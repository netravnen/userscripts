// ==UserScript==
// @name         LSB CSV statement exporter
// @namespace    https://www.lsb.dk/da/netbank/accounts/loan-account
// @version      1.2.5
// @description  Export LSB Loan Account statements for later manual import to spiir
// @author       -
// @match        https://www.lsb.dk/da/netbank/accounts/loan-account?accountId=*
// @match        https://www.lsb.dk/netbank/accounts/loan-account?accountId=*
// @icon         https://icons.duckduckgo.com/ip2/www.lsb.dk.ico
// @grant        none
// @require      https://cdnjs.cloudflare.com/ajax/libs/js-sha256/0.11.0/sha256.min.js
// ==/UserScript==

let sleepTimer = 4000; //time in ms

let seperator = '\t';
let newline = '\n';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function generateDataElement() {

  let rows = [];
  let table = document.querySelector('.transaction-list-inner');
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
  rows = [headers.join(';')];

  // Loop over the table rows
  data.forEach((item, index) => {

    // Immutable
    let row = [],
        today = new Date();

    // Muteable
    var id;
    var accountId;
    let accountName = "BOLIGPRIORITETSKONTO";
    var accountType;
    var date;
    var description;
    var originalDescription;
    let mainCategoryId = 14;
    let mainCategoryName = "Bolig";
    let categoryId = 114;
    let categoryName = "Boliglån/husleje";
    let categoryType = "Expense";
    let expenseType = "Variable"; // Fixed, Variable
    var amount;
    var balance;
    var counterEntryId;
    var comment;
    var tags;
    let extraordinary = "No"; // Yes, No
    var splitGroupId;
    var customDate;
    var currency;
    var originalAmount;
    var originalCurrency;

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

    // Extract currecy code
    originalCurrency = balance
      .match(/[a-zA-Z]+$/)[0]
      .toUpperCase();

    balance = balance
      .replace('.', '')
      .replace(/dkk$/i, '');

    if (amount < 0) {
      expenseType = "Expense";
    }

    // Build a user-defined unique statement identifier based on the data we can extract
    let statementId = sha256(
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
    rows.push(row.join(';'));

    /* End output constructer */

  });

  return rows.join('\n');
}

const work = async () => {
  await sleep(sleepTimer);

  (function() {

    function fallbackCopyTextToClipboard(text) {
      var textArea = document.createElement("textarea");
      textArea.value = text;

      // Avoid scrolling to bottom
      textArea.style.top = "0";
      textArea.style.left = "0";
      textArea.style.position = "fixed";

      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      try {
        var successful = document.execCommand('copy');
        var msg = successful ? 'successful' : 'unsuccessful';
        console.log('Fallback: Copying text command was ' + msg);
      } catch (err) {
        console.error('Fallback: Oops, unable to copy', err);
      }

      document.body.removeChild(textArea);
    }
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

    //document.querySelector('.js-useragent').value = navigator.userAgent;

    let copyTableRowsBtn = document.createElement('button');
    let copyTableRowsBtnInner = document.createElement('span');

    //copyTableRowsBtn.setAttribute('style', 'text-align: center; margin: 10px 0px;');
    copyTableRowsBtn.setAttribute('class', 'button account-header-actions__export-button button--color-white button--with-icon button--has-shadow');
    copyTableRowsBtn.setAttribute('data-testid', 'button');
    //copyTableRowsBtnInner.setAttribute('href', '#');
    copyTableRowsBtnInner.setAttribute('class', 'button__icon-text');
    copyTableRowsBtnInner.setAttribute('data-bind', 'click: click');
    copyTableRowsBtnInner.innerText = 'Copy Data';

    const parentElement = document.querySelector( '.account-header__top-bar > .account-header__actions' );
    parentElement.insertBefore(copyTableRowsBtn, parentElement.querySelector( '.export-as-pdf-button' ));
    copyTableRowsBtn.appendChild(copyTableRowsBtnInner);

    copyTableRowsBtn.addEventListener('click', function(event) {
      copyTextToClipboard(
        generateDataElement()
      );
    });

  })();

}

work();
