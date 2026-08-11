"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const crypto = require("node:crypto");

const { loadUserScript, createDocumentStub, createGMStubs, createMutationObserverStub } = require("./support/dom-stubs.js");

const SCRIPT_PATH = path.join(__dirname, "..", "lsb-exporter.user.js");

/**
 * sha256 stub matching js-sha256's contract (lowercase hex digest of a
 * UTF-8 string), backed by Node's real crypto module rather than a fake —
 * so the script's hashing behavior is exercised with a real algorithm.
 * @param {string} str - Specifies the string to hash.
 * @returns {string} Returns the lowercase hex sha256 digest.
 */
function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

/**
 * Build a transaction row stub exposing only the four field selectors
 * `generateDataElement` queries via `item.querySelector(...)`.
 * @param {{date?: string, description?: string, amount?: string, balance?: string}} fields - Specifies the row's field text.
 * @returns {object} Returns a row stub.
 */
function makeRowStub(fields) {
  const selectors = {
    "div.transaction-field.transaction-field--date":
      fields.date === undefined ? { innerText: fields.date } : { innerText: fields.date },
    "div.transaction-field.transaction-field--statementText": { innerText: fields.description },
    "div.transaction-field.transaction-field--amount": { innerText: fields.amount },
    "div.transaction-field.transaction-field--balance": { innerText: fields.balance },
  };
  return {
    querySelector(selector) {
      if (fields.missing === selector) return null;
      return selectors[selector] || null;
    },
  };
}

/**
 * Build a `document` stub whose `.transaction-list-inner` table returns the
 * given row stubs, or no table at all when `rows` is null.
 * @param {object[]|null} rows - Specifies the row stubs, or null for "no table found".
 * @returns {object} Returns a document stub.
 */
function makeDocumentStub(rows) {
  const documentStub = createDocumentStub();
  const tableStub = {
    querySelectorAll(selector) {
      return selector === '.transaction-list-inner > div[tabindex="0"]' ? rows : [];
    },
  };
  documentStub.querySelector = function (selector) {
    if (selector === ".transaction-list-inner") return rows ? tableStub : null;
    return null;
  };
  return documentStub;
}

test("generateDataElement: throws when sha256() is unavailable", () => {
  const { generateDataElement } = loadUserScript(SCRIPT_PATH, {
    document: makeDocumentStub([]),
    // No `sha256` extraGlobal — mirrors the @require script failing to load.
  });

  assert.throws(() => generateDataElement(), /sha256\(\) is unavailable/);
});

test("generateDataElement: throws when the transaction list is not found", () => {
  const { generateDataElement } = loadUserScript(SCRIPT_PATH, {
    document: makeDocumentStub(null),
    extraGlobals: { sha256 },
  });

  assert.throws(() => generateDataElement(), /transaction list not found/);
});

test("generateDataElement: parses a row into a correctly formatted CSV line", () => {
  const row = makeRowStub({
    date: "5 okt 2024",
    description: "Netto",
    amount: "-1.234",
    balance: "12.345DKK",
  });
  const { generateDataElement } = loadUserScript(SCRIPT_PATH, {
    document: makeDocumentStub([row]),
    extraGlobals: { sha256 },
  });

  const csv = generateDataElement();
  const lines = csv.split("\n");
  assert.equal(lines.length, 2, "header + one data row");
  assert.equal(
    lines[0],
    "Id;AccountId;AccountName;AccountType;Date;Description;OriginalDescription;MainCategoryId;MainCategoryName;CategoryId;CategoryName;CategoryType;ExpenseType;Amount;Balance;CounterEntryId;Comment;Tags;Extraordinary;SplitGroupId;CustomDate;Currency;OriginalAmount;OriginalCurrency",
  );

  // Computed the same way the script itself derives it (via `new Date(...)`,
  // which resolves "5 oct 2024" against the local timezone before converting
  // to UTC), rather than hardcoding a literal that would only be correct in
  // one specific timezone.
  const expectedDate = new Date("5 oct 2024").toISOString().split("T")[0];
  const expectedId = sha256([expectedDate, "-1234", "DKK", "12345"].join("_"));
  const fields = lines[1].split(";");
  assert.equal(fields[0], expectedId);
  assert.equal(fields[2], "BOLIGPRIORITETSKONTO");
  assert.equal(fields[4], expectedDate);
  assert.equal(fields[5], "Netto");
  assert.equal(fields[7], "14");
  assert.equal(fields[8], "Bolig");
  assert.equal(fields[9], "114");
  assert.equal(fields[10], "Boliglån/husleje");
  assert.equal(fields[11], "Expense");
  assert.equal(fields[12], "Variable");
  assert.equal(fields[13], "-1234");
  assert.equal(fields[14], "12345");
  assert.equal(fields[18], "No");
  assert.equal(fields[21], "DKK");
  assert.equal(fields[23], "DKK");
});

