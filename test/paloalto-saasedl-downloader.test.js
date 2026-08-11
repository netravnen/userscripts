"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  loadUserScript,
  createDocumentStub,
  createGMStubs,
  createTimerStubs,
  createMutationObserverStub,
} = require("./support/dom-stubs.js");

const SCRIPT_PATH = path.join(__dirname, "..", "paloalto-saasedl-downloader.user.js");
const FEED_SELECTOR = 'a[href^="https://saasedl.paloaltonetworks.com/feeds/"]';
const PANEL_ID = "paloalto-edl-download-panel";

/**
 * Build a document stub whose `getElementById` reflects whatever has
 * actually been appended to `document.body` (by id), so `buildPanel`'s
 * `if (document.getElementById(PANEL_ID)) return;` idempotency guard
 * behaves the same way it would against a real DOM.
 * @param {object[]} [feedAnchors] - Specifies the feed anchors `FEED_SELECTOR` should return.
 * @returns {object} Returns a document stub.
 */
function makePanelDocumentStub(feedAnchors = []) {
  const documentStub = createDocumentStub();
  documentStub.querySelectorAll = (selector) => (selector === FEED_SELECTOR ? feedAnchors : []);
  documentStub.getElementById = (id) =>
    documentStub.body.children.find((child) => child.id === id) || null;
  return documentStub;
}

/**
 * Build a `<td>` cell stub exposing only the query methods
 * `extractEDLTableData` calls on it.
 * @param {{textContent?: string, anchorHref?: string, paragraphs?: string[]}} opts - Specifies the cell's content.
 * @returns {object} Returns a cell stub.
 */
function makeCell({ textContent = "", anchorHref, paragraphs }) {
  return {
    textContent,
    querySelector(selector) {
      if (selector === "a" && anchorHref !== undefined) {
        return { href: anchorHref, textContent: anchorHref };
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "p" && paragraphs) {
        return paragraphs.map((text) => ({ textContent: text }));
      }
      return [];
    },
  };
}

/**
 * Build a feed anchor + parent `<tr>` row stub pair representing one EDL
 * table row, matching the seven-cell layout `extractEDLTableData` expects.
 * @param {{name: string, description: string, addressFamily: string, sourceHref: string, optimizedHref: string, lastChanged: string, lastChecked: string}} row - Specifies the row's field values.
 * @returns {object} Returns a feed anchor stub with a `.closest("tr")` link to its row.
 */
function makeFeedRow(row) {
  const cells = [
    makeCell({ textContent: row.name }),
    makeCell({ anchorHref: row.sourceHref, paragraphs: ["", row.description] }),
    makeCell({ textContent: row.addressFamily }),
    makeCell({ anchorHref: row.sourceHref }),
    makeCell({ anchorHref: row.optimizedHref }),
    makeCell({ textContent: row.lastChanged }),
    makeCell({ textContent: row.lastChecked }),
  ];

  const rowStub = {
    querySelectorAll(selector) {
      return selector === "td" ? cells : [];
    },
  };

  return {
    closest(selector) {
      return selector === "tr" ? rowStub : null;
    },
  };
}

/**
 * Build a `document` stub whose `FEED_SELECTOR` query returns the given
 * feed anchor stubs.
 * @param {object[]} anchors - Specifies the feed anchor stubs.
 * @returns {object} Returns a document stub.
 */
function makeDocumentStub(anchors) {
  const documentStub = createDocumentStub();
  documentStub.querySelectorAll = function (selector) {
    return selector === FEED_SELECTOR ? anchors : [];
  };
  return documentStub;
}

