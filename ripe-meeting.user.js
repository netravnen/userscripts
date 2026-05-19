// ==UserScript==
// @name         RIPE Meeting - Copy Session Filename
// @namespace    https://github.com/netravnen/userscripts
// @version      0.0.10
// @description  Floating panel + renamed PDF/MP4 download on RIPE meeting session detail pages
// @author       -
// @match        https://*.ripe.net/programme/meeting-plan/sessions/*/*
// @match        https://*.ripe.net/programme/meeting-plan/sessions/*/*/
// @require      https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/js/fontawesome.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/js/regular.min.js
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      pretalx.ripe.net
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  if (!/^ripe\d+\.ripe\.net$/i.test(location.hostname)) return;

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

  const MONTH_NUM = {
    january:'01',
    february:'02',
    march:'03',
    april:'04',
    may:'05',
    june:'06',
    july:'07',
    august:'08',
    september:'09',
    october:'10',
    november:'11',
    december:'12',
  };

  function sanitize(str) {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/'/g,               '')
      .replace(/[:/\\|]/g,         '')
      .replace(/[\s\-]+/g,        '_')
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/_+/g,             '_')
      .replace(/^_+|_+$/g,        '');
  }

  function faIcon(name) {
    const i = document.createElement('i');
    i.className = `fa-regular fa-${name}`;
    i.setAttribute('aria-hidden', 'true');
    i.style.pointerEvents = 'none';
    return i;
  }

  // ── Shared icon anchor style ───────────────────────────────────────────────
  // Applied identically to both the PDF anchor and the injected MP4 anchor
  // so FA's converted SVG elements share the same box-model context and
  // sit on the same baseline regardless of the site's own CSS on the PDF link.
  const ICON_ANCHOR_STYLE = {
    display:        'inline-flex',
    alignItems:     'center',
    justifyContent: 'center',
    verticalAlign:  'middle',
    lineHeight:     '1',
    fontSize:       '1.15em',
    textDecoration: 'none',
    cursor:         'pointer',
  };

  const confMatch  = location.hostname.match(/^ripe(\d+)\.ripe\.net$/i);
  const meetingNum = parseInt(confMatch[1], 10);
  const conference = 'RIPE' + confMatch[1].toUpperCase();

  const trackAnchor = [...document.querySelectorAll('a[href]')]
    .find(a => /\/programme\/meeting-plan\/sessions\/\d+\/?$/.test(a.pathname));
  const sessionTrack = trackAnchor ? trackAnchor.textContent.trim() : 'Session';

  const pathMatch = location.pathname.match(/\/sessions\/\d+\/([A-Z0-9]+)\/?$/i);
  if (!pathMatch) return;
  const sessionId = pathMatch[1].toUpperCase();

  const h1 = document.querySelector('h1');
  if (!h1) return;
  const sessionTitle = h1.textContent.trim();

  const mainEl = document.querySelector('main, [id="content"], article') || document.body;

  const DATE_RE = /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b/i;

  function buildDateToken(year, day, monthName) {
    const mm = MONTH_NUM[monthName.toLowerCase()];
    const dd = String(parseInt(day, 10)).padStart(2, '0');
    return `${year}${mm}${dd}`;
  }

  function extractDateToken() {
    const year = MEETING_YEAR[meetingNum];
    if (!year) return null;
    for (const dt of mainEl.querySelectorAll('dt')) {
      if (/^\s*date:\s*$/i.test(dt.textContent)) {
        const dd = dt.nextElementSibling;
        if (dd) { const m = dd.textContent.match(DATE_RE); if (m) return buildDateToken(year, m[1], m[2]); }
      }
    }
    const m = mainEl.innerText.match(DATE_RE);
    return m ? buildDateToken(year, m[1], m[2]) : null;
  }

  const TIME_RE = /(\d{1,2}):(\d{2})\s*\(UTC\s*([+-])(\d{2})(\d{2})\)/;

  function formatTimeToken(m) {
    const hhmm   = m[1].padStart(2, '0') + m[2];
    const sign   = m[3] === '-' ? '-' : '';
    const offH   = parseInt(m[4], 10);
    const offM   = parseInt(m[5], 10);
    const utcSfx = offM !== 0
      ? `UTC${sign}${offH}_${String(offM).padStart(2, '0')}`
      : `UTC${sign}${offH}`;
    return `${hhmm}_${utcSfx}`;
  }

  function extractTimeToken() {
    for (const dt of mainEl.querySelectorAll('dt')) {
      if (/^\s*time:\s*$/i.test(dt.textContent)) {
        const dd = dt.nextElementSibling;
        if (dd) { const m = dd.textContent.match(TIME_RE); if (m) return formatTimeToken(m); }
      }
    }
    const m = mainEl.innerText.match(TIME_RE);
    return m ? formatTimeToken(m) : null;
  }

  function findSpeakerContainer() {
    for (const dt of mainEl.querySelectorAll('dt')) {
      if (/speaker/i.test(dt.textContent.trim())) {
        const dd = dt.nextElementSibling;
        if (dd && dd.tagName === 'DD') return dd;
      }
    }
    for (const el of mainEl.querySelectorAll('p, div')) {
      const labelInStrong = el.querySelector('strong, b');
      const hasLabel =
        (labelInStrong && /speaker/i.test(labelInStrong.textContent)) ||
        [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && /speaker/i.test(n.textContent));
      if (!hasLabel) continue;
      const speakerLinks = [...el.querySelectorAll('a[href]')].filter(a => {
        try { const u = new URL(a.href); return u.pathname === location.pathname && !!u.hash; }
        catch { return false; }
      });
      if (speakerLinks.length > 0) return el;
    }
    return null;
  }

  function parseSpeakers(container) {
    const anchors = [...container.querySelectorAll('a[href]')].filter(a => {
      try { const u = new URL(a.href); return u.pathname === location.pathname && !!u.hash; }
      catch { return false; }
    });
    return anchors.map(a => {
      const name = a.textContent.trim();
      let raw = '', node = a.nextSibling;
      while (node) {
        if (node.nodeType === Node.TEXT_NODE) raw += node.textContent; else break;
        node = node.nextSibling;
      }
      return { name, affiliation: raw.replace(/^[\s,]+/, '').replace(/[\s,]+$/, '') };
    });
  }

  const speakerContainer = findSpeakerContainer();
  const speakers         = speakerContainer ? parseSpeakers(speakerContainer) : [];
  let speakerToken = '', affiliationToken = '';
  if (speakers.length > 0) {
    speakerToken = sanitize(speakers[0].name);
    if (speakers.length > 1) speakerToken += '_et_al';
    if (speakers[0].affiliation) affiliationToken = sanitize(speakers[0].affiliation);
  }

  const stem = [
    conference,
    sanitize(sessionTrack),
    extractDateToken(),
    extractTimeToken(),
    sessionId,
    sanitize(sessionTitle),
    speakerToken,
    affiliationToken,
  ].filter(Boolean).join('_');

  // ─────────────────────────────────────────────────────────────────────────
  // SLIDES LINK - FA file-pdf icon, renamed download
  // ─────────────────────────────────────────────────────────────────────────
  function findSlidesAnchor() {
    const byTitle = mainEl.querySelector(
      'a[title*="Download slides"], a[title*="download slides"]'
    );
    if (byTitle) return byTitle;
    for (const dt of mainEl.querySelectorAll('dt')) {
      if (/^\s*slides:\s*$/i.test(dt.textContent)) {
        const dd = dt.nextElementSibling;
        if (dd) { const a = dd.querySelector('a[href$=".pdf"]'); if (a) return a; }
      }
    }
    return mainEl.querySelector('a[href*="pretalx.ripe.net"][href$=".pdf"]') || null;
  }

  function applyRenamedDownload(anchor) {
    const pdfFilename = `${stem}.pdf`;

    while (anchor.firstChild) anchor.removeChild(anchor.firstChild);
    anchor.appendChild(faIcon('file-pdf'));
    anchor.title = pdfFilename;

    // Apply shared icon anchor style - overrides any site CSS that would
    // otherwise cause vertical misalignment between the two icons
    Object.assign(anchor.style, ICON_ANCHOR_STYLE);

    function setTooltip(text) { anchor.title = text; }

    anchor.addEventListener('click', function handleDownload(e) {
      e.preventDefault();
      if (anchor.dataset.fetching) return;
      anchor.dataset.fetching = '1';
      setTooltip('⏳ Fetching…');

      GM_xmlhttpRequest({
        method:       'GET',
        url:          anchor.href,
        responseType: 'arraybuffer',

        onprogress(res) {
          if (res.total > 0) {
            setTooltip(`⏳ ${Math.round((res.loaded / res.total) * 100)}%`);
          }
        },

        onload(res) {
          delete anchor.dataset.fetching;
          if (res.status < 200 || res.status >= 400) {
            setTooltip(`❌ HTTP ${res.status} - click to retry`);
            setTimeout(() => setTooltip(pdfFilename), 4000);
            return;
          }
          const blob    = new Blob([res.response], { type: 'application/pdf' });
          const blobUrl = URL.createObjectURL(blob);
          const dl      = document.createElement('a');
          dl.href = blobUrl; dl.download = pdfFilename; dl.style.display = 'none';
          document.body.appendChild(dl); dl.click(); document.body.removeChild(dl);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
          setTooltip(`✓ Downloaded as ${pdfFilename}`);
          setTimeout(() => setTooltip(pdfFilename), 2500);
        },

        onerror() {
          delete anchor.dataset.fetching;
          setTooltip('❌ Network error - click to retry');
          setTimeout(() => setTooltip(pdfFilename), 4000);
        },
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RECORDING LINK - FA file-video icon, adjacent to PDF icon
  // ─────────────────────────────────────────────────────────────────────────
  function findMp4Href() {
    const a = mainEl.querySelector('a[href$=".mp4"]');
    if (a) return a.href;
    return (
      mainEl.querySelector('video[src$=".mp4"]')?.src ||
      mainEl.querySelector('video source[src$=".mp4"]')?.src ||
      null
    );
  }

  function injectMp4Link(adjacentAnchor) {
    const mp4Href = findMp4Href();
    if (!mp4Href) return;

    const mp4Filename = `${stem}.mp4`;

    const link = document.createElement('a');
    link.href     = mp4Href;
    link.download = mp4Filename;
    link.title    = mp4Filename;
    link.id       = 'ripe-mp4-download';
    link.appendChild(faIcon('file-video'));

    // Same shared style as the PDF anchor - guarantees identical box model
    // so both SVG icons share the same baseline and cap-height
    Object.assign(link.style, ICON_ANCHOR_STYLE);
    link.style.marginLeft = '6px';   // gap between the two icons

    adjacentAnchor.insertAdjacentElement('afterend', link);
  }

  const slidesAnchor = findSlidesAnchor();
  if (slidesAnchor) {
    applyRenamedDownload(slidesAnchor);
    injectMp4Link(slidesAnchor);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FLOATING PANEL
  // ─────────────────────────────────────────────────────────────────────────
  const PANEL_ID = 'ripe-session-copy-panel';
  if (document.getElementById(PANEL_ID)) return;

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  Object.assign(panel.style, {
    position:      'fixed',
    bottom:        '24px',
    right:         '24px',
    zIndex:        '2147483647',
    display:       'flex',
    flexDirection: 'column',
    gap:           '8px',
    fontFamily:    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
  });

  function makeButton(ext) {
    const BG_BASE    = '#003d82';
    const BG_HOVER   = '#0057b8';
    const BG_SUCCESS = '#1f8a4c';

    const btn = document.createElement('button');
    btn.title = `${stem}.${ext}`;

    const icon  = faIcon('clipboard');
    const label = document.createElement('span');
    label.textContent = `  Copy .${ext} filename`;
    label.style.pointerEvents = 'none';

    btn.appendChild(icon);
    btn.appendChild(label);

    Object.assign(btn.style, {
      display:       'inline-flex',
      alignItems:    'center',
      background:    BG_BASE,
      color:         '#ffffff',
      border:        'none',
      borderRadius:  '8px',
      padding:       '9px 15px',
      fontSize:      '12px',
      fontWeight:    '700',
      letterSpacing: '0.02em',
      cursor:        'pointer',
      boxShadow:     '0 3px 12px rgba(0,0,0,0.45)',
      whiteSpace:    'nowrap',
      userSelect:    'none',
      transition:    'background 0.12s ease',
      lineHeight:    '1.4',
      gap:           '6px',
    });

    btn.addEventListener('mouseenter', () => { btn.style.background = BG_HOVER; });
    btn.addEventListener('mouseleave', () => { if (!btn.dataset.copied) btn.style.background = BG_BASE; });

    btn.addEventListener('click', () => {
      if (btn.dataset.copied) return;
      GM_setClipboard(`${stem}.${ext}`, 'text');
      btn.dataset.copied   = '1';
      label.textContent    = '  Copied!';
      btn.style.background = BG_SUCCESS;
      btn.style.cursor     = 'default';
      setTimeout(() => {
        delete btn.dataset.copied;
        label.textContent    = `  Copy .${ext} filename`;
        btn.style.background = BG_BASE;
        btn.style.cursor     = 'pointer';
      }, 1800);
    });

    return btn;
  }

  panel.appendChild(makeButton('pdf'));
  panel.appendChild(makeButton('mp4'));
  document.body.appendChild(panel);

})();