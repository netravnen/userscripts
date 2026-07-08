// ==UserScript==
// @name         Rejseplanen - Quick Calendar Export
// @namespace    https://github.com/netravnen/userscripts
// @version      0.8.3
// @description  Adds Outlook.com and Outlook M365 (cloud.microsoft) quick-add buttons to both the production (webapp) and beta (webapp-nextgen) Rejseplanen calendar export UI, plus Google Calendar on production; the beta rows are self-styled rather than cloned from Angular's own components
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
 * Inject Outlook.com and Outlook M365 (cloud.microsoft) quick-add buttons —
 * plus Google Calendar on the production site — into Rejseplanen's calendar
 * export UI, on both the production site (webapp, jQuery/Hafas-widget based)
 * and the beta site (webapp-nextgen, Angular-based). The two variants have
 * unrelated DOM structures and are handled by entirely separate code paths;
 * see the "PRODUCTION SITE" and "BETA SITE" sections below.
 * @returns {void} Returns nothing.
 */
(function () {
  "use strict";

  const INJECTED_FLAG = "rpQuickAddInjected";

  // ─────────────────────────────────────────────────────────────────────────
  // PRODUCTION SITE (webapp) — jQuery/Hafas-widget "Gem" overlay
  // ─────────────────────────────────────────────────────────────────────────

  const ICS_ANCHOR_SELECTOR = "a.hfs_calendarExportFormat.ics";
  const OVERLAY_SELECTOR = ".hfs_calendarExportOverlay";

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

  // ─────────────────────────────────────────────────────────────────────────
  // BETA SITE (webapp-nextgen) — Angular "Add to calendar" panel
  //
  // This UI has no onclick payload to parse (Angular wires clicks via JS, not
  // inline attributes) and already offers a native "Google Calendar" share
  // option, so this variant only adds Outlook.com / Outlook (M365). Trip
  // timing/names are instead recovered from the client-routed connection
  // details URL itself, e.g.:
  //   .../tp/connection-details/<HAFAS ctx>?start=A=...@O=<name>@...&dest=...
  // The <ctx> path segment repeats "$<dep 12-digit local stamp>$<arr 12-digit
  // local stamp>$" once per leg; the very first and very last 12-digit run in
  // the whole ctx are the trip's overall departure/arrival. Times carry no
  // UTC offset (they're Europe/Copenhagen wall-clock), so they're converted
  // using Intl's own DST-aware offset lookup rather than a fixed +1/+2.
  // ─────────────────────────────────────────────────────────────────────────

  const BETA_ICS_LABEL_RE = /\.ics\b/i;
  const BETA_CONNECTION_DETAILS_RE = /\/tp\/connection-details\//;

  /**
   * Extract a stop's display name from a `start=`/`dest=` query parameter
   * value (already URL-decoded by `URLSearchParams`), e.g.
   * `A=2@O=Rugårdsvej 25, 5000 Odense C, Odense Kommune@H=25@...` → the `O=`
   * field up to the next `@`.
   * @param {string|null} paramValue - Specifies the decoded query param value.
   * @returns {string|null} Returns the trimmed stop name, or null when absent.
   */
  function extractQueryStopName(paramValue) {
    if (!paramValue) return null;
    const m = paramValue.match(/@O=([^@]+)@/);
    return m ? m[1].trim() : null;
  }

  /**
   * Check whether a 12-digit string plausibly encodes a `YYYYMMDDHHmm` local
   * timestamp, to filter out incidental 12-digit runs elsewhere in the ctx
   * segment (e.g. inside its trailing base64 blob) before picking the
   * first/last real departure/arrival stamp.
   * @param {string} stamp - Specifies a candidate 12-digit substring.
   * @returns {boolean} Returns true when the value parses as a plausible date/time.
   */
  function isPlausibleLocalStamp(stamp) {
    const y = parseInt(stamp.slice(0, 4), 10);
    const mo = parseInt(stamp.slice(4, 6), 10);
    const d = parseInt(stamp.slice(6, 8), 10);
    const h = parseInt(stamp.slice(8, 10), 10);
    const mi = parseInt(stamp.slice(10, 12), 10);
    const nowYear = new Date().getFullYear();
    return (
      y >= nowYear - 1 &&
      y <= nowYear + 2 &&
      mo >= 1 &&
      mo <= 12 &&
      d >= 1 &&
      d <= 31 &&
      h <= 23 &&
      mi <= 59
    );
  }

  /**
   * Convert a `YYYYMMDDHHmm` Europe/Copenhagen local timestamp into a compact
   * UTC iCalendar timestamp (`YYYYMMDDTHHMMSSZ`), the same shape
   * `TripExportArgs.dateStart`/`dateEnd` use for the production site — so
   * `buildOutlookDeepLink`/`buildGoogleCalendarUrl` work unchanged for both
   * sites. Uses `Intl.DateTimeFormat` to look up Denmark's actual UTC offset
   * for that instant (CET/+1 or CEST/+2) rather than assuming a fixed one.
   * @param {string} stamp - Specifies a 12-digit `YYYYMMDDHHmm` local timestamp.
   * @returns {string} Returns a compact UTC iCalendar timestamp.
   */
  function copenhagenLocalStampToIcsUtc(stamp) {
    const y = parseInt(stamp.slice(0, 4), 10);
    const mo = parseInt(stamp.slice(4, 6), 10);
    const d = parseInt(stamp.slice(6, 8), 10);
    const h = parseInt(stamp.slice(8, 10), 10);
    const mi = parseInt(stamp.slice(10, 12), 10);

    const guessUtcMs = Date.UTC(y, mo - 1, d, h, mi, 0);
    const offsetParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Copenhagen",
      timeZoneName: "shortOffset",
    }).formatToParts(new Date(guessUtcMs));
    const offsetPart = offsetParts.find((p) => p.type === "timeZoneName");
    const offsetMatch = offsetPart && offsetPart.value.match(/GMT([+-]\d+)/);
    const offsetHours = offsetMatch ? parseInt(offsetMatch[1], 10) : 1;

    const utcDate = new Date(guessUtcMs - offsetHours * 60 * 60 * 1000);
    return utcDate.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  }

  /**
   * Parse trip export arguments (matching `TripExportArgs`) out of a beta
   * site connection-details URL.
   * @param {string} href - Specifies the current page URL.
   * @returns {TripExportArgs|null} Returns parsed trip export arguments, or
   *   null when the URL isn't a connection-details view or couldn't be parsed.
   */
  function parseBetaTripArgs(href) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return null;
    }
    if (!BETA_CONNECTION_DETAILS_RE.test(url.pathname)) return null;

    const originName = extractQueryStopName(url.searchParams.get("start"));
    const destName = extractQueryStopName(url.searchParams.get("dest"));
    if (!originName || !destName) return null;

    const ctxSegment = url.pathname.split("/tp/connection-details/")[1];
    if (!ctxSegment) return null;

    let ctx;
    try {
      ctx = decodeURIComponent(ctxSegment);
    } catch {
      return null;
    }

    const stamps = (ctx.match(/\d{12}/g) || []).filter(isPlausibleLocalStamp);
    if (stamps.length < 2) return null;

    return {
      dateStart: copenhagenLocalStampToIcsUtc(stamps[0]),
      dateEnd: copenhagenLocalStampToIcsUtc(stamps[stamps.length - 1]),
      description: encodeURIComponent(`Fra ${originName} til ${destName}.`),
      title: `${originName} → ${destName}`,
      location: "",
    };
  }

  /**
   * Find the beta "Add to calendar" panel's native "Download (.ics)" list
   * item within a subtree, matched by its visible label rather than any
   * Angular-internal class/attribute (which are compiler-generated per build
   * and not a stable target), so detection survives both app rebuilds and UI
   * language changes (".ics" isn't typically localized).
   * @param {Element} scope - Specifies the subtree to search (or match) within.
   * @returns {Element|null} Returns the `<next-gen-list-item>` element, or null.
   */
  function findBetaIcsListItem(scope) {
    const titles = scope.matches?.("next-gen-list-item-title")
      ? [scope]
      : Array.from(scope.querySelectorAll?.("next-gen-list-item-title") || []);

    for (const title of titles) {
      if (BETA_ICS_LABEL_RE.test((title.textContent || "").trim())) {
        return title.closest("next-gen-list-item");
      }
    }
    return null;
  }

  /**
   * Text/icon color for a beta quick-add row, matching the blue used by
   * Rejseplanen's own native "Google Calendar" / "Download (.ics)" rows.
   * @type {string}
   */
  const BETA_ROW_COLOR = "#1a73e8";
  /**
   * Trailing icon color for a beta quick-add row, matching the muted gray
   * used by the native rows' trailing action icons.
   * @type {string}
   */
  const BETA_ROW_SUFFIX_COLOR = "#5f6368";
  /** @type {string} */
  const BETA_ROW_HOVER_BG = "#f1f3f4";

  /**
   * Build a quick-add row from plain elements, visually approximating
   * Rejseplanen's native "Add to calendar" list items (leading icon, title,
   * trailing icon). Cloning the real native `<next-gen-list-item>` was tried
   * first but rendered grayed-out and unclickable — these custom elements
   * evidently carry their own Angular component/Custom-Element JS behavior
   * that a static `cloneNode` copy can't reproduce (no matching component
   * instance/DI context gets attached to a clone) — so this row is fully
   * self-styled instead of borrowing native tags/classes.
   * @param {string} label - Specifies the visible row label.
   * @param {string} url - Specifies the target calendar quick-add URL.
   * @returns {HTMLDivElement} Returns a configured, ready-to-insert row element.
   */
  function makeBetaQuickAddRow(label, url) {
    const row = document.createElement("div");
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.setAttribute("aria-label", label);
    Object.assign(row.style, {
      display: "flex",
      alignItems: "center",
      gap: "12px",
      width: "100%",
      boxSizing: "border-box",
      // Horizontal padding matches the native "Google Calendar"/"Download
      // (.ics)" rows' own left/right inset, so the leading icon/text and the
      // trailing icon line up at the same x-position across all four rows.
      padding: "10px 16px",
      borderRadius: "8px",
      cursor: "pointer",
      color: BETA_ROW_COLOR,
      fontWeight: "600",
      fontSize: "15px",
      userSelect: "none",
    });

    const icon = faIcon("brands", "microsoft");
    icon.style.marginRight = "0";
    icon.style.fontSize = "20px";
    icon.style.flex = "0 0 auto";

    const titleEl = document.createElement("span");
    titleEl.textContent = label;

    // margin-left: auto pushes the suffix icon to the row's far right edge
    // (matching the native "Google Calendar"/"Download (.ics)" rows) — more
    // robust than relying on the title's own flex-grow, which has no free
    // space to expand into unless the row is explicitly full-width.
    const suffixIcon = faIcon("regular", "share-from-square");
    suffixIcon.style.marginRight = "0";
    suffixIcon.style.marginLeft = "auto";
    suffixIcon.style.fontSize = "16px";
    suffixIcon.style.color = BETA_ROW_SUFFIX_COLOR;
    suffixIcon.style.flex = "0 0 auto";

    row.appendChild(icon);
    row.appendChild(titleEl);
    row.appendChild(suffixIcon);

    row.addEventListener("mouseenter", () => {
      row.style.background = BETA_ROW_HOVER_BG;
    });
    row.addEventListener("mouseleave", () => {
      row.style.background = "";
    });

    /**
     * Open the quick-add URL in a new tab.
     * @returns {void} Returns nothing.
     */
    function openInNewTab() {
      window.open(url, "_blank", "noopener,noreferrer");
    }

    row.addEventListener("click", openInNewTab);
    row.addEventListener(
      "keydown",
      /**
       * Activate the row on Enter/Space, matching native button semantics.
       * @param {KeyboardEvent} e - Specifies the keydown event.
       * @returns {void} Returns nothing.
       */
      function handleKeydown(e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openInNewTab();
        }
      },
    );

    return row;
  }

  /**
   * Parse trip export arguments from the current beta site URL and insert
   * Outlook.com / Outlook (M365) quick-add rows directly after the native
   * "Download (.ics)" row. A no-op when the URL can't be parsed as a
   * connection-details view, or when rows have already been injected for
   * this panel instance.
   * @param {Element} icsListItem - Specifies the native `<next-gen-list-item>`
   *   for "Download (.ics)".
   * @returns {void} Returns nothing.
   */
  function injectBetaQuickAddButtons(icsListItem) {
    const wrapper = icsListItem.parentElement;
    if (!wrapper || wrapper.dataset[INJECTED_FLAG] === "1") return;

    const args = parseBetaTripArgs(location.href);
    if (!args) return;

    wrapper.dataset[INJECTED_FLAG] = "1";

    const outlookUrl = buildOutlookDeepLink("https://outlook.live.com", args);
    const outlookM365Url = buildOutlookDeepLink(
      "https://outlook.cloud.microsoft",
      args,
    );

    let anchor = wrapper;
    [
      outlookUrl && { label: "Outlook.com", url: outlookUrl },
      outlookM365Url && { label: "Outlook (M365)", url: outlookM365Url },
    ]
      .filter(Boolean)
      .forEach(({ label, url }) => {
        const row = makeBetaQuickAddRow(label, url);
        anchor.insertAdjacentElement("afterend", row);
        anchor = row;
      });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SHARED — mutation observer wiring for both site variants
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Handle a single DOM node added anywhere in the page, checking whether it
   * is (or contains) either site variant's calendar-export entry point and
   * injecting quick-add buttons when found.
   * @param {Node} node - Specifies an added DOM node from a MutationObserver record.
   * @returns {void} Returns nothing.
   */
  function handleAddedNode(node) {
    if (!(node instanceof HTMLElement)) return;

    const icsAnchor = node.matches(ICS_ANCHOR_SELECTOR)
      ? node
      : node.querySelector(ICS_ANCHOR_SELECTOR);
    if (icsAnchor) {
      injectQuickAddButtons(icsAnchor);
      return;
    }

    const betaIcsListItem = findBetaIcsListItem(node);
    if (betaIcsListItem) injectBetaQuickAddButtons(betaIcsListItem);
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
