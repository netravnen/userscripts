"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  loadUserScript,
  createDocumentStub,
  createElementStub,
  createGMStubs,
  createTimerStubs,
  createMutationObserverStub,
} = require("./support/dom-stubs.js");

const SCRIPT_PATH = path.join(__dirname, "..", "ripe-meeting.user.js");

/**
 * Load the script with a location that satisfies its two top-level
 * `ripe\d+.ripe.net` hostname guards — without a matching hostname the IIFE
 * returns before defining any function, and `module.exports` never runs.
 * @param {{pathname?: string, hostname?: string}} [overrides] - Specifies location overrides.
 * @returns {object} Returns the script's exported functions.
 */
function load(overrides = {}) {
  return loadUserScript(SCRIPT_PATH, {
    hostname: "ripe92.ripe.net",
    ...overrides,
  });
}

/**
 * Build a document stub whose `main, [id="content"], article` query returns
 * the given main-content element — the script reads this once at load time
 * into its module-level `mainEl` variable, so helpers like
 * `extractDateToken`/`findSpeakerContainer` need it configured before load.
 * @param {object} mainEl - Specifies the main-content element stub.
 * @returns {object} Returns a document stub.
 */
function makeDocumentWithMain(mainEl) {
  const documentStub = createDocumentStub();
  documentStub.querySelector = (sel) =>
    sel === 'main, [id="content"], article' ? mainEl : null;
  return documentStub;
}

test("sanitize: strips diacritics via NFD normalization before token-izing", () => {
  const { sanitize } = load();
  assert.equal(sanitize("Møller & Co."), "M_ller_Co");
  assert.equal(sanitize("Réunion: Café / Bar"), "Reunion_Cafe_Bar");
});

test("sanitize: strips apostrophes and collapses whitespace/hyphens to underscores", () => {
  const { sanitize } = load();
  assert.equal(sanitize("O'Brien's Talk"), "OBriens_Talk");
  assert.equal(sanitize("  Hello   World  "), "Hello_World");
});

test("capStemLength: leaves a short stem untouched", () => {
  const { capStemLength } = load();
  assert.equal(capStemLength("RIPE92_Short_Stem"), "RIPE92_Short_Stem");
});

test("capStemLength: truncates to MAX_STEM_LENGTH and trims a trailing underscore run", () => {
  const { capStemLength } = load();
  const longStem = "a".repeat(215) + "___" + "b".repeat(20);
  const result = capStemLength(longStem);
  assert.ok(result.length <= 220);
  assert.ok(!result.endsWith("_"));
});

test("buildDateToken: builds a YYYYMMDD token from year/day/month-name", () => {
  const { buildDateToken } = load();
  assert.equal(buildDateToken(2024, "5", "October"), "20241005");
  assert.equal(buildDateToken(2024, "31", "december"), "20241231");
});

test("formatTimeToken: formats a positive UTC offset without a '+' sign (current behavior)", () => {
  const { formatTimeToken } = load();
  // TIME_RE's capture groups: [full, hh, mm, sign, offH, offM]
  assert.equal(formatTimeToken(["", "14", "30", "+", "02", "00"]), "1430_UTC2");
});

test("formatTimeToken: formats a negative UTC offset with non-zero minutes", () => {
  const { formatTimeToken } = load();
  assert.equal(formatTimeToken(["", "9", "05", "-", "03", "30"]), "0905_UTC-3_30");
});

test("getTrustedSlidesUrl: accepts an https pretalx.ripe.net URL", () => {
  const { getTrustedSlidesUrl } = load();
  const url = getTrustedSlidesUrl("https://pretalx.ripe.net/media/ripe92/slides.pdf");
  assert.ok(url instanceof URL);
  assert.equal(url.hostname, "pretalx.ripe.net");
});

test("getTrustedSlidesUrl: rejects a non-https URL", () => {
  const { getTrustedSlidesUrl } = load();
  assert.equal(getTrustedSlidesUrl("http://pretalx.ripe.net/media/ripe92/slides.pdf"), null);
});

test("getTrustedSlidesUrl: rejects an untrusted host", () => {
  const { getTrustedSlidesUrl } = load();
  assert.equal(getTrustedSlidesUrl("https://evil.invalid/slides.pdf"), null);
});

test("getTrustedSlidesUrl: rejects an unparseable URL", () => {
  const { getTrustedSlidesUrl } = load();
  assert.equal(getTrustedSlidesUrl("not a url"), null);
});

test("isSamePageHashLink: true for a same-path anchor with a hash fragment", () => {
  const { isSamePageHashLink } = load({
    pathname: "/programme/meeting-plan/sessions/123/ABCD",
  });
  const a = { href: "https://ripe92.ripe.net/programme/meeting-plan/sessions/123/ABCD#speaker-1" };
  assert.equal(isSamePageHashLink(a), true);
});

test("isSamePageHashLink: false when the path differs from the current page", () => {
  const { isSamePageHashLink } = load({
    pathname: "/programme/meeting-plan/sessions/123/ABCD",
  });
  const a = { href: "https://ripe92.ripe.net/programme/meeting-plan/sessions/999/ZZZZ#speaker-1" };
  assert.equal(isSamePageHashLink(a), false);
});

test("isSamePageHashLink: false when the anchor has no hash fragment", () => {
  const { isSamePageHashLink } = load({
    pathname: "/programme/meeting-plan/sessions/123/ABCD",
  });
  const a = { href: "https://ripe92.ripe.net/programme/meeting-plan/sessions/123/ABCD" };
  assert.equal(isSamePageHashLink(a), false);
});

test("isSamePageHashLink: false for an unparseable href", () => {
  const { isSamePageHashLink } = load();
  assert.equal(isSamePageHashLink({ href: "not a url" }), false);
});

test("module.exports stays empty when the hostname doesn't match ripeNN.ripe.net", () => {
  const exported = loadUserScript(SCRIPT_PATH, { hostname: "www.ripe.net" });
  assert.deepEqual({ ...exported }, {});
});

test("faIcon: builds a regular-style FontAwesome icon element", () => {
  const { faIcon } = load();
  const icon = faIcon("file-pdf");
  assert.equal(icon.className, "fa-regular fa-file-pdf");
  assert.equal(icon.getAttribute("aria-hidden"), "true");
});

