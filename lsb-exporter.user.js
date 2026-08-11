// ==UserScript==
// @name         LSB CSV statement exporter
// @namespace    https://github.com/netravnen/userscripts
// @version      1.3.2
// @description  Export LSB Loan Account statements for later manual import to spiir
// @author       -
// @match        https://www.lsb.dk/da/netbank/accounts/loan-account?accountId=*
// @match        https://www.lsb.dk/netbank/accounts/loan-account?accountId=*
// @icon         https://icons.duckduckgo.com/ip2/www.lsb.dk.ico
// @license      MIT
// @updateURL    https://github.com/netravnen/userscripts/raw/refs/heads/main/lsb-exporter.meta.js
// @downloadURL  https://github.com/netravnen/userscripts/raw/refs/heads/main/lsb-exporter.user.js
// @supportURL   https://github.com/netravnen/userscripts/issues
// @grant        none
// @require      https://cdnjs.cloudflare.com/ajax/libs/js-sha256/0.11.0/sha256.min.js#sha256=5e623445991d81ba5fb0abf201d7a6d45c9010c1f2e11377fefa8e8054572953
// @run-at       document-idle
// @noframes
// ==/UserScript==

/**
 * Inject a "Copy Data" button into LSB netbank's loan-account statement page
 * that extracts each visible transaction row into a tab/semicolon-delimited
 * CSV (with a sha256-derived per-row statement id) and copies it to the
 * clipboard, for later manual import into spiir.
 * @returns {void} Returns nothing.
 */
