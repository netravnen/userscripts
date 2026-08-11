// ==UserScript==
// @name         RIPE Meeting - Session File Downloader
// @namespace    https://www.ripe.net/
// @version      0.4.0
// @description  Floating panel with per-format download buttons + renamed in-page download links (PDF/PPT/PPTX/KEY/MP4)
// @author       netravnen
// @icon         https://www.ripe.net/favicon.ico
// @license      MIT
// @match        https://*.ripe.net/programme/meeting-plan/sessions/*/*
// @match        https://*.ripe.net/programme/meeting-plan/sessions/*/*/
// @updateURL    https://github.com/netravnen/userscripts/raw/refs/heads/main/ripe-meeting.meta.js
// @downloadURL  https://github.com/netravnen/userscripts/raw/refs/heads/main/ripe-meeting.user.js
// @supportURL   https://github.com/netravnen/userscripts/issues
// @require      https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/js/fontawesome.min.js#sha256=6b2cf1db39dba731b99d0d1b0246dec83a1cf4807336e7517b83807af2dfd615
// @require      https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/js/regular.min.js#sha256=520dfc4ea22493d021802e6291587dcdf3f79bdbf23d513240c3871eb0f74f38
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @connect      pretalx.ripe.net
// @noframes
// @run-at       document-idle
// ==/UserScript==
