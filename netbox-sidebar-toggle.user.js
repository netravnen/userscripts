// ==UserScript==
// @name         NetBox sidebar toggle
// @namespace    https://netboxlabs.com/
// @version      1.2.0
// @description  Adds a button to the left of NetBox's header search field to collapse/expand the left sidebar, remembering the state across page loads. Works on any NetBox instance - configure the hostname via the Tampermonkey menu on first run.
// @author       netravnen
// @match        *://*/*
// @icon         https://icons.duckduckgo.com/ip2/netboxlabs.com.ico
// @license      MIT
// @updateURL    https://github.com/netravnen/userscripts/raw/refs/heads/main/netbox-sidebar-toggle.meta.js
// @downloadURL  https://github.com/netravnen/userscripts/raw/refs/heads/main/netbox-sidebar-toggle.user.js
// @supportURL   https://github.com/netravnen/userscripts/issues
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @run-at       document-idle
// @noframes
// ==/UserScript==

/**
 * Add a sidebar-collapse toggle button to NetBox's own top header, placed
 * immediately to the left of NetBox's built-in search field, and persist
 * the collapsed/expanded state across page loads.
 *
 * The `@match` is intentionally unscoped (any scheme, any host, any path)
 * because a self-hosted NetBox instance can live at any hostname - this file
 * must not hardcode one. To keep that broad match from doing anything on
 * non-NetBox sites, every code path below is gated on `isNetBoxPage()`,
 * which fingerprints NetBox's own `data-netbox-version` attribute on
 * `<html>`. The script only runs its sidebar logic once a hostname has been
 * confirmed via the `GM_registerMenuCommand` prompt (auto-suggesting the
 * current hostname).
 * @returns {void} Returns nothing.
 */
