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
