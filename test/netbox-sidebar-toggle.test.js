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

const SCRIPT_PATH = path.join(__dirname, "..", "netbox-sidebar-toggle.user.js");
const FIXTURE_PATH = path.join(__dirname, "fixtures", "netbox.html");

// Mirrors the selector constants inside netbox-sidebar-toggle.user.js.
const MARKER_SELECTOR = "html[data-netbox-version]";
const SIDEBAR_SELECTOR = "aside.navbar-vertical";
const PAGE_WRAPPER_SELECTOR = ".page-wrapper";
const TOP_HEADER_SELECTOR = "header.navbar";
const SEARCH_FORM_SELECTOR = 'header.navbar form[action="/search/"]';
const TOGGLE_BUTTON_ID = "nb-sidebar-toggle-button";

/**
 * Recursively search an element stub's `.children` tree (depth-first) for
 * the first descendant whose `.id` matches, so `getElementById` behaves the
 * same way it would against a real DOM.
 * @param {object|null} el - Specifies the element stub to search from.
 * @param {string} id - Specifies the id to look for.
 * @returns {object|null} Returns the matching descendant, or null.
 */
function findById(el, id) {
  if (!el || !Array.isArray(el.children)) return null;
  for (const child of el.children) {
    if (child.id === id) return child;
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

/**
 * Build a document stub wired up for the script's real-page selectors
 * (NetBox marker, sidebar aside, page-wrapper, top header, header search
 * form), each individually overridable per test. When `searchForm` is
 * given, it's wrapped in a fresh parent container (mirroring the real
 * `#navbar-menu` collapse div the form lives in) so `injectToggleButton`'s
 * `searchForm.parentNode.insertBefore(...)` has somewhere real to insert
 * into, and `getElementById` searches that container's subtree.
 * @param {{hasMarker?: boolean, aside?: object, pageWrapper?: object, topHeader?: object, searchForm?: object}} [opts] - Specifies which pieces of the page exist.
 * @returns {object} Returns a document stub.
 */
function makeNetBoxDocumentStub(opts = {}) {
  const { hasMarker = true, aside, pageWrapper, topHeader, searchForm } = opts;
  const documentStub = createDocumentStub();
  let searchFormContainer = null;
  if (searchForm) {
    searchFormContainer = createElementStub("div");
    searchFormContainer.appendChild(searchForm);
  }
  documentStub.querySelector = (selector) => {
    if (selector === MARKER_SELECTOR) return hasMarker ? { tagName: "HTML" } : null;
    if (selector === SIDEBAR_SELECTOR) return aside || null;
    if (selector === PAGE_WRAPPER_SELECTOR) return pageWrapper || null;
    if (selector === TOP_HEADER_SELECTOR) return topHeader || null;
    if (selector === SEARCH_FORM_SELECTOR) return searchForm || null;
    return null;
  };
  documentStub.getElementById = (id) => findById(searchFormContainer, id);
  return documentStub;
}

/**
 * Load the script against a document that satisfies its top-level
 * `isNetBoxPage()` guard by default - without a matching marker the IIFE
 * returns before defining any function, and `module.exports` never runs.
 * @param {{document?: object, hostname?: string, gm?: object, mutationObserver?: object, extraGlobals?: object}} [overrides] - Specifies sandbox overrides.
 * @returns {object} Returns the script's exported functions.
 */
function load(overrides = {}) {
  return loadUserScript(SCRIPT_PATH, {
    document: overrides.document || makeNetBoxDocumentStub(),
    hostname: overrides.hostname || "netbox.example.com",
    gm: overrides.gm,
    mutationObserver: overrides.mutationObserver,
    extraGlobals: overrides.extraGlobals,
  });
}

const fixtureHtml = fs.readFileSync(FIXTURE_PATH, "utf8");

test("fixture sanity: real NetBox page carries the data-netbox-version marker", () => {
  assert.match(fixtureHtml, /<html[^>]*\sdata-netbox-version="/);
});

test("fixture sanity: real NetBox page has the vertical sidebar aside", () => {
  assert.match(fixtureHtml, /<aside\s+class="navbar navbar-vertical/);
});

test("fixture sanity: real NetBox page has the desktop header's right-hand nav container", () => {
  assert.match(fixtureHtml, /class="navbar-nav flex-row align-items-center order-md-last"/);
});

test("fixture sanity: real NetBox page has the page-wrapper and non-vertical top header", () => {
  assert.match(fixtureHtml, /<div class="page-wrapper">/);
  assert.match(fixtureHtml, /<header\s+class="navbar navbar-expand-md/);
});

test("top-level guard: does nothing on a page without the NetBox marker", () => {
  const exportsObj = load({ document: makeNetBoxDocumentStub({ hasMarker: false }) });
  assert.deepEqual(Object.keys(exportsObj), []);
});

test("getConfiguredHostname/setConfiguredHostname: round-trip through GM storage", () => {
  const gmStubs = createGMStubs();
  const { getConfiguredHostname, setConfiguredHostname } = load({ gm: gmStubs });
  assert.equal(getConfiguredHostname(), "");
  setConfiguredHostname("netbox.example.com");
  assert.equal(getConfiguredHostname(), "netbox.example.com");
});

test("isEnabledForCurrentHost: true only when the configured hostname matches location.hostname", () => {
  const gmStubs = createGMStubs();
  const { isEnabledForCurrentHost } = load({ gm: gmStubs, hostname: "netbox.example.com" });
  assert.equal(isEnabledForCurrentHost(), false, "unconfigured");

  gmStubs.GM_setValue("netbox_hostname", "netbox.example.com");
  assert.equal(isEnabledForCurrentHost(), true, "reads GM storage live, matches now that it's set");

  gmStubs.GM_setValue("netbox_hostname", "netbox-staging.tv2intern.dk");
  assert.equal(isEnabledForCurrentHost(), false, "mismatched host");
});

test("ensureHostnameConfigured: stores the trimmed prompt answer when unconfigured", () => {
  const gmStubs = createGMStubs();
  const promptCalls = [];
  const { ensureHostnameConfigured, getConfiguredHostname } = load({
    gm: gmStubs,
    hostname: "netbox.example.com",
    extraGlobals: {
      prompt: (message, defaultValue) => {
        promptCalls.push({ message, defaultValue });
        return "  netbox.example.com  ";
      },
    },
  });

  ensureHostnameConfigured();

  assert.equal(getConfiguredHostname(), "netbox.example.com");
  assert.equal(promptCalls.length, 1);
  assert.equal(promptCalls[0].defaultValue, "netbox.example.com");
});

test("ensureHostnameConfigured: leaves the hostname unset when the prompt is cancelled or blank", () => {
  const gmStubs = createGMStubs();
  const { ensureHostnameConfigured, getConfiguredHostname } = load({
    gm: gmStubs,
    extraGlobals: { prompt: () => null },
  });
  ensureHostnameConfigured();
  assert.equal(getConfiguredHostname(), "");
});

test("ensureHostnameConfigured: does not prompt again once a hostname is already configured", () => {
  const gmStubs = createGMStubs();
  gmStubs.GM_setValue("netbox_hostname", "netbox.example.com");
  let promptCallCount = 0;
  const { ensureHostnameConfigured } = load({
    gm: gmStubs,
    extraGlobals: { prompt: () => { promptCallCount += 1; return "ignored"; } },
  });
  ensureHostnameConfigured();
  assert.equal(promptCallCount, 0);
});

test("isSidebarHidden/setSidebarHidden: round-trip through GM storage and apply the DOM state", () => {
  const gmStubs = createGMStubs();
  const aside = createElementStub("aside");
  const { isSidebarHidden, setSidebarHidden } = load({
    gm: gmStubs,
    document: makeNetBoxDocumentStub({ aside }),
  });

  assert.equal(isSidebarHidden(), false);
  setSidebarHidden(true);
  assert.equal(isSidebarHidden(), true);
  assert.equal(aside.style.transform, "translateX(-100%)");

  setSidebarHidden(false);
  assert.equal(isSidebarHidden(), false);
  assert.equal(aside.style.transform, "");
});

test("applyHiddenState: returns false without touching anything when the sidebar aside isn't on the page", () => {
  const { applyHiddenState } = load();
  assert.equal(applyHiddenState(true), false);
});

test("applyHiddenState: hiding slides the aside off-screen, marks it inert/aria-hidden, and zeroes the content margins", () => {
  const aside = createElementStub("aside");
  const pageWrapper = createElementStub("div");
  const topHeader = createElementStub("header");
  const { applyHiddenState } = load({
    document: makeNetBoxDocumentStub({ aside, pageWrapper, topHeader }),
  });

  assert.equal(applyHiddenState(true), true);
  assert.equal(aside.style.transform, "translateX(-100%)");
  assert.equal(aside.getAttribute("aria-hidden"), "true");
  assert.equal(aside.inert, true);
  assert.equal(pageWrapper.style.marginLeft, "0px");
  assert.equal(topHeader.style.marginLeft, "0px");
});

test("applyHiddenState: showing clears the transform/inert/aria-hidden and restores the stylesheet's own margins", () => {
  const aside = createElementStub("aside");
  const pageWrapper = createElementStub("div");
  const topHeader = createElementStub("header");
  const { applyHiddenState } = load({
    document: makeNetBoxDocumentStub({ aside, pageWrapper, topHeader }),
  });

  applyHiddenState(true);
  assert.equal(applyHiddenState(false), true);
  assert.equal(aside.style.transform, "");
  assert.equal(aside.getAttribute("aria-hidden"), null);
  assert.equal(aside.inert, false);
  assert.equal(pageWrapper.style.marginLeft, "");
  assert.equal(topHeader.style.marginLeft, "");
});

test("applyHiddenState: tolerates a missing page-wrapper/top-header (only the aside is required)", () => {
  const aside = createElementStub("aside");
  const { applyHiddenState } = load({ document: makeNetBoxDocumentStub({ aside }) });
  assert.equal(applyHiddenState(true), true);
  assert.equal(aside.style.transform, "translateX(-100%)");
});

test("updateToggleButton: reflects the hidden state in the icon class and accessible labels", () => {
  const { updateToggleButton, createToggleButton } = load();
  const btn = createToggleButton();

  updateToggleButton(btn, true);
  assert.equal(btn.firstChild.className, "mdi mdi-chevron-right");
  assert.equal(btn.getAttribute("aria-label"), "Show sidebar");
  assert.equal(btn.getAttribute("title"), "Show sidebar");

  updateToggleButton(btn, false);
  assert.equal(btn.firstChild.className, "mdi mdi-chevron-left");
  assert.equal(btn.getAttribute("aria-label"), "Hide sidebar");
});

test("createToggleButton: reuses NetBox's own header icon-button classes instead of hand-rolled styling", () => {
  const { createToggleButton } = load();
  const btn = createToggleButton();
  assert.equal(btn.id, "nb-sidebar-toggle-button");
  assert.equal(btn.className, "nav-link fs-2 p-0 text-secondary");
  assert.equal(btn.getAttribute("data-bs-toggle"), "tooltip");
  assert.equal(btn.getAttribute("data-bs-placement"), "bottom");
  assert.equal(btn.firstChild.tagName, "I");
});

test("createToggleButton: clicking it toggles the persisted hidden state", () => {
  const gmStubs = createGMStubs();
  const aside = createElementStub("aside");
  const { createToggleButton, isSidebarHidden } = load({
    gm: gmStubs,
    document: makeNetBoxDocumentStub({ aside }),
  });
  const btn = createToggleButton();

  btn.click();
  assert.equal(isSidebarHidden(), true);
  btn.click();
  assert.equal(isSidebarHidden(), false);
});

test("injectToggleButton: returns false when the header search form isn't on the page", () => {
  const { injectToggleButton } = load();
  assert.equal(injectToggleButton(), false);
});

test("injectToggleButton: inserts the button as the search form's previous sibling", () => {
  const searchForm = createElementStub("form");
  const documentStub = makeNetBoxDocumentStub({ searchForm });
  const { injectToggleButton } = load({ document: documentStub });

  assert.equal(injectToggleButton(), true);
  const siblings = searchForm.parentNode.children;
  assert.equal(siblings.length, 2);
  assert.equal(siblings[0].id, "nb-sidebar-toggle-button");
  assert.equal(siblings[1], searchForm);
});

test("injectToggleButton: is idempotent, does not insert a second button", () => {
  const searchForm = createElementStub("form");
  const documentStub = makeNetBoxDocumentStub({ searchForm });
  const { injectToggleButton } = load({ document: documentStub });

  assert.equal(injectToggleButton(), true);
  assert.equal(injectToggleButton(), true);
  assert.equal(searchForm.parentNode.children.length, 2);
});

test("init: false when the header search form is missing, true once it's present", () => {
  const { init } = load({ document: makeNetBoxDocumentStub({}) });
  assert.equal(init(), false, "no search form yet");

  const searchForm = createElementStub("form");
  const documentStub = makeNetBoxDocumentStub({ searchForm });
  const withForm = load({ document: documentStub });
  assert.equal(withForm.init(), true);
  assert.equal(searchForm.parentNode.children.length, 2, "the button got injected");
});

test("top-level init: enabled + search form already present injects the button synchronously, no retry observer", () => {
  const gmStubs = createGMStubs();
  gmStubs.GM_setValue("netbox_hostname", "netbox.example.com");
  const searchForm = createElementStub("form");
  const documentStub = makeNetBoxDocumentStub({ searchForm });
  const moStub = createMutationObserverStub();

  load({
    gm: gmStubs,
    hostname: "netbox.example.com",
    document: documentStub,
    mutationObserver: moStub,
  });

  assert.equal(searchForm.parentNode.children.length, 2, "button injected on first synchronous init() call");
  assert.equal(moStub.instances.length, 0, "no retry observer needed");
});

test("top-level init: retries via MutationObserver until the header search form appears", () => {
  const gmStubs = createGMStubs();
  gmStubs.GM_setValue("netbox_hostname", "netbox.example.com");
  const documentStub = makeNetBoxDocumentStub({});
  const moStub = createMutationObserverStub();

  load({
    gm: gmStubs,
    hostname: "netbox.example.com",
    document: documentStub,
    mutationObserver: moStub,
  });

  assert.equal(moStub.instances.length, 1, "search form missing at load time, so a retry observer starts");
  const [observer] = moStub.instances;
  assert.equal(observer.disconnected, false);

  const searchForm = createElementStub("form");
  const container = createElementStub("div");
  container.appendChild(searchForm);
  documentStub.querySelector = (selector) => {
    if (selector === SEARCH_FORM_SELECTOR) return searchForm;
    if (selector === MARKER_SELECTOR) return { tagName: "HTML" };
    return null;
  };

  observer.callback();
  assert.equal(observer.disconnected, true, "disconnects once init() succeeds");
  assert.equal(searchForm.parentNode.children.length, 2);
});

test("top-level init: gives up after MAX_INIT_RETRIES when the header search form never appears", () => {
  const gmStubs = createGMStubs();
  gmStubs.GM_setValue("netbox_hostname", "netbox.example.com");
  const moStub = createMutationObserverStub();

  load({
    gm: gmStubs,
    hostname: "netbox.example.com",
    document: makeNetBoxDocumentStub({}),
    mutationObserver: moStub,
  });

  const [observer] = moStub.instances;
  for (let i = 0; i < 9; i++) observer.callback();
  assert.equal(observer.disconnected, false, "still retrying");
  observer.callback();
  assert.equal(observer.disconnected, true, "gives up after MAX_INIT_RETRIES");
});

test("top-level init: does nothing when no hostname is configured for this host", () => {
  const gmStubs = createGMStubs();
  const searchForm = createElementStub("form");
  const documentStub = makeNetBoxDocumentStub({ searchForm });
  const moStub = createMutationObserverStub();

  load({
    gm: gmStubs,
    hostname: "netbox.example.com",
    document: documentStub,
    mutationObserver: moStub,
  });

  assert.equal(searchForm.parentNode.children.length, 1, "button never injected");
  assert.equal(moStub.instances.length, 0, "no retry observer registered either");
});

test("debug toggle: GM_registerMenuCommand toggles DEBUG and re-registers with an updated label", () => {
  const gmStubs = createGMStubs();
  load({ gm: gmStubs });

  const debugCommand = [...gmStubs.commands.values()].find((c) => c.label.startsWith("Debug logging:"));
  assert.match(debugCommand.label, /Debug logging: OFF/);

  debugCommand.callback();
  assert.equal(gmStubs.GM_getValue("debug_logging", false), true);
  const updated = [...gmStubs.commands.values()].find((c) => c.label.startsWith("Debug logging:"));
  assert.match(updated.label, /Debug logging: ON/);
});

test("hostname menu command: label reflects 'not set' until a hostname is configured, then the chosen host", () => {
  const gmStubs = createGMStubs();
  load({
    gm: gmStubs,
    extraGlobals: { prompt: () => "netbox.example.com" },
  });

  const before = [...gmStubs.commands.values()].find((c) => c.label.startsWith("NetBox sidebar toggle host:"));
  assert.match(before.label, /not set/);

  before.callback();

  const after = [...gmStubs.commands.values()].find((c) => c.label.startsWith("NetBox sidebar toggle host:"));
  assert.match(after.label, /netbox\.tv2intern\.dk/);
});

test("hostname menu command: a cancelled prompt (null) leaves the hostname unchanged", () => {
  const gmStubs = createGMStubs();
  gmStubs.GM_setValue("netbox_hostname", "netbox.example.com");
  load({
    gm: gmStubs,
    extraGlobals: { prompt: () => null },
  });

  const command = [...gmStubs.commands.values()].find((c) => c.label.startsWith("NetBox sidebar toggle host:"));
  command.callback();

  assert.equal(gmStubs.GM_getValue("netbox_hostname", ""), "netbox.example.com");
});
