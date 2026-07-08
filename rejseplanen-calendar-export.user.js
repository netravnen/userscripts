// ==UserScript==
// @name         Rejseplanen - Quick Calendar Export
// @namespace    https://github.com/netravnen/userscripts
// @version      0.7.1
// @description  Adds Outlook.com, Outlook M365 (cloud.microsoft), and Google Calendar quick-add buttons using Rejseplanen's own native "Detaljer"-style secondary button classes, alongside the native "Gem" (.ics) button, with condensed overlay copy to make room
// @author       -
// @icon         https://www.rejseplanen.dk/favicon.ico
// @license      MIT
// @match        https://*.rejseplanen.dk/*
// @updateURL    https://github.com/netravnen/userscripts/raw/refs/heads/main/rejseplanen-calendar-export.meta.js
// @downloadURL  https://github.com/netravnen/userscripts/raw/refs/heads/main/rejseplanen-calendar-export.user.js
// @supportURL   https://github.com/netravnen/userscripts/issues
// @require      https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/js/fontawesome.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/js/brands.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/js/regular.min.js
// @grant        none
// @noframes
// @run-at       document-idle
// ==/UserScript==

/**
 * Inject Outlook.com, Outlook M365 (cloud.microsoft), and Google Calendar
 * quick-add buttons into Rejseplanen's "Gem" (.ics export) overlay.
 * @returns {void} Returns nothing.
 */
