"use strict";

const fs = require("node:fs");
const vm = require("node:vm");
const { URL, URLSearchParams } = require("node:url");

/**
 * Minimal DOM Node type-constant stub (`Node.TEXT_NODE`/`Node.ELEMENT_NODE`),
 * for scripts that branch on `node.nodeType === Node.TEXT_NODE` without
 * needing a full DOM Node implementation.
 */
const NodeConstants = Object.freeze({ ELEMENT_NODE: 1, TEXT_NODE: 3 });

/**
 * Marker base class for element stubs, exposed to sandboxed scripts as the
 * `HTMLElement` global — every `createElementStub()` instance has this as
 * its prototype, so a script's own `node instanceof HTMLElement` guard
 * (e.g. filtering MutationObserver `addedNodes`) evaluates correctly
 * against the exact same class reference on both sides.
 */
class HTMLElementStub {}

/**
 * Build a real (non-no-op) `addEventListener`/`removeEventListener`/
 * `dispatch` trio backed by a per-type listener array, shared by both the
 * element stub and the document stub so code that wires up listeners on
 * `document` directly (drag-handling `mousemove`/`mouseup`, delegated
 * clicks, etc.) is just as testable as element-level listeners.
 * @returns {{addEventListener: Function, removeEventListener: Function, dispatch: Function}} Returns the listener-bookkeeping trio.
 */
function createEventListenerMixin() {
  const listeners = {};
  return {
    addEventListener(type, listener) {
      (listeners[type] || (listeners[type] = [])).push(listener);
    },
    removeEventListener(type, listener) {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((l) => l !== listener);
    },
    /**
     * Synchronously invoke every listener registered for `type`, matching
     * an `Event`-like shape (`type`, no-op `preventDefault`/`stopPropagation`).
     * @param {string} type - Specifies the event type (e.g. "click").
     * @param {object} [eventOverrides] - Specifies additional event fields/overrides.
     * @returns {object} Returns the synthetic event object passed to listeners.
     */
    dispatch(type, eventOverrides) {
      const event = { type, preventDefault() {}, stopPropagation() {}, ...eventOverrides };
      (listeners[type] || []).slice().forEach((listener) => listener(event));
      return event;
    },
  };
}

/**
 * No-op MutationObserver stub: enough for scripts that only construct one
 * and call `.observe(...)`/`.disconnect()` without needing the callback to
 * actually fire during tests.
 */
class StubMutationObserver {
  constructor(callback) {
    this.callback = callback;
  }
  observe() {}
  disconnect() {}
}

/**
 * Create a fresh MutationObserver stub class that records every instance
 * constructed under it (in `.instances`, in construction order), so a test
 * can grab the observer a script created internally (e.g. a load-time retry
 * observer, a local variable it never exposes) and invoke `.callback(...)`
 * directly to exercise code that only runs when the browser would actually
 * fire a mutation. Scoped per-call (not a shared static registry) so
 * instances from one test/load don't leak into another sharing the process.
 * @returns {{MutationObserver: Function, instances: object[]}} Returns the class plus its instance registry.
 */
function createMutationObserverStub() {
  const instances = [];
  class TrackedMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      instances.push(this);
    }
    observe() {}
    disconnect() {
      this.disconnected = true;
    }
  }
  return { MutationObserver: TrackedMutationObserver, instances };
}

/**
 * Create controllable fake `setTimeout`/`setInterval` stubs: scheduling a
 * callback records it instead of ever invoking it (so tests can assert on
 * state immediately after a click handler runs, before any timer fires),
 * and `.flush()` synchronously invokes and clears every still-pending
 * callback once, in registration order — enough to exercise reset-after-N-ms
 * UI code without real elapsed time or a real Node timer that could leak
 * past the test.
 * @returns {{setTimeout: Function, clearTimeout: Function, setInterval: Function, clearInterval: Function, flush: Function}} Returns the timer stub functions plus `.flush()`.
 */
