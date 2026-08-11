"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  loadUserScript,
  createDocumentStub,
  createElementStub,
  createGMStubs,
  createMutationObserverStub,
} = require("./support/dom-stubs.js");

const SCRIPT_PATH = path.join(__dirname, "..", "rejseplanen-calendar-export.user.js");
const INJECTED_FLAG = "rpQuickAddInjected";

/**
 * @param {object} [overrides] - Specifies sandbox overrides to forward to loadUserScript.
 * @returns {object} Returns the script's exported functions, freshly loaded.
 */
function load(overrides) {
  return loadUserScript(SCRIPT_PATH, overrides);
}

test("parseExportIcsArgs: parses a compact single-line exportIcs() onclick call", () => {
  const { parseExportIcsArgs } = load();
  const onclick =
    "Hafas.Util.exportIcs({dateStart:'20240115T080000Z',dateEnd:'20240115T090000Z',description:'Fra%20A%20til%20B.',title:'A to B',location:''})";

  // Spread into a host-realm object: the script runs inside a vm sandbox,
  // so object literals it constructs carry that realm's Object prototype,
  // and assert's strict deepEqual treats differing prototypes as unequal
  // even when every property matches.
  assert.deepEqual({ ...parseExportIcsArgs(onclick) }, {
    dateStart: "20240115T080000Z",
    dateEnd: "20240115T090000Z",
    description: "Fra%20A%20til%20B.",
    title: "A to B",
    location: "",
  });
});

test("parseExportIcsArgs: tolerates pretty-printed multi-line onclick with a trailing comma", () => {
  const { parseExportIcsArgs } = load();
  const onclick = `Hafas.Util.exportIcs({
    dateStart: '20240115T080000Z',
    dateEnd: '20240115T090000Z',
    description: 'Fra%20A%20til%20B.',
    title: 'A to B',
    location: 'Odense',
  })`;

  assert.deepEqual({ ...parseExportIcsArgs(onclick) }, {
    dateStart: "20240115T080000Z",
    dateEnd: "20240115T090000Z",
    description: "Fra%20A%20til%20B.",
    title: "A to B",
    location: "Odense",
  });
});

test("parseExportIcsArgs: returns null when the onclick attribute doesn't match", () => {
  const { parseExportIcsArgs } = load();
  assert.equal(parseExportIcsArgs("someOtherFunction()"), null);
});

test("decodeDescription: decodes a percent-encoded description", () => {
  const { decodeDescription } = load();
  assert.equal(decodeDescription("Fra%20A%20til%20B."), "Fra A til B.");
});

test("decodeDescription: falls back to the raw (trimmed) input when decoding fails", () => {
  const { decodeDescription } = load();
  assert.equal(decodeDescription("  100% off  "), "100% off");
});

test("icsUtcToIso: converts a compact UTC iCalendar timestamp to ISO-8601", () => {
  const { icsUtcToIso } = load();
  assert.equal(icsUtcToIso("20240115T080000Z"), "2024-01-15T08:00:00Z");
});

test("icsUtcToIso: returns null for a non-matching timestamp", () => {
  const { icsUtcToIso } = load();
  assert.equal(icsUtcToIso("not-a-timestamp"), null);
});

test("buildGoogleCalendarUrl: builds a Google Calendar quick-add URL", () => {
  const { buildGoogleCalendarUrl } = load();
  const url = buildGoogleCalendarUrl({
    title: "A to B",
    dateStart: "20240115T080000Z",
    dateEnd: "20240115T090000Z",
    description: "Fra%20A%20til%20B.",
    location: "Odense",
  });

  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, "https://calendar.google.com/calendar/render");
  assert.equal(parsed.searchParams.get("action"), "TEMPLATE");
  assert.equal(parsed.searchParams.get("text"), "A to B");
  assert.equal(parsed.searchParams.get("dates"), "20240115T080000Z/20240115T090000Z");
  assert.equal(parsed.searchParams.get("details"), "Fra A til B.");
  assert.equal(parsed.searchParams.get("location"), "Odense");
});

test("buildOutlookDeepLink: builds an Outlook compose deep link", () => {
  const { buildOutlookDeepLink } = load();
  const url = buildOutlookDeepLink("https://outlook.live.com", {
    title: "A to B",
    dateStart: "20240115T080000Z",
    dateEnd: "20240115T090000Z",
    description: "Fra%20A%20til%20B.",
    location: "Odense",
  });

  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://outlook.live.com");
  assert.equal(parsed.pathname, "/calendar/0/deeplink/compose");
  assert.equal(parsed.searchParams.get("rru"), "addevent");
  assert.equal(parsed.searchParams.get("startdt"), "2024-01-15T08:00:00Z");
  assert.equal(parsed.searchParams.get("enddt"), "2024-01-15T09:00:00Z");
  assert.equal(parsed.searchParams.get("subject"), "A to B");
});