test("isTrackAnchor: matches a bare session-track path, not a session-detail path", () => {
  const { isTrackAnchor } = load();
  assert.equal(isTrackAnchor({ pathname: "/programme/meeting-plan/sessions/123" }), true);
  assert.equal(isTrackAnchor({ pathname: "/programme/meeting-plan/sessions/123/" }), true);
  assert.equal(isTrackAnchor({ pathname: "/programme/meeting-plan/sessions/123/ABCD" }), false);
});

test("debug toggle: GM_registerMenuCommand toggles DEBUG and re-registers with an updated label", () => {
  const gmStubs = createGMStubs();
  load({ gm: gmStubs });

  const [, command] = [...gmStubs.commands.entries()][0];
  assert.match(command.label, /Debug logging: OFF/);

  command.callback();

  assert.equal(gmStubs.GM_getValue("debug_logging", false), true);
  assert.equal(gmStubs.commands.size, 1, "the stale command is unregistered, not left dangling");
  const [, updated] = [...gmStubs.commands.entries()][0];
  assert.match(updated.label, /Debug logging: ON/);

  updated.callback();

  assert.equal(gmStubs.GM_getValue("debug_logging", false), false);
  const [, offAgain] = [...gmStubs.commands.entries()][0];
  assert.match(offAgain.label, /Debug logging: OFF/);
});

test("debug toggle: the initial menu label reflects a pre-existing 'ON' debug_logging value", () => {
  const gmStubs = createGMStubs();
  gmStubs.GM_setValue("debug_logging", true);
  load({ gm: gmStubs });

  const [, command] = [...gmStubs.commands.entries()][0];
  assert.match(command.label, /Debug logging: ON/);
});

test("debug logging: dbg/dbgWarn actually log to console when DEBUG is true", () => {
  const gmStubs = createGMStubs();
  gmStubs.GM_setValue("debug_logging", true);

  const originalDebug = console.debug;
  const originalWarn = console.warn;
  const calls = { debug: 0, warn: 0 };
  console.debug = () => { calls.debug += 1; };
  console.warn = () => { calls.warn += 1; };

  try {
    const { downloadViaXhr } = load({ gm: gmStubs });

    downloadViaXhr(
      "https://pretalx.ripe.net/media/ripe92/slides.pdf",
      "slides.pdf",
      { mime: "application/pdf" },
      () => {},
      () => {},
      () => { throw new Error("should not fail"); },
    );
    gmStubs.xhrCalls[0].onload({
      status: 200,
      response: new TextEncoder().encode("hello").buffer,
      responseHeaders: "content-type: application/pdf\r\n",
    });
    assert.ok(calls.debug >= 1, "dbg logged on successful download");

    downloadViaXhr("https://pretalx.ripe.net/x.pdf", "x.pdf", { mime: "application/pdf" }, () => {}, () => {}, () => {});
    gmStubs.xhrCalls[1].onerror();
    assert.ok(calls.warn >= 1, "dbgWarn logged on network error");
  } finally {
    console.debug = originalDebug;
    console.warn = originalWarn;
  }
});

test("extractDateToken: reads a structured Date: <dt>/<dd> pair", () => {
  const dl = createElementStub("dl");
  const dt = createElementStub("dt");
  dt.textContent = "Date:";
  const dd = createElementStub("dd");
  dd.textContent = "14 August";
  dl.appendChild(dt);
  dl.appendChild(dd);

  const mainEl = createElementStub("main");
  mainEl.querySelectorAll = (sel) => (sel === "dt" ? [dt] : []);

  const { extractDateToken } = load({ document: makeDocumentWithMain(mainEl) });
  assert.equal(extractDateToken(), "20260814");
});

test("extractDateToken: falls back to a full-page text scan when no structured <dt> matches", () => {
  const mainEl = createElementStub("main");
  mainEl.querySelectorAll = () => [];
  mainEl.textContent = "Session details... 5 October ...";

  const { extractDateToken } = load({ document: makeDocumentWithMain(mainEl) });
  assert.equal(extractDateToken(), "20261005");
});

test("extractDateToken: returns null when the meeting number has no known year", () => {
  const mainEl = createElementStub("main");
  const { extractDateToken } = load({
    document: makeDocumentWithMain(mainEl),
    hostname: "ripe999.ripe.net",
  });
  assert.equal(extractDateToken(), null);
});

test("extractTimeToken: reads a structured Time: <dt>/<dd> pair", () => {
  const dl = createElementStub("dl");
  const dt = createElementStub("dt");
  dt.textContent = "Time:";
  const dd = createElementStub("dd");
  dd.textContent = "14:30 (UTC+0200)";
  dl.appendChild(dt);
  dl.appendChild(dd);

  const mainEl = createElementStub("main");
  mainEl.querySelectorAll = (sel) => (sel === "dt" ? [dt] : []);

  const { extractTimeToken } = load({ document: makeDocumentWithMain(mainEl) });
  assert.equal(extractTimeToken(), "1430_UTC2");
});

test("extractTimeToken: falls back to a full-page text scan when no structured <dt> matches", () => {
  const mainEl = createElementStub("main");
  mainEl.querySelectorAll = () => [];
  mainEl.textContent = "Starts at 09:05 (UTC-0330) sharp.";

  const { extractTimeToken } = load({ document: makeDocumentWithMain(mainEl) });
  assert.equal(extractTimeToken(), "0905_UTC-3_30");
});

test("extractTimeToken: returns null when no time can be found anywhere", () => {
  const mainEl = createElementStub("main");
  mainEl.querySelectorAll = () => [];
  mainEl.textContent = "No time info here.";
  const { extractTimeToken } = load({ document: makeDocumentWithMain(mainEl) });
  assert.equal(extractTimeToken(), null);
});

test("findSpeakerContainer: finds a Speaker(s): <dt>/<dd> pair", () => {
  const dl = createElementStub("dl");
  const dt = createElementStub("dt");
  dt.textContent = "Speaker(s):";
  const dd = createElementStub("dd");
  dl.appendChild(dt);
  dl.appendChild(dd);

  const mainEl = createElementStub("main");
  mainEl.querySelectorAll = (sel) => (sel === "dt" ? [dt] : []);

  const { findSpeakerContainer } = load({ document: makeDocumentWithMain(mainEl) });
  assert.equal(findSpeakerContainer(), dd);
});

