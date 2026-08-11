"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  loadUserScript,
  createDocumentStub,
  createElementStub,
  createGMStubs,
  createMutationObserverStub,
} = require("./support/dom-stubs");

const SCRIPT_PATH = path.join(__dirname, "..", "viessmann-modell-tab-title.user.js");
const FIXTURE_PATH = path.join(__dirname, "fixtures", "5225.html");

/**
 * Read the real, saved product-page fixture
 * (https://viessmann-modell.com/en/electronic/electronics-digital/1115a-power-module/5225)
 * and extract the exact strings the script's selectors target, so the test
 * data tracks the live site's actual markup rather than hand-typed guesses.
 * The page renders the breadcrumb trail twice (see BREADCRUMB_NAV_SELECTOR's
 * comment in the script) - `breadcrumbTitles` is the raw, page-wide list of
 * all 6 spans; `firstNavBreadcrumbTitles` is just the first nav's 3, which
 * is what a single `nav.querySelectorAll(...)` call actually returns.
 * @returns {{ titleText: string, breadcrumbTitles: string[], firstNavBreadcrumbTitles: string[] }} Returns the extracted fixture data.
 */
function readFixtureData() {
  const html = fs.readFileSync(FIXTURE_PATH, "utf8");

  const titleMatch = html.match(/<h1>([^<]+)<\/h1>/);
  assert.ok(titleMatch, "fixture must contain a <h1> product title");

  const breadcrumbTitles = [...html.matchAll(/<span\s+class="breadcrumb-title"[^>]*>([^<]+)</g)].map((m) =>
    m[1].trim(),
  );
  assert.ok(breadcrumbTitles.length > 0, "fixture must contain breadcrumb-title spans");

  return { titleText: titleMatch[1], breadcrumbTitles, firstNavBreadcrumbTitles: breadcrumbTitles.slice(0, 3) };
}

const fixture = readFixtureData();

test("fixture sanity: real page title is '5225 5A Power module'", () => {
  assert.equal(fixture.titleText, "5225 5A Power module");
});

test("fixture sanity: real page renders the breadcrumb trail twice (theme header + CMS content block)", () => {
  assert.deepEqual(fixture.breadcrumbTitles, [
    "Product range",
    "Electronic",
    "Electronics Digital",
    "Product range",
    "Electronic",
    "Electronics Digital",
  ]);
});

test("extractItemNo: reads the leading token of the real h1 text", () => {
  const documentStub = createDocumentStub();
  documentStub.querySelector = (selector) => {
    if (selector === ".cms-element-product-name h1") return { innerText: fixture.titleText };
    return null;
  };
  const { extractItemNo } = loadUserScript(SCRIPT_PATH, { document: documentStub });
  assert.equal(extractItemNo(), "5225");
});

test("extractItemNo: returns null when the title element is absent", () => {
  const { extractItemNo } = loadUserScript(SCRIPT_PATH);
  assert.equal(extractItemNo(), null);
});

test("extractItemName: strips the article number out of the real title text", () => {
  const { extractItemName } = loadUserScript(SCRIPT_PATH);
  const titleEl = { innerText: fixture.titleText };
  assert.equal(extractItemName(titleEl, "5225"), "5A Power module");
});

test("buildBreadcrumbRange: joins the real breadcrumb trail and appends the article number", () => {
  const documentStub = createDocumentStub();
  documentStub.querySelector = (selector) => {
    if (selector === 'nav[aria-label="breadcrumb"]') {
      return {
        querySelectorAll(innerSelector) {
          if (innerSelector === ".breadcrumb-title") return fixture.firstNavBreadcrumbTitles.map((text) => ({ innerText: text }));
          return [];
        },
      };
    }
    return null;
  };
  const { buildBreadcrumbRange } = loadUserScript(SCRIPT_PATH, { document: documentStub });
  assert.equal(buildBreadcrumbRange("5225"), "Product range > Electronic > Electronics Digital > #5225");
});

test("buildBreadcrumbRange: only the first breadcrumb nav is queried, not both", () => {
  // Regression check: the real fixture contains two `.breadcrumb-title`
  // groups on the page (see "fixture sanity" test above), but only the
  // first `nav[aria-label="breadcrumb"]` should ever be queried.
  const documentStub = createDocumentStub();
  let queryCount = 0;
  documentStub.querySelector = (selector) => {
    if (selector === 'nav[aria-label="breadcrumb"]') {
      queryCount += 1;
      return { querySelectorAll: () => fixture.firstNavBreadcrumbTitles.map((text) => ({ innerText: text })) };
    }
    return null;
  };
  const { buildBreadcrumbRange } = loadUserScript(SCRIPT_PATH, { document: documentStub });
  const result = buildBreadcrumbRange("5225");
  assert.equal(queryCount, 1);
  assert.equal(result, "Product range > Electronic > Electronics Digital > #5225");
});

test("buildBreadcrumbRange: appends just the article number when no breadcrumb nav is found", () => {
  const { buildBreadcrumbRange } = loadUserScript(SCRIPT_PATH);
  assert.equal(buildBreadcrumbRange("5225"), "#5225");
});

test("setPageTitle: returns false when the product title element is absent", () => {
  const { setPageTitle } = loadUserScript(SCRIPT_PATH);
  assert.equal(setPageTitle(), false);
});

test("setPageTitle: returns false when the title text has no extractable article number", () => {
  const documentStub = createDocumentStub();
  documentStub.querySelector = (sel) =>
    sel === ".cms-element-product-name h1" ? { innerText: "" } : null;
  const { setPageTitle } = loadUserScript(SCRIPT_PATH, { document: documentStub });
  assert.equal(setPageTitle(), false);
});