test("buildOutlookDeepLink: returns null when the trip timestamps can't be converted", () => {
  const { buildOutlookDeepLink } = load();
  const url = buildOutlookDeepLink("https://outlook.live.com", {
    title: "A to B",
    dateStart: "not-a-timestamp",
    dateEnd: "20240115T090000Z",
    description: "",
    location: "",
  });
  assert.equal(url, null);
});

test("extractQueryStopName: extracts the O= field from a Hafas stop query value", () => {
  const { extractQueryStopName } = load();
  assert.equal(
    extractQueryStopName("A=2@O=Rugårdsvej 25, 5000 Odense C@H=25@L=1"),
    "Rugårdsvej 25, 5000 Odense C",
  );
});

test("extractQueryStopName: returns null for a null or non-matching input", () => {
  const { extractQueryStopName } = load();
  assert.equal(extractQueryStopName(null), null);
  assert.equal(extractQueryStopName("no-O-field-here"), null);
});

test("isPlausibleLocalStamp: accepts a plausible current-year YYYYMMDDHHmm stamp", () => {
  const { isPlausibleLocalStamp } = load();
  const year = new Date().getFullYear();
  assert.equal(isPlausibleLocalStamp(`${year}0115${"1200"}`), true);
});

test("isPlausibleLocalStamp: rejects an impossible month/day/hour/minute", () => {
  const { isPlausibleLocalStamp } = load();
  const year = new Date().getFullYear();
  assert.equal(isPlausibleLocalStamp(`${year}13151200`), false); // month 13
  assert.equal(isPlausibleLocalStamp("190001011200"), false); // year far in the past
});

test("copenhagenLocalStampToIcsUtc: converts a January (CET, UTC+1) local stamp", () => {
  const { copenhagenLocalStampToIcsUtc } = load();
  const year = new Date().getFullYear();
  assert.equal(copenhagenLocalStampToIcsUtc(`${year}01151200`), `${year}0115T110000Z`);
});

test("parseBetaTripArgs: parses a beta connection-details URL into trip args", () => {
  const { parseBetaTripArgs } = load();
  const year = new Date().getFullYear();
  const ctx = `$${year}01151200$${year}01151300$somebase64tail==`;
  const href =
    "https://www.rejseplanen.dk/webapp-nextgen/tp/connection-details/" +
    encodeURIComponent(ctx) +
    "?start=" +
    encodeURIComponent("A=2@O=Odense H@H=25") +
    "&dest=" +
    encodeURIComponent("A=2@O=Aarhus H@H=25");

  const args = parseBetaTripArgs(href);
  assert.equal(args.title, "Odense H → Aarhus H");
  assert.equal(args.location, "");
  assert.equal(args.dateStart, `${year}0115T110000Z`);
  assert.equal(args.dateEnd, `${year}0115T120000Z`);
  assert.equal(decodeURIComponent(args.description), "Fra Odense H til Aarhus H.");
});

test("parseBetaTripArgs: returns null for a URL that isn't a connection-details view", () => {
  const { parseBetaTripArgs } = load();
  assert.equal(parseBetaTripArgs("https://www.rejseplanen.dk/webapp-nextgen/tp/search"), null);
});

test("parseBetaTripArgs: returns null when only one of start/dest stop names is present", () => {
  const { parseBetaTripArgs } = load();
  const year = new Date().getFullYear();
  const ctx = `$${year}01151200$${year}01151300$somebase64tail==`;
  const href =
    "https://www.rejseplanen.dk/webapp-nextgen/tp/connection-details/" +
    encodeURIComponent(ctx) +
    "?start=" +
    encodeURIComponent("A=2@O=Odense H@H=25");
  // No `dest` query param at all.
  assert.equal(parseBetaTripArgs(href), null);
});

test("parseBetaTripArgs: returns null when the connection-details route has no ctx segment after it", () => {
  const { parseBetaTripArgs } = load();
  const href =
    "https://www.rejseplanen.dk/webapp-nextgen/tp/connection-details/?start=" +
    encodeURIComponent("A=2@O=Odense H@H=25") +
    "&dest=" +
    encodeURIComponent("A=2@O=Aarhus H@H=26");
  assert.equal(parseBetaTripArgs(href), null);
});