test("findSpeakerContainer: finds an inline <p> container labeled via <strong>", () => {
  const p = createElementStub("p");
  const strong = createElementStub("strong");
  strong.textContent = "Speaker:";
  p.appendChild(strong);
  const anchor = createElementStub("a");
  anchor.href = "https://ripe92.ripe.net/programme/meeting-plan/sessions/123/ABCD#speaker-1";
  p.appendChild(anchor);
  p.querySelector = (sel) => (sel === "strong, b" ? strong : null);
  p.querySelectorAll = (sel) => (sel === "a[href]" ? [anchor] : []);

  const mainEl = createElementStub("main");
  mainEl.querySelectorAll = (sel) => {
    if (sel === "dt") return [];
    if (sel === "p, div") return [p];
    return [];
  };

  const { findSpeakerContainer } = load({
    document: makeDocumentWithMain(mainEl),
    pathname: "/programme/meeting-plan/sessions/123/ABCD",
  });
  assert.equal(findSpeakerContainer(), p);
});

test("findSpeakerContainer: finds an inline <p> container labeled via a text node (no <strong>)", () => {
  const p = createElementStub("p");
  p.children.push({ nodeType: 3, textContent: "Speaker: ", remove() {} });
  const anchor = createElementStub("a");
  anchor.href = "https://ripe92.ripe.net/programme/meeting-plan/sessions/123/ABCD#speaker-1";
  p.appendChild(anchor);
  p.querySelector = (sel) => (sel === "strong, b" ? null : null);
  p.querySelectorAll = (sel) => (sel === "a[href]" ? [anchor] : []);

  const mainEl = createElementStub("main");
  mainEl.querySelectorAll = (sel) => {
    if (sel === "dt") return [];
    if (sel === "p, div") return [p];
    return [];
  };

  const { findSpeakerContainer } = load({
    document: makeDocumentWithMain(mainEl),
    pathname: "/programme/meeting-plan/sessions/123/ABCD",
  });
  assert.equal(findSpeakerContainer(), p);
});

test("findSpeakerContainer: skips a <p>/<div> candidate with no speaker label at all", () => {
  const unlabeledP = createElementStub("p");
  unlabeledP.querySelector = () => null;
  unlabeledP.childNodes = [];

  const p = createElementStub("p");
  p.children.push({ nodeType: 3, textContent: "Speaker: ", remove() {} });
  const anchor = createElementStub("a");
  anchor.href = "https://ripe92.ripe.net/programme/meeting-plan/sessions/123/ABCD#speaker-1";
  p.appendChild(anchor);
  p.querySelector = (sel) => (sel === "strong, b" ? null : null);
  p.querySelectorAll = (sel) => (sel === "a[href]" ? [anchor] : []);

  const mainEl = createElementStub("main");
  mainEl.querySelectorAll = (sel) => {
    if (sel === "dt") return [];
    if (sel === "p, div") return [unlabeledP, p];
    return [];
  };

  const { findSpeakerContainer } = load({
    document: makeDocumentWithMain(mainEl),
    pathname: "/programme/meeting-plan/sessions/123/ABCD",
  });
  assert.equal(findSpeakerContainer(), p, "the unlabeled candidate is skipped, the labeled one is found");
});

test("findSpeakerContainer: returns null when neither strategy finds a match", () => {
  const mainEl = createElementStub("main");
  mainEl.querySelectorAll = () => [];
  const { findSpeakerContainer } = load({ document: makeDocumentWithMain(mainEl) });
  assert.equal(findSpeakerContainer(), null);
});

test("parseSpeakers: parses name + trailing affiliation text after each speaker anchor", () => {
  const container = createElementStub("dd");
  const anchor = createElementStub("a");
  anchor.href = "https://ripe92.ripe.net/programme/meeting-plan/sessions/123/ABCD#speaker-1";
  anchor.textContent = "Jane Doe";
  container.appendChild(anchor);
  const affiliationText = { nodeType: 3, textContent: ", ACME Corp", remove() {} };
  const brNode = createElementStub("br");
  // Wire `nextSibling` directly rather than relying on positional lookup
  // (plain text-node stubs don't get the element stub's `nextSibling`
  // getter), so the walk in `parseSpeakers` reaches a non-text sibling and
  // exercises its loop-terminating `break`.
  Object.defineProperty(affiliationText, "nextSibling", { get: () => brNode });
  container.children.push(affiliationText, brNode);
  container.querySelectorAll = (sel) => (sel === "a[href]" ? [anchor] : []);

  const { parseSpeakers } = load({ pathname: "/programme/meeting-plan/sessions/123/ABCD" });
  const speakers = [...parseSpeakers(container)].map((s) => ({ ...s }));
  assert.deepEqual(speakers, [{ name: "Jane Doe", affiliation: "ACME Corp" }]);
});

test("findAllSlidesAnchors: prefers title=\"Download slides as ...\" anchors when present", () => {
  const anchor = createElementStub("a");
  const mainEl = createElementStub("main");
  mainEl.querySelectorAll = (sel) =>
    sel === 'a[title*="Download slides"], a[title*="download slides"]' ? [anchor] : [];

  const { findAllSlidesAnchors } = load({ document: makeDocumentWithMain(mainEl) });
  assert.deepEqual([...findAllSlidesAnchors()], [anchor]);
});

test("findAllSlidesAnchors: falls back to a Slides: <dt>/<dd> pair filtered by known extensions", () => {
  const dt = createElementStub("dt");
  dt.textContent = "Slides:";
  const dd = createElementStub("dd");
  const pdfAnchor = createElementStub("a");
  pdfAnchor.href = "https://pretalx.ripe.net/media/ripe92/slides.pdf";
  const otherAnchor = createElementStub("a");
  otherAnchor.href = "https://pretalx.ripe.net/media/ripe92/notes.txt";
  dd.appendChild(pdfAnchor);
  dd.appendChild(otherAnchor);
  dd.querySelectorAll = (sel) => (sel === "a[href]" ? [pdfAnchor, otherAnchor] : []);
  const dl = createElementStub("dl");
  dl.appendChild(dt);
  dl.appendChild(dd);

  const mainEl = createElementStub("main");
  mainEl.querySelectorAll = (sel) => {
    if (sel === 'a[title*="Download slides"], a[title*="download slides"]') return [];
    if (sel === "dt") return [dt];
    return [];
  };

  const { findAllSlidesAnchors } = load({ document: makeDocumentWithMain(mainEl) });
  assert.deepEqual([...findAllSlidesAnchors()], [pdfAnchor]);
});