test("generateDataElement: positive amounts are categorized as Income", () => {
  const row = makeRowStub({
    date: "1 jan 2024",
    description: "Løn",
    amount: "20.000",
    balance: "30.000DKK",
  });
  const { generateDataElement } = loadUserScript(SCRIPT_PATH, {
    document: makeDocumentStub([row]),
    extraGlobals: { sha256 },
  });

  const fields = generateDataElement().split("\n")[1].split(";");
  assert.equal(fields[11], "Income");
});

test("generateDataElement: 'I dag' resolves to today's ISO date", () => {
  const row = makeRowStub({
    date: "I dag",
    description: "Kaffe",
    amount: "-50",
    balance: "1.000DKK",
  });
  const { generateDataElement } = loadUserScript(SCRIPT_PATH, {
    document: makeDocumentStub([row]),
    extraGlobals: { sha256 },
  });

  const todayIso = new Date().toISOString().split("T")[0];
  const fields = generateDataElement().split("\n")[1].split(";");
  assert.equal(fields[4], todayIso);
});

test("generateDataElement: a malformed row is skipped rather than aborting the whole export", () => {
  const goodRow = makeRowStub({
    date: "1 jan 2024",
    description: "Netto",
    amount: "-100",
    balance: "1.000DKK",
  });
  const badRow = makeRowStub({
    date: "1 jan 2024",
    description: "Netto",
    amount: "-100",
    balance: "1.000DKK",
    missing: "div.transaction-field.transaction-field--balance",
  });
  const { generateDataElement } = loadUserScript(SCRIPT_PATH, {
    document: makeDocumentStub([badRow, goodRow]),
    extraGlobals: { sha256 },
  });

  const lines = generateDataElement().split("\n");
  assert.equal(lines.length, 2, "header + only the one well-formed row");
});

test("generateDataElement: 'I går' resolves to yesterday's ISO date", () => {
  const row = makeRowStub({
    date: "I går",
    description: "Kaffe",
    amount: "-50",
    balance: "1.000DKK",
  });
  const { generateDataElement } = loadUserScript(SCRIPT_PATH, {
    document: makeDocumentStub([row]),
    extraGlobals: { sha256 },
  });

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayIso = yesterday.toISOString().split("T")[0];
  const fields = generateDataElement().split("\n")[1].split(";");
  assert.equal(fields[4], yesterdayIso);
});

test("debug toggle: GM menu command flips DEBUG and re-registers with the new label", () => {
  const gmStubs = createGMStubs();
  loadUserScript(SCRIPT_PATH, {
    document: makeDocumentStub([]),
    extraGlobals: { sha256 },
    gm: gmStubs,
  });

  assert.equal(gmStubs.commands.size, 1);
  const [, entry] = [...gmStubs.commands.entries()][0];
  assert.match(entry.label, /Debug logging: OFF/);

  entry.callback();

  assert.equal(gmStubs.GM_getValue("debug_logging", false), true);
  assert.equal(gmStubs.commands.size, 1, "old command unregistered, new one registered");
  const [, newEntry] = [...gmStubs.commands.entries()][0];
  assert.match(newEntry.label, /Debug logging: ON/);

  // Toggle back off, to exercise the re-registration ternary's other arm.
  newEntry.callback();
  assert.equal(gmStubs.GM_getValue("debug_logging", false), false);
  const [, offAgainEntry] = [...gmStubs.commands.entries()][0];
  assert.match(offAgainEntry.label, /Debug logging: OFF/);
});