test("parseBetaTripArgs: returns null when the ctx segment has no 12-digit timestamps at all", () => {
  const { parseBetaTripArgs } = load();
  const href =
    "https://www.rejseplanen.dk/webapp-nextgen/tp/connection-details/" +
    encodeURIComponent("$no-timestamps-here$") +
    "?start=" +
    encodeURIComponent("A=2@O=Odense H@H=25") +
    "&dest=" +
    encodeURIComponent("A=2@O=Aarhus H@H=25");
  assert.equal(parseBetaTripArgs(href), null);
});

test("parseBetaTripArgs: returns null when only one plausible 12-digit timestamp is found", () => {
  const { parseBetaTripArgs } = load();
  const year = new Date().getFullYear();
  const ctx = `$${year}01151200$somebase64tail==`;
  const href =
    "https://www.rejseplanen.dk/webapp-nextgen/tp/connection-details/" +
    encodeURIComponent(ctx) +
    "?start=" +
    encodeURIComponent("A=2@O=Odense H@H=25") +
    "&dest=" +
    encodeURIComponent("A=2@O=Aarhus H@H=25");
  assert.equal(parseBetaTripArgs(href), null);
});

test("copenhagenLocalStampToIcsUtc: falls back to a UTC+1 offset when Intl doesn't report a GMT offset", () => {
  const { copenhagenLocalStampToIcsUtc } = load({
    extraGlobals: {
      Intl: {
        DateTimeFormat: class {
          formatToParts() {
            return [{ type: "timeZoneName", value: "Central European Time" }];
          }
        },
      },
    },
  });
  const year = new Date().getFullYear();
  assert.equal(copenhagenLocalStampToIcsUtc(`${year}01151200`), `${year}0115T110000Z`);
});

test("feature flags: productionSite and betaSite default to enabled", () => {
  const { isFeatureEnabled } = load();
  assert.equal(isFeatureEnabled("productionSite"), true);
  assert.equal(isFeatureEnabled("betaSite"), true);
});

test("feature flags: setFeatureFlagEnabled persists a per-flag override via GM_setValue", () => {
  const { isFeatureEnabled, setFeatureFlagEnabled, getFeatureFlagOverrides } = load();

  setFeatureFlagEnabled("betaSite", false);

  assert.equal(isFeatureEnabled("betaSite"), false);
  assert.equal(isFeatureEnabled("productionSite"), true, "unrelated flag is untouched");
  assert.deepEqual({ ...getFeatureFlagOverrides() }, { betaSite: false });
});

test("menu commands: debug + both feature-flag toggles are registered, and toggling one re-registers with an updated label", () => {
  const gmStubs = createGMStubs();
  loadUserScript(SCRIPT_PATH, { gm: gmStubs });

  assert.equal(gmStubs.commands.size, 3);
  const labels = [...gmStubs.commands.values()].map((c) => c.label);
  assert.ok(labels.some((l) => /^Debug logging: OFF/.test(l)));
  assert.ok(labels.some((l) => /^Production site quick-add: ON/.test(l)));
  assert.ok(labels.some((l) => /^Beta site quick-add: ON/.test(l)));

  const [, betaCommand] = [...gmStubs.commands.entries()].find(([, c]) =>
    c.label.startsWith("Beta site quick-add"),
  );
  betaCommand.callback();

  assert.equal(gmStubs.commands.size, 3, "the stale command is unregistered, not left dangling");
  const [, updatedBeta] = [...gmStubs.commands.entries()].find(([, c]) =>
    c.label.startsWith("Beta site quick-add"),
  );
  assert.match(updatedBeta.label, /Beta site quick-add: OFF/);
});

test("faIcon: builds a styled FontAwesome icon element", () => {
  const { faIcon } = load();
  const icon = faIcon("brands", "microsoft");
  assert.equal(icon.className, "fa-brands fa-microsoft");
  assert.equal(icon.getAttribute("aria-hidden"), "true");
  assert.equal(icon.style.marginRight, "6px");
});

test("makeQuickAddButton: builds a labeled quick-add anchor with the native secondary-button class", () => {
  const { makeQuickAddButton } = load();
  const btn = makeQuickAddButton("https://example.invalid/add", "Google Kalender", "google");

  assert.equal(btn.href, "https://example.invalid/add");
  assert.equal(btn.target, "_blank");
  assert.equal(btn.rel, "noopener noreferrer");
  assert.equal(btn.title, "Google Kalender");
  assert.equal(btn.getAttribute("aria-label"), "Google Kalender");
  assert.equal(btn.className, "hfs_btn hfs_btnPrimary hfs_calendarExportFormat");
  assert.equal(btn.children.length, 2);
  assert.equal(btn.children[0].className, "fa-brands fa-google");
  assert.equal(btn.children[1].textContent, "Google Kalender");
});