test("findAllSlidesAnchors: a Slides: <dd> anchor with an unparseable href is silently filtered out", () => {
  const dt = createElementStub("dt");
  dt.textContent = "Slides:";
  const dd = createElementStub("dd");
  const pdfAnchor = createElementStub("a");
  pdfAnchor.href = "https://pretalx.ripe.net/media/ripe92/slides.pdf";
  const brokenAnchor = createElementStub("a");
  brokenAnchor.href = "not a url";
  dd.querySelectorAll = (sel) => (sel === "a[href]" ? [brokenAnchor, pdfAnchor] : []);
  const dl = createElementStub("dl");
  dl.appendChild(dt);
  dl.appendChild(dd);

  const mainEl = createElementStub("main");
  mainEl.querySelectorAll = (sel) => {
    if (sel === 'a[title*="Download slides"], a[title*="download slides"]') return [];
    if (sel === "dt") return [dt];
    return [];
  };

  const { findAllSlidesAnchors } = load({ document: makeDocumentWithMain(mainEl) });
  assert.deepEqual([...findAllSlidesAnchors()], [pdfAnchor]);
});

test("findAllSlidesAnchors: falls back to scanning trusted pretalx.ripe.net presentation links", () => {
  const pdfAnchor = createElementStub("a");
  pdfAnchor.href = "https://pretalx.ripe.net/media/ripe92/slides.pdf";
  const untrustedAnchor = createElementStub("a");
  untrustedAnchor.href = "https://evil.invalid/slides.pdf";

  const mainEl = createElementStub("main");
  mainEl.querySelectorAll = (sel) =>
    sel === 'a[href*="pretalx.ripe.net"]' ? [pdfAnchor, untrustedAnchor] : [];

  const { findAllSlidesAnchors } = load({ document: makeDocumentWithMain(mainEl) });
  assert.deepEqual([...findAllSlidesAnchors()], [pdfAnchor]);
});

test("findAllSlidesAnchors: a pretalx-scan anchor with an unparseable href is silently filtered out", () => {
  const pdfAnchor = createElementStub("a");
  pdfAnchor.href = "https://pretalx.ripe.net/media/ripe92/slides.pdf";
  const brokenAnchor = createElementStub("a");
  brokenAnchor.href = "not a url";

  const mainEl = createElementStub("main");
  mainEl.querySelectorAll = (sel) =>
    sel === 'a[href*="pretalx.ripe.net"]' ? [brokenAnchor, pdfAnchor] : [];

  const { findAllSlidesAnchors } = load({ document: makeDocumentWithMain(mainEl) });
  assert.deepEqual([...findAllSlidesAnchors()], [pdfAnchor]);
});

test("downloadViaXhr: on success, downloads a Blob, and calls onProgress/onSuccess", () => {
  const gmStubs = createGMStubs();
  const documentStub = createDocumentStub();
  const { downloadViaXhr } = load({ gm: gmStubs, document: documentStub });

  const progressUpdates = [];
  let succeeded = false;
  downloadViaXhr(
    "https://pretalx.ripe.net/media/ripe92/slides.pdf",
    "slides.pdf",
    { mime: "application/pdf" },
    (pct) => progressUpdates.push(pct),
    () => {
      succeeded = true;
    },
    () => {
      throw new Error("should not fail");
    },
  );

  assert.equal(gmStubs.xhrCalls.length, 1);
  const call = gmStubs.xhrCalls[0];

  call.onprogress({ loaded: 50, total: 100 });
  assert.deepEqual(progressUpdates, [50]);
  call.onprogress({ loaded: 0, total: 0 });
  assert.deepEqual(progressUpdates, [50], "a zero total is ignored, not treated as 0%");

  call.onload({
    status: 200,
    response: new TextEncoder().encode("hello").buffer,
    responseHeaders: "content-type: application/pdf\r\n",
  });

  assert.equal(succeeded, true);
  assert.equal(documentStub.body.children.length, 0, "the temporary anchor is appended then removed");
});

test("downloadViaXhr: succeeds when responseHeaders has no Content-Type at all", () => {
  const gmStubs = createGMStubs();
  const { downloadViaXhr } = load({ gm: gmStubs });

  let succeeded = false;
  downloadViaXhr(
    "https://pretalx.ripe.net/media/ripe92/slides.pdf",
    "slides.pdf",
    { mime: "application/pdf" },
    () => {},
    () => { succeeded = true; },
    () => { throw new Error("should not fail"); },
  );

  gmStubs.xhrCalls[0].onload({
    status: 200,
    response: new TextEncoder().encode("hello").buffer,
    responseHeaders: "",
  });

  assert.equal(succeeded, true, "an absent Content-Type header doesn't block the download");
});

test("downloadViaXhr: onFailure fires for an HTTP error status", () => {
  const gmStubs = createGMStubs();
  const { downloadViaXhr } = load({ gm: gmStubs });
  let failureMsg = null;
  downloadViaXhr("https://pretalx.ripe.net/x.pdf", "x.pdf", { mime: "application/pdf" }, () => {}, () => {}, (m) => {
    failureMsg = m;
  });
  gmStubs.xhrCalls[0].onload({ status: 500, response: null, responseHeaders: "" });
  assert.equal(failureMsg, "HTTP 500");
});

test("downloadViaXhr: onFailure fires for an empty response body", () => {
  const gmStubs = createGMStubs();
  const { downloadViaXhr } = load({ gm: gmStubs });
  let failureMsg = null;
  downloadViaXhr("https://pretalx.ripe.net/x.pdf", "x.pdf", { mime: "application/pdf" }, () => {}, () => {}, (m) => {
    failureMsg = m;
  });
  gmStubs.xhrCalls[0].onload({ status: 200, response: new ArrayBuffer(0), responseHeaders: "" });
  assert.equal(failureMsg, "Empty response");
});

test("downloadViaXhr: onFailure fires when Content-Type doesn't match the expected MIME", () => {
  const gmStubs = createGMStubs();
  const { downloadViaXhr } = load({ gm: gmStubs });
  let failureMsg = null;
  downloadViaXhr("https://pretalx.ripe.net/x.pdf", "x.pdf", { mime: "application/pdf" }, () => {}, () => {}, (m) => {
    failureMsg = m;
  });
  gmStubs.xhrCalls[0].onload({
    status: 200,
    response: new TextEncoder().encode("x").buffer,
    responseHeaders: "content-type: text/html\r\n",
  });
  assert.equal(failureMsg, "Unexpected type (text/html)");
});