(function () {
  "use strict";

  // Captured immediately, before any other code in this script runs, and
  // used exclusively from here on instead of the live `sha256` global.
  // @grant none means the @require'd js-sha256 library attaches itself as
  // `window.sha256` in shared page context rather than an isolated
  // sandbox; reading that global fresh on every call would let another
  // script sharing this page redefine it at any later point (e.g. right
  // before the user clicks "Copy Data") and silently intercept every
  // row's date/amount/currency/balance as it's hashed. Capturing it once,
  // here, closes that window without requiring a live-tested @grant change.
  const sha256Fn = typeof sha256 === 'function' ? sha256 : null;

  const SEPARATOR = ";";
  const NEWLINE = "\n";

  const PARENT_ACTIONS_SELECTOR = ".account-header__top-bar > .account-header__actions";
  const PDF_BUTTON_SELECTOR = ".export-as-pdf-button";
  const COPY_BUTTON_SELECTOR = ".account-header-actions__export-button";
  const MAX_INIT_RETRIES = 10;

  /** @type {number} */
  let initRetryCount = 0;

  /**
   * @typedef {Object} StatementRow
   * @property {string} Id                  - sha256 hash of date/amount/currency/balance, used as a stable per-row identifier.
   * @property {string} [AccountId]          - Left blank; filled in manually.
   * @property {string} AccountName          - Hardcoded to this script's target loan account.
   * @property {string} [AccountType]        - Left blank; filled in manually.
   * @property {string} Date                 - Transaction date in YYYY-MM-DD form.
   * @property {string} Description          - Transaction description as shown on the statement.
   * @property {string} [OriginalDescription] - Left blank; filled in manually.
   * @property {number} MainCategoryId       - Hardcoded spiir main category id (K14, Bolig).
   * @property {string} MainCategoryName     - Hardcoded spiir main category name (Bolig).
   * @property {number} CategoryId           - Hardcoded spiir category id (K114, Boliglån/husleje).
   * @property {string} CategoryName         - Hardcoded spiir category name (Boliglån/husleje).
   * @property {string} CategoryType         - "Expense" or "Income", derived from the transaction amount's sign.
   * @property {string} ExpenseType          - "Fixed" or "Variable"; always "Variable" here.
   * @property {string} Amount               - Transaction amount with thousands separators stripped.
   * @property {string} Balance              - Running balance with thousands separators and currency suffix stripped.
   * @property {string} [CounterEntryId]     - Left blank; filled in manually.
   * @property {string} [Comment]            - Left blank; filled in manually.
   * @property {string} [Tags]               - Left blank; filled in manually.
   * @property {string} Extraordinary        - "Yes" or "No"; always "No" here.
   * @property {string} [SplitGroupId]       - Left blank; filled in manually.
   * @property {string} [CustomDate]         - Left blank; filled in manually.
   * @property {string} Currency             - Mirrors OriginalCurrency; this script has no currency conversion logic.
   * @property {string} [OriginalAmount]     - Left blank; filled in manually.
   * @property {string} OriginalCurrency     - Currency code parsed off the balance column (e.g. "DKK").
   */

  /**
   * Extract every visible transaction row from the loan-account statement
   * table and serialize them into a semicolon-delimited CSV string (with a
   * header row) matching the column layout spiir expects for manual import.
   * @returns {string} Returns the CSV payload as a single newline-joined string.
   */
  function generateDataElement() {
    if (!sha256Fn) {
      throw new Error('lsb-exporter: sha256() is unavailable (the @require script failed to load or was blocked)');
    }

    let rows = [];
    let table = document.querySelector('.transaction-list-inner');
    if (!table) {
      throw new Error('lsb-exporter: transaction list not found on the page');
    }
    let data = table.querySelectorAll('.transaction-list-inner > div[tabindex="0"]');

    let headers = [
      "Id",                  // 00
      "AccountId",           // 01
      "AccountName",         // 02
      "AccountType",         // 03
      "Date",                // 04
      "Description",         // 05
      "OriginalDescription", // 06
      "MainCategoryId",      // 07
      "MainCategoryName",    // 08
      "CategoryId",          // 09
      "CategoryName",        // 10
      "CategoryType",        // 11
      "ExpenseType",         // 12
      "Amount",              // 13
      "Balance",             // 14
      "CounterEntryId",      // 15
      "Comment",             // 16
      "Tags",                // 17
      "Extraordinary",       // 18
      "SplitGroupId",        // 19
      "CustomDate",          // 20
      "Currency",            // 21
      "OriginalAmount",      // 22
      "OriginalCurrency"     // 23
    ];

    /*

      - K12, Bolig
        - K114, Boliglån/husleje, Regn
        - K115, El, vand, varme & renovation, Regn
        - K116, Ejerforening, Regn
        - K117, Ejendomsskat, Regn
        - K118, Husforsikring, Regn
        - K119, Indbo- & familieforsikring, Regn
        - K120, Alarmsystem, Regn
        - K121, Udgifter fritidshus, Regn
        - K122, Ombygning & vedligehold,
        - K195, Have & planter,
        - K187, Andre boligudgifter,
      - K13, Transport
        - K123, Bil-, MC-, bådlån o.l., Regn
        - K124, Brændstof,
        - K125, Bilforsikring & autohjælp, Regn
        - K126, Ejerafgift/grøn afgift, Regn
        - K127, Bus, tog, færge o.l.,
        - K128, Taxi,
        - K129, Parkering,
        - K130, Værksted & reservedele,
        - K131, Anden transport,
      - K14, Husholdning
        - K132, Dagligvarer,
        - K133, Kiosk, bager & specialbutikker,
        - K192, Kantine- & frokostordning,
      - K16, Andre leveomkostninger
        - K134, Apotek & medicin,
        - K153, Behandling & læger,
        - K142, Underholds- & børnebidrag, Regn
        - K143, Institution, Regn
        - K144, Fagforening & a-kasse, Regn
        - K145, Livs- & ulykkesforsikring, Regn
        - K146, Sundheds- & sygeforsikring, Regn
        - K154, Briller & kontaktlinser,
        - K148, TV & streaming, Regn
        - K149, Telefoni & internet, Regn
        - K189, Studieudgifter,
        - K191, Foreninger & kontingenter, Regn
      - K17, Privatforbrug
        - K155, Fastfood & takeaway,
        - K156, Bar, cafe & restaurant,
        - K157, Tøj, sko & accessories,
        - K158, Møbler & boligudstyr,
        - K159, Elektronik & computerudstyr,
        - K163, Film, musik & læsestof,
        - K186, Online services & software,
        - K161, Hobby & sportsudstyr,
        - K164, Biograf, koncerter & forlystelser,
        - K162, Frisør & personlig pleje,
        - K147, Sport & fritid,
        - K151, Hus & havehjælp,
        - K160, Spil & legetøj,
        - K165, Tips & lotto,
        - K167, Babyudstyr,
        - K168, Kæledyr,
        - K169, Gaver & velgørenhed,
        - K188, Tobak & alkohol,
        - K172, Kontanthævning & check,
        - K193, Højskole- & kursusophold,
        - K194, Serviceydelser & rådgivning,
        - K170, Andet privatforbrug,
      - K15, Ferie
        - K135, Fly & Hotel,
        - K138, Billeje,
        - K139, Sommerhus & camping,
        - K140, Ferieaktiviteter,
        - K141, Rejseforsikring,
      - K18, Diverse
        - K171, Ukendt,
        - K174, Bankgebyrer,
        - K175, Rykkergebyrer,
        - K176, Bøder & afgifter,
        - K177, Restskat,
        - K196, Offentligt gebyr,
      - K19, Lån & gæld
        - K178, Studielån, Regn
        - K179, Forbrugslån, Regn
        - K180, Private lån (venner & familie), Regn
        - K181, Udlånsrenter,
      - K20, Pension & Opsparing
        - K182, Pensionsopsparing, Regn
        - K183, Børneopsparing, Regn
        - K184, Anden opsparing, Regn
        - K185, Værdipapirshandel,
      - K11, Indkomst
        - K103, Løn, Ind
        - K104, Pensionsudbetaling, Ind
        - K105, Dagpenge/overførselsindkomst, Ind
        - K106, SU & studielån, Ind
        - K107, Børnepenge, Ind
        - K108, Underholds- & børnebidrag, Ind
        - K109, Feriepenge, Ind
        - K110, Renteindtægter, Ind
        - K111, Udbytte & afkast, Ind
        - K112, Overskydende skat, Ind
        - K190, Boligstøtte, Ind
        - K113, Anden indkomst, Ind
      - K10, Vis ikke
        - K100, Kontooverførsel,
        - K101, Udlæg,
        - K102, Ignorer,
      - K__clear__, Ikke kategoriseret

    */

    // Reset the array. Set it to the headers construct
    rows = [headers.join(SEPARATOR)];

    let skippedRows = 0;

    // Loop over the table rows. Each row is handled independently so one
    // malformed/unexpected row (missing field, unrecognized balance suffix,
    // etc.) doesn't abort the entire export.
    data.forEach((item, index) => {
      try {

        // Immutable
        let row = [],
            today = new Date();

        // Mutable
        let id;
        let accountId;
        let accountName = "BOLIGPRIORITETSKONTO";
        let accountType;
        let date;
        let description;
        let originalDescription;
        let mainCategoryId = 14;
        let mainCategoryName = "Bolig";
        let categoryId = 114;
        let categoryName = "Boliglån/husleje";
        let categoryType;
        let expenseType = "Variable"; // Fixed, Variable
        let amount;
        let balance;
        let counterEntryId;
        let comment;
        let tags;
        let extraordinary = "No"; // Yes, No
        let splitGroupId;
        let customDate;
        let currency;
        let originalAmount;
        let originalCurrency;

        // Extract the data we want
        date        = item.querySelector('div.transaction-field.transaction-field--date');
        description = item.querySelector('div.transaction-field.transaction-field--statementText');
        amount      = item.querySelector('div.transaction-field.transaction-field--amount');
        balance     = item.querySelector('div.transaction-field.transaction-field--balance');

        // We only want the innertext from the four columns of each row extracted
        date        = date.innerText;
        description = description.innerText;
        amount      = amount.innerText;
        balance     = balance.innerText;

        /* Begin date parsing */

        // Native date parsing only supports english
        date = date
          .replace('okt', 'oct')
          .replace('sept', 'sep')
          .replace('juli', 'jul')
          .replace('juni', 'jun')
          .replace('maj', 'may');

        // Not a date. Convert to parseable date
        if (date == "I dag") {
          date = today;
        } else if (date == "I går") {
          date = today.setDate(today.getDate() - 1);
        }

        // Parse date, Convert to ISO format, Extract YYYY-MM-DD
        date = new Date(date)
          .toISOString()
          .split('T')[0];

        /* End date parsing */

        amount = amount.replace('.', '');

        // Extract currency code
        originalCurrency = balance
          .match(/[a-zA-Z]+$/)[0]
          .toUpperCase();

        balance = balance
          .replace('.', '')
          .replace(/dkk$/i, '');

        // Mirror the extracted currency; this script has no conversion logic
        currency = originalCurrency;

        // Derive income vs. expense from the amount's sign
        categoryType = Number(amount) < 0 ? "Expense" : "Income";

        // Build a user-defined unique statement identifier based on the data we can extract
        let statementId = sha256Fn(
          [
            date,
            amount,
            currency,
            balance
          ].join('_')
        );

        /* Begin output constructer */

        // Construct the row we want to push as output
        row[0]  = statementId;
        row[1]  = accountId;
        row[2]  = accountName;
        row[3]  = accountType;
        row[4]  = date;
        row[5]  = description;
        row[6]  = originalDescription;
        row[7]  = mainCategoryId;
        row[8]  = mainCategoryName;
        row[9]  = categoryId;
        row[10] = categoryName;
        row[11] = categoryType;
        row[12] = expenseType;
        row[13] = amount;
        row[14] = balance;
        row[15] = counterEntryId;
        row[16] = comment;
        row[17] = tags;
        row[18] = extraordinary;
        row[19] = splitGroupId;
        row[20] = customDate;
        row[21] = currency;
        row[22] = originalAmount;
        row[23] = originalCurrency;


        // Push data to the results array
        rows.push(row.join(SEPARATOR));

        /* End output constructer */

      } catch (err) {
        skippedRows += 1;
        console.error('lsb-exporter: skipping row ' + index + ' (unexpected format)', err);
      }
    });

    if (skippedRows > 0) {
      console.warn('lsb-exporter: ' + skippedRows + ' row(s) skipped due to unexpected format; the CSV is incomplete');
    }

    return rows.join(NEWLINE);
  }

  /**
   * Fallback clipboard copy using a hidden, focused textarea plus
   * `document.execCommand('copy')`, for contexts without the async
   * Clipboard API (e.g. insecure/non-HTTPS origins).
   * @param {string} text - Specifies the text to copy.
   * @returns {void} Returns nothing.
   */
  function fallbackCopyTextToClipboard(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;

    // Avoid scrolling to bottom
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.position = "fixed";

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      const successful = document.execCommand('copy');
      const msg = successful ? 'successful' : 'unsuccessful';
      console.log('Fallback: Copying text command was ' + msg);
    } catch (err) {
      console.error('Fallback: Oops, unable to copy', err);
    }

    document.body.removeChild(textArea);
  }

  /**
   * Copy text to the clipboard, preferring the async Clipboard API and
   * falling back to `fallbackCopyTextToClipboard` when it isn't available.
   * @param {string} text - Specifies the text to copy.
   * @returns {void} Returns nothing.
   */
  function copyTextToClipboard(text) {
    if (!navigator.clipboard) {
      fallbackCopyTextToClipboard(text);
      return;
    }
    navigator.clipboard.writeText(text).then(function() {
      console.log('Async: Copying to clipboard was successful!');
    }, function(err) {
      console.error('Async: Could not copy text: ', err);
    });
  }

  /**
   * Build the "Copy Data" button, styled with LSB's own native action-button
   * classes (matching "Eksportér som PDF") rather than hand-picked colors,
   * insert it before the "Eksportér som PDF" button, and wire it to copy the
   * generated CSV to the clipboard on click.
   * @param {Element} parentElement - Specifies the account header actions container.
   * @returns {void} Returns nothing.
   */
  function injectCopyButton(parentElement) {
    let copyTableRowsBtn = document.createElement('button');
    let copyTableRowsBtnInner = document.createElement('span');

    copyTableRowsBtn.setAttribute('class', 'button account-header-actions__export-button button--color-white button--with-icon button--has-shadow');
    copyTableRowsBtn.setAttribute('data-testid', 'button');
    copyTableRowsBtnInner.setAttribute('class', 'button__icon-text');
    copyTableRowsBtnInner.setAttribute('data-bind', 'click: click');
    copyTableRowsBtnInner.innerText = 'Copy Data';

    parentElement.insertBefore(copyTableRowsBtn, parentElement.querySelector(PDF_BUTTON_SELECTOR));
    copyTableRowsBtn.appendChild(copyTableRowsBtnInner);

    copyTableRowsBtn.addEventListener('click', function() {
      try {
        copyTextToClipboard(generateDataElement());
      } catch (err) {
        console.error('lsb-exporter: export failed', err);
      }
    });
  }

  /**
   * Evaluate whether the account header actions bar and its "Eksportér som
   * PDF" anchor point are present, and inject the "Copy Data" button once
   * they are. A no-op (returning true) if the button was already injected.
   * @returns {boolean} Returns true if the button is present after this call.
   */
  function initScript() {
    const parentElement = document.querySelector(PARENT_ACTIONS_SELECTOR);
    if (!parentElement) return false;
    if (!parentElement.querySelector(PDF_BUTTON_SELECTOR)) return false;
    if (parentElement.querySelector(COPY_BUTTON_SELECTOR)) return true;

    injectCopyButton(parentElement);
    return true;
  }

  if (!initScript()) {
    const retryObserver = new MutationObserver(function retryOnMutation() {
      initRetryCount += 1;
      if (initScript() || initRetryCount >= MAX_INIT_RETRIES) {
        retryObserver.disconnect();
      }
    });
    retryObserver.observe(document.body, { childList: true, subtree: true });
  }
})();