test("styleGemForGrid: applies grid layout styling and prepends a floppy-disk icon", () => {
  const { styleGemForGrid } = load();
  const icsAnchor = createElementStub("a");
  icsAnchor.textContent = "Gem";

  styleGemForGrid(icsAnchor);

  assert.equal(icsAnchor.style.width, "100%");
  assert.equal(icsAnchor.children.length, 1);
  assert.equal(icsAnchor.children[0].className, "fa-regular fa-floppy-disk");
});

test("makeQuickAddGrid: lays out buttons in a two-column grid, spanning the last button when the count is odd", () => {
  const { makeQuickAddGrid } = load();
  const buttons = [createElementStub("a"), createElementStub("a"), createElementStub("a")];

  const grid = makeQuickAddGrid(buttons);

  assert.equal(grid.style.gridTemplateColumns, "repeat(2, minmax(0, 1fr))");
  assert.equal(grid.children.length, 3);
  assert.equal(buttons[0].style.gridColumn, undefined);
  assert.equal(buttons[2].style.gridColumn, "1 / -1");
});

test("makeQuickAddGrid: leaves every button unspanned when the count is even", () => {
  const { makeQuickAddGrid } = load();
  const buttons = [createElementStub("a"), createElementStub("a")];
  makeQuickAddGrid(buttons);
  assert.equal(buttons[1].style.gridColumn, undefined);
});

test("wrapInExportRow: wraps content in a full-width col-xs-12 row", () => {
  const { wrapInExportRow } = load();
  const content = createElementStub("div");
  const row = wrapInExportRow(content);

  assert.equal(row.className, "col-xs-12");
  assert.equal(row.style.marginTop, "6px");
  assert.equal(row.children[0], content);
});

test("condenseOverlayText: shortens the step list and rewrites intro/more-info paragraphs in place", () => {
  const overlay = createElementStub("div");
  const [li1, li2, li3] = [createElementStub("li"), createElementStub("li"), createElementStub("li")];

  const introPara = createElementStub("div");
  introPara.querySelector = () => null;

  const moreInfoPara = createElementStub("div");
  const link = createElementStub("a");
  link.textContent = "her";
  const leadingText = { nodeType: 3, textContent: "Læs mere om hvilke kalendere ", remove() {} };
  moreInfoPara.children.push(leadingText);
  moreInfoPara.appendChild(link);
  moreInfoPara.querySelector = (sel) => (sel === "a" ? link : null);

  overlay.querySelectorAll = (sel) => {
    if (sel === ".hfs_decimalList > li") return [li1, li2, li3];
    if (sel === ".col-xs-12.hfs_noPadding") return [introPara, moreInfoPara];
    return [];
  };

  const { condenseOverlayText } = load();
  condenseOverlayText(overlay);

  assert.equal(li1.textContent, "Vælg en kalender nedenfor");
  assert.equal(li2.textContent, "Gem/åbn .ics-filen i din kalender");
  assert.equal(li3.textContent, "Tjek rejsen igen inden afgang");
  assert.equal(
    introPara.textContent,
    "Gemmes som en kalenderaftale med rejsedetaljer og link til rejseplanen.dk.",
  );

  const prefixNode = moreInfoPara.children.find((c) => c !== link && c !== leadingText);
  assert.ok(prefixNode, "a new prefix text node is inserted before the preserved link");
  assert.equal(prefixNode.textContent, "Mere info ");
  assert.ok(moreInfoPara.children.indexOf(prefixNode) < moreInfoPara.children.indexOf(link));
});

/**
 * Build a `.col-lg-12` row containing a "Gem" (.ics) anchor, nested inside an
 * overlay element, matching the DOM shape `injectQuickAddButtons` expects to
 * `closest()` its way up from the anchor.
 * @param {{onclick?: string, injected?: boolean}} [opts] - Specifies row/anchor options.
 * @returns {{overlay: object, row: object, icsAnchor: object}} Returns the built stub tree.
 */
function makeGemOverlayStub({ onclick, injected = false } = {}) {
  const overlay = createElementStub("div");
  overlay.className = "hfs_calendarExportOverlay";
  const row = createElementStub("div");
  row.className = "col-lg-12";
  if (injected) row.dataset[INJECTED_FLAG] = "1";
  const icsAnchor = createElementStub("a");
  if (onclick !== undefined) icsAnchor.setAttribute("onclick", onclick);
  row.appendChild(icsAnchor);
  overlay.appendChild(row);
  return { overlay, row, icsAnchor };
}