test("downloadViaXhr: onFailure fires on network error and on timeout", () => {
  const gmStubs = createGMStubs();
  const { downloadViaXhr } = load({ gm: gmStubs });
  const failures = [];
  downloadViaXhr("https://pretalx.ripe.net/x.pdf", "x.pdf", { mime: "application/pdf" }, () => {}, () => {}, (m) =>
    failures.push(m),
  );
  gmStubs.xhrCalls[0].onerror();
  downloadViaXhr("https://pretalx.ripe.net/x.pdf", "x.pdf", { mime: "application/pdf" }, () => {}, () => {}, (m) =>
    failures.push(m),
  );
  gmStubs.xhrCalls[1].ontimeout();
  assert.deepEqual(failures, ["Network error", "Timed out"]);
});

test("applyRenamedDownload: is a no-op when already enhanced", () => {
  const anchor = createElementStub("a");
  anchor.dataset.ripeEnhanced = "1";
  anchor.href = "https://pretalx.ripe.net/media/ripe92/slides.pdf";
  const { applyRenamedDownload } = load();
  applyRenamedDownload(anchor);
  assert.equal(anchor.children.length, 0);
});

test("applyRenamedDownload: is a no-op for an untrusted host", () => {
  const anchor = createElementStub("a");
  anchor.href = "https://evil.invalid/slides.pdf";
  const { applyRenamedDownload } = load();
  applyRenamedDownload(anchor);
  assert.equal(anchor.dataset.ripeEnhanced, undefined);
});

test("applyRenamedDownload: is a no-op when the URL has no file extension", () => {
  const anchor = createElementStub("a");
  anchor.href = "https://pretalx.ripe.net/media/ripe92/slides";
  const { applyRenamedDownload } = load();
  applyRenamedDownload(anchor);
  assert.equal(anchor.dataset.ripeEnhanced, undefined);
});

test("applyRenamedDownload: an unrecognized extension falls back to a generic file icon and octet-stream MIME", () => {
  const anchor = createElementStub("a");
  anchor.href = "https://pretalx.ripe.net/media/ripe92/slides.zip";
  const gmStubs = createGMStubs();
  const { applyRenamedDownload } = load({ gm: gmStubs });

  applyRenamedDownload(anchor);
  assert.equal(anchor.children[0].className, "fa-regular fa-file");

  anchor.click();
  assert.equal(gmStubs.xhrCalls.length, 1);
  gmStubs.xhrCalls[0].onload({
    status: 200,
    response: new TextEncoder().encode("x").buffer,
    responseHeaders: "content-type: application/octet-stream\r\n",
  });
  assert.match(anchor.title, /\.zip$/);
});

test("applyRenamedDownload: enhances a trusted slides anchor and downloads on click, then resets on success", () => {
  const anchor = createElementStub("a");
  anchor.href = "https://pretalx.ripe.net/media/ripe92/slides.pdf";
  anchor.appendChild(createElementStub("span"));

  const gmStubs = createGMStubs();
  const timerStubs = createTimerStubs();
  const { applyRenamedDownload } = load({ gm: gmStubs, timers: timerStubs });

  applyRenamedDownload(anchor);

  assert.equal(anchor.dataset.ripeEnhanced, "1");
  assert.equal(anchor.children.length, 1, "pre-existing content is cleared and replaced with the icon");
  assert.equal(anchor.children[0].className, "fa-regular fa-file-pdf");
  assert.match(anchor.title, /\.pdf$/);

  anchor.click();
  assert.equal(anchor.dataset.fetching, "1");
  assert.equal(gmStubs.xhrCalls.length, 1);

  anchor.click();
  assert.equal(gmStubs.xhrCalls.length, 1, "a re-entrant click while fetching is ignored");

  gmStubs.xhrCalls[0].onprogress({ loaded: 25, total: 100 });
  assert.match(anchor.title, /⏳ 25%/);

  gmStubs.xhrCalls[0].onload({
    status: 200,
    response: new TextEncoder().encode("hi").buffer,
    responseHeaders: "content-type: application/pdf\r\n",
  });

  assert.equal(anchor.dataset.fetching, undefined);
  assert.match(anchor.title, /Downloaded as/);

  // A second download before the first tooltip-reset timer fires clears
  // the pending timer instead of leaving it dangling.
  anchor.click();
  gmStubs.xhrCalls[1].onload({
    status: 200,
    response: new TextEncoder().encode("hi").buffer,
    responseHeaders: "content-type: application/pdf\r\n",
  });
  assert.match(anchor.title, /Downloaded as/);

  timerStubs.flush();
  assert.match(anchor.title, /\.pdf$/, "tooltip resets back to the filename after the success timeout");
});

test("applyRenamedDownload: click handler shows and resets a failure tooltip", () => {
  const anchor = createElementStub("a");
  anchor.href = "https://pretalx.ripe.net/media/ripe92/slides.pdf";
  const gmStubs = createGMStubs();
  const timerStubs = createTimerStubs();
  const { applyRenamedDownload } = load({ gm: gmStubs, timers: timerStubs });
  applyRenamedDownload(anchor);

  anchor.click();
  gmStubs.xhrCalls[0].onerror();

  assert.equal(anchor.dataset.fetching, undefined);
  assert.match(anchor.title, /❌ Network error/);

  timerStubs.flush();
  assert.match(anchor.title, /\.pdf$/);
});

test("findRecordingSection: finds the heading's parent element by 'Recording' text", () => {
  const heading = createElementStub("h2");
  heading.textContent = "Recording";
  const section = createElementStub("section");
  section.appendChild(heading);

  const mainEl = createElementStub("main");
  mainEl.querySelectorAll = (sel) => (sel === "h2, h3, h4" ? [heading] : []);

  const { findRecordingSection } = load({ document: makeDocumentWithMain(mainEl) });
  assert.equal(findRecordingSection(), section);
});

test("findRecordingSection: returns null when the matching heading has no parent element", () => {
  const heading = createElementStub("h2");
  heading.textContent = "Recording";
  // Never appended to a parent, so parentNode/parentElement stay null.

  const mainEl = createElementStub("main");
  mainEl.querySelectorAll = (sel) => (sel === "h2, h3, h4" ? [heading] : []);

  const { findRecordingSection } = load({ document: makeDocumentWithMain(mainEl) });
  assert.equal(findRecordingSection(), null);
});

test("findRecordingSection: returns null when no matching heading is found", () => {
  const mainEl = createElementStub("main");
  mainEl.querySelectorAll = () => [];
  const { findRecordingSection } = load({ document: makeDocumentWithMain(mainEl) });
  assert.equal(findRecordingSection(), null);
});