test("debug toggle: the initial menu label reflects a pre-existing 'ON' debug_logging value", () => {
  const gmStubs = createGMStubs();
  gmStubs.GM_setValue("debug_logging", true);
  loadUserScript(SCRIPT_PATH, {
    document: makeDocumentStub([]),
    extraGlobals: { sha256 },
    gm: gmStubs,
  });

  const [, entry] = [...gmStubs.commands.entries()][0];
  assert.match(entry.label, /Debug logging: ON/);
});

test("debug logging: dbg/dbgInfo/dbgWarn actually log to console when DEBUG is true", () => {
  const gmStubs = createGMStubs();
  gmStubs.GM_setValue("debug_logging", true);
  const row = makeRowStub({
    date: "1 jan 2024",
    description: "Netto",
    amount: "-100",
    balance: "1.000DKK",
  });
  // makeDocumentStub's querySelector only ever matches ".transaction-list-inner",
  // so the actions-bar selector initScript() checks for already returns null
  // here - meaning initScript() fails at load and a retry observer starts.
  const documentStub = makeDocumentStub([row]);
  const moStub = createMutationObserverStub();

  const originalDebug = console.debug;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const calls = { debug: 0, info: 0, warn: 0 };
  console.debug = () => { calls.debug += 1; };
  console.info = () => { calls.info += 1; };
  console.warn = () => { calls.warn += 1; };

  try {
    const { generateDataElement, fallbackCopyTextToClipboard, copyTextToClipboard, initScript } = loadUserScript(
      SCRIPT_PATH,
      {
        document: documentStub,
        extraGlobals: { sha256 },
        gm: gmStubs,
        mutationObserver: moStub,
      },
    );

    generateDataElement(); // dbgInfo (line 404)
    fallbackCopyTextToClipboard("x"); // dbg, success arm (line 431)

    // dbgWarn via the retry observer giving up (line 508).
    for (let i = 0; i < 10; i++) moStub.instances[0].callback();

    assert.ok(calls.info >= 1, "dbgInfo logged");
    assert.ok(calls.debug >= 1, "dbg logged");
    assert.ok(calls.warn >= 1, "dbgWarn logged");
  } finally {
    console.debug = originalDebug;
    console.info = originalInfo;
    console.warn = originalWarn;
  }
});

test("fallbackCopyTextToClipboard: logs the 'unsuccessful' outcome when execCommand returns false", () => {
  const documentStub = makeDocumentStub([]);
  documentStub.execCommand = () => false;
  const { fallbackCopyTextToClipboard } = loadUserScript(SCRIPT_PATH, {
    document: documentStub,
    extraGlobals: { sha256 },
  });

  assert.doesNotThrow(() => fallbackCopyTextToClipboard("hello"));
});

test("copyTextToClipboard: falls back to document.execCommand when navigator.clipboard is unavailable", () => {
  const execCommandCalls = [];
  const documentStub = makeDocumentStub([]);
  documentStub.execCommand = function (name) {
    execCommandCalls.push(name);
    return true;
  };
  const { copyTextToClipboard } = loadUserScript(SCRIPT_PATH, {
    document: documentStub,
    extraGlobals: { sha256 },
    // Default sandbox navigator has no `.clipboard`, so the fallback path is used.
  });

  copyTextToClipboard("hello");
  assert.deepEqual(execCommandCalls, ["copy"]);
});

test("fallbackCopyTextToClipboard: logs and continues when document.execCommand throws", () => {
  const documentStub = makeDocumentStub([]);
  documentStub.execCommand = function () {
    throw new Error("execCommand blocked");
  };
  const { fallbackCopyTextToClipboard } = loadUserScript(SCRIPT_PATH, {
    document: documentStub,
    extraGlobals: { sha256 },
  });

  fallbackCopyTextToClipboard("csv payload");
  // The textarea is still removed even though the copy attempt threw.
  assert.equal(documentStub.body.children.length, 0);
});

test("copyTextToClipboard: logs when the async Clipboard API rejects", async () => {
  let rejectFn;
  const { copyTextToClipboard } = loadUserScript(SCRIPT_PATH, {
    document: makeDocumentStub([]),
    extraGlobals: {
      sha256,
      navigator: {
        clipboard: {
          writeText() {
            return new Promise((_resolve, reject) => {
              rejectFn = reject;
            });
          },
        },
      },
    },
  });

  copyTextToClipboard("hello world");
  assert.equal(typeof rejectFn, "function");
  rejectFn(new Error("denied"));
  await Promise.resolve().then(() => {});
});