const SAMPLE_ONCLICK =
  "Hafas.Util.exportIcs({dateStart:'20240115T080000Z',dateEnd:'20240115T090000Z',description:'Fra%20A%20til%20B.',title:'A to B',location:''})";

test("injectQuickAddButtons: replaces the Gem row with a Gem + Google + Outlook x2 quick-add grid", () => {
  const { overlay, row, icsAnchor } = makeGemOverlayStub({ onclick: SAMPLE_ONCLICK });
  const { injectQuickAddButtons } = load();

  injectQuickAddButtons(icsAnchor);

  assert.equal(row.parentNode, null, "the original row is detached");
  assert.equal(overlay.children.length, 1);
  const gridRow = overlay.children[0];
  assert.equal(gridRow.className, "col-xs-12");
  assert.equal(gridRow.dataset[INJECTED_FLAG], "1");

  const grid = gridRow.children[0];
  assert.equal(grid.children.length, 4, "Gem, Google Kalender, Outlook.com, Outlook (M365)");
  assert.equal(grid.children[0], icsAnchor, "the Gem anchor is reused in place, not cloned");
});

test("injectQuickAddButtons: is a no-op when there's no enclosing .col-lg-12 row", () => {
  const icsAnchor = createElementStub("a");
  const { injectQuickAddButtons } = load();
  assert.doesNotThrow(() => injectQuickAddButtons(icsAnchor));
});

test("injectQuickAddButtons: is a no-op when the row is already flagged as injected", () => {
  const { row, icsAnchor } = makeGemOverlayStub({ onclick: SAMPLE_ONCLICK, injected: true });
  const { injectQuickAddButtons } = load();
  injectQuickAddButtons(icsAnchor);
  assert.equal(row.children.length, 1, "row is left untouched");
});

test("injectQuickAddButtons: is a no-op when the onclick attribute can't be parsed", () => {
  const { row, icsAnchor } = makeGemOverlayStub({ onclick: "someOtherFunction()" });
  const { injectQuickAddButtons } = load();
  injectQuickAddButtons(icsAnchor);
  assert.equal(row.children.length, 1, "row is left untouched");
});

test("injectQuickAddButtons: is a no-op when the onclick attribute is missing entirely", () => {
  const { row, icsAnchor } = makeGemOverlayStub();
  const { injectQuickAddButtons } = load();
  injectQuickAddButtons(icsAnchor);
  assert.equal(row.children.length, 1, "row is left untouched");
});

test("findBetaIcsListItem: finds the .ics list item by its visible title text among descendants", () => {
  const { findBetaIcsListItem } = load();

  const listItem = createElementStub("next-gen-list-item");
  const title = createElementStub("next-gen-list-item-title");
  title.textContent = "Download (.ics)";
  listItem.appendChild(title);

  const scope = createElementStub("div");
  scope.querySelectorAll = (sel) => (sel === "next-gen-list-item-title" ? [title] : []);
  scope.appendChild(listItem);

  assert.equal(findBetaIcsListItem(scope), listItem);
});

test("findBetaIcsListItem: matches when the scope itself is the title element", () => {
  const { findBetaIcsListItem } = load();
  const listItem = createElementStub("next-gen-list-item");
  const title = createElementStub("next-gen-list-item-title");
  title.textContent = ".ics download";
  listItem.appendChild(title);

  assert.equal(findBetaIcsListItem(title), listItem);
});

test("findBetaIcsListItem: returns null (not throwing) when the scope has no querySelectorAll at all", () => {
  const { findBetaIcsListItem } = load();
  const scope = { matches: () => false };
  assert.equal(findBetaIcsListItem(scope), null);
});

test("findBetaIcsListItem: skips a title with no textContent rather than throwing", () => {
  const { findBetaIcsListItem } = load();
  const title = createElementStub("next-gen-list-item-title");
  title.textContent = undefined;
  const scope = createElementStub("div");
  scope.querySelectorAll = (sel) => (sel === "next-gen-list-item-title" ? [title] : []);

  assert.equal(findBetaIcsListItem(scope), null);
});

test("findBetaIcsListItem: returns null when no descendant title matches the .ics label", () => {
  const { findBetaIcsListItem } = load();
  const title = createElementStub("next-gen-list-item-title");
  title.textContent = "Google Calendar";
  const scope = createElementStub("div");
  scope.querySelectorAll = (sel) => (sel === "next-gen-list-item-title" ? [title] : []);

  assert.equal(findBetaIcsListItem(scope), null);
});

