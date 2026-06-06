// ==UserScript==
// @name         Palo Alto Networks SaaS EDL Table Downloader
// @namespace    https://github.com/netravnen/userscripts
// @version      1.2.0
// @description  Floating panel with one-click JSON, CSV, and plain text URL download buttons for Palo Alto Networks SaaS EDL tables
// @author       -
// @icon         https://www.paloaltonetworks.com/favicon.ico
// @license      MIT
// @match        https://docs.paloaltonetworks.com/*
// @match        https://saasedl.paloaltonetworks.com/*
// @updateURL    https://github.com/netravnen/userscripts/raw/refs/heads/main/paloalto-saasedl-downloader.meta.js
// @downloadURL  https://github.com/netravnen/userscripts/raw/refs/heads/main/paloalto-saasedl-downloader.user.js
// @supportURL   https://github.com/netravnen/userscripts/issues
// @require      https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/js/fontawesome.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/js/regular.min.js
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

/**
 * Technical data extractor and file downloader for Palo Alto SaaS EDL tables.
 * Surfaces a floating UI container with standalone JSON, CSV, and TXT URL export buttons.
 *
 * v1.2.0 improvements:
 *  - Live feed count badge with 5 s auto-refresh
 *  - Timestamped filenames (ISO date suffix) to prevent silent overwrites
 *  - Source / Optimised list toggle
 *  - Draggable panel
 *
 * @returns {void} Returns nothing.
 */
