// ==UserScript==
// @name         Viessmann-modell.com article number in tab title
// @namespace    https://viessmann-modell.com/
// @version      1.4.0
// @description  Set the tab title to the product's article number, name, and breadcrumb range on Viessmann-modell.com product pages
// @author       netravnen
// @match        https://viessmann-modell.com/en/product-range/electronics/*
// @match        https://viessmann-modell.com/en/electronic/electronics-digital/*
// @icon         https://icons.duckduckgo.com/ip2/viessmann-modell.com.ico
// @license      MIT
// @updateURL    https://github.com/netravnen/userscripts/raw/refs/heads/main/viessmann-modell-tab-title.meta.js
// @downloadURL  https://github.com/netravnen/userscripts/raw/refs/heads/main/viessmann-modell-tab-title.user.js
// @supportURL   https://github.com/netravnen/userscripts/issues
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @run-at       document-idle
// @noframes
// ==/UserScript==

/**
 * Set the tab title on Viessmann-modell.com product pages to
 * "Viessmann <article no> | <product name> | <breadcrumb range> |
 * viessmann-modell.com", so open tabs are distinguishable at a glance.
 * @returns {void} Returns nothing.
 */
(function () {
  "use strict";

  const PRODUCT_TITLE_SELECTOR = ".cms-element-product-name h1";
  // The page renders the breadcrumb twice (the theme's own header
  // breadcrumb, plus a duplicate CMS content-block breadcrumb further down
  // the same layout) - scope to the first nav found so the range isn't
  // doubled.
  const BREADCRUMB_NAV_SELECTOR = 'nav[aria-label="breadcrumb"]';
  const BREADCRUMB_TITLE_SELECTOR = ".breadcrumb-title";
  const SEPARATOR = " | ";
  const MAX_INIT_RETRIES = 10;

  const DEBUG_STORAGE_KEY = "debug_logging";
  let DEBUG = GM_getValue(DEBUG_STORAGE_KEY, false);

  /** @returns {void} Returns nothing. */
  function dbgInfo(...args) { if (DEBUG) console.info("[viessmann-tab-title]", ...args); }
  /** @returns {void} Returns nothing. */
  function dbgWarn(...args) { if (DEBUG) console.warn("[viessmann-tab-title]", ...args); }

  /**
   * Unregister and re-register the debug-logging menu command so its
   * ON/OFF label reflects the current state immediately, rather than
   * staying stale until the page reloads.
   * @returns {void} Returns nothing.
   */
  let debugToggleId = GM_registerMenuCommand(`Debug logging: ${DEBUG ? "ON" : "OFF"}`, function toggleDebugLogging() {
    DEBUG = !DEBUG;
    GM_setValue(DEBUG_STORAGE_KEY, DEBUG);
    if (typeof GM_unregisterMenuCommand === "function") GM_unregisterMenuCommand(debugToggleId);
    debugToggleId = GM_registerMenuCommand(`Debug logging: ${DEBUG ? "ON" : "OFF"}`, toggleDebugLogging);
  });

  /** @type {number} */
  let initRetryCount = 0;
  /** @type {string|null} */
  let expectedTitle = null;
  /** @type {boolean} */
  let titleGuardStarted = false;

  /**
   * Extract the product's article number, which is the leading token of the
   * page title element's own text (e.g. "5225 5A Power module" -> "5225").
   * There is no separate article-number element on the current site markup.
   * @returns {string|null} Returns the article number, or null when not found.
   */
  function extractItemNo() {
    const el = document.querySelector(PRODUCT_TITLE_SELECTOR);
    if (!el) return null;
    const match = el.innerText.trim().match(/^(\S+)/);
    return match ? match[1] : null;
  }

  /**
   * Extract the product name by stripping the article number out of the
   * page title element's own text.
   * @param {Element} titleEl - Specifies the product title element.
   * @param {string} itemNo - Specifies the already-extracted article number.
   * @returns {string} Returns the trimmed product name.
   */
  function extractItemName(titleEl, itemNo) {
    return titleEl.innerText.replace(itemNo, "").trim();
  }

  /**
   * Build the "Category > Sub-category > #ArticleNo" breadcrumb range string
   * from the page's breadcrumb navigation links.
   * @param {string} itemNo - Specifies the product's article number.
   * @returns {string} Returns the breadcrumb range string.
   */
  function buildBreadcrumbRange(itemNo) {
    const nav = document.querySelector(BREADCRUMB_NAV_SELECTOR);
    const crumbs = nav
      ? Array.from(nav.querySelectorAll(BREADCRUMB_TITLE_SELECTOR))
          .map((el) => el.innerText.trim())
          .filter(Boolean)
      : [];
    crumbs.push("#" + itemNo);
    return crumbs.join(" > ");
  }

  /**
   * Evaluate whether the product title and article number are present on
   * the page, and set `document.title` from them once they are.
   * @returns {boolean} Returns true if the title was set.
   */
  function setPageTitle() {
    const titleEl = document.querySelector(PRODUCT_TITLE_SELECTOR);
    if (!titleEl) return false;

    const itemNo = extractItemNo();
    if (!itemNo) return false;

    const itemName = extractItemName(titleEl, itemNo);
    const itemRange = buildBreadcrumbRange(itemNo);

    expectedTitle = [
      "Viessmann " + itemNo,
      itemName,
      itemRange,
      "viessmann-modell.com",
    ].join(SEPARATOR);
    document.title = expectedTitle;

    dbgInfo("tab title set to", expectedTitle);
    startTitleGuard();
    return true;
  }

  /**
   * The site's own scripts (SPA hydration, analytics/consent tooling) can
   * overwrite `document.title` shortly after this script sets it. Watch the
   * `<title>` element and re-apply our value whenever something else
   * changes it, instead of setting it once and trusting it to stick.
   * Starts at most once, on the first successful `setPageTitle()`.
   * @returns {void} Returns nothing.
   */
  function startTitleGuard() {
    if (titleGuardStarted) return;
    const titleEl = document.querySelector("title");
    if (!titleEl) return;
    titleGuardStarted = true;

    const titleGuardObserver = new MutationObserver(function reapplyTitle() {
      if (expectedTitle && document.title !== expectedTitle) {
        dbgWarn("page reset the tab title; re-applying", expectedTitle);
        document.title = expectedTitle;
      }
    });
    titleGuardObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
  }

  if (!setPageTitle()) {
    const retryObserver = new MutationObserver(function retryOnMutation() {
      initRetryCount += 1;
      if (setPageTitle() || initRetryCount >= MAX_INIT_RETRIES) {
        if (initRetryCount >= MAX_INIT_RETRIES) dbgWarn("gave up after", MAX_INIT_RETRIES, "retries");
        retryObserver.disconnect();
      }
    });
    retryObserver.observe(document.body, { childList: true, subtree: true });
  }

  // No-op in Tampermonkey (no CommonJS `module` global there); lets
  // node:test load the pure functions above directly from this file.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { extractItemNo, extractItemName, buildBreadcrumbRange, setPageTitle, startTitleGuard };
  }
})();