test("makeBetaQuickAddRow: builds a self-styled row that opens the URL on click and on Enter/Space", () => {
  let openedUrl = null;
  const { makeBetaQuickAddRow } = loadUserScript(SCRIPT_PATH, {
    windowOpen: (url) => {
      openedUrl = url;
    },
  });

  const row = makeBetaQuickAddRow("Outlook.com", "https://outlook.live.com/add");

  assert.equal(row.getAttribute("aria-label"), "Outlook.com");
  assert.equal(row.children[1].textContent, "Outlook.com");

  row.click();
  assert.equal(openedUrl, "https://outlook.live.com/add");

  openedUrl = null;
  row.dispatch("keydown", { key: "Enter" });
  assert.equal(openedUrl, "https://outlook.live.com/add");

  openedUrl = null;
  row.dispatch("keydown", { key: "x" });
  assert.equal(openedUrl, null, "non-activating keys are ignored");

  row.dispatch("mouseenter");
  assert.equal(row.style.background, "#f1f3f4");
  row.dispatch("mouseleave");
  assert.equal(row.style.background, "");
});

test("injectBetaQuickAddButtons: inserts Outlook.com/M365 rows after the .ics list item's wrapper", () => {
  const wrapper = createElementStub("div");
  const listItem = createElementStub("next-gen-list-item");
  wrapper.appendChild(listItem);
  const parentOfWrapper = createElementStub("div");
  parentOfWrapper.appendChild(wrapper);

  const href =
    "https://www.rejseplanen.dk/webapp-nextgen/tp/connection-details/" +
    encodeURIComponent(`$${new Date().getFullYear()}01151200$${new Date().getFullYear()}01151300$tail==`) +
    "?start=" +
    encodeURIComponent("A=2@O=Odense H@H=25") +
    "&dest=" +
    encodeURIComponent("A=2@O=Aarhus H@H=25");

  const { injectBetaQuickAddButtons } = loadUserScript(SCRIPT_PATH, { href });
  injectBetaQuickAddButtons(listItem);

  assert.equal(wrapper.dataset[INJECTED_FLAG], "1");
  assert.equal(parentOfWrapper.children.length, 3, "wrapper + 2 inserted rows");
  assert.match(parentOfWrapper.children[1].getAttribute("aria-label"), /Outlook\.com/);
  assert.match(parentOfWrapper.children[2].getAttribute("aria-label"), /Outlook \(M365\)/);
});

test("injectBetaQuickAddButtons: is a no-op when the current URL can't be parsed as a trip", () => {
  const wrapper = createElementStub("div");
  const listItem = createElementStub("next-gen-list-item");
  wrapper.appendChild(listItem);
  const parentOfWrapper = createElementStub("div");
  parentOfWrapper.appendChild(wrapper);

  const { injectBetaQuickAddButtons } = loadUserScript(SCRIPT_PATH, {
    href: "https://www.rejseplanen.dk/webapp-nextgen/tp/search",
  });
  injectBetaQuickAddButtons(listItem);

  assert.equal(wrapper.dataset[INJECTED_FLAG], undefined);
  assert.equal(parentOfWrapper.children.length, 1);
});

test("injectBetaQuickAddButtons: is a no-op when already flagged as injected", () => {
  const wrapper = createElementStub("div");
  wrapper.dataset[INJECTED_FLAG] = "1";
  const listItem = createElementStub("next-gen-list-item");
  wrapper.appendChild(listItem);

  const { injectBetaQuickAddButtons } = load();
  assert.doesNotThrow(() => injectBetaQuickAddButtons(listItem));
});

test("handleAddedNode: ignores non-element nodes (e.g. text nodes)", () => {
  const { handleAddedNode } = load();
  assert.doesNotThrow(() => handleAddedNode({ nodeType: 3, textContent: "hi" }));
});

test("handleAddedNode: detects and injects a production-site Gem overlay node directly", () => {
  const { overlay, row, icsAnchor } = makeGemOverlayStub({ onclick: SAMPLE_ONCLICK });
  icsAnchor.matches = (sel) => sel === "a.hfs_calendarExportFormat.ics";

  const { handleAddedNode } = load();
  handleAddedNode(icsAnchor);

  assert.equal(row.parentNode, null, "production-site injection ran");
  assert.equal(overlay.children.length, 1);
});

