// ==UserScript==
// @name         Rejseplanen - Quick Calendar Export
// @namespace    https://www.rejseplanen.dk/
// @version      0.9.1
// @description  Adds Outlook.com and Outlook M365 (cloud.microsoft) quick-add buttons to both the production (webapp) and beta (webapp-nextgen) Rejseplanen calendar export UI, plus Google Calendar on production; the beta rows are self-styled rather than cloned from Angular's own components
// @author       netravnen
// @icon         https://www.rejseplanen.dk/favicon.ico
// @license      MIT
// @match        https://*.rejseplanen.dk/*
// @updateURL    https://github.com/netravnen/userscripts/raw/refs/heads/main/rejseplanen-calendar-export.meta.js
// @downloadURL  https://github.com/netravnen/userscripts/raw/refs/heads/main/rejseplanen-calendar-export.user.js
// @supportURL   https://github.com/netravnen/userscripts/issues
// @require      https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/js/fontawesome.min.js#sha256=6b2cf1db39dba731b99d0d1b0246dec83a1cf4807336e7517b83807af2dfd615
// @require      https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/js/brands.min.js#sha256=58897dac1cfca59514ebd2992f09acc67251d80d15dd7cfa9fcc21c47d6d2980
// @require      https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/js/regular.min.js#sha256=520dfc4ea22493d021802e6291587dcdf3f79bdbf23d513240c3871eb0f74f38
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @noframes
// @run-at       document-idle
// ==/UserScript==