test("findMp4Href: prefers an <a href$=.mp4> anchor within the recording section", () => {
  const heading = createElementStub("h2");
  heading.textContent = "Recording";
  const section = createElementStub("section");
  section.appendChild(heading);
  const mp4Anchor = createElementStub("a");
  mp4Anchor.href = "https://ripe92.ripe.net/recordings/session.mp4";
  section.querySelector = (sel) => (sel === 'a[href$=".mp4"]' ? mp4Anchor : null);

  const mainEl = createElementStub("main");
  mainEl.querySelectorAll = (sel) => (sel === "h2, h3, h4" ? [heading] : []);

  const { findMp4Href } = load({ document: makeDocumentWithMain(mainEl) });
  assert.equal(findMp4Href(), "https://ripe92.ripe.net/recordings/session.mp4");
});

test("findMp4Href: falls back to a <video src=.mp4> when no anchor is present", () => {
  const video = createElementStub("video");
  video.src = "https://ripe92.ripe.net/recordings/session.mp4";
  const mainEl = createElementStub("main");
  mainEl.querySelectorAll = () => [];
  mainEl.querySelector = (sel) => (sel === 'video[src$=".mp4"]' ? video : null);

  const { findMp4Href } = load({ document: makeDocumentWithMain(mainEl) });
  assert.equal(findMp4Href(), "https://ripe92.ripe.net/recordings/session.mp4");
});

test("findMp4Href: falls back to a <video><source src=.mp4> when no video src is present", () => {
  const source = createElementStub("source");
  source.src = "https://ripe92.ripe.net/recordings/session.mp4";
  const mainEl = createElementStub("main");
  mainEl.querySelectorAll = () => [];
  mainEl.querySelector = (sel) => (sel === 'video source[src$=".mp4"]' ? source : null);

  const { findMp4Href } = load({ document: makeDocumentWithMain(mainEl) });
  assert.equal(findMp4Href(), "https://ripe92.ripe.net/recordings/session.mp4");
});

test("findMp4Href: returns null when no recording is present at all", () => {
  const mainEl = createElementStub("main");
  mainEl.querySelectorAll = () => [];
  mainEl.querySelector = () => null;
  const { findMp4Href } = load({ document: makeDocumentWithMain(mainEl) });
  assert.equal(findMp4Href(), null);
});

test("injectMp4Link: is a no-op when there's no recording URL", () => {
  const anchor = createElementStub("a");
  const { injectMp4Link } = load();
  injectMp4Link(anchor, null);
  assert.equal(anchor.nextSibling, null);
});

test("injectMp4Link: inserts an MP4 download icon after the anchor, with a self-restoring click state", () => {
  const wrapper = createElementStub("div");
  const anchor = createElementStub("a");
  wrapper.appendChild(anchor);

  const timerStubs = createTimerStubs();
  const { injectMp4Link } = load({ timers: timerStubs });
  injectMp4Link(anchor, "https://ripe92.ripe.net/recordings/session.mp4");

  const link = anchor.nextSibling;
  assert.ok(link, "the mp4 link is inserted right after the anchor");
  assert.equal(link.id, "ripe-mp4-download");
  assert.equal(link.children[0].className, "fa-regular fa-file-video");

  link.click();
  assert.equal(link.children[0].className, "fa-regular fa-circle-check");
  assert.match(link.getAttribute("aria-label"), /Download started/);

  timerStubs.flush();
  assert.equal(link.children[0].className, "fa-regular fa-file-video");
  assert.match(link.getAttribute("aria-label"), /Download recording/);
});

test("makeDownloadButton: hover styling, click-triggered download flow, and reset after the success timeout", () => {
  const timerStubs = createTimerStubs();
  const liveRegion = { textContent: "" };
  const { makeDownloadButton } = load({ timers: timerStubs });

  let progressCb, successCb;
  const btn = makeDownloadButton(
    {
      label: "PDF",
      icon: "file-pdf",
      filename: "session.pdf",
      triggerDownload: (onProgress, onSuccess) => {
        progressCb = onProgress;
        successCb = onSuccess;
      },
    },
    liveRegion,
  );

  btn.dispatch("mouseenter");
  assert.equal(btn.style.background, "#0057b8");
  btn.dispatch("mouseleave");
  assert.equal(btn.style.background, "#003d82");

  btn.click();
  assert.equal(btn.dataset.active, "1");
  assert.equal(btn.children[1].textContent, " ⏳ Fetching…");

  btn.click();
  assert.equal(btn.children[1].textContent, " ⏳ Fetching…", "a re-entrant click is ignored");

  progressCb(42);
  assert.equal(btn.children[1].textContent, " ⏳ 42%");

  successCb();
  assert.equal(btn.children[1].textContent, " ✓ Downloaded");
  assert.equal(liveRegion.textContent, "Downloaded: session.pdf");

  btn.dispatch("mouseenter");
  assert.equal(btn.style.background, "#1f8a4c", "hover is suppressed while a download is active");

  successCb();
  assert.equal(
    btn.children[1].textContent,
    " ✓ Downloaded",
    "a second success before the reset timer fires clears the pending timer first",
  );

  timerStubs.flush();
  assert.equal(btn.dataset.active, undefined);
  assert.equal(btn.children[1].textContent, " Download PDF");
  assert.equal(liveRegion.textContent, "");
});

test("makeDownloadButton: click handler shows and resets an error state on failure", () => {
  const timerStubs = createTimerStubs();
  const liveRegion = { textContent: "" };
  const { makeDownloadButton } = load({ timers: timerStubs });

  let failureCb;
  const btn = makeDownloadButton(
    {
      label: "PDF",
      icon: "file-pdf",
      filename: "session.pdf",
      triggerDownload: (_onProgress, _onSuccess, onFailure) => {
        failureCb = onFailure;
      },
    },
    liveRegion,
  );

  btn.click();
  failureCb("Network error");
  assert.equal(btn.children[1].textContent, " ❌ Network error");
  assert.equal(liveRegion.textContent, "Download failed: Network error");

  failureCb("Timed out");
  assert.equal(
    btn.children[1].textContent,
    " ❌ Timed out",
    "a second failure before the reset timer fires clears the pending timer first",
  );

  timerStubs.flush();
  assert.equal(btn.children[1].textContent, " Download PDF");
  assert.equal(liveRegion.textContent, "");
});

/**
 * Build a full session-detail page stub with a title, track anchor,
 * date/time/speaker `<dt>/<dd>` pairs, a title-tagged slides anchor, and a
 * "Recording" section with an mp4 anchor — enough for `initScript()` to
 * resolve every field and build the full panel.
 * @returns {{documentStub: object, slidesAnchor: object, zipSlidesAnchor: object, brokenSlidesAnchor: object}} Returns the built page stub.
 */