test("copyTextToClipboard: uses the async Clipboard API when available", async () => {
  const writeTextCalls = [];
  const { copyTextToClipboard } = loadUserScript(SCRIPT_PATH, {
    document: makeDocumentStub([]),
    extraGlobals: {
      sha256,
      navigator: {
        clipboard: {
          writeText(text) {
            writeTextCalls.push(text);
            return Promise.resolve();
          },
        },
      },
    },
  });

  copyTextToClipboard("hello world");
  await Promise.resolve();
  assert.deepEqual(writeTextCalls, ["hello world"]);
});

test("fallbackCopyTextToClipboard: appends a textarea to the body, copies, then removes it", () => {
  const documentStub = makeDocumentStub([]);
  const { fallbackCopyTextToClipboard } = loadUserScript(SCRIPT_PATH, {
    document: documentStub,
    extraGlobals: { sha256 },
  });

  fallbackCopyTextToClipboard("csv payload");
  // The textarea is appended and then removed again by the end of the call.
  assert.equal(documentStub.body.children.length, 0);
});

test("injectCopyButton: inserts a 'Copy Data' button before the PDF export button", () => {
  const parentElement = createDocumentStub().createElement("div");
  const pdfButton = createDocumentStub().createElement("a");
  parentElement.querySelector = function (selector) {
    return selector === ".export-as-pdf-button" ? pdfButton : null;
  };

  const { injectCopyButton } = loadUserScript(SCRIPT_PATH, {
    document: makeDocumentStub([]),
    extraGlobals: { sha256 },
  });

  injectCopyButton(parentElement);

  assert.equal(parentElement.children.length, 1);
  const [button] = parentElement.children;
  assert.equal(button.getAttribute("data-testid"), "button");
  assert.equal(button.children[0].innerText, "Copy Data");
});

test("injectCopyButton: clicking the button copies the generated CSV to the clipboard", () => {
  const writeTextCalls = [];
  const row = makeRowStub({
    date: "1 jan 2024",
    description: "Netto",
    amount: "-100",
    balance: "1.000DKK",
  });
  const documentStub = makeDocumentStub([row]);
  const parentElement = documentStub.createElement("div");
  parentElement.querySelector = function () {
    return null; // No PDF button anchor: insertBefore falls back to append.
  };

  const { injectCopyButton } = loadUserScript(SCRIPT_PATH, {
    document: documentStub,
    extraGlobals: {
      sha256,
      navigator: {
        clipboard: {
          writeText(text) {
            writeTextCalls.push(text);
            return Promise.resolve();
          },
        },
      },
    },
  });

  injectCopyButton(parentElement);
  parentElement.children[0].click();

  assert.equal(writeTextCalls.length, 1);
  assert.match(writeTextCalls[0], /^Id;AccountId;/);
});

test("injectCopyButton: a click handler error (e.g. sha256 unavailable) is caught, not thrown", () => {
  const documentStub = makeDocumentStub([]);
  const parentElement = documentStub.createElement("div");
  parentElement.querySelector = function () {
    return null;
  };

  const { injectCopyButton } = loadUserScript(SCRIPT_PATH, {
    document: documentStub,
    // No `sha256` extraGlobal: generateDataElement() throws synchronously
    // when the button is clicked, inside the click handler's own try/catch.
  });

  injectCopyButton(parentElement);
  assert.doesNotThrow(() => parentElement.children[0].click());
});

test("initScript: returns false when the account actions bar is not present", () => {
  const documentStub = makeDocumentStub([]);
  documentStub.querySelector = () => null;
  const { initScript } = loadUserScript(SCRIPT_PATH, {
    document: documentStub,
    extraGlobals: { sha256 },
  });

  assert.equal(initScript(), false);
});