function createTimerStubs() {
  const pending = new Map();
  let nextId = 1;
  return {
    setTimeout(callback) {
      const id = nextId++;
      pending.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    setInterval(callback) {
      const id = nextId++;
      pending.set(id, callback);
      return id;
    },
    clearInterval(id) {
      pending.delete(id);
    },
    flush() {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}

/**
 * Create a minimal, mutable fake DOM element: `style`/`dataset` as plain
 * objects, `setAttribute`/`getAttribute` backed by a plain map, and
 * `appendChild`/`insertBefore`/`removeChild`/`insertAdjacentElement`
 * operating on a real backing array — enough for panel-building code
 * (`createElement` → configure → `appendChild`) to run to completion
 * without throwing, without emulating full DOM/CSSOM semantics.
 * @param {string} [tagName] - Specifies the element's tag name.
 * @returns {object} Returns a mutable element stub.
 */
function createElementStub(tagName) {
  const children = [];
  const attributes = {};
  const eventMixin = createEventListenerMixin();
  /**
   * Mimic real DOM move semantics: inserting a node that already has a
   * parent implicitly detaches it from that parent first, rather than
   * leaving a stale duplicate reference behind in the old parent's children.
   * @param {object} child - Specifies the node about to be (re)inserted.
   * @returns {void} Returns nothing.
   */
  function detachFromCurrentParent(child) {
    if (child.parentNode && typeof child.parentNode.removeChild === "function") {
      child.parentNode.removeChild(child);
    }
  }
  const el = {
    tagName: (tagName || "").toUpperCase(),
    style: {},
    dataset: {},
    className: "",
    textContent: "",
    innerText: "",
    value: "",
    id: "",
    offsetWidth: 0,
    children,
    childNodes: children,
    setAttribute(name, value) {
      attributes[name] = String(value);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null;
    },
    removeAttribute(name) {
      delete attributes[name];
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name);
    },
    appendChild(child) {
      detachFromCurrentParent(child);
      children.push(child);
      child.parentNode = el;
      return child;
    },
    insertBefore(child, ref) {
      detachFromCurrentParent(child);
      const idx = ref ? children.indexOf(ref) : -1;
      if (idx === -1) children.push(child);
      else children.splice(idx, 0, child);
      child.parentNode = el;
      return child;
    },
    removeChild(child) {
      const idx = children.indexOf(child);
      if (idx !== -1) children.splice(idx, 1);
      child.parentNode = null;
      return child;
    },
    /**
     * Position-aware insert: `beforebegin`/`afterend` insert `child` as a
     * sibling of this element (in its parent's children); `afterbegin`/
     * `beforeend` insert as this element's first/last child.
     * @param {string} position - Specifies one of the four standard positions.
     * @param {object} child - Specifies the node to insert.
     * @returns {object} Returns the inserted node.
     */
    insertAdjacentElement(position, child) {
      detachFromCurrentParent(child);
      const parent = el.parentNode;
      if ((position === "beforebegin" || position === "afterend") && Array.isArray(parent?.children)) {
        const idx = parent.children.indexOf(el);
        parent.children.splice(position === "beforebegin" ? idx : idx + 1, 0, child);
        child.parentNode = parent;
      } else if (position === "afterbegin") {
        children.unshift(child);
        child.parentNode = el;
      } else {
        children.push(child);
        child.parentNode = el;
      }
      return child;
    },
    insertAdjacentText() {},
    /**
     * Replace this element, in place, within its parent's children.
     * @param {object} newNode - Specifies the replacement node.
     * @returns {void} Returns nothing.
     */
    replaceWith(newNode) {
      if (!el.parentNode || !Array.isArray(el.parentNode.children)) return;
      const parent = el.parentNode;
      const idx = parent.children.indexOf(el);
      if (idx === -1) return;
      parent.children.splice(idx, 1, newNode);
      newNode.parentNode = parent;
      el.parentNode = null;
    },
    /** @returns {void} Returns nothing. */
    remove() {
      if (el.parentNode && typeof el.parentNode.removeChild === "function") {
        el.parentNode.removeChild(el);
      }
    },
    // Real listener bookkeeping (unlike the rest of this stub) so tests can
    // exercise click-handler logic — the bulk of these scripts' behavior —
    // via `el.dispatch("click")`/`el.click()` instead of needing a full
    // synthetic-event/browser-event-loop implementation.
    ...eventMixin,
    click() {
      el.dispatch("click");
    },
    focus() {},
    blur() {},
    select() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    /**
     * Minimal selector matcher: exact tag name (case-insensitive), a single
     * `.class`, or a single `#id`. No compound/combinator support — tests
     * needing more override `matches`/`querySelector(All)` directly, as
     * established elsewhere in this file.
     * @param {string} selector - Specifies a simple CSS selector.
     * @returns {boolean} Returns true when this element matches.
     */
    matches(selector) {
      if (!selector) return false;
      if (selector.startsWith(".")) {
        return (el.className || "").split(/\s+/).includes(selector.slice(1));
      }
      if (selector.startsWith("#")) return el.id === selector.slice(1);
      return el.tagName.toLowerCase() === selector.toLowerCase();
    },
    /**
     * Walk `parentNode` up from this element (inclusive), returning the
     * first ancestor matching `selector` via `.matches()`.
     * @param {string} selector - Specifies a simple CSS selector.
     * @returns {object|null} Returns the matching ancestor, or null.
     */
    closest(selector) {
      let node = el;
      while (node) {
        if (typeof node.matches === "function" && node.matches(selector)) return node;
        node = node.parentNode || null;
      }
      return null;
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    },
    get firstChild() {
      return children[0] || null;
    },
    // In this stub every parent is itself an element (no non-Element parent
    // nodes are modeled), so `parentElement` just mirrors `parentNode`.
    get parentElement() {
      return el.parentNode || null;
    },
    // Next sibling of any node type (text or element), by position in the
    // parent's children array — matches real `Node.nextSibling` semantics.
    get nextSibling() {
      if (!el.parentNode) return null;
      const siblings = el.parentNode.children;
      const idx = siblings.indexOf(el);
      return idx === -1 ? null : siblings[idx + 1] || null;
    },
    // Next *element* sibling, skipping any interleaved text-node stubs —
    // matches real `Element.nextElementSibling` semantics.
    get nextElementSibling() {
      if (!el.parentNode) return null;
      const siblings = el.parentNode.children;
      const startIdx = siblings.indexOf(el);
      if (startIdx === -1) return null;
      for (let i = startIdx + 1; i < siblings.length; i++) {
        if (siblings[i] && siblings[i].tagName) return siblings[i];
      }
      return null;
    },
  };
  Object.setPrototypeOf(el, HTMLElementStub.prototype);
  return el;
}

/**
 * Create an in-memory GM_getValue/GM_setValue-compatible store, plus a
 * GM_registerMenuCommand/GM_unregisterMenuCommand pair that actually tracks
 * registered commands (in `.commands`, keyed by id) rather than no-op'ing —
 * so tests can look up a script's debug/feature-flag toggle by label and
 * invoke its callback directly, exercising the re-register-on-toggle logic
 * every script uses. `.commands` is a test-only introspection property, not
 * a `GM_*` API member, and is filtered out before being exposed as a
 * sandbox global by `loadUserScript`.
 * @returns {object} Returns the GM_* stub functions plus `.commands`.
 */
function createGMStubs() {
  const store = new Map();
  const commands = new Map();
  const xhrCalls = [];
  let nextMenuCommandId = 1;
  return {
    GM_getValue(key, defaultValue) {
      return store.has(key) ? store.get(key) : defaultValue;
    },
    GM_setValue(key, value) {
      store.set(key, value);
    },
    GM_registerMenuCommand(label, callback) {
      const id = nextMenuCommandId++;
      commands.set(id, { label, callback });
      return id;
    },
    GM_unregisterMenuCommand(id) {
      commands.delete(id);
    },
    // Records each call's options object instead of ever invoking a
    // callback, so a test can grab `gmStubs.xhrCalls[0]` and manually
    // invoke `.onload(...)`/`.onerror()`/`.ontimeout()`/`.onprogress(...)`
    // to exercise each outcome branch of code built on GM_xmlhttpRequest.
    GM_xmlhttpRequest(options) {
      xhrCalls.push(options);
    },
    xhrCalls,
    commands,
  };
}

/**
 * Create a minimal, mutable `document` stub. `querySelector`/
 * `querySelectorAll` are reassignable so individual test cases can
 * reconfigure what the script "finds" on the page without reloading it.
 * `body` and `createElement(...)` return the mutable element stub above, so
 * panel-building code that does `document.createElement(...)` →
 * `document.body.appendChild(...)` runs without throwing.
 * @returns {object} Returns the document stub.
 */
function createDocumentStub() {
  return {
    body: createElementStub("body"),
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    getElementById() {
      return null;
    },
    createElement(tagName) {
      return createElementStub(tagName);
    },
    createTextNode(text) {
      return { nodeType: 3, textContent: text, remove() {} };
    },
    execCommand() {
      return true;
    },
    // Real listener bookkeeping (see createEventListenerMixin) so tests can
    // exercise document-level delegated listeners — e.g. a drag handle's
    // `document.addEventListener("mousemove"/"mouseup", ...)` — via
    // `documentStub.dispatch(type, overrides)`, not just element-level ones.
    ...createEventListenerMixin(),
  };
}

/**
 * Load a `.user.js` file's source in an isolated vm sandbox with stubbed
 * browser/GM_* globals, and return whatever it assigns to `module.exports`
 * (each script conditionally exports its pure/testable functions at the
 * bottom of its IIFE — a no-op in a real browser, since there's no
 * CommonJS `module` global there).
 * @param {string} filePath - Specifies the absolute path to the .user.js file.
 * @param {{ pathname?: string, hostname?: string, href?: string, document?: object, gm?: object, timers?: object, mutationObserver?: {MutationObserver: Function, instances: object[]}, windowOpen?: Function, extraGlobals?: object }} [overrides] - Specifies sandbox overrides.
 * @returns {object} Returns the script's exported functions.
 */
function loadUserScript(filePath, overrides = {}) {
  const source = fs.readFileSync(filePath, "utf8");
  const documentStub = overrides.document || createDocumentStub();
  const gmStubs = overrides.gm || createGMStubs();
  const timerStubs = overrides.timers || createTimerStubs();
  const mutationObserverStub = overrides.mutationObserver || createMutationObserverStub();
  // Only the real GM_* API surface becomes a sandbox global — `.commands`
  // is test-only introspection (see createGMStubs) and would otherwise leak
  // in as a stray `commands` global.
  const gmGlobals = Object.fromEntries(
    Object.entries(gmStubs).filter(([key]) => key.startsWith("GM_")),
  );
  const origin = overrides.origin || "https://example.invalid";
  const pathname = overrides.pathname || "/";
  const locationStub = {
    pathname,
    hostname: overrides.hostname || "example.invalid",
    origin,
    href: overrides.href || origin + pathname,
  };

  const moduleStub = { exports: {} };
  const sandbox = {
    module: moduleStub,
    exports: moduleStub.exports,
    // `open` is a no-op by default; pass `overrides.windowOpen` to spy on
    // `window.open(url, ...)` calls (e.g. quick-add-row click handlers).
    window: { location: locationStub, open: overrides.windowOpen || function () {} },
    location: locationStub,
    document: documentStub,
    // Clipboard-less by default (`navigator.clipboard` undefined), so
    // copy-to-clipboard code takes its no-async-Clipboard-API fallback path
    // unless a test overrides `extraGlobals.navigator`.
    navigator: { clipboard: undefined },
    MutationObserver: mutationObserverStub.MutationObserver,
    URL,
    URLSearchParams,
    // Node's global Blob (stable since v18) and node:url's URL both support
    // createObjectURL/revokeObjectURL natively, so download-button code that
    // builds a Blob and an object URL runs unmodified against real behavior.
    Blob,
    // Host ArrayBuffer, not the vm-realm's own: response bodies built by
    // tests (e.g. via TextEncoder().encode(...).buffer) must pass an
    // `instanceof ArrayBuffer` check performed by code running inside the
    // sandbox.
    ArrayBuffer,
    Node: NodeConstants,
    HTMLElement: HTMLElementStub,
    console,
    // Fake (not real Node timers): scheduling records the callback instead
    // of ever invoking it, so a scheduled reset/refresh never fires unless a
    // test explicitly calls `timerStubs.flush()`. Real timers would leak
    // past the test and, for setInterval, hang the test runner's exit.
    setTimeout: timerStubs.setTimeout,
    clearTimeout: timerStubs.clearTimeout,
    setInterval: timerStubs.setInterval,
    clearInterval: timerStubs.clearInterval,
    ...gmGlobals,
    ...(overrides.extraGlobals || {}),
  };

  vm.createContext(sandbox);
  new vm.Script(source, { filename: filePath }).runInContext(sandbox);

  return moduleStub.exports;
}

module.exports = {
  loadUserScript,
  createDocumentStub,
  createElementStub,
  createGMStubs,
  createMutationObserverStub,
  createTimerStubs,
};