test("isoStamp: returns today's date in YYYY-MM-DD form", () => {
  const { isoStamp } = loadUserScript(SCRIPT_PATH);
  assert.match(isoStamp(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(isoStamp(), new Date().toISOString().slice(0, 10));
});

test("convertToCSV: quotes every field and escapes embedded double quotes", () => {
  const { convertToCSV } = loadUserScript(SCRIPT_PATH);
  const csv = convertToCSV([
    {
      name: 'Slack "prod"',
      description: "Slack service",
      address_family: "IPv4",
      source_list: "https://example.invalid/source",
      optimized_list: "https://example.invalid/optimized",
      last_changed: "2024-01-01",
      last_checked: "2024-01-02",
    },
  ]);
  const lines = csv.split("\n");
  assert.equal(
    lines[0],
    '"name","description","address_family","source_list","optimized_list","last_changed","last_checked"',
  );
  assert.equal(
    lines[1],
    '"Slack ""prod""","Slack service","IPv4","https://example.invalid/source","https://example.invalid/optimized","2024-01-01","2024-01-02"',
  );
});

test("convertToCSV: a missing field falls back to an empty string", () => {
  const { convertToCSV } = loadUserScript(SCRIPT_PATH);
  const csv = convertToCSV([{ name: "Only a name" }]);
  const lines = csv.split("\n");
  assert.equal(lines[1], '"Only a name","","","","","",""');
});

test("convertToURLList: uses the optimized list when useOptimized is true (default)", () => {
  const { convertToURLList } = loadUserScript(SCRIPT_PATH);
  const list = convertToURLList([
    { source_list: "https://a.invalid/source", optimized_list: "https://a.invalid/optimized" },
    { source_list: "https://b.invalid/source", optimized_list: "" },
  ]);
  // Empty optimized URLs are filtered out; only the non-empty one survives.
  assert.equal(list, "https://a.invalid/optimized");
});

test("extractEDLTableData: parses a real-shaped 7-cell table row", () => {
  const anchor = makeFeedRow({
    name: "Slack",
    description: "Slack messaging service",
    addressFamily: "IPv4",
    sourceHref: "https://saasedl.paloaltonetworks.com/feeds/slack/source",
    optimizedHref: "https://saasedl.paloaltonetworks.com/feeds/slack/optimized",
    lastChanged: "2024-01-01",
    lastChecked: "2024-01-02",
  });
  const { extractEDLTableData } = loadUserScript(SCRIPT_PATH, {
    document: makeDocumentStub([anchor]),
  });

  // Spread into a host-realm array first, then spread each row into a plain
  // host-realm object: the script runs inside a vm sandbox, so both the
  // array and the row objects it constructs carry that realm's prototypes,
  // and assert's strict deepEqual treats differing prototypes as unequal
  // even when every property matches. `.map()` on the still-vm-realm array
  // would itself produce another vm-realm array (ArraySpeciesCreate), so
  // the outer `[...]` spread has to come first.
  assert.deepEqual([...extractEDLTableData()].map((row) => ({ ...row })), [
    {
      name: "Slack",
      description: "Slack messaging service",
      address_family: "IPv4",
      source_list: "https://saasedl.paloaltonetworks.com/feeds/slack/source",
      optimized_list: "https://saasedl.paloaltonetworks.com/feeds/slack/optimized",
      last_changed: "2024-01-01",
      last_checked: "2024-01-02",
    },
  ]);
});

test("extractEDLTableData: skips a feed anchor with no parent <tr>", () => {
  const anchor = { closest: () => null };
  const { extractEDLTableData } = loadUserScript(SCRIPT_PATH, {
    document: makeDocumentStub([anchor]),
  });

  assert.deepEqual([...extractEDLTableData()], []);
});

test("extractEDLTableData: skips a row with fewer than 7 <td> cells", () => {
  const shortRow = { querySelectorAll: (sel) => (sel === "td" ? [makeCell({ textContent: "x" })] : []) };
  const anchor = { closest: () => shortRow };
  const { extractEDLTableData } = loadUserScript(SCRIPT_PATH, {
    document: makeDocumentStub([anchor]),
  });

  assert.deepEqual([...extractEDLTableData()], []);
});

test("extractEDLTableData: uses the single paragraph's text as description when there's no anchor", () => {
  const cells = [
    makeCell({ textContent: "Name" }),
    makeCell({ paragraphs: ["Just a description"] }),
    makeCell({ textContent: "IPv4" }),
    makeCell({ anchorHref: "https://saasedl.paloaltonetworks.com/feeds/x/source" }),
    makeCell({ anchorHref: "https://saasedl.paloaltonetworks.com/feeds/x/optimized" }),
    makeCell({ textContent: "2024-01-01" }),
    makeCell({ textContent: "2024-01-02" }),
  ];
  const rowStub = { querySelectorAll: (sel) => (sel === "td" ? cells : []) };
  const anchor = { closest: (sel) => (sel === "tr" ? rowStub : null) };
  const { extractEDLTableData } = loadUserScript(SCRIPT_PATH, {
    document: makeDocumentStub([anchor]),
  });

  const [row] = [...extractEDLTableData()].map((r) => ({ ...r }));
  assert.equal(row.description, "Just a description");
});

test("extractEDLTableData: falls back to the cell's own text (minus the anchor label) when there are no <p> tags", () => {
  const descriptionCell = makeCell({ textContent: "Cloud App FeedSome inline description" });
  descriptionCell.querySelector = (sel) =>
    sel === "a" ? { href: "https://saasedl.paloaltonetworks.com/feeds/x/source", textContent: "Cloud App Feed" } : null;
  const cells = [
    makeCell({ textContent: "Name" }),
    descriptionCell,
    makeCell({ textContent: "IPv4" }),
    makeCell({ anchorHref: "https://saasedl.paloaltonetworks.com/feeds/x/source" }),
    makeCell({ anchorHref: "https://saasedl.paloaltonetworks.com/feeds/x/optimized" }),
    makeCell({ textContent: "2024-01-01" }),
    makeCell({ textContent: "2024-01-02" }),
  ];
  const rowStub = { querySelectorAll: (sel) => (sel === "td" ? cells : []) };
  const anchor = { closest: (sel) => (sel === "tr" ? rowStub : null) };
  const { extractEDLTableData } = loadUserScript(SCRIPT_PATH, {
    document: makeDocumentStub([anchor]),
  });

  const [row] = [...extractEDLTableData()].map((r) => ({ ...r }));
  assert.equal(row.description, "Some inline description");
});

test("extractEDLTableData: no anchor at all and no <p> tags -> description falls back to the cell's raw text", () => {
  const cells = [
    makeCell({ textContent: "Name" }),
    makeCell({ textContent: "Just plain text, no markup" }),
    makeCell({ textContent: "IPv4" }),
    makeCell({ textContent: "no source anchor" }),
    makeCell({ textContent: "no optimized anchor" }),
    makeCell({ textContent: "2024-01-01" }),
    makeCell({ textContent: "2024-01-02" }),
  ];
  const rowStub = { querySelectorAll: (sel) => (sel === "td" ? cells : []) };
  const anchor = { closest: (sel) => (sel === "tr" ? rowStub : null) };
  const { extractEDLTableData } = loadUserScript(SCRIPT_PATH, {
    document: makeDocumentStub([anchor]),
  });

  const [row] = [...extractEDLTableData()].map((r) => ({ ...r }));
  assert.equal(row.description, "Just plain text, no markup");
  assert.equal(row.source_list, "", "no <a> in cells[3] -> empty source_list");
  assert.equal(row.optimized_list, "", "no <a> in cells[4] -> empty optimized_list");
});

test("retry observer: retries initScript on mutation until feed anchors appear, then disconnects", () => {
  const anchors = [];
  const documentStub = makePanelDocumentStub(anchors);
  const moStub = createMutationObserverStub();
  loadUserScript(SCRIPT_PATH, { document: documentStub, mutationObserver: moStub });

  assert.equal(moStub.instances.length, 1, "a retry observer is created since no feeds exist at load");
  const [observer] = moStub.instances;
  assert.equal(observer.disconnected, false);

  observer.callback();
  assert.equal(observer.disconnected, false, "still no feed anchors: retries continue");

  anchors.push({});
  observer.callback();
  assert.equal(observer.disconnected, true, "disconnects once initScript succeeds");
  assert.ok(documentStub.body.children.some((child) => child.id === PANEL_ID));
});

test("retry observer: gives up after MAX_INIT_RETRIES", () => {
  const documentStub = makePanelDocumentStub([]);
  const moStub = createMutationObserverStub();
  loadUserScript(SCRIPT_PATH, { document: documentStub, mutationObserver: moStub });

  const [observer] = moStub.instances;
  for (let i = 0; i < 9; i++) observer.callback();
  assert.equal(observer.disconnected, false);

  observer.callback();
  assert.equal(observer.disconnected, true, "gives up after 10 retries");
});

test("faIcon: builds a regular-style FontAwesome icon element", () => {
  const { faIcon } = loadUserScript(SCRIPT_PATH, { document: makePanelDocumentStub() });
  const icon = faIcon("file-code");
  assert.equal(icon.className, "fa-regular fa-file-code");
  assert.equal(icon.getAttribute("aria-hidden"), "true");
});

test("debug toggle: GM_registerMenuCommand toggles DEBUG and re-registers with an updated label", () => {
  const gmStubs = createGMStubs();
  loadUserScript(SCRIPT_PATH, { gm: gmStubs, document: makePanelDocumentStub() });

  assert.equal(gmStubs.commands.size, 1);
  const [, command] = [...gmStubs.commands.entries()][0];
  assert.match(command.label, /Debug logging: OFF/);

  command.callback();

  assert.equal(gmStubs.GM_getValue("debug_logging", false), true);
  assert.equal(gmStubs.commands.size, 1, "the stale command is unregistered, not left dangling");
  const [, updated] = [...gmStubs.commands.entries()][0];
  assert.match(updated.label, /Debug logging: ON/);

  // Toggle back off, to exercise the re-registration ternary's other arm.
  updated.callback();
  assert.equal(gmStubs.GM_getValue("debug_logging", false), false);
  const [, offAgain] = [...gmStubs.commands.entries()][0];
  assert.match(offAgain.label, /Debug logging: OFF/);
});

test("debug toggle: the initial menu label reflects a pre-existing 'ON' debug_logging value", () => {
  const gmStubs = createGMStubs();
  gmStubs.GM_setValue("debug_logging", true);
  loadUserScript(SCRIPT_PATH, { gm: gmStubs, document: makePanelDocumentStub() });

  const [, command] = [...gmStubs.commands.entries()][0];
  assert.match(command.label, /Debug logging: ON/);
});

test("debug logging: dbg/dbgInfo actually log to console when DEBUG is true", () => {
  const gmStubs = createGMStubs();
  gmStubs.GM_setValue("debug_logging", true);
  const feedRow = makeFeedRow({
    name: "Cloud App Feed",
    description: "Some inline description",
    addressFamily: "IPv4",
    sourceHref: "https://saasedl.paloaltonetworks.com/feeds/x/source",
    optimizedHref: "https://saasedl.paloaltonetworks.com/feeds/x/optimized",
    lastChanged: "2024-01-01",
    lastChecked: "2024-01-02",
  });
  const documentStub = makePanelDocumentStub([feedRow]);
  const moStub = createMutationObserverStub();

  const originalDebug = console.debug;
  const originalInfo = console.info;
  const calls = { debug: 0, info: 0 };
  console.debug = () => { calls.debug += 1; };
  console.info = () => { calls.info += 1; };

  try {
    const { extractEDLTableData, initScript } = loadUserScript(SCRIPT_PATH, {
      document: documentStub,
      gm: gmStubs,
      mutationObserver: moStub,
    });

    extractEDLTableData(); // dbg (line 178)
    initScript(); // dbgInfo (line 551, "panel built")

    assert.ok(calls.debug >= 1, "dbg logged");
    assert.ok(calls.info >= 1, "dbgInfo logged");
  } finally {
    console.debug = originalDebug;
    console.info = originalInfo;
  }
});

test("debug logging: dbgWarn actually logs to console when DEBUG is true and the retry observer gives up", () => {
  const gmStubs = createGMStubs();
  gmStubs.GM_setValue("debug_logging", true);
  const moStub = createMutationObserverStub();

  const originalWarn = console.warn;
  let warnCalls = 0;
  console.warn = () => { warnCalls += 1; };

  try {
    loadUserScript(SCRIPT_PATH, {
      document: makePanelDocumentStub([]),
      gm: gmStubs,
      mutationObserver: moStub,
    });

    const [observer] = moStub.instances;
    for (let i = 0; i < 10; i++) observer.callback();

    assert.ok(warnCalls >= 1, "dbgWarn logged");
  } finally {
    console.warn = originalWarn;
  }
});

test("makeDownloadButton: click handler downloads data, shows success state, and resets after the timeout flushes", () => {
  const timerStubs = createTimerStubs();
  const liveRegion = { textContent: "" };
  const { makeDownloadButton } = loadUserScript(SCRIPT_PATH, {
    document: makePanelDocumentStub(),
    timers: timerStubs,
  });

  const btn = makeDownloadButton({
    label: "Download JSON",
    icon: "file-code",
    filename: () => "paloalto-saasedl-2024-01-01.json",
    mimeType: "application/json",
    liveRegion,
    getData: () => '{"a":1}',
  });

  btn.click();

  assert.equal(btn.dataset.active, "1");
  assert.equal(btn.children[1].textContent, " ✓ Downloadet!");
  assert.match(btn.getAttribute("aria-label"), /succesfuldt/);
  assert.match(liveRegion.textContent, /paloalto-saasedl-2024-01-01\.json/);

  // A re-entrant click while active is a no-op.
  btn.click();
  assert.equal(btn.children[1].textContent, " ✓ Downloadet!");

  timerStubs.flush();

  assert.equal(btn.dataset.active, undefined);
  assert.equal(btn.children[1].textContent, " Download JSON");
  assert.equal(btn.getAttribute("aria-label"), "Download JSON");
  assert.equal(liveRegion.textContent, "");

  // A second click after the reset clears the still-set (already-fired)
  // `resetTimer` id from the first click, exercising that clearTimeout call.
  btn.click();
  assert.equal(btn.dataset.active, "1");
});

test("makeDownloadButton: click handler shows an error state when getData yields no usable data", () => {
  const liveRegion = { textContent: "" };
  const { makeDownloadButton } = loadUserScript(SCRIPT_PATH, {
    document: makePanelDocumentStub(),
  });

  const btn = makeDownloadButton({
    label: "Download CSV",
    icon: "file",
    filename: () => "empty.csv",
    mimeType: "text/csv",
    liveRegion,
    getData: () => "",
  });

  btn.click();

  assert.equal(btn.children[1].textContent, " ❌ Ingen data fundet");
  assert.match(btn.getAttribute("aria-label"), /fejlede/);
  assert.match(liveRegion.textContent, /fejlede/);
});

test("makeDownloadButton: mouseenter/mouseleave toggle the hover background while idle", () => {
  const { makeDownloadButton } = loadUserScript(SCRIPT_PATH, {
    document: makePanelDocumentStub(),
  });
  const btn = makeDownloadButton({
    label: "Download URL'er",
    icon: "file-lines",
    filename: () => "x.txt",
    mimeType: "text/plain",
    liveRegion: { textContent: "" },
    getData: () => "data",
  });

  btn.dispatch("mouseenter");
  assert.equal(btn.style.background, "#1d6fa5");
  btn.dispatch("mouseleave");
  assert.equal(btn.style.background, "#005073");
});

test("initScript: returns false when document.body isn't available yet", () => {
  const documentStub = makePanelDocumentStub([{}]);
  documentStub.body = null;
  const { initScript } = loadUserScript(SCRIPT_PATH, { document: documentStub });
  assert.equal(initScript(), false);
});

test("initScript: returns false when no feed anchors are present", () => {
  const { initScript } = loadUserScript(SCRIPT_PATH, { document: makePanelDocumentStub([]) });
  assert.equal(initScript(), false);
});

test("initScript: builds and injects the panel exactly once when feed anchors are present", () => {
  const documentStub = makePanelDocumentStub([{}]);
  const { initScript } = loadUserScript(SCRIPT_PATH, { document: documentStub });

  // The script's own load-time `if (!initScript())` call already injected
  // the panel once; this explicit call must stay idempotent against it.
  assert.equal(initScript(), true);
  assert.equal(
    documentStub.body.children.filter((child) => child.id === PANEL_ID).length,
    1,
  );
});

test("buildPanel: builds the full panel (badge/toggle/buttons), refreshes the badge on interval flush, and guards re-entry", () => {
  const feedRow = {
    name: "Cloud App Feed",
    description: "Some inline description",
    addressFamily: "IPv4",
    sourceHref: "https://saasedl.paloaltonetworks.com/feeds/x/source",
    optimizedHref: "https://saasedl.paloaltonetworks.com/feeds/x/optimized",
    lastChanged: "2024-01-01",
    lastChecked: "2024-01-02",
  };
  const anchors = [makeFeedRow(feedRow), makeFeedRow(feedRow)];
  const documentStub = makePanelDocumentStub(anchors);
  const timerStubs = createTimerStubs();
  const { buildPanel, convertToURLList } = loadUserScript(SCRIPT_PATH, {
    document: documentStub,
    timers: timerStubs,
  });

  buildPanel();
  const panel = documentStub.body.children.find((child) => child.id === PANEL_ID);
  assert.ok(panel, "panel should be appended to document.body");
  // liveRegion, headerRow, badge, toggleWrapper, and 3 download buttons.
  assert.equal(panel.children.length, 7);

  const [, headerRow, badge, toggleWrapper, jsonBtn, csvBtn, urlBtn] = panel.children;

  assert.equal(badge.textContent, "2 feeds detected");
  anchors.push(makeFeedRow(feedRow));
  timerStubs.flush();
  assert.equal(badge.textContent, "3 feeds detected");

  const [handle, dismissBtn] = headerRow.children;
  assert.match(handle.textContent, /EDL Downloader/);

  const [checkbox] = toggleWrapper.children;
  assert.equal(checkbox.checked, true);
  const rows = [{ source_list: "https://s.invalid", optimized_list: "https://o.invalid" }];
  assert.equal(convertToURLList(rows), "https://o.invalid");
  checkbox.checked = false;
  checkbox.dispatch("change");
  assert.equal(convertToURLList(rows), "https://s.invalid");

  // Exercise each download button's own `filename()`/`getData()` closures.
  for (const btn of [jsonBtn, csvBtn, urlBtn]) {
    btn.click();
    assert.equal(btn.dataset.active, "1");
  }

  dismissBtn.click();
  assert.equal(panel.style.display, "none");

  // A second call is a no-op: the getElementById(PANEL_ID) guard fires.
  buildPanel();
  assert.equal(
    documentStub.body.children.filter((child) => child.id === PANEL_ID).length,
    1,
  );
});

test("buildPanel: drag handle updates panel position via document-level mousemove/mouseup listeners", () => {
  const documentStub = makePanelDocumentStub([{}]);
  const { buildPanel } = loadUserScript(SCRIPT_PATH, { document: documentStub });

  buildPanel();
  const panel = documentStub.body.children.find((child) => child.id === PANEL_ID);
  const [, headerRow] = panel.children;
  const [handle] = headerRow.children;

  handle.dispatch("mousedown", { clientX: 120, clientY: 80 });
  assert.equal(handle.style.cursor, "grabbing");

  documentStub.dispatch("mousemove", { clientX: 150, clientY: 100 });
  assert.equal(panel.style.right, "auto");
  assert.equal(panel.style.bottom, "auto");
  // getBoundingClientRect() stubs to all-zero, so the offset captured at
  // mousedown is just clientX/clientY, and the new position is
  // mousemove's clientX/clientY minus that offset: 150-120=30, 100-80=20.
  assert.equal(panel.style.left, "30px");
  assert.equal(panel.style.top, "20px");

  documentStub.dispatch("mouseup");
  assert.equal(handle.style.cursor, "grab");

  // A mousemove with no prior mousedown is ignored (dragging is false).
  panel.style.left = "0px";
  documentStub.dispatch("mousemove", { clientX: 999, clientY: 999 });
  assert.equal(panel.style.left, "0px");

  // A stray mouseup with no prior mousedown is also ignored.
  handle.style.cursor = "grab";
  documentStub.dispatch("mouseup");
  assert.equal(handle.style.cursor, "grab");
});