(function () {
  "use strict";

  const NETBOX_MARKER_SELECTOR = "html[data-netbox-version]";
  const SIDEBAR_SELECTOR = "aside.navbar-vertical";
  const PAGE_WRAPPER_SELECTOR = ".page-wrapper";
  const TOP_HEADER_SELECTOR = "header.navbar";
  // Scoped to `header.navbar` because the mobile sidebar carries its own
  // `form[action="/search/"]` (inside `aside`, not `header`); this selector
  // only ever matches the desktop header's search form.
  const SEARCH_FORM_SELECTOR = 'header.navbar form[action="/search/"]';
  const TOGGLE_BUTTON_ID = "nb-sidebar-toggle-button";
  // Matches NetBox's own `aside.navbar-vertical.navbar-expand-lg` transition
  // duration (confirmed in the compiled stylesheet: `transition:transform
  // .3s`), so the content reflow animates in lockstep with the sidebar
  // instead of visibly lagging or leading it.
  const TRANSITION = "0.3s ease";
  const MAX_INIT_RETRIES = 10;

  const DEBUG_STORAGE_KEY = "debug_logging";
  const HOSTNAME_STORAGE_KEY = "netbox_hostname";
  const SIDEBAR_HIDDEN_STORAGE_KEY = "sidebar_hidden";

  /**
   * Detect whether the current page is a NetBox instance, via the
   * `data-netbox-version` attribute NetBox itself renders on `<html>`.
   * @returns {boolean} Returns true when the page fingerprints as NetBox.
   */
  function isNetBoxPage() {
    return !!document.querySelector(NETBOX_MARKER_SELECTOR);
  }

  // Every other code path in this script - debug logging, the hostname
  // menu command, the sidebar toggle itself - only makes sense (and should
  // only ever register a Tampermonkey menu command) on an actual NetBox
  // page, given the broad `@match` above.
  if (!isNetBoxPage()) return;

  let DEBUG = GM_getValue(DEBUG_STORAGE_KEY, false);

  /** @returns {void} Returns nothing. */
  function dbg(...args) { if (DEBUG) console.debug("[netbox-sidebar-toggle]", ...args); }
  /** @returns {void} Returns nothing. */
  function dbgWarn(...args) { if (DEBUG) console.warn("[netbox-sidebar-toggle]", ...args); }

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

  /**
   * @returns {string} Returns the hostname this script is currently
   * configured to run on, or "" when unconfigured.
   */
  function getConfiguredHostname() {
    return GM_getValue(HOSTNAME_STORAGE_KEY, "");
  }

  /**
   * @param {string} hostname - Specifies the hostname to persist.
   * @returns {void} Returns nothing.
   */
  function setConfiguredHostname(hostname) {
    GM_setValue(HOSTNAME_STORAGE_KEY, hostname);
  }

  /**
   * @returns {boolean} Returns true when a hostname has been configured and
   * it matches the current page's hostname.
   */
  function isEnabledForCurrentHost() {
    const configured = getConfiguredHostname();
    return !!configured && configured === location.hostname;
  }

  /**
   * On the first NetBox page load with no hostname configured yet, ask the
   * user to confirm the hostname this script should activate on, defaulting
   * to the current one. Necessary because the shipped script has no
   * hardcoded instance to fall back on.
   * @returns {void} Returns nothing.
   */
  function ensureHostnameConfigured() {
    if (getConfiguredHostname()) return;
    if (typeof prompt !== "function") return;
    const answer = prompt("NetBox sidebar toggle: which hostname should this run on?", location.hostname);
    if (!answer) return;
    const trimmed = answer.trim();
    if (trimmed) setConfiguredHostname(trimmed);
  }

  /** @returns {string} Returns the current hostname menu command label. */
  function hostnameMenuLabel() {
    return `NetBox sidebar toggle host: ${getConfiguredHostname() || "not set"}`;
  }

  let hostnameMenuId = GM_registerMenuCommand(hostnameMenuLabel(), function changeHostname() {
    if (typeof prompt !== "function") return;
    const answer = prompt("NetBox sidebar toggle: which hostname should this run on?", getConfiguredHostname() || location.hostname);
    if (answer === null) return;
    setConfiguredHostname(answer.trim());
    if (typeof GM_unregisterMenuCommand === "function") GM_unregisterMenuCommand(hostnameMenuId);
    hostnameMenuId = GM_registerMenuCommand(hostnameMenuLabel(), changeHostname);
  });

  /** @returns {boolean} Returns true when the sidebar is currently collapsed. */
  function isSidebarHidden() {
    return !!GM_getValue(SIDEBAR_HIDDEN_STORAGE_KEY, false);
  }

  /**
   * Slide the sidebar off-screen (or back into view) and reclaim (or
   * restore) the horizontal space it was pushing the header/content over
   * by, purely via inline styles - no dependency on NetBox's own
   * `data-sidenav-*` body attributes, whose exact CSS mechanics aren't
   * something this script can rely on across NetBox versions. (Confirmed
   * against NetBox's own compiled stylesheet: at the lg breakpoint the
   * sidebar is `position:fixed; left:0; width:18rem`, and `.page-wrapper`/
   * `header.navbar` pick up `margin-left:18rem` purely via a `~` sibling
   * CSS combinator - an inline style on those two elements is enough to
   * override that with no `!important` needed.)
   * @param {boolean} hidden - Specifies whether the sidebar should be hidden.
   * @returns {boolean} Returns true when the sidebar element was found and updated.
   */
  function applyHiddenState(hidden) {
    const aside = document.querySelector(SIDEBAR_SELECTOR);
    if (!aside) return false;

    aside.style.transition = `transform ${TRANSITION}`;
    aside.style.transform = hidden ? "translateX(-100%)" : "";
    if (hidden) aside.setAttribute("aria-hidden", "true");
    else aside.removeAttribute("aria-hidden");
    aside.inert = hidden;

    [document.querySelector(PAGE_WRAPPER_SELECTOR), document.querySelector(TOP_HEADER_SELECTOR)]
      .filter(Boolean)
      .forEach((el) => {
        el.style.transition = `margin-left ${TRANSITION}`;
        el.style.marginLeft = hidden ? "0px" : "";
      });

    return true;
  }

  /**
   * Persist the collapsed/expanded state, apply it to the page, and sync
   * the toggle button's icon/labels to match.
   * @param {boolean} hidden - Specifies whether the sidebar should be hidden.
   * @returns {void} Returns nothing.
   */
  function setSidebarHidden(hidden) {
    GM_setValue(SIDEBAR_HIDDEN_STORAGE_KEY, hidden);
    applyHiddenState(hidden);
    const btn = document.getElementById(TOGGLE_BUTTON_ID);
    if (btn) updateToggleButton(btn, hidden);
    dbg("sidebar", hidden ? "hidden" : "shown");
  }

  /** @returns {void} Returns nothing. */
  function handleToggleClick() {
    setSidebarHidden(!isSidebarHidden());
  }

  /**
   * Sync the toggle button's icon and accessible labels to the given
   * state, using the standard `mdi-chevron-left`/`mdi-chevron-right` pair
   * (already in NetBox's own Material Design Icons font) to signal which
   * direction the sidebar will move on the next click.
   * @param {Element} btn - Specifies the toggle button element.
   * @param {boolean} hidden - Specifies whether the sidebar is currently hidden.
   * @returns {void} Returns nothing.
   */
  function updateToggleButton(btn, hidden) {
    const icon = btn.firstChild;
    const label = hidden ? "Show sidebar" : "Hide sidebar";
    if (icon) icon.className = hidden ? "mdi mdi-chevron-right" : "mdi mdi-chevron-left";
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label);
    btn.setAttribute("data-bs-original-title", label);
  }

  /**
   * Build the toggle button as a plain header icon button, reusing NetBox's
   * own `nav-link fs-2 p-0 text-secondary` classes - the same ones its
   * color-mode-toggle buttons use - so it reads as a native part of the
   * header rather than an injected overlay.
   * @returns {Element} Returns the unattached button element.
   */
  function createToggleButton() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = TOGGLE_BUTTON_ID;
    btn.className = "nav-link fs-2 p-0 text-secondary";
    btn.setAttribute("data-bs-toggle", "tooltip");
    btn.setAttribute("data-bs-placement", "bottom");
    btn.appendChild(document.createElement("i"));
    btn.addEventListener("click", handleToggleClick);
    updateToggleButton(btn, isSidebarHidden());
    return btn;
  }

  /**
   * Insert the toggle button as the search form's immediate previous
   * sibling, so it renders directly to the left of NetBox's own header
   * search field.
   * @returns {boolean} Returns true when the button was inserted (or already present).
   */
  function injectToggleButton() {
    if (document.getElementById(TOGGLE_BUTTON_ID)) return true;
    const searchForm = document.querySelector(SEARCH_FORM_SELECTOR);
    if (!searchForm || !searchForm.parentNode) return false;

    searchForm.parentNode.insertBefore(createToggleButton(), searchForm);
    return true;
  }

  /**
   * @returns {boolean} Returns true once the button is injected and the
   * persisted collapsed/expanded state has been applied.
   */
  function init() {
    if (!injectToggleButton()) return false;
    applyHiddenState(isSidebarHidden());
    return true;
  }

  ensureHostnameConfigured();

  if (isEnabledForCurrentHost()) {
    if (!init()) {
      let initRetryCount = 0;
      const retryObserver = new MutationObserver(function retryOnMutation() {
        initRetryCount += 1;
        if (init() || initRetryCount >= MAX_INIT_RETRIES) {
          if (initRetryCount >= MAX_INIT_RETRIES) dbgWarn("gave up after", MAX_INIT_RETRIES, "retries");
          retryObserver.disconnect();
        }
      });
      retryObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  // No-op in Tampermonkey (no CommonJS `module` global there); lets
  // node:test load the pure functions above directly from this file.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      isNetBoxPage,
      getConfiguredHostname,
      setConfiguredHostname,
      isEnabledForCurrentHost,
      ensureHostnameConfigured,
      isSidebarHidden,
      setSidebarHidden,
      applyHiddenState,
      updateToggleButton,
      createToggleButton,
      injectToggleButton,
      init,
      handleToggleClick,
    };
  }
})();