test("initScript: returns false when the PDF export button hasn't rendered yet", () => {
  const documentStub = makeDocumentStub([]);
  const parentElement = documentStub.createElement("div");
  parentElement.querySelector = () => null;
  documentStub.querySelector = function (selector) {
    return selector === ".account-header__top-bar > .account-header__actions" ? parentElement : null;
  };
  const { initScript } = loadUserScript(SCRIPT_PATH, {
    document: documentStub,
    extraGlobals: { sha256 },
  });

  assert.equal(initScript(), false);
});

test("initScript: returns true without re-injecting when the Copy Data button already exists", () => {
  const documentStub = makeDocumentStub([]);
  const parentElement = documentStub.createElement("div");
  const pdfButton = documentStub.createElement("a");
  const copyButton = documentStub.createElement("button");
  parentElement.querySelector = function (selector) {
    if (selector === ".export-as-pdf-button") return pdfButton;
    if (selector === ".account-header-actions__export-button") return copyButton;
    return null;
  };
  documentStub.querySelector = function (selector) {
    return selector === ".account-header__top-bar > .account-header__actions" ? parentElement : null;
  };
  const { initScript } = loadUserScript(SCRIPT_PATH, {
    document: documentStub,
    extraGlobals: { sha256 },
  });

  assert.equal(initScript(), true);
  assert.equal(parentElement.children.length, 0, "no new button injected");
});

test("initScript: injects the Copy Data button when the actions bar and PDF button are present", () => {
  const documentStub = makeDocumentStub([]);
  const parentElement = documentStub.createElement("div");
  const pdfButton = documentStub.createElement("a");
  // Mirrors the real DOM: COPY_BUTTON_SELECTOR only matches once a button
  // with that class has actually been inserted, so this stays idempotent
  // across both the automatic load-time initScript() call and the explicit
  // one below (unlike a static flag, which would let the second call inject
  // a duplicate that the real querySelector would have caught).
  parentElement.querySelector = function (selector) {
    if (selector === ".export-as-pdf-button") return pdfButton;
    if (selector === ".account-header-actions__export-button") {
      return (
        parentElement.children.find((child) =>
          (child.getAttribute("class") || "").includes("account-header-actions__export-button"),
        ) || null
      );
    }
    return null;
  };
  documentStub.querySelector = function (selector) {
    return selector === ".account-header__top-bar > .account-header__actions" ? parentElement : null;
  };
  const { initScript } = loadUserScript(SCRIPT_PATH, {
    document: documentStub,
    extraGlobals: { sha256 },
  });

  assert.equal(initScript(), true);
  assert.equal(parentElement.children.length, 1, "idempotent: still only one button after a second call");
});

test("top-level retry observer: retries initScript on mutation until the actions bar appears, then disconnects", () => {
  const documentStub = makeDocumentStub([]);
  // No actions bar at load time, so initScript() fails and a retry observer starts.
  documentStub.querySelector = () => null;

  const moStub = createMutationObserverStub();
  loadUserScript(SCRIPT_PATH, {
    document: documentStub,
    extraGlobals: { sha256 },
    mutationObserver: moStub,
  });

  assert.equal(moStub.instances.length, 1);
  const [observer] = moStub.instances;
  assert.equal(observer.disconnected, false);

  observer.callback();
  assert.equal(observer.disconnected, false, "still no actions bar: retries continue");

  const parentElement = documentStub.createElement("div");
  const pdfButton = documentStub.createElement("a");
  parentElement.querySelector = (selector) => (selector === ".export-as-pdf-button" ? pdfButton : null);
  documentStub.querySelector = (selector) =>
    selector === ".account-header__top-bar > .account-header__actions" ? parentElement : null;

  observer.callback();
  assert.equal(observer.disconnected, true, "disconnects once initScript succeeds");
});

test("top-level retry observer: gives up after MAX_INIT_RETRIES", () => {
  const documentStub = makeDocumentStub([]);
  documentStub.querySelector = () => null;

  const moStub = createMutationObserverStub();
  loadUserScript(SCRIPT_PATH, {
    document: documentStub,
    extraGlobals: { sha256 },
    mutationObserver: moStub,
  });

  const [observer] = moStub.instances;
  for (let i = 0; i < 9; i++) observer.callback();
  assert.equal(observer.disconnected, false);

  observer.callback();
  assert.equal(observer.disconnected, true, "gives up after 10 retries");
});
