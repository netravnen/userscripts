// ==UserScript==
// @name         LSB CSV statement exporter
// @namespace    https://www.lsb.dk/
// @version      1.5.0
// @description  Export LSB Loan Account statements for later manual import to spiir
// @author       netravnen
// @match        https://www.lsb.dk/da/netbank/accounts/loan-account?accountId=*
// @match        https://www.lsb.dk/netbank/accounts/loan-account?accountId=*
// @icon         https://icons.duckduckgo.com/ip2/www.lsb.dk.ico
// @license      MIT
// @updateURL    https://github.com/netravnen/userscripts/raw/refs/heads/main/lsb-exporter.meta.js
// @downloadURL  https://github.com/netravnen/userscripts/raw/refs/heads/main/lsb-exporter.user.js
// @supportURL   https://github.com/netravnen/userscripts/issues
// @require      https://cdnjs.cloudflare.com/ajax/libs/js-sha256/0.11.0/sha256.min.js#sha256=5e623445991d81ba5fb0abf201d7a6d45c9010c1f2e11377fefa8e8054572953
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @run-at       document-idle
// @noframes
// ==/UserScript==