test("handleAddedNode: detects a production-site Gem overlay nested inside an added node", () => {
  const { overlay, row, icsAnchor } = makeGemOverlayStub({ onclick: SAMPLE_ONCLICK });
  const container = createElementStub("div");
  container.querySelector = (sel) =>
    sel === "a.hfs_calendarExportFormat.ics" ? icsAnchor : null;

  const { handleAddedNode } = load();
  handleAddedNode(container);

  assert.equal(row.parentNode, null, "production-site injection ran via the nested anchor");
  assert.equal(overlay.children.length, 1);
});

test("handleAddedNode: skips the production-site path entirely when that feature flag is disabled", () => {
  const gmStubs = createGMStubs();
  gmStubs.GM_setValue("rejseplanenQuickAdd.featureFlags", { productionSite: false });
  const { overlay, row, icsAnchor } = makeGemOverlayStub({ onclick: SAMPLE_ONCLICK });
  icsAnchor.matches = (sel) => sel === "a.hfs_calendarExportFormat.ics";

  const { handleAddedNode } = loadUserScript(SCRIPT_PATH, { gm: gmStubs });
  handleAddedNode(icsAnchor);

  assert.equal(row.parentNode, overlay, "production-site injection was skipped");
});

test("handleAddedNode: detects a beta-site .ics list item nested inside an added node", () => {
  const wrapper = createElementStub("div");
  const listItem = createElementStub("next-gen-list-item");
  wrapper.appendChild(listItem);
  const parentOfWrapper = createElementStub("div");
  parentOfWrapper.appendChild(wrapper);

  const container = createElementStub("div");
  const title = createElementStub("next-gen-list-item-title");
  title.textContent = "Download (.ics)";
  listItem.appendChild(title);
  container.querySelectorAll = (sel) => (sel === "next-gen-list-item-title" ? [title] : []);

  const href =
    "https://www.rejseplanen.dk/webapp-nextgen/tp/connection-details/" +
    encodeURIComponent(`$${new Date().getFullYear()}01151200$${new Date().getFullYear()}01151300$tail==`) +
    "?start=" +
    encodeURIComponent("A=2@O=Odense H@H=25") +
    "&dest=" +
    encodeURIComponent("A=2@O=Aarhus H@H=25");

  const { handleAddedNode } = loadUserScript(SCRIPT_PATH, { href });
  handleAddedNode(container);

  assert.equal(wrapper.dataset[INJECTED_FLAG], "1");
  assert.equal(parentOfWrapper.children.length, 3);
});

test("debug toggle: GM_registerMenuCommand toggles DEBUG and re-registers with an updated label", () => {
  const gmStubs = createGMStubs();
  loadUserScript(SCRIPT_PATH, { gm: gmStubs });

  const [, debugCommand] = [...gmStubs.commands.entries()].find(([, c]) =>
    c.label.startsWith("Debug logging"),
  );
  assert.match(debugCommand.label, /Debug logging: OFF/);

  debugCommand.callback();

  assert.equal(gmStubs.GM_getValue("debug_logging", false), true);
  assert.equal(gmStubs.commands.size, 3, "the stale command is unregistered, not left dangling");
  const [, updated] = [...gmStubs.commands.entries()].find(([, c]) =>
    c.label.startsWith("Debug logging"),
  );
  assert.match(updated.label, /Debug logging: ON/);

  // Toggle back off, to exercise the re-registration ternary's other arm.
  updated.callback();
  assert.equal(gmStubs.GM_getValue("debug_logging", false), false);
  const [, offAgain] = [...gmStubs.commands.entries()].find(([, c]) =>
    c.label.startsWith("Debug logging"),
  );
  assert.match(offAgain.label, /Debug logging: OFF/);
});

test("debug toggle: the initial menu label reflects a pre-existing 'ON' debug_logging value", () => {
  const gmStubs = createGMStubs();
  gmStubs.GM_setValue("debug_logging", true);
  loadUserScript(SCRIPT_PATH, { gm: gmStubs });

  const [, debugCommand] = [...gmStubs.commands.entries()].find(([, c]) =>
    c.label.startsWith("Debug logging"),
  );
  assert.match(debugCommand.label, /Debug logging: ON/);
});