test("setPageTitle: sets document.title from the real fixture and starts the title guard observer", () => {
  const documentStub = createDocumentStub();
  const titleEl = { innerText: fixture.titleText };
  const headTitleEl = createElementStub("title");
  documentStub.querySelector = (sel) => {
    if (sel === ".cms-element-product-name h1") return titleEl;
    if (sel === "title") return headTitleEl;
    return null;
  };
  const moStub = createMutationObserverStub();
  const { setPageTitle } = loadUserScript(SCRIPT_PATH, {
    document: documentStub,
    mutationObserver: moStub,
  });

  assert.equal(setPageTitle(), true);
  assert.equal(documentStub.title, "Viessmann 5225 | 5A Power module | #5225 | viessmann-modell.com");
  assert.equal(moStub.instances.length, 1, "the title guard observer was started");

  // The site resets the title; the observer's callback re-applies it.
  documentStub.title = "Something else";
  moStub.instances[0].callback();
  assert.equal(documentStub.title, "Viessmann 5225 | 5A Power module | #5225 | viessmann-modell.com");
});

test("startTitleGuard: is a no-op when the <title> element can't be found", () => {
  // No product title at load either, so the top-level init already starts
  // its own retry observer - `instances.length` starts at 1, not 0.
  const documentStub = createDocumentStub();
  documentStub.querySelector = () => null;
  const moStub = createMutationObserverStub();
  const { startTitleGuard } = loadUserScript(SCRIPT_PATH, {
    document: documentStub,
    mutationObserver: moStub,
  });
  assert.equal(moStub.instances.length, 1, "load-time retry observer");
  startTitleGuard();
  assert.equal(moStub.instances.length, 1, "no title guard observer was added");
});

test("startTitleGuard: only starts once even if called again", () => {
  const documentStub = createDocumentStub();
  documentStub.querySelector = (sel) => (sel === "title" ? createElementStub("title") : null);
  const moStub = createMutationObserverStub();
  const { startTitleGuard } = loadUserScript(SCRIPT_PATH, {
    document: documentStub,
    mutationObserver: moStub,
  });
  assert.equal(moStub.instances.length, 1, "load-time retry observer");
  startTitleGuard();
  assert.equal(moStub.instances.length, 2, "the title guard observer was added");
  startTitleGuard();
  assert.equal(moStub.instances.length, 2, "a second call doesn't add another");
});

test("debug toggle: GM_registerMenuCommand toggles DEBUG and re-registers with an updated label", () => {
  const gmStubs = createGMStubs();
  loadUserScript(SCRIPT_PATH, { gm: gmStubs });

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
  loadUserScript(SCRIPT_PATH, { gm: gmStubs });

  const [, command] = [...gmStubs.commands.entries()][0];
  assert.match(command.label, /Debug logging: ON/);
});

test("debug logging: dbgInfo/dbgWarn actually log to console when DEBUG is true", () => {
  const gmStubs = createGMStubs();
  gmStubs.GM_setValue("debug_logging", true);

  const originalInfo = console.info;
  const originalWarn = console.warn;
  const calls = { info: 0, warn: 0 };
  console.info = () => { calls.info += 1; };
  console.warn = () => { calls.warn += 1; };

  try {
    const documentStub = createDocumentStub();
    const titleEl = { innerText: fixture.titleText };
    const headTitleEl = createElementStub("title");
    documentStub.querySelector = (sel) => {
      if (sel === ".cms-element-product-name h1") return titleEl;
      if (sel === "title") return headTitleEl;
      return null;
    };
    const moStub = createMutationObserverStub();
    const { setPageTitle } = loadUserScript(SCRIPT_PATH, {
      document: documentStub,
      mutationObserver: moStub,
      gm: gmStubs,
    });

    assert.equal(setPageTitle(), true);
    assert.ok(calls.info >= 1, "dbgInfo logged when the tab title was set");

    documentStub.title = "Something else";
    moStub.instances[0].callback();
    assert.ok(calls.warn >= 1, "dbgWarn logged when the page reset the tab title");
  } finally {
    console.info = originalInfo;
    console.warn = originalWarn;
  }
});

test("top-level retry observer: retries setPageTitle on mutation, gives up after MAX_INIT_RETRIES", () => {
  const documentStub = createDocumentStub();
  const moStub = createMutationObserverStub();
  loadUserScript(SCRIPT_PATH, { document: documentStub, mutationObserver: moStub });

  assert.equal(moStub.instances.length, 1, "no product title at load time, so a retry observer starts");
  const [observer] = moStub.instances;
  assert.equal(observer.disconnected, false);

  for (let i = 0; i < 9; i++) observer.callback();
  assert.equal(observer.disconnected, false, "still retrying: product title never appears in this test");

  observer.callback();
  assert.equal(observer.disconnected, true, "disconnects once MAX_INIT_RETRIES is reached");
});

test("top-level retry observer: disconnects once setPageTitle succeeds mid-retry", () => {
  const documentStub = createDocumentStub();
  const titleEl = { innerText: fixture.titleText };
  const moStub = createMutationObserverStub();
  loadUserScript(SCRIPT_PATH, { document: documentStub, mutationObserver: moStub });

  const [observer] = moStub.instances;
  documentStub.querySelector = (sel) => (sel === ".cms-element-product-name h1" ? titleEl : null);
  observer.callback();
  assert.equal(observer.disconnected, true);
});
