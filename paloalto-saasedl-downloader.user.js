// ==UserScript==
// @name         Palo Alto Networks SaaS EDL Table Downloader
// @namespace    https://github.com/netravnen/userscripts
// @version      1.1.0
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
 * @returns {void} Returns nothing.
 */
(function () {
  "use strict";

  const PANEL_ID = "paloalto-edl-download-panel";
  const MAX_INIT_RETRIES = 10;

  /** @type {number} */
  let initRetryCount = 0;

  /**
   * @typedef {Object} EDLFeedRow
   * @property {string} name - The extracted name of the feed.
   * @property {string} description - The functional description of the endpoint.
   * @property {string} address_family - The IP version or classification.
   * @property {string} source_list - The URL to the original unoptimized list.
   * @property {string} optimized_list - The URL to the Palo Alto Networks optimized list.
   * @property {string} last_changed - Timestamp documenting when payload mutations were recorded.
   * @property {string} last_checked - Timestamp logging when the parsing engine validated the state.
   */

  /**
   * @typedef {Object} ButtonConfig
   * @property {string} label - Specifies the visual button text.
   * @property {string} icon - Specifies the FontAwesome icon identifier.
   * @property {string} filename - Specifies the suggested leaf name for the download file.
   * @property {string} mimeType - Specifies the standard web encoding content-type descriptor.
   * @property {HTMLSpanElement} liveRegion - Specifies the screen-reader notification area.
   * @property {function(): string} getData - Callback invoked to generate text contents for serialization.
   */

  // ─────────────────────────────────────────────────────────────────────────
  // UTILITY HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a Font Awesome regular-style icon element.
   * @param {string} name - Specifies the icon name without the `fa-` prefix.
   * @returns {HTMLElement} Returns a configured `<i>` icon element.
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
   * @returns {EDLFeedRow[]} Array containing structured feed metadata.
   */
  function extractEDLTableData() {
    /** @type {EDLFeedRow[]} */
    const results = [];
    const feedAnchors = document.querySelectorAll('a[href^="https://saasedl.paloaltonetworks.com/feeds/"]');

    feedAnchors.forEach((item) => {
      const row = item.closest("tr");
      if (!row) return;

      const cells = row.querySelectorAll("td");
      if (cells.length < 7) return;

      // Extract text content and references safely across the horizontally matched cells
      const name = cells[0].textContent.trim();

      const urlAnchor = cells[1].querySelector("a");
      const paragraphs = cells[1].querySelectorAll("p");
      let description = "";
      if (paragraphs.length > 1) {
        description = paragraphs[1].textContent.trim();
      } else if (paragraphs.length === 1 && !urlAnchor) {
        description = paragraphs[0].textContent.trim();
      } else {
        description = cells[1].textContent.replace(urlAnchor ? urlAnchor.textContent : "", "").trim();
      }

      const address_family = cells[2].textContent.trim();

      const sourceLink = cells[3].querySelector("a");
      const source_list = sourceLink ? sourceLink.href.trim() : "";

      const optimizedLink = cells[4].querySelector("a");
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
   * Formats a collection of dataset rows into an RFC 4180 compliant CSV string payload.
   * @param {EDLFeedRow[]} data - The data array source.
   * @returns {string} Fully structured CSV table.
   */
  function convertToCSV(data) {
    const headers = ["name", "description", "address_family", "source_list", "optimized_list", "last_changed", "last_checked"];

    const csvRows = [
      headers.map(h => `"${h}"`).join(",")
    ];

    data.forEach(row => {
      const values = headers.map(header => {
        const val = row[header] || "";
        // Escape inner quotes by doubling them up to enforce CSV parser sanitization boundaries
        const escaped = val.replace(/"/g, '""');
        return `"${escaped}"`;
      });
      csvRows.push(values.join(","));
    });

    return csvRows.join("\n");
  }

  /**
   * Extracts a plain string list containing only active optimized feed links.
   * @param {EDLFeedRow[]} data - The data array source.
   * @returns {string} Plain text list containing URIs only.
   */
  function convertToURLList(data) {
    return data
      .map(row => row.optimized_list)
      .filter(url => url && url.trim() !== "")
      .join("\n");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PANEL COMPONENT BUILDERS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Build a unified actionable download interface element matching the core styling standards.
   * @param {ButtonConfig} config - Button presentation and processing options.
   * @returns {HTMLButtonElement} Fully event-wrapped download trigger button.
   */
  function makeDownloadButton(config) {
    const BG_BASE = "#005073";
    const BG_HOVER = "#1d6fa5";
    const BG_SUCCESS = "#1f8a4c";
    const BG_ERROR = "#b00020";

    /** @type {number|null} */
    let resetTimer = null;

    const btn = document.createElement("button");
    btn.setAttribute("aria-label", config.label);

    const icon = faIcon(config.icon);
    const label = document.createElement("span");
    label.textContent = ` ${config.label}`;
    label.style.pointerEvents = "none";

    btn.appendChild(icon);
    btn.appendChild(label);

    Object.assign(btn.style, {
      display: "inline-flex",
      alignItems: "center",
      background: BG_BASE,
      color: "#ffffff",
      border: "none",
      borderRadius: "8px",
      padding: "9px 15px",
      fontSize: "12px",
      fontWeight: "700",
      letterSpacing: "0.02em",
      cursor: "pointer",
      boxShadow: "0 3px 12px rgba(0,0,0,0.45)",
      whiteSpace: "nowrap",
      userSelect: "none",
      transition: "background 0.12s ease",
      lineHeight: "1.4",
      gap: "6px",
    });

    function handleMouseEnter() {
      if (!btn.dataset.active) btn.style.background = BG_HOVER;
    }

    function handleMouseLeave() {
      if (!btn.dataset.active) btn.style.background = BG_BASE;
    }

    btn.addEventListener("mouseenter", handleMouseEnter);
    btn.addEventListener("mouseleave", handleMouseLeave);

    function handleClick() {
      if (btn.dataset.active) return;
      btn.dataset.active = "1";
      btn.style.cursor = "default";

      let blobUrl = null;
      const dlAnchor = document.createElement("a");

      try {
        const textPayload = config.getData();

        if (!textPayload || textPayload.trim() === "" || textPayload === "[]") {
          throw new Error("No data found");
        }

        // Generate dynamic file payload parameters safely in-memory
        const textBlob = new Blob([textPayload], { type: config.mimeType });
        blobUrl = URL.createObjectURL(textBlob);

        dlAnchor.href = blobUrl;
        dlAnchor.download = config.filename;
        dlAnchor.style.display = "none";
        document.body.appendChild(dlAnchor);

        dlAnchor.click();

        label.textContent = " ✓ Downloadet!";
        btn.style.background = BG_SUCCESS;
        btn.setAttribute("aria-label", `Download startet succesfuldt`);
        config.liveRegion.textContent = `Filen ${config.filename} er blevet gemt`;
      } catch (err) {
        label.textContent = " ❌ Ingen data fundet";
        btn.style.background = BG_ERROR;
        btn.setAttribute("aria-label", `Download fejlede`);
        config.liveRegion.textContent = `Download fejlede. Ingen tabelelementer tilgængelige.`;
      } finally {
        if (dlAnchor.parentNode) {
          document.body.removeChild(dlAnchor);
        }
        if (blobUrl) {
          URL.revokeObjectURL(blobUrl);
        }
      }

      function resetButtonState() {
        delete btn.dataset.active;
        label.textContent = ` ${config.label}`;
        btn.style.background = BG_BASE;
        btn.style.cursor = "pointer";
        btn.setAttribute("aria-label", config.label);
        config.liveRegion.textContent = "";
      }

      if (resetTimer !== null) clearTimeout(resetTimer);
      resetTimer = setTimeout(resetButtonState, 2500);
    }

    btn.addEventListener("click", handleClick);
    return btn;
  }

  /**
   * Build and inject the interface container inside the viewport tree canvas.
   * @returns {void} Returns nothing.
   */
  function buildPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", "SaaS EDL data downloader panel");

    Object.assign(panel.style, {
      position: "fixed",
      bottom: "24px",
      right: "24px",
      zIndex: "9999",
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    });

    const liveRegion = document.createElement("span");
    liveRegion.setAttribute("aria-live", "polite");
    liveRegion.setAttribute("aria-atomic", "true");
    Object.assign(liveRegion.style, {
      position: "absolute",
      width: "1px",
      height: "1px",
      padding: "0",
      margin: "-1px",
      overflow: "hidden",
      clip: "rect(0,0,0,0)",
      whiteSpace: "nowrap",
      border: "0",
    });
    panel.appendChild(liveRegion);

    function makeDismissButton() {
      const btn = document.createElement("button");
      btn.textContent = "×";
      btn.setAttribute("aria-label", "Luk panel");
      btn.title = "Luk panel";
      Object.assign(btn.style, {
        alignSelf: "flex-end",
        background: "transparent",
        border: "none",
        color: "#333333",
        cursor: "pointer",
        fontSize: "18px",
        lineHeight: "1",
        padding: "0 2px",
        userSelect: "none",
        fontWeight: "bold"
      });

      btn.addEventListener("click", () => {
        panel.style.display = "none";
      });
      return btn;
    }

    panel.appendChild(makeDismissButton());

    // Button 1: Download JSON file
    panel.appendChild(
      makeDownloadButton({
        label: "Download JSON",
        icon: "file-code",
        filename: "paloalto-saasedl.json",
        mimeType: "application/json;charset=utf-8;",
        liveRegion,
        getData: () => {
          const rawDataset = extractEDLTableData();
          return JSON.stringify(rawDataset, null, 2);
        }
      })
    );

    // Button 2: Download CSV file
    panel.appendChild(
      makeDownloadButton({
        label: "Download CSV",
        icon: "file",
        filename: "paloalto-saasedl.csv",
        mimeType: "text/csv;charset=utf-8;",
        liveRegion,
        getData: () => {
          const rawDataset = extractEDLTableData();
          return convertToCSV(rawDataset);
        }
      })
    );

    // Button 3: Download plaintext URL list
    panel.appendChild(
      makeDownloadButton({
        label: "Download URL'er",
        icon: "file-lines",
        filename: "paloalto-saasedl-urls.txt",
        mimeType: "text/plain;charset=utf-8;",
        liveRegion,
        getData: () => {
          const rawDataset = extractEDLTableData();
          return convertToURLList(rawDataset);
        }
      })
    );

    document.body.appendChild(panel);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INIT + MUTATION OBSERVER RETRY
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Evaluates table viability and initiates setup.
   * Returns false if rows have not fully materialized into view.
   * @returns {boolean} True if drawing succeeds.
   */
  function initScript() {
    if (!document.body) return false;

    // Ensure target feeds exist before initializing structural components
    const currentAnchors = document.querySelectorAll('a[href^="https://saasedl.paloaltonetworks.com/feeds/"]');
    if (currentAnchors.length === 0) return false;

    buildPanel();
    return true;
  }

  if (!initScript()) {
    const retryObserver = new MutationObserver(
      /**
       * Asynchronous monitoring thread executing recovery retries on active tree changes.
       * @returns {void} Returns nothing.
       */
      function retryOnMutation() {
        initRetryCount += 1;
        if (initScript() || initRetryCount >= MAX_INIT_RETRIES) {
          retryObserver.disconnect();
        }
      }
    );
    retryObserver.observe(document.body, { childList: true, subtree: true });
  }
})();