(function () {
  "use strict";

  const ICS_ANCHOR_SELECTOR = "a.hfs_calendarExportFormat.ics";
  const OVERLAY_SELECTOR = ".hfs_calendarExportOverlay";
  const INJECTED_FLAG = "rpQuickAddInjected";

  /**
   * Condensed replacement text for the overlay's "Sådan gør du" step list,
   * indexed positionally to match Rejseplanen's own three `<li>` steps.
   * Shorter phrasing than the site's default copy, so the instructional text
   * takes up less vertical space, leaving more room for the quick-add button
   * grid without altering the surrounding `<li>` markup.
   * @type {string[]}
   */
  const CONDENSED_STEPS = [
    "Vælg en kalender nedenfor",
    "Gem/åbn .ics-filen i din kalender",
    "Tjek rejsen igen inden afgang",
  ];

  /**
   * Condensed replacement text for the overlay's "Du kan gemme..." intro
   * paragraph (the `<div class="col-xs-12 hfs_noPadding">` with no link).
   * @type {string}
   */
  const CONDENSED_INTRO =
    "Gemmes som en kalenderaftale med rejsedetaljer og link til rejseplanen.dk.";

  /**
   * Condensed replacement text prefixed before the preserved "her" link in
   * the overlay's "Læs mere om hvilke kalendere..." paragraph.
   * @type {string}
   */
  const CONDENSED_MORE_INFO_PREFIX = "Mere info ";

  /**
   * Regular expression matching the Hafas.Util.exportIcs(...) call embedded in
   * the "Gem" (.ics) anchor's onclick attribute. Capture groups follow the
   * fixed key order emitted by Rejseplanen's server-side template: dateStart,
   * dateEnd, description, title, location. `\s*` tolerates both the compact
   * single-line form the template renders and pretty-printed/reformatted
   * multi-line markup; the trailing `,?` tolerates an optional trailing comma
   * before the closing brace.
   * @type {RegExp}
   */
  const EXPORT_ICS_RE =
    /Hafas\.Util\.exportIcs\(\{\s*dateStart:\s*'([^']*)',\s*dateEnd:\s*'([^']*)',\s*description:\s*'([^']*)',\s*title:\s*'([^']*)',\s*location:\s*'([^']*)'\s*,?\s*\}\)/;

  /**
   * @typedef {Object} TripExportArgs
   * @property {string} dateStart - Trip start timestamp in compact UTC iCalendar
   *   form (`YYYYMMDDTHHMMSSZ`), taken verbatim from the exportIcs() call.
   * @property {string} dateEnd - Trip end timestamp in the same compact UTC form.
   * @property {string} description - URL-encoded, human-readable itinerary text.
   * @property {string} title - Trip summary text (not URL-encoded).
   * @property {string} location - Trip location text (not URL-encoded), usually empty.
   */

  /**
   * Parse the trip's Hafas.Util.exportIcs(...) arguments out of a "Gem" anchor's
   * onclick attribute string.
   * @param {string} onclickAttr - Specifies the raw onclick attribute value.
   * @returns {TripExportArgs|null} Returns parsed trip export arguments, or null
   *   when the onclick attribute does not match the expected call shape.
   */
  function parseExportIcsArgs(onclickAttr) {
    const m = onclickAttr.match(EXPORT_ICS_RE);
    if (!m) return null;

    return {
      dateStart: m[1].trim(),
      dateEnd: m[2].trim(),
      description: m[3],
      title: m[4].trim(),
      location: m[5].trim(),
    };
  }

  /**
   * Decode a percent-encoded itinerary description into readable text.
   * Falls back to the raw input when decoding fails.
   * @param {string} raw - Specifies the percent-encoded description text.
   * @returns {string} Returns the decoded description text.
   */
  function decodeDescription(raw) {
    try {
      return decodeURIComponent(raw).trim();
    } catch {
      return raw.trim();
    }
  }

  /**
   * Convert a compact UTC iCalendar timestamp (`YYYYMMDDTHHMMSSZ`) into an
   * ISO-8601 UTC timestamp (`YYYY-MM-DDTHH:MM:SSZ`) suitable for Outlook's
   * calendar compose deep link.
   * @param {string} icsUtc - Specifies a compact UTC iCalendar timestamp.
   * @returns {string|null} Returns an ISO-8601 timestamp, or null when the
   *   input does not match the expected compact UTC form.
   */
  function icsUtcToIso(icsUtc) {
    const m = icsUtc.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    if (!m) return null;
    const [, y, mo, d, h, mi, s] = m;
    return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
  }

  /**
   * Build a Google Calendar "quick add" event URL for a parsed trip.
   * @param {TripExportArgs} args - Specifies the parsed trip export arguments.
   * @returns {string} Returns a fully-formed Google Calendar event URL.
   */
  function buildGoogleCalendarUrl(args) {
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: args.title,
      dates: `${args.dateStart}/${args.dateEnd}`,
      details: decodeDescription(args.description),
      location: args.location,
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  /**
   * Build an Outlook calendar compose deep link for a parsed trip.
   * Shared by both the personal Outlook.com and the M365 (cloud.microsoft)
   * targets, which expose the same deep link route on different origins.
   * @param {string} origin - Specifies the Outlook web origin
   *   (e.g. `https://outlook.live.com` or `https://outlook.cloud.microsoft`).
   * @param {TripExportArgs} args - Specifies the parsed trip export arguments.
   * @returns {string|null} Returns a fully-formed Outlook compose deep link, or
   *   null when the trip's timestamps could not be converted to ISO-8601.
   */
  function buildOutlookDeepLink(origin, args) {
    const startdt = icsUtcToIso(args.dateStart);
    const enddt = icsUtcToIso(args.dateEnd);
    if (!startdt || !enddt) return null;

    const params = new URLSearchParams({
      path: "/calendar/action/compose",
      rru: "addevent",
      startdt,
      enddt,
      subject: args.title,
      body: decodeDescription(args.description),
      location: args.location,
      allday: "false",
    });
    return `${origin}/calendar/0/deeplink/compose?${params.toString()}`;
  }

  /**
   * Layout-only inline styling shared by every button in the quick-add grid.
   * Deliberately excludes any background/border/color/radius so each button
   * renders with whatever appearance its own native classes give it, rather
   * than a hand-picked color scheme. Font size is left unset so buttons
   * inherit the site's own `.hfs_btn` text size.
   * @type {Object.<string, string>}
   */
  const GRID_LAYOUT_STYLE = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: "8px 6px",
    width: "100%",
    minWidth: "0",
    boxSizing: "border-box",
    whiteSpace: "normal",
  };

  /**
   * Class list for the three new quick-add buttons (Outlook.com, Outlook
   * M365, Google Kalender). Rejseplanen's own trip list shows this exact
   * combination — `hfs_btn hfs_btnPrimary` without the `hfs_atomPrimaryBtn`
   * modifier that gives "Pris & køb" its solid amber fill — rendered as the
   * plain bordered "Detaljer" button. Reusing it natively (rather than
   * hand-picking colors/border-radius) guarantees a pixel-exact match to the
   * site's own secondary button, including its hover/focus states.
   * @type {string}
   */
  const SECONDARY_BUTTON_CLASS = "hfs_btn hfs_btnPrimary hfs_calendarExportFormat";

  /**
   * Create a Font Awesome icon element for the given style/name pair.
   * The element is converted to an inline SVG by the FA MutationObserver
   * loaded via `@require`.
   * @param {string} style - Specifies the Font Awesome style prefix without
   *   the `fa-` prefix (e.g. `"brands"`, `"regular"`).
   * @param {string} name - Specifies the icon name without the `fa-` prefix.
   * @returns {HTMLElement} Returns a configured icon element.
   */
  function faIcon(style, name) {
    const i = document.createElement("i");
    i.className = `fa-${style} fa-${name}`;
    i.setAttribute("aria-hidden", "true");
    i.style.pointerEvents = "none";
    i.style.marginRight = "6px";
    return i;
  }

  /**
   * Create a quick-add button using Rejseplanen's own `hfs_btn hfs_btnPrimary`
   * secondary-button classes (matching "Detaljer"'s native white/bordered
   * look — see `SECONDARY_BUTTON_CLASS`), opening the given calendar URL in a
   * new tab.
   * @param {string} url - Specifies the target calendar quick-add URL.
   * @param {string} label - Specifies the visible button label.
   * @param {string} iconName - Specifies the Font Awesome brand icon name
   *   without the `fa-` prefix.
   * @returns {HTMLAnchorElement} Returns a configured quick-add button anchor.
   */
  function makeQuickAddButton(url, label, iconName) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = label;
    a.setAttribute("aria-label", label);
    a.className = SECONDARY_BUTTON_CLASS;
    Object.assign(a.style, GRID_LAYOUT_STYLE);

    a.appendChild(faIcon("brands", iconName));
    a.appendChild(document.createTextNode(label));
    return a;
  }

  /**
   * Resize the original "Gem" (.ics) anchor to match the quick-add buttons'
   * grid sizing and prepend a floppy-disk save icon, without altering its
   * classes, native amber `hfs_btnPrimary` appearance, label text, or click
   * behavior — "Gem" keeps looking like the site's own primary action button
   * (e.g. "Pris & køb") rather than adopting a custom color scheme.
   * @param {HTMLAnchorElement} icsAnchor - Specifies the "Gem" (.ics) export anchor.
   * @returns {void} Returns nothing.
   */
  function styleGemForGrid(icsAnchor) {
    Object.assign(icsAnchor.style, GRID_LAYOUT_STYLE);
    icsAnchor.insertBefore(faIcon("regular", "floppy-disk"), icsAnchor.firstChild);
  }

  /**
   * Arrange button anchors into a two-column CSS grid. When the button count
   * is odd, the last button spans both columns so the grid never leaves a
   * dangling empty cell.
   * @param {HTMLAnchorElement[]} buttons - Specifies the button anchors to lay out.
   * @returns {HTMLDivElement} Returns a configured grid container element.
   */
  function makeQuickAddGrid(buttons) {
    const grid = document.createElement("div");
    Object.assign(grid.style, {
      display: "grid",
      // minmax(0, 1fr), not plain 1fr: plain 1fr defaults to minmax(auto, 1fr),
      // which refuses to shrink a column below its content's min-content width
      // and pushes the row wider than the popup instead of wrapping the label.
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gap: "6px",
      width: "100%",
      boxSizing: "border-box",
    });

    buttons.forEach((btn, i) => {
      if (i === buttons.length - 1 && buttons.length % 2 !== 0) {
        btn.style.gridColumn = "1 / -1";
      }
      grid.appendChild(btn);
    });

    return grid;
  }

  /**
   * Wrap the quick-add button grid in a full-width `col-xs-12` row — the same
   * class Rejseplanen uses for its own full-bleed overlay text (e.g. the "Du
   * kan gemme..." paragraph) — so the grid spans the entire popup width
   * instead of being confined to the `col-lg-6` half-column the original
   * "Gem" row used.
   * @param {HTMLElement} content - Specifies the element to place in the row.
   * @returns {HTMLDivElement} Returns a configured full-width row element.
   */
  function wrapInExportRow(content) {
    const row = document.createElement("div");
    row.className = "col-xs-12";
    row.style.marginTop = "6px";
    row.appendChild(content);
    return row;
  }

  /**
   * Shorten the overlay's own instructional copy in place: the three
   * "Sådan gør du" step `<li>` items, and both `<div class="col-xs-12
   * hfs_noPadding">` paragraphs below them. Only text content is replaced —
   * every element, class, and the preserved "her" link stay exactly as
   * Rejseplanen renders them — freeing vertical space for the quick-add
   * button grid without touching markup.
   * @param {Element} overlayScope - Specifies the overlay element to search within.
   * @returns {void} Returns nothing.
   */
  function condenseOverlayText(overlayScope) {
    overlayScope.querySelectorAll(".hfs_decimalList > li").forEach((li, i) => {
      if (CONDENSED_STEPS[i]) li.textContent = CONDENSED_STEPS[i];
    });

    overlayScope
      .querySelectorAll(".col-xs-12.hfs_noPadding")
      .forEach((paragraph) => {
        const link = paragraph.querySelector("a");
        if (!link) {
          paragraph.textContent = CONDENSED_INTRO;
          return;
        }

        [...paragraph.childNodes].forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE) node.remove();
        });
        paragraph.insertBefore(
          document.createTextNode(CONDENSED_MORE_INFO_PREFIX),
          link,
        );
        link.insertAdjacentText("afterend", ".");
      });
  }

  /**
   * Parse trip export arguments from the "Gem" (.ics) anchor and replace its
   * row with a unified two-column grid containing the (relocated, resized,
   * icon-tagged) "Gem" button alongside Outlook.com, Outlook M365, and Google
   * Calendar quick-add buttons. Also condenses the overlay's own instructional
   * copy (see `condenseOverlayText`) to free up vertical space for the grid.
   * A no-op when the anchor's onclick attribute cannot be parsed, or when the
   * grid has already been injected for this overlay instance.
   * @param {HTMLAnchorElement} icsAnchor - Specifies the "Gem" (.ics) export anchor.
   * @returns {void} Returns nothing.
   */
  function injectQuickAddButtons(icsAnchor) {
    const existingRow = icsAnchor.closest(".col-lg-12");
    if (!existingRow || existingRow.dataset[INJECTED_FLAG] === "1") return;

    const args = parseExportIcsArgs(icsAnchor.getAttribute("onclick") || "");
    if (!args) return;

    const overlayScope = icsAnchor.closest(OVERLAY_SELECTOR);
    if (overlayScope) condenseOverlayText(overlayScope);

    const outlookUrl = buildOutlookDeepLink("https://outlook.live.com", args);
    const outlookM365Url = buildOutlookDeepLink(
      "https://outlook.cloud.microsoft",
      args,
    );
    const googleUrl = buildGoogleCalendarUrl(args);

    styleGemForGrid(icsAnchor);

    // Row 1: Gem | Google Kalender. Row 2: Outlook.com | Outlook (M365).
    const buttons = [
      icsAnchor,
      makeQuickAddButton(googleUrl, "Google Kalender", "google"),
      outlookUrl && makeQuickAddButton(outlookUrl, "Outlook.com", "microsoft"),
      outlookM365Url &&
        makeQuickAddButton(outlookM365Url, "Outlook (M365)", "microsoft"),
    ].filter(Boolean);

    const gridRow = wrapInExportRow(makeQuickAddGrid(buttons));
    gridRow.dataset[INJECTED_FLAG] = "1";
    existingRow.replaceWith(gridRow);
  }

  /**
   * Handle a single DOM node added anywhere in the page, checking whether it
   * is (or contains) the "Gem" (.ics) export anchor and injecting quick-add
   * buttons when found.
   * @param {Node} node - Specifies an added DOM node from a MutationObserver record.
   * @returns {void} Returns nothing.
   */
  function handleAddedNode(node) {
    if (!(node instanceof HTMLElement)) return;

    const icsAnchor = node.matches(ICS_ANCHOR_SELECTOR)
      ? node
      : node.querySelector(ICS_ANCHOR_SELECTOR);
    if (icsAnchor) injectQuickAddButtons(icsAnchor);
  }

  const overlayObserver = new MutationObserver(
    /**
     * Process all added nodes across a batch of DOM mutations, looking for a
     * newly-opened "Gem" (.ics) export overlay.
     * @param {MutationRecord[]} mutations - Specifies the observed mutation records.
     * @returns {void} Returns nothing.
     */
    function handleMutations(mutations) {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach(handleAddedNode);
      }
    },
  );

  overlayObserver.observe(document.body, { childList: true, subtree: true });
})();