test("feature flag toggle: GM_registerMenuCommand toggles a flag and re-registers with an updated label, both ways", () => {
  const gmStubs = createGMStubs();
  loadUserScript(SCRIPT_PATH, { gm: gmStubs });

  const findBetaCommand = () =>
    [...gmStubs.commands.entries()].find(([, c]) => c.label.startsWith("Beta site quick-add"));

  const [, betaCommand] = findBetaCommand();
  assert.match(betaCommand.label, /: ON/);

  betaCommand.callback();
  const [, offCommand] = findBetaCommand();
  assert.match(offCommand.label, /: OFF/);

  offCommand.callback();
  const [, onAgainCommand] = findBetaCommand();
  assert.match(onAgainCommand.label, /: ON/);
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
    const { handleAddedNode } = loadUserScript(SCRIPT_PATH, { gm: gmStubs });

    const { icsAnchor } = makeGemOverlayStub({ onclick: SAMPLE_ONCLICK });
    icsAnchor.matches = (sel) => sel === "a.hfs_calendarExportFormat.ics";
    handleAddedNode(icsAnchor); // dbg (production site: Gem overlay detected)

    const { icsAnchor: badAnchor } = makeGemOverlayStub({ onclick: "not parseable" });
    badAnchor.matches = (sel) => sel === "a.hfs_calendarExportFormat.ics";
    handleAddedNode(badAnchor); // dbgWarn (line 460, unparseable onclick)

    assert.ok(calls.debug >= 1, "dbg logged for the production-site path");
    assert.ok(calls.warn >= 1, "dbgWarn logged");

    const listItem = createElementStub("next-gen-list-item");
    const title = createElementStub("next-gen-list-item-title");
    title.textContent = "Download (.ics)";
    listItem.appendChild(title);
    listItem.matches = () => false;
    listItem.querySelectorAll = (sel) => (sel === "next-gen-list-item-title" ? [title] : []);
    const href =
      "https://www.rejseplanen.dk/webapp-nextgen/tp/connection-details/" +
      encodeURIComponent(`$${new Date().getFullYear()}01151200$${new Date().getFullYear()}01151300$tail==`) +
      "?start=" +
      encodeURIComponent("A=2@O=Odense H@H=25") +
      "&dest=" +
      encodeURIComponent("A=2@O=Aarhus H@H=25");
    const betaGmStubs = createGMStubs();
    betaGmStubs.GM_setValue("debug_logging", true);
    const { handleAddedNode: handleAddedNodeBeta } = loadUserScript(SCRIPT_PATH, {
      gm: betaGmStubs,
      href,
    });
    handleAddedNodeBeta(listItem); // dbg (beta site: Download (.ics) row detected)

    assert.ok(calls.debug >= 2, "dbg logged for both production and beta paths");
  } finally {
    console.debug = originalDebug;
    console.warn = originalWarn;
  }
});

test("parseBetaTripArgs: returns null when the href itself can't be parsed as a URL", () => {
  const { parseBetaTripArgs } = load();
  assert.equal(parseBetaTripArgs("not a url at all"), null);
});

test("parseBetaTripArgs: returns null when the ctx path segment has an invalid percent-encoding", () => {
  const { parseBetaTripArgs } = load();
  const href =
    "https://www.rejseplanen.dk/webapp-nextgen/tp/connection-details/%E0%A4%A" +
    "?start=" +
    encodeURIComponent("A=2@O=Odense H@H=25") +
    "&dest=" +
    encodeURIComponent("A=2@O=Aarhus H@H=25");
  assert.equal(parseBetaTripArgs(href), null);
});

test("overlayObserver: processes each mutation batch's added nodes via handleAddedNode", () => {
  const { overlay, row, icsAnchor } = (function () {
    const overlayEl = createElementStub("div");
    overlayEl.className = "hfs_calendarExportOverlay";
    const rowEl = createElementStub("div");
    rowEl.className = "col-lg-12";
    const anchor = createElementStub("a");
    anchor.setAttribute(
      "onclick",
      "Hafas.Util.exportIcs({dateStart:'20240115T080000Z',dateEnd:'20240115T090000Z',description:'Fra%20A%20til%20B.',title:'A to B',location:''})",
    );
    anchor.matches = (sel) => sel === "a.hfs_calendarExportFormat.ics";
    rowEl.appendChild(anchor);
    overlayEl.appendChild(rowEl);
    return { overlay: overlayEl, row: rowEl, icsAnchor: anchor };
  })();

  const moStub = createMutationObserverStub();
  loadUserScript(SCRIPT_PATH, { mutationObserver: moStub });

  assert.equal(moStub.instances.length, 1, "one overlay observer is created at load");
  const [observer] = moStub.instances;

  observer.callback([{ addedNodes: [icsAnchor] }]);

  assert.equal(row.parentNode, null, "the mutation batch was routed through handleAddedNode");
  assert.equal(overlay.children.length, 1);
});