function makeFullRipePage() {
  const documentStub = createDocumentStub();
  documentStub.body = createElementStub("body");

  const h1 = createElementStub("h1");
  h1.textContent = "  My Great Talk  ";

  const trackAnchor = createElementStub("a");
  trackAnchor.pathname = "/programme/meeting-plan/sessions/123";
  trackAnchor.textContent = "Plenary";

  const dateDt = createElementStub("dt");
  dateDt.textContent = "Date:";
  const dateDd = createElementStub("dd");
  dateDd.textContent = "14 August";
  const dl1 = createElementStub("dl");
  dl1.appendChild(dateDt);
  dl1.appendChild(dateDd);

  const timeDt = createElementStub("dt");
  timeDt.textContent = "Time:";
  const timeDd = createElementStub("dd");
  timeDd.textContent = "14:30 (UTC+0200)";
  const dl2 = createElementStub("dl");
  dl2.appendChild(timeDt);
  dl2.appendChild(timeDd);

  const speakerDt = createElementStub("dt");
  speakerDt.textContent = "Speaker(s):";
  const speakerDd = createElementStub("dd");
  const speakerAnchor = createElementStub("a");
  speakerAnchor.href = "https://ripe92.ripe.net/programme/meeting-plan/sessions/123/ABCD#speaker-1";
  speakerAnchor.textContent = "Jane Doe";
  speakerDd.appendChild(speakerAnchor);
  speakerDd.children.push({ nodeType: 3, textContent: ", ACME Corp", remove() {} });
  speakerDd.querySelectorAll = (sel) => (sel === "a[href]" ? [speakerAnchor] : []);
  const dl3 = createElementStub("dl");
  dl3.appendChild(speakerDt);
  dl3.appendChild(speakerDd);

  const slidesAnchor = createElementStub("a");
  slidesAnchor.href = "https://pretalx.ripe.net/media/ripe92/slides.pdf";
  slidesAnchor.setAttribute("title", "Download slides as PDF");
  const slidesWrapper = createElementStub("dd");
  slidesWrapper.appendChild(slidesAnchor);

  // An extra slides-titled anchor with an extension unknown to SLIDES_FORMAT
  // (exercises the panel button's generic-icon/octet-stream fallback), and
  // one with an unparseable href (exercises the panel button's catch path).
  // Neither is filtered by SLIDES_EXT_RE, since both come from the
  // title-matching strategy which doesn't check extensions.
  const zipSlidesAnchor = createElementStub("a");
  zipSlidesAnchor.href = "https://pretalx.ripe.net/media/ripe92/handout.zip";
  zipSlidesAnchor.setAttribute("title", "Download slides as ZIP");
  const brokenSlidesAnchor = createElementStub("a");
  brokenSlidesAnchor.href = "not a url";
  brokenSlidesAnchor.setAttribute("title", "Download slides as ???");

  const recordingHeading = createElementStub("h2");
  recordingHeading.textContent = "Recording";
  const recordingSection = createElementStub("section");
  const mp4Anchor = createElementStub("a");
  mp4Anchor.href = "https://ripe92.ripe.net/recordings/session.mp4";
  recordingSection.appendChild(recordingHeading);
  recordingSection.querySelector = (sel) => (sel === 'a[href$=".mp4"]' ? mp4Anchor : null);

  const mainEl = createElementStub("main");
  mainEl.querySelectorAll = (sel) => {
    if (sel === "dt") return [dateDt, timeDt, speakerDt];
    if (sel === 'a[title*="Download slides"], a[title*="download slides"]')
      return [zipSlidesAnchor, brokenSlidesAnchor, slidesAnchor];
    if (sel === "h2, h3, h4") return [recordingHeading];
    return [];
  };

  documentStub.querySelector = (sel) => {
    if (sel === "h1") return h1;
    if (sel === 'main, [id="content"], article') return mainEl;
    return null;
  };
  documentStub.querySelectorAll = (sel) => (sel === "a[href]" ? [trackAnchor] : []);
  documentStub.getElementById = (id) =>
    documentStub.body.children.find((c) => c.id === id) || null;

  return { documentStub, slidesAnchor, zipSlidesAnchor, brokenSlidesAnchor };
}

test("initScript: appends '_et_al' for multiple speakers, and skips a slides anchor with no extension in the panel", () => {
  const documentStub = createDocumentStub();
  documentStub.body = createElementStub("body");

  const h1 = createElementStub("h1");
  h1.textContent = "My Great Talk";

  const speakerDt = createElementStub("dt");
  speakerDt.textContent = "Speaker(s):";
  const speakerDd = createElementStub("dd");
  const speakerAnchor1 = createElementStub("a");
  speakerAnchor1.href = "https://ripe92.ripe.net/programme/meeting-plan/sessions/123/ABCD#speaker-1";
  speakerAnchor1.textContent = "Jane Doe";
  const speakerAnchor2 = createElementStub("a");
  speakerAnchor2.href = "https://ripe92.ripe.net/programme/meeting-plan/sessions/123/ABCD#speaker-2";
  speakerAnchor2.textContent = "John Smith";
  speakerDd.appendChild(speakerAnchor1);
  speakerDd.appendChild(speakerAnchor2);
  speakerDd.querySelectorAll = (sel) =>
    sel === "a[href]" ? [speakerAnchor1, speakerAnchor2] : [];
  const speakerDl = createElementStub("dl");
  speakerDl.appendChild(speakerDt);
  speakerDl.appendChild(speakerDd);

  const noExtSlidesAnchor = createElementStub("a");
  noExtSlidesAnchor.href = "https://pretalx.ripe.net/media/ripe92/slides";
  noExtSlidesAnchor.setAttribute("title", "Download slides");

  const pdfSlidesAnchor = createElementStub("a");
  pdfSlidesAnchor.href = "https://pretalx.ripe.net/media/ripe92/slides.pdf";
  pdfSlidesAnchor.setAttribute("title", "Download slides as PDF");

  const mainEl = createElementStub("main");
  mainEl.querySelectorAll = (sel) => {
    if (sel === "dt") return [speakerDt];
    if (sel === 'a[title*="Download slides"], a[title*="download slides"]')
      return [noExtSlidesAnchor, pdfSlidesAnchor];
    return [];
  };

  documentStub.querySelector = (sel) => {
    if (sel === "h1") return h1;
    if (sel === 'main, [id="content"], article') return mainEl;
    return null;
  };
  documentStub.querySelectorAll = (sel) => (sel === "a[href]" ? [] : []);
  documentStub.getElementById = (id) =>
    documentStub.body.children.find((c) => c.id === id) || null;

  const { initScript } = load({
    document: documentStub,
    pathname: "/programme/meeting-plan/sessions/123/ABCD",
  });

  assert.equal(initScript(), true);
  assert.equal(noExtSlidesAnchor.dataset.ripeEnhanced, undefined, "the no-extension anchor is left alone");
  assert.match(pdfSlidesAnchor.title, /Jane_Doe_et_al/, "the stem includes the '_et_al' suffix");

  const panel = documentStub.body.children.find((c) => c.id === "ripe-session-copy-panel");
  // liveRegion + dismiss button + one button for the PDF anchor — the
  // no-extension slides anchor is skipped by addSlidesPanelButton, and
  // there's no recording section.
  assert.equal(panel.children.length, 3, "the no-extension slides anchor got no panel button");
});

