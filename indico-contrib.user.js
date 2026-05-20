// ==UserScript==
// @name           Indico - Contribution File Downloader
// @namespace      https://github.com/netravnen/userscripts
// @version        0.0.1
// @description    Floating panel with per-format download buttons for Indico contribution pages (PDF/PPT/PPTX/KEY) plus YouTube/Vimeo/MP4 recording links
// @author         -
// @icon           https://getindico.io/favicon.ico
// @license        MIT
// @match          *://*/event/*/contributions/*
// @require        https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/js/fontawesome.min.js
// @require        https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/js/regular.min.js
// @grant          GM_xmlhttpRequest
// @connect        *
// @noframes
// @run-at         document-idle
// @updateURL      https://github.com/netravnen/userscripts/raw/refs/heads/main/indico-contrib.meta.js
// @downloadURL    https://github.com/netravnen/userscripts/raw/refs/heads/main/indico-contrib.user.js
// @supportURL     https://github.com/netravnen/userscripts/issues
// ==/UserScript==

/**
 * Initialize the Indico contribution file downloader on eligible contribution pages.
 * @returns {void} Returns nothing.
 */
(function () {
  'use strict';

  // ── Indico fingerprint guard ──────────────────────────────────────────────
  // Every Indico instance injects <meta name="generator" content="Indico x.y.z">.
  // This guards against the broad @match firing on non-Indico sites.
  const generatorMeta = document.querySelector('meta[name="generator"]');
  if (!generatorMeta || !/^indico\b/i.test(generatorMeta.content)) return;

  // ── URL structure guard ───────────────────────────────────────────────────
  /**
   * Regular expression extracting the event and contribution IDs from the path.
   * @type {RegExp}
   */
  const PATH_RE = /\/event\/(\d+)\/contributions\/(\d+)\/?/;
  const pathMatch = location.pathname.match(PATH_RE);
  if (!pathMatch) return;

  /** @type {string} */
  const contribId = pathMatch[2];

  // ──────────────────────────────────────────────────────────────────────────
  // CONSTANTS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * @typedef {Object} SlideFormat
   * @property {string} icon - Font Awesome icon name without the `fa-` prefix.
   * @property {string} mime - MIME type string used when constructing the Blob.
   */

  /**
   * Map from lowercase file extension to presentation format metadata.
   * @type {Object.<string, SlideFormat>}
   */
  const SLIDES_FORMAT = {
    pdf: {
      icon: 'file-pdf',
      mime: 'application/pdf',
    },
    ppt: {
      icon: 'file-powerpoint',
      mime: 'application/vnd.ms-powerpoint',
    },
    pptx: {
      icon: 'file-powerpoint',
      mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    },
    key: {
      icon: 'file',
      mime: 'application/octet-stream',
    },
  };

  /**
   * Human-readable label shown on the panel button for each slide format.
   * @type {Object.<string, string>}
   */
  const SLIDE_BUTTON_LABELS = {
    pdf: 'PDF',
    ppt: 'PPT',
    pptx: 'PPTX',
    key: 'Keynote',
  };

  /**
   * Regular expression matching all handled presentation file extensions.
   * @type {RegExp}
   */
  const SLIDES_EXT_RE = /\.(pdf|pptx?|key)$/i;

  const REQUEST_TIMEOUT_MS = 60_000;
  const MAX_STEM_LENGTH = 220;
  const PANEL_ID = 'indico-contrib-dl-panel';
  const MAX_INIT_RETRIES = 10;

  // Floating panel — neutral dark colour scheme (decision D)
  const BG_BASE    = '#1e2433';
  const BG_HOVER   = '#2d3a52';
  const BG_SUCCESS = '#1f8a4c';
  const BG_ERROR   = '#b00020';

  /** @type {number} */
  let initRetryCount = 0;
  /** @type {string} */
  let stem = 'indico_contrib';

  /**
   * Map from lowercase English month name to its zero-padded two-digit number.
   * @type {Object.<string, string>}
   */
  const MONTH_NUM = {
    january: '01', february: '02', march: '03',    april: '04',
    may: '05',     june: '06',     july: '07',     august: '08',
    september: '09', october: '10', november: '11', december: '12',
  };

  // ──────────────────────────────────────────────────────────────────────────
  // UTILITIES
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Convert arbitrary text into a safe filename token.
   * @param {string} str - Specifies the source text.
   * @returns {string} Returns a sanitized token.
   */
  function sanitize(str) {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/'/g, '')
      .replace(/[:/\\|]/g, '')
      .replace(/[\s\-]+/g, '_')
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  /**
   * Restrict a filename stem to a conservative filesystem-safe length.
   * @param {string} value - Specifies the candidate stem.
   * @returns {string} Returns a bounded stem.
   */
  function capStemLength(value) {
    return value.slice(0, MAX_STEM_LENGTH).replace(/_+$/g, '');
  }

  /**
   * Create a Font Awesome regular-style icon element.
   * The element is converted to an inline SVG by the FA MutationObserver
   * loaded via `@require`.
   * @param {string} name - Specifies the icon name without the `fa-` prefix.
   * @returns {HTMLElement} Returns a configured icon element.
   */
  function faIcon(name) {
    const i = document.createElement('i');
    i.className = `fa-regular fa-${name}`;
    i.setAttribute('aria-hidden', 'true');
    i.style.pointerEvents = 'none';
    return i;
  }

  /**
   * Shared inline style applied to every enhanced download anchor.
   * Ensures an identical box-model context so FA SVG icons share the same
   * baseline regardless of site CSS applied to the original anchor.
   * @type {Object.<string, string>}
   */
  const ICON_ANCHOR_STYLE = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    verticalAlign: 'middle',
    lineHeight: '1',
    fontSize: '1.15em',
    textDecoration: 'none',
    cursor: 'pointer',
  };

  // ──────────────────────────────────────────────────────────────────────────
  // DOM SCOPE
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Primary content container. Re-evaluated inside initScript() in case
   * the element is not yet in the DOM at an earlier MutationObserver retry.
   * @type {HTMLElement}
   */
  let mainEl =
    document.querySelector('main, [id="content"], .event-page') || document.body;

  // ──────────────────────────────────────────────────────────────────────────
  // METADATA EXTRACTION
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Regular expression matching a full human-readable date with a four-digit year.
   * @type {RegExp}
   */
  const DATE_FULL_RE =
    /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i;

  /**
   * Regular expression matching a 24-hour HH:MM time token.
   * @type {RegExp}
   */
  const TIME_RE = /\b(\d{1,2}):(\d{2})\b/;

  /**
   * Collect breadcrumb anchor elements that represent meaningful navigation
   * steps, filtering out blank entries and the generic "Home" link.
   * Works across Indico's known breadcrumb markup variants.
   * @returns {HTMLAnchorElement[]} Returns an ordered array of meaningful breadcrumb anchors.
   */
  function getBreadcrumbLinks() {
    return [
      ...document.querySelectorAll(
        '.breadcrumbs a, .i-breadcrumbs a, nav.breadcrumbs a, ol.breadcrumb a',
      ),
    ].filter(
      /**
       * Exclude blank and generic home links from breadcrumb candidates.
       * @param {HTMLAnchorElement} a - Specifies the candidate anchor.
       * @returns {boolean} Returns true when the anchor represents a meaningful step.
       */
      function keepMeaningfulLink(a) {
        const t = a.textContent.trim().toLowerCase();
        return t !== '' && t !== 'home';
      },
    );
  }

  /**
   * Extract the event name from the breadcrumb or document title.
   * Breadcrumb structure: Home → Event Name → [Session] → Contribution Title.
   * Title structure: "Contribution Title · Event Name · Indico".
   * @returns {string} Returns the event name, or an empty string when not found.
   */
  function extractEventName() {
    const links = getBreadcrumbLinks();
    if (links.length > 0) return links[0].textContent.trim();

    // Fallback — document.title is typically "Contribution Title · Event Name · Indico"
    const parts = document.title
      .split(/[·\-—]/)
      .map(function trimPart(s) { return s.trim(); })
      .filter(Boolean);

    if (parts.length >= 3) return parts[parts.length - 2];
    if (parts.length === 2) return parts[1];

    return '';
  }

  /**
   * Extract the session or track name from the contribution metadata DL
   * or from the second meaningful breadcrumb link.
   * @returns {string} Returns the session name, or an empty string when not found.
   */
  function extractSessionTrack() {
    for (const dt of mainEl.querySelectorAll('dt')) {
      if (/^\s*(session|track|module)\s*$/i.test(dt.textContent)) {
        const dd = dt.nextElementSibling;
        if (dd && dd.tagName === 'DD') return dd.textContent.trim();
      }
    }

    const links = getBreadcrumbLinks();
    if (links.length >= 2) return links[1].textContent.trim();

    return '';
  }

  /**
   * Convert an ISO datetime string to a compact YYYYMMDD date token.
   * @param {string} iso - Specifies the ISO datetime string (e.g. "2025-05-14T10:00:00").
   * @returns {string|null} Returns a compact date token, or null when the format is unrecognised.
   */
  function isoToDateToken(iso) {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}${m[2]}${m[3]}` : null;
  }

  /**
   * Extract the contribution date as a YYYYMMDD token.
   * Resolution order:
   *   1. `<time datetime>` element in the main content.
   *   2. `<dt>Date</dt><dd>` pair — first checks for a nested `<time>`, then text.
   *   3. Full-page text scan.
   * @returns {string|null} Returns a date token, or null when not found.
   */
  function extractDateToken() {
    const timeEl = mainEl.querySelector('time[datetime]');
    if (timeEl) {
      const token = isoToDateToken(timeEl.getAttribute('datetime') || '');
      if (token) return token;
    }

    for (const dt of mainEl.querySelectorAll('dt')) {
      if (/^\s*date\s*$/i.test(dt.textContent)) {
        const dd = dt.nextElementSibling;
        if (!dd) continue;

        const innerTime = dd.querySelector('time[datetime]');
        if (innerTime) {
          const token = isoToDateToken(innerTime.getAttribute('datetime') || '');
          if (token) return token;
        }

        const m = dd.textContent.match(DATE_FULL_RE);
        if (m) {
          const mm = MONTH_NUM[m[2].toLowerCase()];
          const day = String(parseInt(m[1], 10)).padStart(2, '0');
          return `${m[3]}${mm}${day}`;
        }
      }
    }

    const m = mainEl.textContent.match(DATE_FULL_RE);
    if (m) {
      const mm = MONTH_NUM[m[2].toLowerCase()];
      const day = String(parseInt(m[1], 10)).padStart(2, '0');
      return `${m[3]}${mm}${day}`;
    }

    return null;
  }

  /**
   * Extract the contribution start time as an HHMM token.
   * Resolution order:
   *   1. ISO T-fragment in a `<time datetime>` element.
   *   2. `<dt>Date|Time</dt><dd>` pair text.
   * @returns {string|null} Returns an HHMM token, or null when not found.
   */
  function extractTimeToken() {
    const timeEl = mainEl.querySelector('time[datetime]');
    if (timeEl) {
      const dtAttr = timeEl.getAttribute('datetime') || '';
      const m = dtAttr.match(/T(\d{2}):(\d{2})/);
      if (m) return m[1] + m[2];
    }

    for (const dt of mainEl.querySelectorAll('dt')) {
      if (/^\s*(date|time)\s*$/i.test(dt.textContent)) {
        const dd = dt.nextElementSibling;
        if (!dd) continue;
        const m = dd.textContent.match(TIME_RE);
        if (m) return m[1].padStart(2, '0') + m[2];
      }
    }

    return null;
  }

  /**
   * @typedef {Object} Speaker
   * @property {string} name - Normalised speaker display name.
   * @property {string} affiliation - Organisation affiliation, or empty string.
   */

  /**
   * Parse speaker names and affiliations from a container element.
   * Handles `.person-name` / `.speaker-name` spans, anchor-based lists,
   * and plain text fallback.
   * @param {HTMLElement} container - Specifies the container holding speaker data.
   * @returns {Speaker[]} Returns an array of parsed speaker entries.
   */
  function parseSpeakerContainer(container) {
    const results = [];

    const nameEls = container.querySelectorAll('.person-name, .speaker-name');
    if (nameEls.length > 0) {
      nameEls.forEach(
        /**
         * Extract name and affiliation from a speaker name element.
         * @param {HTMLElement} el - Specifies the speaker name element.
         * @returns {void} Returns nothing.
         */
        function extractSpeakerFromEl(el) {
          const name = el.textContent.trim();
          if (!name) return;

          let affiliation = '';
          const sibling = el.nextElementSibling;

          if (
            sibling &&
            /affiliation|organisation|organization|company/i.test(
              sibling.className + ' ' + (sibling.getAttribute('title') || ''),
            )
          ) {
            affiliation = sibling.textContent
              .replace(/^[\s,()]+|[\s,()]+$/g, '')
              .trim();
          } else {
            let node = el.nextSibling;
            while (node) {
              if (node.nodeType === Node.TEXT_NODE) {
                const raw = node.textContent.replace(/^[\s,()]+|[\s,()]+$/g, '');
                if (raw) { affiliation = raw; break; }
              } else if (node.nodeType === Node.ELEMENT_NODE) {
                break;
              }
              node = node.nextSibling;
            }
          }

          results.push({ name, affiliation });
        },
      );

      return results;
    }

    // Fallback: any anchor elements within the container
    container.querySelectorAll('a[href]').forEach(
      /**
       * Extract speaker name from a container anchor.
       * @param {HTMLAnchorElement} a - Specifies the speaker anchor.
       * @returns {void} Returns nothing.
       */
      function extractSpeakerFromAnchor(a) {
        const name = a.textContent.trim();
        if (name) results.push({ name, affiliation: '' });
      },
    );

    if (results.length > 0) return results;

    // Last resort: first line of container textContent
    const text = container.textContent.trim().split('\n')[0].trim();
    if (text) results.push({ name: text, affiliation: '' });

    return results;
  }

  /**
   * Locate and parse the contribution speakers from the page metadata.
   * Tries `<dt>Speaker(s)</dt><dd>` first, then known CSS class selectors.
   * @returns {Speaker[]} Returns an array of speaker entries, possibly empty.
   */
  function extractSpeakers() {
    for (const dt of mainEl.querySelectorAll('dt')) {
      if (/^\s*speakers?\s*$/i.test(dt.textContent)) {
        const dd = dt.nextElementSibling;
        if (dd && dd.tagName === 'DD') return parseSpeakerContainer(dd);
      }
    }

    const speakerContainer = mainEl.querySelector(
      '.speaker-list, .contrib-speakers, .speaker-metadata, .speakers',
    );
    if (speakerContainer) return parseSpeakerContainer(speakerContainer);

    return [];
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ATTACHMENT DISCOVERY
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Determine whether an anchor's href ends with a known presentation extension.
   * @param {HTMLAnchorElement} a - Specifies the candidate anchor.
   * @returns {boolean} Returns true when the extension is known.
   */
  function hasKnownPresentationExt(a) {
    try {
      return SLIDES_EXT_RE.test(new URL(a.href).pathname);
    } catch {
      return false;
    }
  }

  /**
   * Find all presentation attachment anchors using a three-tier lookup.
   *   Tier 1 — URL path pattern (`/attachments/`) — stable across all Indico versions.
   *   Tier 2 — Indico 3.x CSS class selectors.
   *   Tier 3 — Any anchor with a known extension in the main content area.
   * @returns {HTMLAnchorElement[]} Returns an array of attachment anchors, possibly empty.
   */
  function findAllAttachmentAnchors() {
    const tier1 = [
      ...mainEl.querySelectorAll('a[href*="/attachments/"]'),
    ].filter(hasKnownPresentationExt);
    if (tier1.length > 0) return tier1;

    const tier2 = [
      ...mainEl.querySelectorAll(
        '.attachments-box a[href], .attachment-link[href], .material-list a[href], .material a[href]',
      ),
    ].filter(hasKnownPresentationExt);
    if (tier2.length > 0) return tier2;

    return [...mainEl.querySelectorAll('a[href]')].filter(hasKnownPresentationExt);
  }

  /**
   * Validate an attachment URL — requires HTTPS protocol.
   * @param {string} href - Specifies the candidate URL string.
   * @returns {URL|null} Returns a validated URL object, or null when invalid.
   */
  function getTrustedAttachmentUrl(href) {
    try {
      const url = new URL(href);
      if (url.protocol !== 'https:') return null;
      return url;
    } catch {
      return null;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // VIDEO LINK DETECTION
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * @typedef {Object} VideoLink
   * @property {string} href - Fully resolved video URL.
   * @property {'mp4'|'youtube'|'vimeo'} type - Video hosting type.
   */

  /**
   * Find recording video links on the contribution page.
   * Scope is narrowed to a heading-gated recording section when an exact
   * "Recording" or "Video" heading is found, to avoid matching unrelated
   * video links elsewhere in the content.
   * Handles YouTube, Vimeo, direct MP4 anchors, and embedded `<video>` elements.
   * @returns {VideoLink[]} Returns an array of detected video links, possibly empty.
   */
  function findVideoLinks() {
    const seen = new Set();
    const results = [];

    let scope = mainEl;
    for (const heading of mainEl.querySelectorAll('h2, h3, h4, h5')) {
      if (/^\s*(?:recording|video)s?\s*$/i.test(heading.textContent)) {
        scope = heading.parentElement || mainEl;
        break;
      }
    }

    /**
     * Classify and record a single video URL when it has not been seen before.
     * @param {string} href - Specifies the fully resolved URL to classify.
     * @returns {void} Returns nothing.
     */
    function classifyAndRecord(href) {
      if (!href || seen.has(href)) return;

      let u;
      try { u = new URL(href); } catch { return; }

      if (
        /(?:^|\.)youtube\.com$/i.test(u.hostname) &&
        /\/(?:watch|embed)\b/.test(u.pathname)
      ) {
        seen.add(href);
        results.push({ href, type: 'youtube' });
        return;
      }

      if (/^youtu\.be$/i.test(u.hostname)) {
        seen.add(href);
        results.push({ href, type: 'youtube' });
        return;
      }

      if (/(?:^|\.)vimeo\.com$/i.test(u.hostname)) {
        seen.add(href);
        results.push({ href, type: 'vimeo' });
        return;
      }

      if (/\.mp4(?:\?|$)/i.test(u.pathname)) {
        seen.add(href);
        results.push({ href, type: 'mp4' });
      }
    }

    for (const a of scope.querySelectorAll('a[href]')) {
      classifyAndRecord(a.href);
    }

    for (const v of scope.querySelectorAll('video[src], video > source[src]')) {
      const rawSrc = v.getAttribute('src') || '';
      try {
        classifyAndRecord(new URL(rawSrc, location.href).href);
      } catch { /* skip malformed src */ }
    }

    return results;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // DOWNLOAD VIA XHR
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Download a file via GM_xmlhttpRequest and trigger a named save using a
   * temporary Blob object URL. Validates HTTP status, response body length,
   * and Content-Type before dispatching the download.
   * @param {string} href - Specifies the fully-resolved HTTPS URL to fetch.
   * @param {string} filename - Specifies the output filename including extension.
   * @param {SlideFormat} format - Specifies format metadata for MIME validation.
   * @param {function(number): void} onProgress - Specifies the progress callback (0–100).
   * @param {function(): void} onSuccess - Specifies the success callback.
   * @param {function(string): void} onFailure - Specifies the failure callback.
   * @returns {void} Returns nothing.
   */
  function downloadViaXhr(href, filename, format, onProgress, onSuccess, onFailure) {
    GM_xmlhttpRequest({
      method: 'GET',
      url: href,
      responseType: 'arraybuffer',
      timeout: REQUEST_TIMEOUT_MS,

      /**
       * Update download progress.
       * @param {{loaded: number, total: number}} res - Specifies the progress event.
       * @returns {void} Returns nothing.
       */
      onprogress(res) {
        if (res.total > 0) {
          onProgress(Math.round((res.loaded / res.total) * 100));
        }
      },

      /**
       * Validate the response and dispatch the Blob download.
       * @param {{status: number, response: ArrayBuffer, responseHeaders: string}} res
       * @returns {void} Returns nothing.
       */
      onload(res) {
        if (res.status < 200 || res.status >= 400) {
          onFailure(`HTTP ${res.status}`);
          return;
        }

        if (!(res.response instanceof ArrayBuffer) || res.response.byteLength === 0) {
          onFailure('Empty response');
          return;
        }

        const ctMatch = res.responseHeaders?.match(/^content-type:\s*([^\r\n;]+)/im);
        const ct = ctMatch ? ctMatch[1].trim().toLowerCase() : '';
        const expected = format.mime.toLowerCase();

        if (ct && ct !== expected && ct !== 'application/octet-stream') {
          onFailure(`Unexpected type (${ct})`);
          return;
        }

        const blob = new Blob([res.response], { type: format.mime });
        const blobUrl = URL.createObjectURL(blob);
        const dl = document.createElement('a');
        dl.href = blobUrl;
        dl.download = filename;
        dl.style.display = 'none';
        document.body.appendChild(dl);
        dl.click();
        document.body.removeChild(dl);

        /**
         * Release the temporary Blob URL after the browser has consumed it.
         * @returns {void} Returns nothing.
         */
        function revokeBlobUrl() {
          URL.revokeObjectURL(blobUrl);
        }

        setTimeout(revokeBlobUrl, 10_000);
        onSuccess();
      },

      /**
       * Invoke failure callback on network error.
       * @returns {void} Returns nothing.
       */
      onerror() {
        onFailure('Network error');
      },

      /**
       * Invoke failure callback on request timeout.
       * @returns {void} Returns nothing.
       */
      ontimeout() {
        onFailure('Timed out');
      },
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // IN-PAGE ANCHOR ENHANCEMENT
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Replace an attachment anchor's inner content with a Font Awesome icon
   * and wire a GM_xmlhttpRequest-based renamed download on click.
   * @param {HTMLAnchorElement} anchor - Specifies the attachment anchor to enhance.
   * @returns {void} Returns nothing.
   */
  function applyRenamedDownload(anchor) {
    if (anchor.dataset.indicoEnhanced === '1') return;

    const trustedUrl = getTrustedAttachmentUrl(anchor.href);
    if (!trustedUrl) return;

    const extMatch = trustedUrl.pathname.match(/\.(\w+)$/);
    if (!extMatch) return;
    const ext = extMatch[1].toLowerCase();

    const format = SLIDES_FORMAT[ext] || { icon: 'file', mime: 'application/octet-stream' };
    const filename = `${stem}.${ext}`;

    while (anchor.firstChild) anchor.removeChild(anchor.firstChild);
    anchor.appendChild(faIcon(format.icon));
    anchor.title = filename;
    anchor.setAttribute('aria-label', `Download slides: ${filename}`);
    Object.assign(anchor.style, ICON_ANCHOR_STYLE);
    anchor.dataset.indicoEnhanced = '1';

    /** @type {number|null} */
    let pendingTimer = null;

    /**
     * Update both the hover tooltip and the accessible label.
     * @param {string} text - Specifies the tooltip and aria-label text.
     * @returns {void} Returns nothing.
     */
    function setTooltip(text) {
      anchor.title = text;
      anchor.setAttribute('aria-label', text);
    }

    /**
     * Cancel any pending tooltip reset and schedule a replacement.
     * @param {Function} fn - Specifies the reset function to schedule.
     * @param {number} delay - Specifies the delay in milliseconds.
     * @returns {void} Returns nothing.
     */
    function scheduleReset(fn, delay) {
      if (pendingTimer !== null) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(fn, delay);
    }

    /**
     * Intercept click, block default navigation, and initiate XHR download.
     * @param {MouseEvent} e - Specifies the click event.
     * @returns {void} Returns nothing.
     */
    anchor.addEventListener('click', function handleDownload(e) {
      e.preventDefault();
      if (anchor.dataset.fetching) return;

      anchor.dataset.fetching = '1';
      anchor.style.cursor = 'wait';
      anchor.style.opacity = '0.5';
      setTooltip('⏳ Fetching…');

      /**
       * Update tooltip with download progress percentage.
       * @param {number} pct - Specifies the completion percentage.
       * @returns {void} Returns nothing.
       */
      function onAnchorProgress(pct) {
        setTooltip(`⏳ ${pct}%`);
      }

      /**
       * Restore anchor and show success tooltip.
       * @returns {void} Returns nothing.
       */
      function onAnchorSuccess() {
        delete anchor.dataset.fetching;
        anchor.style.cursor = 'pointer';
        anchor.style.opacity = '1';
        setTooltip(`✓ Downloaded as ${filename}`);

        /**
         * Reset tooltip to the filename after success feedback.
         * @returns {void} Returns nothing.
         */
        function resetTooltipAfterSuccess() {
          setTooltip(filename);
        }

        scheduleReset(resetTooltipAfterSuccess, 2500);
      }

      /**
       * Restore anchor and show error tooltip with retry prompt.
       * @param {string} msg - Specifies the failure message.
       * @returns {void} Returns nothing.
       */
      function onAnchorFailure(msg) {
        delete anchor.dataset.fetching;
        anchor.style.cursor = 'pointer';
        anchor.style.opacity = '1';
        setTooltip(`❌ ${msg} – click to retry`);

        /**
         * Reset tooltip to the filename after failure feedback.
         * @returns {void} Returns nothing.
         */
        function resetTooltipAfterFailure() {
          setTooltip(filename);
        }

        scheduleReset(resetTooltipAfterFailure, 4000);
      }

      downloadViaXhr(
        trustedUrl.href,
        filename,
        format,
        onAnchorProgress,
        onAnchorSuccess,
        onAnchorFailure,
      );
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // VIDEO LINK INJECTION
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Inject a video icon anchor immediately after the specified adjacent element.
   * Direct MP4 links use the native `download` attribute.
   * YouTube and Vimeo links open in a new tab with `rel="noopener noreferrer"`.
   * @param {HTMLAnchorElement} adjacentAnchor - Specifies the element after which the icon is inserted.
   * @param {VideoLink} videoLink - Specifies the video link to inject.
   * @returns {void} Returns nothing.
   */
  function injectVideoLink(adjacentAnchor, videoLink) {
    const linkId = `indico-video-${videoLink.type}`;
    if (document.getElementById(linkId)) return;

    const isDirect = videoLink.type === 'mp4';
    const videoFilename = `${stem}.mp4`;

    const link = document.createElement('a');
    link.id = linkId;
    link.href = videoLink.href;

    if (isDirect) {
      link.download = videoFilename;
      link.title = videoFilename;
      link.setAttribute('aria-label', `Download recording: ${videoFilename}`);
    } else {
      const label =
        videoLink.type === 'youtube' ? 'YouTube recording' : 'Vimeo recording';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = label;
      link.setAttribute('aria-label', `Open ${label}`);
    }

    link.appendChild(faIcon(isDirect ? 'file-video' : 'circle-play'));
    Object.assign(link.style, ICON_ANCHOR_STYLE);
    link.style.marginLeft = '6px';

    if (isDirect) {
      /**
       * Briefly swap icon to a check mark on click, then restore.
       * @returns {void} Returns nothing.
       */
      link.addEventListener('click', function handleDirectVideoClick() {
        while (link.firstChild) link.removeChild(link.firstChild);
        link.appendChild(faIcon('circle-check'));
        link.setAttribute('aria-label', `Download started: ${videoFilename}`);

        /**
         * Restore the file-video icon after confirmation feedback.
         * @returns {void} Returns nothing.
         */
        function restoreVideoIcon() {
          while (link.firstChild) link.removeChild(link.firstChild);
          link.appendChild(faIcon('file-video'));
          link.setAttribute('aria-label', `Download recording: ${videoFilename}`);
        }

        setTimeout(restoreVideoIcon, 2000);
      });
    }

    adjacentAnchor.insertAdjacentElement('afterend', link);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FLOATING PANEL
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * @typedef {Object} PanelDownloadConfig
   * @property {string} label - Human-readable format label shown on the button.
   * @property {string} icon - Font Awesome icon name without the `fa-` prefix.
   * @property {string} filename - Full formatted filename including extension.
   * @property {string} [successLabel] - Override for success feedback; defaults to "Downloaded".
   * @property {function(
   *   function(number): void,
   *   function(): void,
   *   function(string): void
   * ): void} triggerDownload - Initiates download with (onProgress, onSuccess, onFailure).
   */

  /**
   * Create a floating-panel download button that manages its own visual state machine:
   * idle → fetching → success/error → idle.
   * @param {PanelDownloadConfig} config - Specifies the button configuration.
   * @param {HTMLSpanElement} liveRegion - Specifies the shared aria-live region element.
   * @returns {HTMLButtonElement} Returns a configured download button element.
   */
  function makeDownloadButton(config, liveRegion) {
    /** @type {number|null} */
    let resetTimer = null;

    const btn = document.createElement('button');
    btn.title = config.filename;
    btn.setAttribute('aria-label', `Download ${config.filename}`);

    const icon = faIcon(config.icon);
    const labelEl = document.createElement('span');
    labelEl.textContent = ` Download ${config.label}`;
    labelEl.style.pointerEvents = 'none';

    btn.appendChild(icon);
    btn.appendChild(labelEl);

    Object.assign(btn.style, {
      display: 'inline-flex',
      alignItems: 'center',
      background: BG_BASE,
      color: '#ffffff',
      border: 'none',
      borderRadius: '8px',
      padding: '9px 15px',
      fontSize: '12px',
      fontWeight: '700',
      letterSpacing: '0.02em',
      cursor: 'pointer',
      boxShadow: '0 3px 12px rgba(0,0,0,0.45)',
      whiteSpace: 'nowrap',
      userSelect: 'none',
      transition: 'background 0.12s ease',
      lineHeight: '1.4',
      gap: '6px',
    });

    /**
     * Apply hover styling when no download is active.
     * @returns {void} Returns nothing.
     */
    function handleMouseEnter() {
      if (!btn.dataset.active) btn.style.background = BG_HOVER;
    }

    /**
     * Restore base styling when no download is active.
     * @returns {void} Returns nothing.
     */
    function handleMouseLeave() {
      if (!btn.dataset.active) btn.style.background = BG_BASE;
    }

    btn.addEventListener('mouseenter', handleMouseEnter);
    btn.addEventListener('mouseleave', handleMouseLeave);

    /**
     * Initiate the download action and manage all button state transitions.
     * @returns {void} Returns nothing.
     */
    function handleButtonClick() {
      if (btn.dataset.active) return;
      btn.dataset.active = '1';
      btn.style.cursor = 'default';
      labelEl.textContent = ' ⏳ Fetching…';
      btn.setAttribute('aria-label', `Downloading ${config.label}…`);

      /**
       * Update label with the current download progress.
       * @param {number} pct - Specifies the completion percentage.
       * @returns {void} Returns nothing.
       */
      function handleDownloadProgress(pct) {
        labelEl.textContent = ` ⏳ ${pct}%`;
        btn.setAttribute('aria-label', `Downloading ${config.label}: ${pct}%`);
      }

      /**
       * Transition button to success state.
       * @returns {void} Returns nothing.
       */
      function handleDownloadSuccess() {
        const successText = config.successLabel || 'Downloaded';
        labelEl.textContent = ` ✓ ${successText}`;
        liveRegion.textContent = `${successText}: ${config.filename}`;
        btn.setAttribute('aria-label', `${successText}: ${config.filename}`);
        btn.style.background = BG_SUCCESS;

        /**
         * Restore button to idle state after success feedback.
         * @returns {void} Returns nothing.
         */
        function resetAfterSuccess() {
          delete btn.dataset.active;
          labelEl.textContent = ` Download ${config.label}`;
          liveRegion.textContent = '';
          btn.setAttribute('aria-label', `Download ${config.filename}`);
          btn.style.background = BG_BASE;
          btn.style.cursor = 'pointer';
        }

        if (resetTimer !== null) clearTimeout(resetTimer);
        resetTimer = setTimeout(resetAfterSuccess, 2000);
      }

      /**
       * Transition button to error state.
       * @param {string} msg - Specifies the failure reason.
       * @returns {void} Returns nothing.
       */
      function handleDownloadFailure(msg) {
        labelEl.textContent = ` ❌ ${msg}`;
        liveRegion.textContent = `Download failed: ${msg}`;
        btn.setAttribute('aria-label', `Download failed: ${msg}`);
        btn.style.background = BG_ERROR;

        /**
         * Restore button to idle state after error feedback.
         * @returns {void} Returns nothing.
         */
        function resetAfterFailure() {
          delete btn.dataset.active;
          labelEl.textContent = ` Download ${config.label}`;
          liveRegion.textContent = '';
          btn.setAttribute('aria-label', `Download ${config.filename}`);
          btn.style.background = BG_BASE;
          btn.style.cursor = 'pointer';
        }

        if (resetTimer !== null) clearTimeout(resetTimer);
        resetTimer = setTimeout(resetAfterFailure, 4000);
      }

      config.triggerDownload(
        handleDownloadProgress,
        handleDownloadSuccess,
        handleDownloadFailure,
      );
    }

    btn.addEventListener('click', handleButtonClick);

    return btn;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SCRIPT INITIALIZATION
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Execute all page mutations: attachment anchor enhancement, video link
   * injection, and floating panel construction. Returns true when all required
   * DOM conditions were met and mutations were applied; returns false when one
   * or more required elements were absent, signalling the MutationObserver to
   * retry on the next DOM change.
   * @returns {boolean} Returns true when initialization completed successfully.
   */
  function initScript() {
    const h1 = document.querySelector(
      'h1, .contribution-title, #contribution-title, .title-block h1',
    );
    if (!h1) return false;

    const contribTitle = h1.textContent.trim();
    if (!contribTitle) return false;

    // Re-resolve mainEl — it may have been unavailable at an earlier retry cycle.
    mainEl =
      document.querySelector('main, [id="content"], .event-page') || document.body;

    const attachmentAnchors = findAllAttachmentAnchors();
    const videoLinks = findVideoLinks();

    if (attachmentAnchors.length === 0 && videoLinks.length === 0) return false;

    // ── Build filename stem ─────────────────────────────────────────────────
    const eventName    = extractEventName();
    const sessionTrack = extractSessionTrack();
    const dateToken    = extractDateToken();
    const timeToken    = extractTimeToken();
    const speakers     = extractSpeakers();

    let speakerToken     = '';
    let affiliationToken = '';

    if (speakers.length > 0) {
      speakerToken = sanitize(speakers[0].name);
      if (speakers.length > 1) speakerToken += '_et_al';
      if (speakers[0].affiliation) affiliationToken = sanitize(speakers[0].affiliation);
    }

    stem = capStemLength(
      [
        eventName    ? sanitize(eventName)    : '',
        sessionTrack ? sanitize(sessionTrack) : '',
        dateToken    || '',
        timeToken    || '',
        contribId,
        sanitize(contribTitle),
        speakerToken,
        affiliationToken,
      ]
        .filter(Boolean)
        .join('_') || 'indico_contrib',
    );

    // ── Enhance in-page attachment anchors ──────────────────────────────────
    attachmentAnchors.forEach(applyRenamedDownload);

    // ── Inject video icon anchors after the last attachment anchor ──────────
    if (videoLinks.length > 0 && attachmentAnchors.length > 0) {
      const lastAnchor = attachmentAnchors[attachmentAnchors.length - 1];
      videoLinks.forEach(
        /**
         * Inject an icon link for each discovered video.
         * @param {VideoLink} vl - Specifies the video link to inject.
         * @returns {void} Returns nothing.
         */
        function injectAllVideoLinks(vl) {
          injectVideoLink(lastAnchor, vl);
        },
      );
    }

    // ── Build floating panel (idempotent) ───────────────────────────────────
    if (document.getElementById(PANEL_ID)) return true;

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Indico contribution file downloads');
    Object.assign(panel.style, {
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      zIndex: '9999',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    });

    const liveRegion = document.createElement('span');
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('aria-atomic', 'true');
    Object.assign(liveRegion.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      padding: '0',
      margin: '-1px',
      overflow: 'hidden',
      clip: 'rect(0,0,0,0)',
      whiteSpace: 'nowrap',
      border: '0',
    });
    panel.appendChild(liveRegion);

    /**
     * Create the panel dismiss button.
     * @returns {HTMLButtonElement} Returns a configured dismiss button.
     */
    function makeDismissButton() {
      const btn = document.createElement('button');
      btn.textContent = '×';
      btn.setAttribute('aria-label', 'Dismiss Indico file download panel');
      btn.title = 'Dismiss';
      Object.assign(btn.style, {
        alignSelf: 'flex-end',
        background: 'transparent',
        border: 'none',
        color: 'rgba(255,255,255,0.6)',
        cursor: 'pointer',
        fontSize: '16px',
        lineHeight: '1',
        padding: '0 2px',
        userSelect: 'none',
      });

      /**
       * Hide the panel when the dismiss button is clicked.
       * @returns {void} Returns nothing.
       */
      function handleDismissClick() {
        panel.style.display = 'none';
      }

      btn.addEventListener('click', handleDismissClick);
      return btn;
    }

    panel.appendChild(makeDismissButton());

    // ── Per-format slide download buttons ───────────────────────────────────
    attachmentAnchors.forEach(
      /**
       * Create and append a panel download button for each attachment anchor.
       * @param {HTMLAnchorElement} anchor - Specifies the enhanced attachment anchor.
       * @returns {void} Returns nothing.
       */
      function addSlidesPanelButton(anchor) {
        let ext;
        try {
          const m = new URL(anchor.href).pathname.match(/\.(\w+)$/);
          if (!m) return;
          ext = m[1].toLowerCase();
        } catch {
          return;
        }

        const format = SLIDES_FORMAT[ext] || {
          icon: 'file',
          mime: 'application/octet-stream',
        };
        const filename = `${stem}.${ext}`;
        const buttonLabel = SLIDE_BUTTON_LABELS[ext] || ext.toUpperCase();

        /**
         * Trigger a GM_xmlhttpRequest download for the attachment.
         * @param {function(number): void} onProgress
         * @param {function(): void} onSuccess
         * @param {function(string): void} onFailure
         * @returns {void} Returns nothing.
         */
        function triggerSlidesDownload(onProgress, onSuccess, onFailure) {
          const trusted = getTrustedAttachmentUrl(anchor.href);
          if (!trusted) { onFailure('Invalid URL'); return; }
          downloadViaXhr(
            trusted.href, filename, format, onProgress, onSuccess, onFailure,
          );
        }

        panel.appendChild(
          makeDownloadButton(
            {
              label: buttonLabel,
              icon: format.icon,
              filename,
              triggerDownload: triggerSlidesDownload,
            },
            liveRegion,
          ),
        );
      },
    );

    // ── Video buttons ────────────────────────────────────────────────────────
    videoLinks.forEach(
      /**
       * Create and append a panel button for each detected video link.
       * @param {VideoLink} vl - Specifies the video link.
       * @returns {void} Returns nothing.
       */
      function addVideoPanelButton(vl) {
        const isDirect   = vl.type === 'mp4';
        const typeLabel  = { mp4: 'Video', youtube: 'YouTube', vimeo: 'Vimeo' }[vl.type] || 'Video';
        const videoFilename = isDirect ? `${stem}.mp4` : typeLabel;
        const icon          = isDirect ? 'file-video' : 'circle-play';
        const successLabel  = isDirect ? 'Downloaded' : 'Opened';

        /**
         * Trigger a native download for MP4 or open an external URL in a new tab.
         * @param {function(number): void} _onProgress - Unused for video actions.
         * @param {function(): void} onSuccess
         * @param {function(string): void} _onFailure - Unused for video actions.
         * @returns {void} Returns nothing.
         */
        function triggerVideoAction(_onProgress, onSuccess, _onFailure) {
          if (isDirect) {
            const dl = document.createElement('a');
            dl.href = vl.href;
            dl.download = videoFilename;
            dl.style.display = 'none';
            document.body.appendChild(dl);
            dl.click();
            document.body.removeChild(dl);
          } else {
            window.open(vl.href, '_blank', 'noopener,noreferrer');
          }
          onSuccess();
        }

        panel.appendChild(
          makeDownloadButton(
            {
              label: typeLabel,
              icon,
              filename: videoFilename,
              successLabel,
              triggerDownload: triggerVideoAction,
            },
            liveRegion,
          ),
        );
      },
    );

    document.body.appendChild(panel);
    return true;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // BOOT
  // ──────────────────────────────────────────────────────────────────────────

  if (!initScript()) {
    const retryObserver = new MutationObserver(
      /**
       * Retry initialization on any DOM mutation until success or retry limit.
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