(function () {
  "use strict";

  const PANEL_ID       = "paloalto-edl-download-panel";
  const MAX_INIT_RETRIES = 10;
  const FEED_SELECTOR  = 'a[href^="https://saasedl.paloaltonetworks.com/feeds/"]';

  /** @type {number} */
  let initRetryCount = 0;

  /**
   * Whether the URL export should reference the optimised list (true) or the
   * raw source list (false). Toggled by the in-panel checkbox.
   * @type {boolean}
   */
  let useOptimized = true;

  // ─────────────────────────────────────────────────────────────────────────
  // TYPEDEF DECLARATIONS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * @typedef {Object} EDLFeedRow
   * @property {string} name           - The extracted name of the feed.
   * @property {string} description    - The functional description of the endpoint.
   * @property {string} address_family - The IP version or classification.
   * @property {string} source_list    - URL to the original unoptimised list.
   * @property {string} optimized_list - URL to the Palo Alto Networks optimised list.
   * @property {string} last_changed   - Timestamp documenting when payload mutations were recorded.
   * @property {string} last_checked   - Timestamp logging when the parsing engine validated the state.
   */

  /**
   * @typedef {Object} ButtonConfig
   * @property {string}           label      - Visual button text.
   * @property {string}           icon       - FontAwesome icon identifier (without `fa-` prefix).
   * @property {function():string} filename  - Callback returning the suggested download filename.
   * @property {string}           mimeType   - Standard web content-type descriptor.
   * @property {HTMLSpanElement}  liveRegion - Screen-reader notification area.
   * @property {function():string} getData   - Callback invoked to generate text contents for serialisation.
   */

  // ─────────────────────────────────────────────────────────────────────────
  // UTILITY HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Returns an ISO-8601 date string (YYYY-MM-DD) for today in local time.
   * Used to generate timestamped filenames that prevent silent overwrites.
   * @returns {string} Date stamp string.
   */
  function isoStamp() {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Create a Font Awesome regular-style icon element.
   * @param {string} name - Icon name without the `fa-` prefix.
   * @returns {HTMLElement} Configured `<i>` icon element.
   */
  function faIcon(name) {
    const i = document.createElement("i");
    i.className = `fa-regular fa-${name}`;
    i.setAttribute("aria-hidden", "true");
    i.style.pointerEvents = "none";
    return i;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DATA EXTRACTION ENGINE
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Scrapes the structural DOM tables for live SaaS EDL feed profiles.
   * @returns {EDLFeedRow[]} Array of structured feed metadata.
   */
  function extractEDLTableData() {
    /** @type {EDLFeedRow[]} */
    const results = [];
    const feedAnchors = document.querySelectorAll(FEED_SELECTOR);

    feedAnchors.forEach((item) => {
      const row = item.closest("tr");
      if (!row) return;

      const cells = row.querySelectorAll("td");
      if (cells.length < 7) return;

      const name = cells[0].textContent.trim();

      const urlAnchor  = cells[1].querySelector("a");
      const paragraphs = cells[1].querySelectorAll("p");
      let description  = "";
      if (paragraphs.length > 1) {
        description = paragraphs[1].textContent.trim();
      } else if (paragraphs.length === 1 && !urlAnchor) {
        description = paragraphs[0].textContent.trim();
      } else {
        description = cells[1].textContent
          .replace(urlAnchor ? urlAnchor.textContent : "", "")
          .trim();
      }

      const address_family = cells[2].textContent.trim();

      const sourceLink    = cells[3].querySelector("a");
      const source_list   = sourceLink ? sourceLink.href.trim() : "";

      const optimizedLink  = cells[4].querySelector("a");
      const optimized_list = optimizedLink ? optimizedLink.href.trim() : "";

      const last_changed = cells[5].textContent.trim();
      const last_checked = cells[6].textContent.trim();

      results.push({
        name,
        description,
        address_family,
        source_list,
        optimized_list,
        last_changed,
        last_checked,
      });
    });

    return results;
  }

  /**
   * Formats a dataset into an RFC 4180 compliant CSV string payload.
   * @param {EDLFeedRow[]} data - Source data array.
   * @returns {string} Fully structured CSV table.
   */
  function convertToCSV(data) {
    const headers = [
      "name",
      "description",
      "address_family",
      "source_list",
      "optimized_list",
      "last_changed",
      "last_checked",
    ];

    const csvRows = [headers.map((h) => `"${h}"`).join(",")];

    data.forEach((row) => {
      const values = headers.map((header) => {
        const val     = row[header] || "";
        const escaped = val.replace(/"/g, '""');
        return `"${escaped}"`;
      });
      csvRows.push(values.join(","));
    });

    return csvRows.join("\n");
  }

  /**
   * Extracts a plain string list containing feed URLs.
   * Respects the global `useOptimized` toggle — returns either
   * the optimised or the raw source URL per row.
   * @param {EDLFeedRow[]} data - Source data array.
   * @returns {string} Newline-delimited URI list.
   */
  function convertToURLList(data) {
    return data
      .map((row) => (useOptimized ? row.optimized_list : row.source_list))
      .filter((url) => url && url.trim() !== "")
      .join("\n");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PANEL COMPONENT BUILDERS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Build a unified actionable download interface element.
   * @param {ButtonConfig} config - Button presentation and processing options.
   * @returns {HTMLButtonElement} Fully event-wrapped download trigger button.
   */
  function makeDownloadButton(config) {
    const BG_BASE    = "#005073";
    const BG_HOVER   = "#1d6fa5";
    const BG_SUCCESS = "#1f8a4c";
    const BG_ERROR   = "#b00020";

    /** @type {number|null} */
    let resetTimer = null;

    const btn = document.createElement("button");
    btn.setAttribute("aria-label", config.label);

    const icon  = faIcon(config.icon);
    const label = document.createElement("span");
    label.textContent   = ` ${config.label}`;
    label.style.pointerEvents = "none";

    btn.appendChild(icon);
    btn.appendChild(label);

    Object.assign(btn.style, {
      display:        "inline-flex",
      alignItems:     "center",
      background:     BG_BASE,
      color:          "#ffffff",
      border:         "none",
      borderRadius:   "8px",
      padding:        "9px 15px",
      fontSize:       "12px",
      fontWeight:     "700",
      letterSpacing:  "0.02em",
      cursor:         "pointer",
      boxShadow:      "0 3px 12px rgba(0,0,0,0.45)",
      whiteSpace:     "nowrap",
      userSelect:     "none",
      transition:     "background 0.12s ease",
      lineHeight:     "1.4",
      gap:            "6px",
      width:          "100%",
    });

    btn.addEventListener("mouseenter", () => {
      if (!btn.dataset.active) btn.style.background = BG_HOVER;
    });
    btn.addEventListener("mouseleave", () => {
      if (!btn.dataset.active) btn.style.background = BG_BASE;
    });

    btn.addEventListener("click", () => {
      if (btn.dataset.active) return;
      btn.dataset.active = "1";
      btn.style.cursor   = "default";

      let blobUrl = null;
      const dlAnchor = document.createElement("a");

      try {
        const textPayload = config.getData();

        if (!textPayload || textPayload.trim() === "" || textPayload === "[]") {
          throw new Error("No data found");
        }

        const textBlob = new Blob([textPayload], { type: config.mimeType });
        blobUrl        = URL.createObjectURL(textBlob);

        dlAnchor.href     = blobUrl;
        dlAnchor.download = config.filename();   // ← callback for timestamped name
        dlAnchor.style.display = "none";
        document.body.appendChild(dlAnchor);
        dlAnchor.click();

        label.textContent = " ✓ Downloadet!";
        btn.style.background = BG_SUCCESS;
        btn.setAttribute("aria-label", "Download startet succesfuldt");
        config.liveRegion.textContent = `Filen ${config.filename()} er blevet gemt`;
      } catch (_err) {
        label.textContent = " ❌ Ingen data fundet";
        btn.style.background = BG_ERROR;
        btn.setAttribute("aria-label", "Download fejlede");
        config.liveRegion.textContent = "Download fejlede. Ingen tabelelementer tilgængelige.";
      } finally {
        if (dlAnchor.parentNode) document.body.removeChild(dlAnchor);
        if (blobUrl)             URL.revokeObjectURL(blobUrl);
      }

      if (resetTimer !== null) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        delete btn.dataset.active;
        label.textContent = ` ${config.label}`;
        btn.style.background = BG_BASE;
        btn.style.cursor     = "pointer";
        btn.setAttribute("aria-label", config.label);
        config.liveRegion.textContent = "";
      }, 2500);
    });

    return btn;
  }

  /**
   * Build and inject the floating interface panel into the viewport.
   * Includes:
   *  - Draggable handle
   *  - Live feed-count badge (auto-refreshes every 5 s)
   *  - Source / Optimised toggle
   *  - JSON, CSV, and plain URL download buttons
   *  - Dismiss (×) button
   * @returns {void}
   */
  function buildPanel() {
    if (document.getElementById(PANEL_ID)) return;

    // ── Root panel ──────────────────────────────────────────────────────────
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", "SaaS EDL data downloader panel");

    Object.assign(panel.style, {
      position:   "fixed",
      bottom:     "24px",
      right:      "24px",
      zIndex:     "9999",
      display:    "flex",
      flexDirection: "column",
      gap:        "8px",
      fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
      background: "#f5f7fa",
      border:     "1px solid #c8d0db",
      borderRadius: "10px",
      padding:    "10px 12px 12px",
      boxShadow:  "0 6px 24px rgba(0,0,0,0.18)",
      minWidth:   "210px",
    });

    // ── Visually-hidden ARIA live region ─────────────────────────────────────
    const liveRegion = document.createElement("span");
    liveRegion.setAttribute("aria-live", "polite");
    liveRegion.setAttribute("aria-atomic", "true");
    Object.assign(liveRegion.style, {
      position:  "absolute",
      width:     "1px",
      height:    "1px",
      padding:   "0",
      margin:    "-1px",
      overflow:  "hidden",
      clip:      "rect(0,0,0,0)",
      whiteSpace:"nowrap",
      border:    "0",
    });
    panel.appendChild(liveRegion);

    // ── Draggable handle ─────────────────────────────────────────────────────
    const handle = document.createElement("div");
    handle.textContent = "⠿  EDL Downloader";
    Object.assign(handle.style, {
      cursor:     "grab",
      fontSize:   "11px",
      fontWeight: "700",
      color:      "#444",
      userSelect: "none",
      marginBottom: "2px",
    });

    let dragging = false, dragOffX = 0, dragOffY = 0;

    handle.addEventListener("mousedown", (e) => {
      dragging = true;
      const rect = panel.getBoundingClientRect();
      dragOffX = e.clientX - rect.left;
      dragOffY = e.clientY - rect.top;
      handle.style.cursor = "grabbing";
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      panel.style.right  = "auto";
      panel.style.bottom = "auto";
      panel.style.left   = `${e.clientX - dragOffX}px`;
      panel.style.top    = `${e.clientY - dragOffY}px`;
    });

    document.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      handle.style.cursor = "grab";
    });

    // ── Dismiss button (inside handle row) ───────────────────────────────────
    const headerRow = document.createElement("div");
    Object.assign(headerRow.style, {
      display:        "flex",
      justifyContent: "space-between",
      alignItems:     "center",
    });

    const dismissBtn = document.createElement("button");
    dismissBtn.textContent = "×";
    dismissBtn.setAttribute("aria-label", "Luk panel");
    dismissBtn.title = "Luk panel";
    Object.assign(dismissBtn.style, {
      background:  "transparent",
      border:      "none",
      color:       "#666",
      cursor:      "pointer",
      fontSize:    "18px",
      lineHeight:  "1",
      padding:     "0 2px",
      userSelect:  "none",
      fontWeight:  "bold",
    });
    dismissBtn.addEventListener("click", () => { panel.style.display = "none"; });

    headerRow.appendChild(handle);
    headerRow.appendChild(dismissBtn);
    panel.appendChild(headerRow);

    // ── Live feed-count badge ─────────────────────────────────────────────────
    const badge = document.createElement("div");
    Object.assign(badge.style, {
      fontSize:    "11px",
      color:       "#666",
      textAlign:   "right",
      paddingBottom: "4px",
      borderBottom: "1px solid #dce0e6",
      marginBottom: "2px",
    });

    function refreshBadge() {
      const n = document.querySelectorAll(FEED_SELECTOR).length;
      badge.textContent = `${n} feeds detected`;
    }
    refreshBadge();
    setInterval(refreshBadge, 5000);
    panel.appendChild(badge);

    // ── Source / Optimised toggle ─────────────────────────────────────────────
    const toggleWrapper = document.createElement("label");
    Object.assign(toggleWrapper.style, {
      display:    "flex",
      alignItems: "center",
      gap:        "6px",
      fontSize:   "11px",
      color:      "#333",
      cursor:     "pointer",
      userSelect: "none",
    });

    const checkbox = document.createElement("input");
    checkbox.type    = "checkbox";
    checkbox.checked = true;
    checkbox.setAttribute("aria-label", "Brug optimiseret liste i URL-export");
    checkbox.addEventListener("change", () => { useOptimized = checkbox.checked; });

    toggleWrapper.appendChild(checkbox);
    toggleWrapper.appendChild(document.createTextNode("Brug optimiseret liste"));
    panel.appendChild(toggleWrapper);

    // ── Download buttons ──────────────────────────────────────────────────────

    // JSON
    panel.appendChild(
      makeDownloadButton({
        label:    "Download JSON",
        icon:     "file-code",
        filename: () => `paloalto-saasedl-${isoStamp()}.json`,
        mimeType: "application/json;charset=utf-8;",
        liveRegion,
        getData:  () => JSON.stringify(extractEDLTableData(), null, 2),
      })
    );

    // CSV
    panel.appendChild(
      makeDownloadButton({
        label:    "Download CSV",
        icon:     "file",
        filename: () => `paloalto-saasedl-${isoStamp()}.csv`,
        mimeType: "text/csv;charset=utf-8;",
        liveRegion,
        getData:  () => convertToCSV(extractEDLTableData()),
      })
    );

    // Plain URL list
    panel.appendChild(
      makeDownloadButton({
        label:    "Download URL'er",
        icon:     "file-lines",
        filename: () => `paloalto-saasedl-urls-${isoStamp()}.txt`,
        mimeType: "text/plain;charset=utf-8;",
        liveRegion,
        getData:  () => convertToURLList(extractEDLTableData()),
      })
    );

    document.body.appendChild(panel);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INIT + MUTATION OBSERVER RETRY
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Evaluates table viability and initiates setup.
   * @returns {boolean} True if drawing succeeds.
   */
  function initScript() {
    if (!document.body) return false;
    const currentAnchors = document.querySelectorAll(FEED_SELECTOR);
    if (currentAnchors.length === 0) return false;
    buildPanel();
    return true;
  }

  if (!initScript()) {
    const retryObserver = new MutationObserver(function retryOnMutation() {
      initRetryCount += 1;
      if (initScript() || initRetryCount >= MAX_INIT_RETRIES) {
        retryObserver.disconnect();
      }
    });
    retryObserver.observe(document.body, { childList: true, subtree: true });
  }
})();