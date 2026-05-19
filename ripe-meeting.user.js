// ==UserScript==
// @name         RIPE Meeting - Copy Session Filename
// @namespace    https://github.com/netravnen/userscripts
// @version      0.2.0
// @description  Floating panel + renamed PDF/PPT/PPTX/KEY/MP4 download on RIPE meeting session detail pages
// @author       -
// @icon         https://www.ripe.net/favicon.ico
// @license      MIT
// @match        https://*.ripe.net/programme/meeting-plan/sessions/*/*
// @match        https://*.ripe.net/programme/meeting-plan/sessions/*/*/
// @updateURL    https://github.com/netravnen/userscripts/raw/refs/heads/main/ripe-meeting.meta.js
// @downloadURL  https://github.com/netravnen/userscripts/raw/refs/heads/main/ripe-meeting.user.js
// @supportURL   https://github.com/netravnen/userscripts/issues
// @require      https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/js/fontawesome.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/js/regular.min.js
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      pretalx.ripe.net
// @noframes
// @run-at       document-idle
// ==/UserScript==

/**
 * Initialize the RIPE meeting helper userscript on eligible session pages.
 * @returns {void} Returns nothing.
 */
(function () {
  "use strict";

  if (!/^ripe\d+\.ripe\.net$/i.test(location.hostname)) return;

  /**
   * Map from RIPE meeting number to the calendar year it took place.
    * Used to reconstruct a full ISO date from the day/month shown on the session page.
    * Meetings never span a year boundary, so a single year value is sufficient.
   * @type {Object.<number, number>}
   */
  const MEETING_YEAR = {
    72: 2016,
    73: 2016,
    74: 2017,
    75: 2017,
    76: 2018,
    77: 2018,
    78: 2019,
    79: 2019,
    80: 2020,
    81: 2020,
    82: 2021,
    83: 2021,
    84: 2022,
    85: 2022,
    86: 2023,
    87: 2023,
    88: 2024,
    89: 2024,
    90: 2025,
    91: 2025,
    92: 2026,
    93: 2026,
    94: 2027,
    95: 2027,
    96: 2028,
    97: 2028,
    98: 2029,
    99: 2029,
    100: 2030,
  };

  /**
   * Map from lowercase English month name to its zero-padded two-digit number.
    * Keys are always lowercase; callers must call `.toLowerCase()` before lookup.
   * @type {Object.<string, string>}
   */
  const MONTH_NUM = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12",
  };

  /**
   * @typedef {Object} SlideFormat
    * @property {string} icon - Specifies the Font Awesome icon name without the
    *   `fa-` prefix used for this file format.
    * @property {string} mime - Specifies the MIME type string used when
    *   constructing the Blob for the renamed download.
   */

  /**
   * Map from lowercase file extension to presentation format metadata.
   * All slides files are served from pretalx.ripe.net (cross-origin) and
   * therefore all require GM_xmlhttpRequest regardless of format.
   * The `.key` format has no dedicated Font Awesome Free icon and falls back
   * to the generic `fa-file` icon.
   * @type {Object.<string, SlideFormat>}
   */
  const SLIDES_FORMAT = {
    pdf: { icon: "file-pdf", mime: "application/pdf" },
    ppt: {
      icon: "file-powerpoint",
      mime: "application/vnd.ms-powerpoint",
    },
    pptx: {
      icon: "file-powerpoint",
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    },
    key: { icon: "file", mime: "application/octet-stream" },
  };

  /**
   * Regular expression matching all handled presentation file extensions.
    * Used to filter anchor hrefs when searching for slides download links.
   * @type {RegExp}
   */
  const SLIDES_EXT_RE = /\.(pdf|pptx?|key)$/i;
  const TRUSTED_SLIDES_HOST = "pretalx.ripe.net";
  const REQUEST_TIMEOUT_MS = 60_000;
  const MAX_STEM_LENGTH = 220;

  /**
   * Convert arbitrary text into a safe filename token.
   * @param {string} str - Specifies the source text.
   * @returns {string} Returns a sanitized token.
   */
  function sanitize(str) {
    return str
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/'/g, "")
      .replace(/[:/\\|]/g, "")
      .replace(/[\s\-]+/g, "_")
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  /**
   * Restrict the generated filename stem to a conservative filesystem-safe length.
   * @param {string} value - Specifies the candidate filename stem.
   * @returns {string} Returns a bounded filename stem.
   */
  function capStemLength(value) {
    return value.slice(0, MAX_STEM_LENGTH).replace(/_+$/g, "");
  }

  /**
   * Create a Font Awesome regular-style icon element.
   * The element is converted to an inline SVG by the FA MutationObserver
   * loaded via `@require`.
   * @param {string} name - Specifies the icon name without the `fa-` prefix.
   * @returns {HTMLElement} Returns a configured icon element.
   */
  function faIcon(name) {
    const i = document.createElement("i");
    i.className = `fa-regular fa-${name}`;
    i.setAttribute("aria-hidden", "true");
    i.style.pointerEvents = "none";
    return i;
  }

  /**
   * Determine whether an anchor points to a same-page hash target on the
   * current session page. Used to identify speaker biography anchors, which
   * always link to fragment identifiers on the same URL.
   * @param {HTMLAnchorElement} a - Specifies the candidate anchor element.
   * @returns {boolean} Returns true when the anchor href resolves to the current
   *   pathname with a non-empty hash fragment.
   */
  function isSamePageHashLink(a) {
    try {
      const u = new URL(a.href);
      return u.pathname === location.pathname && !!u.hash;
    } catch {
      return false;
    }
  }

  /**
    * Shared inline style applied to every slides and recording download anchor.
    * Ensures an identical box-model context so Font Awesome SVG icons share the
    * same baseline regardless of site CSS applied to the original slides anchor.
    * Must be spread via `Object.assign(element.style, ICON_ANCHOR_STYLE)`.
   * @type {Object.<string, string>}
   */
  const ICON_ANCHOR_STYLE = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    verticalAlign: "middle",
    lineHeight: "1",
    fontSize: "1.15em",
    textDecoration: "none",
    cursor: "pointer",
  };

  const confMatch = location.hostname.match(/^ripe(\d+)\.ripe\.net$/i);
  if (!confMatch) return;

  const meetingId = confMatch[1];
  const meetingNum = parseInt(meetingId, 10);
  const conference = "RIPE" + meetingId.toUpperCase();

  /**
   * Determine whether an anchor points at the parent track session path.
   * @param {HTMLAnchorElement} a - Specifies the candidate anchor.
   * @returns {boolean} Returns true when the anchor matches the session track path.
   */
  function isTrackAnchor(a) {
    return /\/programme\/meeting-plan\/sessions\/\d+\/?$/.test(a.pathname);
  }

  let mainEl =
    document.querySelector('main, [id="content"], article') || document.body;

  /**
   * Regular expression matching a day and full month name within page text.
   * @type {RegExp}
   */
  const DATE_RE =
    /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b/i;

  /**
   * Build a date token in YYYYMMDD format.
   * @param {number} year - Specifies the meeting year.
   * @param {string} day - Specifies the day value from page text.
   * @param {string} monthName - Specifies the full English month name.
   * @returns {string} Returns a compact ISO date token.
   */
  function buildDateToken(year, day, monthName) {
    const mm = MONTH_NUM[monthName.toLowerCase()];
    const dd = String(parseInt(day, 10)).padStart(2, "0");
    return `${year}${mm}${dd}`;
  }

  /**
   * Extract the session date from page metadata and convert it to a token.
   * Falls back to a full-page text search when the structured `<dt>` is absent.
   * @returns {string|null} Returns a tokenized date or null when not available.
   */
  function extractDateToken() {
    const year = MEETING_YEAR[meetingNum];
    if (!year) return null;

    for (const dt of mainEl.querySelectorAll("dt")) {
      if (/^\s*date:\s*$/i.test(dt.textContent)) {
        const dd = dt.nextElementSibling;
        if (dd) {
          const m = dd.textContent.match(DATE_RE);
          if (m) return buildDateToken(year, m[1], m[2]);
        }
      }
    }

    const m = mainEl.textContent.match(DATE_RE);
    return m ? buildDateToken(year, m[1], m[2]) : null;
  }

  /**
   * Regular expression matching a time-of-day string with UTC offset.
   * @type {RegExp}
   */
  const TIME_RE = /(\d{1,2}):(\d{2})\s*\(UTC\s*([+-])(\d{2})(\d{2})\)/;

  /**
   * Convert a time match into the normalized filename time token.
   * @param {RegExpMatchArray} m - Specifies the match result for `TIME_RE`.
   * @returns {string} Returns a formatted time token.
   */
  function formatTimeToken(m) {
    const hhmm = m[1].padStart(2, "0") + m[2];
    const sign = m[3] === "-" ? "-" : "";
    const offH = parseInt(m[4], 10);
    const offM = parseInt(m[5], 10);
    const utcSfx =
      offM !== 0
        ? `UTC${sign}${offH}_${String(offM).padStart(2, "0")}`
        : `UTC${sign}${offH}`;
    return `${hhmm}_${utcSfx}`;
  }

  /**
   * Extract and normalize the session start time from page metadata.
   * Falls back to a full-page text search when the structured `<dt>` is absent.
   * @returns {string|null} Returns a tokenized time or null when not available.
   */
  function extractTimeToken() {
    for (const dt of mainEl.querySelectorAll("dt")) {
      if (/^\s*time:\s*$/i.test(dt.textContent)) {
        const dd = dt.nextElementSibling;
        if (dd) {
          const m = dd.textContent.match(TIME_RE);
          if (m) return formatTimeToken(m);
        }
      }
    }

    const m = mainEl.textContent.match(TIME_RE);
    return m ? formatTimeToken(m) : null;
  }

  /**
   * Locate the DOM container that holds speaker name anchors.
   * Handles both `<dl>/<dt>/<dd>` and inline `<p>` page layouts.
   * @returns {HTMLElement|null} Returns a speaker container or null when not found.
   */
  function findSpeakerContainer() {
    for (const dt of mainEl.querySelectorAll("dt")) {
      if (/speaker/i.test(dt.textContent.trim())) {
        const dd = dt.nextElementSibling;
        if (dd && dd.tagName === "DD") return dd;
      }
    }

    for (const el of mainEl.querySelectorAll("p, div")) {
      const labelInStrong = el.querySelector("strong, b");
      const hasLabel =
        (labelInStrong && /speaker/i.test(labelInStrong.textContent)) ||
        [...el.childNodes].some(
          /**
           * Check whether a child node contains a speaker label text fragment.
           * @param {Node} n - Specifies the child node from the candidate container.
           * @returns {boolean} Returns true when the node is a speaker label text node.
           */
          function childHasSpeakerText(n) {
            return (
              n.nodeType === Node.TEXT_NODE && /speaker/i.test(n.textContent)
            );
          },
        );

      if (!hasLabel) continue;

      const speakerLinks = [...el.querySelectorAll("a[href]")].filter(
        isSamePageHashLink,
      );

      if (speakerLinks.length > 0) return el;
    }

    return null;
  }

  /**
   * Parse speaker names and optional affiliations from a speaker container.
   * @param {HTMLElement} container - Specifies the speaker container element.
   * @returns {{name: string, affiliation: string}[]} Returns parsed speaker entries.
   */
  function parseSpeakers(container) {
    const anchors = [...container.querySelectorAll("a[href]")].filter(
      isSamePageHashLink,
    );

    return anchors.map(
      /**
       * Extract normalized speaker details from an anchor and its adjacent text.
       * @param {HTMLAnchorElement} a - Specifies the speaker anchor.
       * @returns {{name: string, affiliation: string}} Returns parsed speaker details.
       */
      function mapSpeaker(a) {
        const name = a.textContent.trim();
        let raw = "",
          node = a.nextSibling;

        while (node) {
          if (node.nodeType === Node.TEXT_NODE) raw += node.textContent;
          else break;
          node = node.nextSibling;
        }

        return {
          name,
          affiliation: raw.replace(/^[\s,]+/, "").replace(/[\s,]+$/, ""),
        };
      },
    );
  }

  /** @type {number} */
  const MAX_INIT_RETRIES = 10;
  /** @type {number} */
  let initRetryCount = 0;
  /** @type {string} */
  let stem = "RIPE_session";

  // ─────────────────────────────────────────────────────────────────────────
  // SLIDES LINKS - renamed download for PDF, PPT, PPTX, and KEY formats
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Find all presentation slides download anchors on the session page.
   * Covers PDF, PPT, PPTX, and KEY formats across both known HTML layouts.
   * Three strategies are tried in priority order:
   *   1. `title="Download slides as *"` attributes (matches all formats).
   *   2. `<dt>Slides:</dt>` sibling `<dd>` containing known-extension anchors.
   *   3. All `pretalx.ripe.net` anchors with a known presentation extension.
   * @returns {HTMLAnchorElement[]} Returns an array of slides anchor elements, possibly empty.
   */
  function findAllSlidesAnchors() {
    const byTitle = [
      ...mainEl.querySelectorAll(
        'a[title*="Download slides"], a[title*="download slides"]',
      ),
    ];
    if (byTitle.length > 0) return byTitle;

    for (const dt of mainEl.querySelectorAll("dt")) {
      if (/^\s*slides:\s*$/i.test(dt.textContent)) {
        const dd = dt.nextElementSibling;
        if (dd) {
          const anchors = [...dd.querySelectorAll("a[href]")].filter(
            /**
             * Keep only anchors pointing to known presentation file extensions.
             * @param {HTMLAnchorElement} a - Specifies the candidate anchor.
             * @returns {boolean} Returns true when the href ends with a known presentation extension.
             */
            function isKnownPresentationLink(a) {
              try {
                return SLIDES_EXT_RE.test(new URL(a.href).pathname);
              } catch {
                return false;
              }
            },
          );
          if (anchors.length > 0) return anchors;
        }
      }
    }

    return [...mainEl.querySelectorAll('a[href*="pretalx.ripe.net"]')].filter(
      /**
       * Keep only pretalx anchors with a known presentation file extension.
       * @param {HTMLAnchorElement} a - Specifies the candidate anchor.
       * @returns {boolean} Returns true when the anchor points to a known presentation type.
       */
      function isPretalxPresentationLink(a) {
        try {
          const url = new URL(a.href);
          return (
            url.protocol === "https:" &&
            url.hostname === TRUSTED_SLIDES_HOST &&
            SLIDES_EXT_RE.test(url.pathname)
          );
        } catch {
          return false;
        }
      },
    );
  }

  /**
   * Parse and validate a slides URL against trusted host and protocol.
   * @param {string} href - Specifies the candidate slides URL.
   * @returns {URL|null} Returns a validated URL object or null when invalid.
   */
  function getTrustedSlidesUrl(href) {
    try {
      const url = new URL(href);
      if (url.protocol !== "https:") return null;
      if (url.hostname !== TRUSTED_SLIDES_HOST) return null;
      return url;
    } catch {
      return null;
    }
  }

  /**
   * Convert a slides anchor to a renamed downloader with per-format icon and
   * MIME type. The file extension is resolved automatically from the anchor href
   * via the `SLIDES_FORMAT` map. Unknown extensions fall back to a generic file
   * icon and `application/octet-stream`. All slides assets are hosted on
   * `pretalx.ripe.net` (cross-origin) and are therefore always retrieved via
   * `GM_xmlhttpRequest` regardless of format.
   * @param {HTMLAnchorElement} anchor - Specifies the slides anchor to enhance.
   * @returns {void} Returns nothing.
   */
  function applyRenamedDownload(anchor) {
    if (anchor.dataset.ripeEnhanced === "1") return;

    const trustedUrl = getTrustedSlidesUrl(anchor.href);
    if (!trustedUrl) return;

    let ext;
    const m = trustedUrl.pathname.match(/\.(\w+)$/);
    if (!m) return;
    ext = m[1].toLowerCase();

    if (!ext) return;

    const format = SLIDES_FORMAT[ext] || {
      icon: "file",
      mime: "application/octet-stream",
    };
    const filename = `${stem}.${ext}`;

    while (anchor.firstChild) anchor.removeChild(anchor.firstChild);
    anchor.appendChild(faIcon(format.icon));
    anchor.title = filename;
    anchor.setAttribute("aria-label", `Download slides: ${filename}`);
    Object.assign(anchor.style, ICON_ANCHOR_STYLE);
    anchor.dataset.ripeEnhanced = "1";

    /**
     * Set the hover tooltip and accessible label on the slides icon anchor.
     * @param {string} text - Specifies the tooltip and aria-label text.
     * @returns {void} Returns nothing.
     */
    /** @type {number|null} */
    let pendingTimer = null;

    function setTooltip(text) {
      anchor.title = text;
      anchor.setAttribute("aria-label", text);
    }

    /**
     * Cancel any pending tooltip-reset timer and schedule a new one.
     * @param {Function} fn - Specifies the named reset function to schedule.
     * @param {number} delay - Specifies the delay in milliseconds.
     * @returns {void} Returns nothing.
     */
    function scheduleTooltipReset(fn, delay) {
      if (pendingTimer !== null) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(fn, delay);
    }

    /**
     * Download the file through GM_xmlhttpRequest to enforce a custom filename.
     * @param {MouseEvent} e - Specifies the click event.
     * @returns {void} Returns nothing.
     */
    anchor.addEventListener("click", function handleDownload(e) {
      e.preventDefault();
      if (anchor.dataset.fetching) return;
      anchor.dataset.fetching = "1";
      anchor.style.cursor = "wait";
      anchor.style.opacity = "0.5";
      setTooltip("⏳ Fetching…");

      GM_xmlhttpRequest({
        method: "GET",
        url: trustedUrl.href,
        responseType: "arraybuffer",
        timeout: REQUEST_TIMEOUT_MS,

        /**
         * Update tooltip progress during download.
         * @param {{loaded: number, total: number}} res - Specifies the progress event data.
         * @returns {void} Returns nothing.
         */
        onprogress(res) {
          if (res.total > 0) {
            setTooltip(`⏳ ${Math.round((res.loaded / res.total) * 100)}%`);
          }
        },

        /**
         * Complete file download and restore tooltip state.
         * @param {{status: number, response: ArrayBuffer}} res - Specifies the response payload.
         * @returns {void} Returns nothing.
         */
        onload(res) {
          delete anchor.dataset.fetching;
          anchor.style.cursor = "pointer";
          anchor.style.opacity = "1";

          if (res.status < 200 || res.status >= 400) {
            setTooltip(`❌ HTTP ${res.status} - click to retry`);

            /**
             * Restore default tooltip after a failed HTTP response.
             * @returns {void} Returns nothing.
             */
            function resetTooltipAfterHttpError() {
              setTooltip(filename);
            }

            scheduleTooltipReset(resetTooltipAfterHttpError, 4000);
            return;
          }

          if (!(res.response instanceof ArrayBuffer) || res.response.byteLength === 0) {
            setTooltip("❌ Empty response - click to retry");

            /**
             * Restore default tooltip after an empty response.
             * @returns {void} Returns nothing.
             */
            function resetTooltipAfterEmptyResponse() {
              setTooltip(filename);
            }

            scheduleTooltipReset(resetTooltipAfterEmptyResponse, 4000);
            return;
          }

          const contentTypeMatch = res.responseHeaders?.match(
            /^content-type:\s*([^\r\n;]+)/im,
          );
          const contentType = contentTypeMatch
            ? contentTypeMatch[1].trim().toLowerCase()
            : "";
          const expectedMime = format.mime.toLowerCase();
          const allowedGenericType = "application/octet-stream";
          if (
            contentType &&
            contentType !== expectedMime &&
            contentType !== allowedGenericType
          ) {
            setTooltip(`❌ Unexpected type (${contentType})`);

            /**
             * Restore default tooltip after MIME mismatch.
             * @returns {void} Returns nothing.
             */
            function resetTooltipAfterMimeMismatch() {
              setTooltip(filename);
            }

            scheduleTooltipReset(resetTooltipAfterMimeMismatch, 4000);
            return;
          }

          const blob = new Blob([res.response], { type: format.mime });
          const blobUrl = URL.createObjectURL(blob);
          const dl = document.createElement("a");
          dl.href = blobUrl;
          dl.download = filename;
          dl.style.display = "none";
          document.body.appendChild(dl);
          dl.click();
          document.body.removeChild(dl);

          /**
           * Revoke the temporary object URL after download dispatch.
           * @returns {void} Returns nothing.
           */
          function revokeBlobUrl() {
            URL.revokeObjectURL(blobUrl);
          }

          setTimeout(revokeBlobUrl, 10_000);
          setTooltip(`✓ Downloaded as ${filename}`);

          /**
           * Restore the default tooltip after success feedback.
           * @returns {void} Returns nothing.
           */
          function resetTooltipAfterSuccess() {
            setTooltip(filename);
          }

          scheduleTooltipReset(resetTooltipAfterSuccess, 2500);
        },

        /**
         * Report network failures and restore tooltip state.
         * @returns {void} Returns nothing.
         */
        onerror() {
          delete anchor.dataset.fetching;
          anchor.style.cursor = "pointer";
          anchor.style.opacity = "1";
          setTooltip("❌ Network error - click to retry");

          /**
           * Restore default tooltip after a network error.
           * @returns {void} Returns nothing.
           */
          function resetTooltipAfterNetworkError() {
            setTooltip(filename);
          }

          scheduleTooltipReset(resetTooltipAfterNetworkError, 4000);
        },

        /**
         * Report request timeouts and restore tooltip state.
         * @returns {void} Returns nothing.
         */
        ontimeout() {
          delete anchor.dataset.fetching;
          anchor.style.cursor = "pointer";
          anchor.style.opacity = "1";
          setTooltip("❌ Timed out - click to retry");

          /**
           * Restore default tooltip after timeout.
           * @returns {void} Returns nothing.
           */
          function resetTooltipAfterTimeout() {
            setTooltip(filename);
          }

          scheduleTooltipReset(resetTooltipAfterTimeout, 4000);
        },
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RECORDING LINK - FA file-video icon, injected after the last slides anchor
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Resolve the recording section container by finding the heading element
   * whose text content matches "Recording". Returns the heading's parent
   * element or `null` when no recording section is present.
   * @returns {HTMLElement|null} Returns the recording section element or null.
   */
  function findRecordingSection() {
    for (const heading of mainEl.querySelectorAll("h2, h3, h4")) {
      if (/^\s*recording\s*$/i.test(heading.textContent)) {
        return heading.parentElement || null;
      }
    }
    return null;
  }

  /**
   * Resolve the MP4 recording URL from anchors or video sources on the page.
   * Scope is narrowed to the recording section when one can be identified, to
   * avoid matching unrelated `.mp4` links elsewhere in the content area.
   * Both `a.href` and `video.src` / `source.src` return fully-resolved absolute
   * URLs even when the underlying attribute value is a relative path.
   * @returns {string|null} Returns a fully-resolved recording URL or null when
   *   no recording is present on the page.
   */
  function findMp4Href() {
    const scope = findRecordingSection() || mainEl;

    const a = scope.querySelector('a[href$=".mp4"]');
    if (a) return a.href;

    return (
      scope.querySelector('video[src$=".mp4"]')?.src ||
      scope.querySelector('video source[src$=".mp4"]')?.src ||
      null
    );
  }

  /**
    * Inject an MP4 recording download icon immediately after the last slides
    * anchor in the page. The recording asset is same-origin (`ripe*.ripe.net`)
    * so the native `download` attribute rename is used; no `GM_xmlhttpRequest`
    * is required.
    * @param {HTMLAnchorElement} adjacentAnchor - Specifies the last slides anchor
    *   element after which the MP4 icon is inserted.
   * @returns {void} Returns nothing.
   */
  function injectMp4Link(adjacentAnchor) {
    const mp4Href = findMp4Href();
    if (!mp4Href) return;

    const mp4Filename = `${stem}.mp4`;

    const link = document.createElement("a");
    link.href = mp4Href;
    link.download = mp4Filename;
    link.title = mp4Filename;
    link.setAttribute("aria-label", `Download recording: ${mp4Filename}`);
    link.id = "ripe-mp4-download";
    link.appendChild(faIcon("file-video"));

    Object.assign(link.style, ICON_ANCHOR_STYLE);
    link.style.marginLeft = "6px";

    /**
     * Provide brief visual confirmation when the MP4 download is triggered.
     * Does not prevent the native browser download.
     * @returns {void} Returns nothing.
     */
    function handleMp4Click() {
      while (link.firstChild) link.removeChild(link.firstChild);
      link.appendChild(faIcon("circle-check"));
      link.setAttribute("aria-label", `Download started: ${mp4Filename}`);

      /**
       * Restore the original file-video icon after success feedback.
       * @returns {void} Returns nothing.
       */
      function restoreMp4Icon() {
        while (link.firstChild) link.removeChild(link.firstChild);
        link.appendChild(faIcon("file-video"));
        link.setAttribute("aria-label", `Download recording: ${mp4Filename}`);
      }

      setTimeout(restoreMp4Icon, 2000);
    }

    link.addEventListener("click", handleMp4Click);

    adjacentAnchor.insertAdjacentElement("afterend", link);
  }

  const PANEL_ID = "ripe-session-copy-panel";
  /**
   * Create a floating-panel clipboard button for a filename extension.
   * @param {string} ext - Specifies the file extension label shown on the button.
   * @param {HTMLSpanElement} liveRegion - Specifies the shared aria-live region
   *   element used to announce copy events to screen readers.
   * @returns {HTMLButtonElement} Returns a configured button element.
   */
  function makeButton(ext, liveRegion) {
    const BG_BASE = "#003d82";
    const BG_HOVER = "#0057b8";
    const BG_SUCCESS = "#1f8a4c";
    /** @type {number|null} */
    let resetTimer = null;

    const btn = document.createElement("button");
    btn.title = `${stem}.${ext}`;
    btn.setAttribute("aria-label", `Copy ${stem}.${ext} filename to clipboard`);

    const icon = faIcon("clipboard");
    const label = document.createElement("span");
    label.textContent = ` Copy .${ext} filename`;
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

    /**
     * Apply hover styling while the cursor is over the button, unless the
     * copied-success state is currently active.
     * @returns {void} Returns nothing.
     */
    function handleMouseEnter() {
      if (btn.dataset.copied) return;
      btn.style.background = BG_HOVER;
    }

    /**
     * Restore base styling unless the copied state is active.
     * @returns {void} Returns nothing.
     */
    function handleMouseLeave() {
      if (!btn.dataset.copied) btn.style.background = BG_BASE;
    }

    btn.addEventListener("mouseenter", handleMouseEnter);
    btn.addEventListener("mouseleave", handleMouseLeave);

    /**
     * Copy the computed filename to the clipboard and show success styling.
     * @returns {void} Returns nothing.
     */
    function handleButtonClick() {
      if (btn.dataset.copied) return;

      GM_setClipboard(`${stem}.${ext}`, "text");
      btn.dataset.copied = "1";
      label.textContent = " Copied!";
      liveRegion.textContent = `Copied: ${stem}.${ext}`;
      btn.setAttribute("aria-label", "Filename copied to clipboard");
      btn.style.background = BG_SUCCESS;
      btn.style.cursor = "default";

      /**
       * Restore button text and style after the success feedback timeout.
       * @returns {void} Returns nothing.
       */
      function resetButtonState() {
        delete btn.dataset.copied;
        label.textContent = ` Copy .${ext} filename`;
        liveRegion.textContent = "";
        btn.setAttribute("aria-label", `Copy ${stem}.${ext} filename to clipboard`);
        btn.style.background = BG_BASE;
        btn.style.cursor = "pointer";
      }

      if (resetTimer !== null) clearTimeout(resetTimer);
      resetTimer = setTimeout(resetButtonState, 1800);
    }

    btn.addEventListener("click", handleButtonClick);

    return btn;
  }

  /**
   * Execute all page mutations: slides interception, MP4 injection, and panel.
   * Returns true when all required fields were resolved and mutations applied;
   * returns false when one or more required fields were missing.
   * @returns {boolean} Returns true when initialization completed successfully.
   */
  function initScript() {
    const h1 = document.querySelector("h1");
    if (!h1) return false;

    const currentPathMatch = location.pathname.match(
      /\/sessions\/\d+\/([A-Z0-9]+)\/?$/i,
    );
    if (!currentPathMatch) return false;

    mainEl =
      document.querySelector('main, [id="content"], article') || document.body;

    const trackAnchor = [...document.querySelectorAll("a[href]")].find(
      isTrackAnchor,
    );
    const sessionTrack = trackAnchor ? trackAnchor.textContent.trim() : "Session";
    const sessionId = currentPathMatch[1].toUpperCase();
    const sessionTitle = h1.textContent.trim();

    const speakerContainer = findSpeakerContainer();
    const speakers = speakerContainer ? parseSpeakers(speakerContainer) : [];
    let speakerToken = "";
    let affiliationToken = "";

    if (speakers.length > 0) {
      speakerToken = sanitize(speakers[0].name);
      if (speakers.length > 1) speakerToken += "_et_al";
      if (speakers[0].affiliation) {
        affiliationToken = sanitize(speakers[0].affiliation);
      }
    }

    stem = capStemLength(
      [
        conference,
        sanitize(sessionTrack),
        extractDateToken(),
        extractTimeToken(),
        sessionId,
        sanitize(sessionTitle),
        speakerToken,
        affiliationToken,
      ]
        .filter(Boolean)
        .join("_") || "RIPE_session",
    );

    const slidesAnchors = findAllSlidesAnchors();

    slidesAnchors.forEach(
      /**
       * Apply renamed download handling to each discovered slides anchor.
       * @param {HTMLAnchorElement} anchor - Specifies the slides anchor to process.
       * @returns {void} Returns nothing.
       */
      function processSlideAnchor(anchor) {
        applyRenamedDownload(anchor);
      },
    );

    if (slidesAnchors.length > 0) {
      injectMp4Link(slidesAnchors[slidesAnchors.length - 1]);
    }

    if (!document.getElementById(PANEL_ID)) {
      const panel = document.createElement("div");
      panel.id = PANEL_ID;
      panel.setAttribute("role", "region");
      panel.setAttribute("aria-label", "RIPE session filename tools");
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

      /**
       * Create the panel dismiss button that hides the floating panel on click.
       * @returns {HTMLButtonElement} Returns a configured dismiss button element.
       */
      function makeDismissButton() {
        const btn = document.createElement("button");
        btn.textContent = "×";
        btn.setAttribute("aria-label", "Dismiss RIPE filename tools panel");
        btn.title = "Dismiss";
        Object.assign(btn.style, {
          alignSelf: "flex-end",
          background: "transparent",
          border: "none",
          color: "rgba(255,255,255,0.6)",
          cursor: "pointer",
          fontSize: "16px",
          lineHeight: "1",
          padding: "0 2px",
          userSelect: "none",
        });

        /**
         * Hide the panel when the dismiss button is clicked.
         * @returns {void} Returns nothing.
         */
        function handleDismissClick() {
          panel.style.display = "none";
        }

        btn.addEventListener("click", handleDismissClick);
        return btn;
      }

      panel.appendChild(makeDismissButton());
      panel.appendChild(makeButton("pdf", liveRegion));
      panel.appendChild(makeButton("mp4", liveRegion));
      document.body.appendChild(panel);
    }

    return true;
  }

  if (!initScript()) {
    const retryObserver = new MutationObserver(
      /**
       * Retry script initialization when DOM mutations are observed.
       * @returns {void} Returns nothing.
       */
      function retryInitOnMutation() {
        initRetryCount += 1;
        if (initScript() || initRetryCount >= MAX_INIT_RETRIES) {
          retryObserver.disconnect();
        }
      },
    );
    retryObserver.observe(document.body, { childList: true, subtree: true });
  }
})();