test("top-level retry observer: gives up after MAX_INIT_RETRIES and logs via dbgWarn when DEBUG is true", () => {
  const gmStubs = createGMStubs();
  gmStubs.GM_setValue("debug_logging", true);
  const mutationObserverStub = createMutationObserverStub();

  const originalWarn = console.warn;
  let warnCalls = 0;
  console.warn = () => { warnCalls += 1; };

  try {
    // No <h1> at all, so initScript() fails on every retry — the observer
    // never disconnects except by hitting the retry cap.
    load({ gm: gmStubs, mutationObserver: mutationObserverStub });

    assert.equal(mutationObserverStub.instances.length, 1);
    const observer = mutationObserverStub.instances[0];

    for (let i = 0; i < 10; i += 1) observer.callback();

    assert.equal(observer.disconnected, true, "the observer disconnects once the retry cap is hit");
    assert.ok(warnCalls >= 1, "dbgWarn logged the give-up message");
  } finally {
    console.warn = originalWarn;
  }
});

test("initScript: returns false when no <h1> is present", () => {
  const documentStub = createDocumentStub();
  const { initScript } = load({
    document: documentStub,
    pathname: "/programme/meeting-plan/sessions/123/ABCD",
  });
  assert.equal(initScript(), false);
});

test("initScript: returns false when the pathname isn't a session-detail URL", () => {
  const documentStub = createDocumentStub();
  documentStub.querySelector = (sel) => (sel === "h1" ? createElementStub("h1") : null);
  const { initScript } = load({
    document: documentStub,
    pathname: "/programme/meeting-plan/sessions/123",
  });
  assert.equal(initScript(), false);
});

test("initScript: builds the full panel and enhances the slides/recording links on a valid session page", () => {
  const { documentStub, slidesAnchor, zipSlidesAnchor, brokenSlidesAnchor } = makeFullRipePage();
  const gmStubs = createGMStubs();
  const { initScript } = load({
    document: documentStub,
    gm: gmStubs,
    pathname: "/programme/meeting-plan/sessions/123/ABCD",
  });

  assert.equal(initScript(), true);
  assert.equal(slidesAnchor.dataset.ripeEnhanced, "1", "the slides anchor was enhanced in place");
  assert.equal(zipSlidesAnchor.dataset.ripeEnhanced, "1", "an unrecognized extension is still enhanced");
  assert.equal(
    brokenSlidesAnchor.dataset.ripeEnhanced,
    undefined,
    "an unparseable href is left alone by applyRenamedDownload",
  );

  const panel = documentStub.body.children.find((c) => c.id === "ripe-session-copy-panel");
  assert.ok(panel, "panel is appended to document.body");
  // liveRegion, dismiss button, zip slides button, pdf slides button
  // (brokenSlidesAnchor's URL fails to parse and is skipped), mp4 button.
  assert.equal(panel.children.length, 5);

  const mp4Link = slidesAnchor.nextSibling;
  assert.equal(mp4Link.id, "ripe-mp4-download");

  const [, dismissButton, zipButton, slidesButton, mp4Button] = panel.children;
  assert.equal(
    zipButton.children[0].className,
    "fa-regular fa-file",
    "an unrecognized extension gets the generic file icon",
  );

  dismissButton.click();
  assert.equal(panel.style.display, "none");

  slidesButton.click();
  assert.equal(gmStubs.xhrCalls.length, 1, "the panel's slides button triggers a cross-origin download");

  const bodyChildrenBeforeMp4Click = documentStub.body.children.length;
  mp4Button.click();
  assert.equal(
    documentStub.body.children.length,
    bodyChildrenBeforeMp4Click,
    "the temporary mp4 download anchor is appended then removed",
  );
});

test("initScript: the panel's slides button reports failure for an anchor with an untrustworthy href", () => {
  const { documentStub, slidesAnchor } = makeFullRipePage();
  const { initScript } = load({
    document: documentStub,
    pathname: "/programme/meeting-plan/sessions/123/ABCD",
  });

  assert.equal(initScript(), true);
  slidesAnchor.href = "https://evil.invalid/slides.pdf";

  const panel = documentStub.body.children.find((c) => c.id === "ripe-session-copy-panel");
  const [, , , slidesButton] = panel.children;
  slidesButton.click();
  assert.equal(slidesButton.children[1].textContent, " ❌ Invalid URL");
});

test("initScript: a second call doesn't rebuild an already-present panel", () => {
  const { documentStub } = makeFullRipePage();
  const { initScript } = load({
    document: documentStub,
    pathname: "/programme/meeting-plan/sessions/123/ABCD",
  });

  assert.equal(initScript(), true);
  assert.equal(initScript(), true);
  assert.equal(
    documentStub.body.children.filter((c) => c.id === "ripe-session-copy-panel").length,
    1,
  );
});

test("retry observer: retries initScript on mutation until the page is ready, then disconnects", () => {
  const documentStub = createDocumentStub();
  const moStub = createMutationObserverStub();
  load({
    document: documentStub,
    pathname: "/programme/meeting-plan/sessions/123/ABCD",
    mutationObserver: moStub,
  });

  assert.equal(moStub.instances.length, 1, "a retry observer is created since initScript fails at load (no h1)");
  const [observer] = moStub.instances;
  assert.equal(observer.disconnected, false);

  observer.callback();
  assert.equal(observer.disconnected, false, "still no h1: retries continue");

  documentStub.querySelector = (sel) => (sel === "h1" ? createElementStub("h1") : null);
  observer.callback();
  assert.equal(observer.disconnected, true, "disconnects once initScript succeeds");
});
