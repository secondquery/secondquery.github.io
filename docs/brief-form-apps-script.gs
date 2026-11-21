/**
 * Second Query: brief form receiver (Google Apps Script, bound to the "Second Query briefs" Google Sheet).
 * Deploy: Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 * Paste the web app URL into data-endpoint on the form in src/pages/contact.html.
 *
 * What it does with each brief:
 *  1. Logs it in the "Briefs" tab.
 *  2. Emails it to Sam (reply goes straight to the sender).
 *  3. Sends the sender a short acknowledgement.
 *  4. If the visitor ticked the ad measurement box and arrived from an ad, adds the click ID to the
 *     "Google Ads conversions" or "Microsoft Ads conversions" tab, laid out for scheduled imports.
 */
var OWNER = 'sam@secondquery.com';
var CONVERSION_NAME = 'Brief submitted (website)';
var TZ = 'Europe/London';
var DAILY_LIMIT = 40; // stops the form being abused to send lots of emails

function doPost(e) {
  try {
    var d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (d.website) return out_({ ok: true }); // honeypot filled: quietly ignore
    if (!d.ms || d.ms < 3000) return out_({ ok: false, error: 'Please take a moment longer and try again.' });
    var email = String(d.email || '').trim().slice(0, 200);
    var name = String(d.name || '').trim().slice(0, 120);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return out_({ ok: false, error: 'Name and email are needed.' });

    var cache = CacheService.getScriptCache();
    var dayKey = 'n-' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd');
    var n = Number(cache.get(dayKey) || 0);
    if (n >= DAILY_LIMIT) return out_({ ok: false, error: 'busy' });
    cache.put(dayKey, String(n + 1), 21600);
    if (cache.get('e-' + email.toLowerCase())) return out_({ ok: true }); // same person twice in 10 minutes
    cache.put('e-' + email.toLowerCase(), '1', 600);

    var clean = function (v, max) { return String(v || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max || 500); };
    var b = {
      option: clean(d.option, 80), name: name, email: email, role: clean(d.role, 120), company: clean(d.company, 160),
      decision: clean(d.decision, 300), spend: clean(d.spend, 60), timing: clean(d.timing, 60), details: clean(d.details, 4000),
      page: clean(d.page, 120), consent: !!d.adConsent, clicks: d.adConsent && d.clicks ? d.clicks : {}
    };
    var now = new Date();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var log = sheet_(ss, 'Briefs', ['Received', 'Name', 'Email', 'Company', 'Role', 'Option', 'Deciding', 'Monthly spend', 'Timing', 'Details', 'Page', 'Ad measurement consent', 'gclid', 'gbraid', 'wbraid', 'msclkid', 'Status']);
    log.appendRow([now, b.name, b.email, b.company, b.role, b.option, b.decision, b.spend, b.timing, b.details, b.page, b.consent ? 'Yes' : 'No',
      clean(b.clicks.gclid, 200), clean(b.clicks.gbraid, 200), clean(b.clicks.wbraid, 200), clean(b.clicks.msclkid, 200), 'New']);

    var when = Utilities.formatDate(now, TZ, 'yyyy-MM-dd HH:mm:ss');
    if (b.consent && b.clicks.gclid) {
      var g = importSheet_(ss, 'Google Ads conversions', ['Google Click ID', 'Conversion Name', 'Conversion Time', 'Conversion Value', 'Conversion Currency']);
      g.appendRow([clean(b.clicks.gclid, 200), CONVERSION_NAME, when, '', '']);
    }
    if (b.consent && b.clicks.msclkid) {
      var m = importSheet_(ss, 'Microsoft Ads conversions', ['Microsoft Click ID', 'Conversion Name', 'Conversion Time', 'Conversion Value', 'Conversion Currency']);
      m.appendRow([clean(b.clicks.msclkid, 200), CONVERSION_NAME, when, '', '']);
    }

    var text = [
      'Option: ' + b.option, 'Name: ' + b.name, 'Role: ' + b.role, 'Company: ' + b.company, 'Email: ' + b.email,
      'Deciding: ' + (b.decision || 'Not said'), 'Monthly spend: ' + (b.spend || 'Not said'), 'Timing: ' + (b.timing || 'Not said'),
      '', b.details || '(no details)', '', 'Sent from ' + b.page + (b.consent ? ' · came from an ad, measurement consent given' : '')
    ].join('\n');
    MailApp.sendEmail({ to: OWNER, replyTo: b.email, name: 'Second Query website', subject: 'New brief: ' + (b.company || b.name), body: text });
    MailApp.sendEmail({
      to: b.email, replyTo: OWNER, name: 'Sam Hitchmough', subject: 'Thanks for your brief',
      body: 'Hi ' + b.name.split(' ')[0] + ',\n\nThanks for sending your brief to Second Query. I\'ll read it properly and reply within two working days, usually sooner.\n\nFor reference, here\'s what you sent:\n\n' + text + '\n\nSam Hitchmough\nFounder, Second Query\nsecondquery.com\n\nYou\'re getting this because you submitted a brief at secondquery.com. Privacy notice: https://secondquery.com/privacy/'
    });
    return out_({ ok: true });
  } catch (err) {
    console.error(err);
    return out_({ ok: false, error: 'server' });
  }
}

function doGet() { return out_({ ok: true, service: 'Second Query brief form' }); }

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function sheet_(ss, name, header) {
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(header); sh.setFrozenRows(1); }
  return sh;
}

// Import layout: a parameters row, then the column headers, then one row per conversion.
function importSheet_(ss, name, header) {
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(['Parameters:TimeZone=' + TZ]); sh.appendRow(header); }
  return sh;
}

// Run once from the editor to create the tabs and trigger the permission prompt.
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  sheet_(ss, 'Briefs', ['Received', 'Name', 'Email', 'Company', 'Role', 'Option', 'Deciding', 'Monthly spend', 'Timing', 'Details', 'Page', 'Ad measurement consent', 'gclid', 'gbraid', 'wbraid', 'msclkid', 'Status']);
  importSheet_(ss, 'Google Ads conversions', ['Google Click ID', 'Conversion Name', 'Conversion Time', 'Conversion Value', 'Conversion Currency']);
  importSheet_(ss, 'Microsoft Ads conversions', ['Microsoft Click ID', 'Conversion Name', 'Conversion Time', 'Conversion Value', 'Conversion Currency']);
  var s1 = ss.getSheetByName('Sheet1'); if (s1 && ss.getSheets().length > 1) ss.deleteSheet(s1);
  MailApp.getRemainingDailyQuota();
}

// ---------------------------------------------------------------------------
// Lead stages. Change a lead's Status in the Briefs tab and the dates fill in by themselves.
// Google Ads imports "Qualified at" and "Won at" each morning, so it learns which ads bring real clients.
// Type the fee (GBP, ex VAT) in "Won value" when a lead becomes a client.
var STAGES = ['New', 'Call booked', 'Qualified', 'Proposal sent', 'Won', 'Lost', 'Not a fit'];
var QUALIFIED_STAGES = ['Qualified', 'Proposal sent', 'Won'];

// Run once from the editor: adds the stage columns and the Status drop-down.
function setupStages() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Briefs');
  ['Qualified at', 'Won at', 'Won value', 'Won currency', 'Notes'].forEach(function (h) {
    var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    if (head.indexOf(h) < 0) sh.getRange(1, sh.getLastColumn() + 1).setValue(h);
  });
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var col = function (h) { return head.indexOf(h) + 1; };
  var rows = sh.getMaxRows() - 1;
  sh.getRange(2, col('Status'), rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(STAGES, true).setAllowInvalid(false).build());
  sh.getRange(2, col('Qualified at'), rows, 2).setNumberFormat('@');
  sh.getRange(2, col('Won value'), rows, 1).setNumberFormat('0.00');
}

function onEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getName() !== 'Briefs') return;
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var cS = head.indexOf('Status') + 1, cQ = head.indexOf('Qualified at') + 1;
  var cW = head.indexOf('Won at') + 1, cC = head.indexOf('Won currency') + 1;
  if (!cS || !cQ || !cW || e.range.getColumn() > cS || e.range.getLastColumn() < cS) return;
  var stamp = Utilities.formatDate(new Date(), e.source.getSpreadsheetTimeZone(), "yyyy-MM-dd'T'HH:mm:ssXXX");
  for (var row = Math.max(e.range.getRow(), 2); row <= e.range.getLastRow(); row++) {
    var s = String(sh.getRange(row, cS).getValue()).trim();
    if (QUALIFIED_STAGES.indexOf(s) >= 0 && !sh.getRange(row, cQ).getValue()) sh.getRange(row, cQ).setValue(stamp);
    if (s === 'Won' && !sh.getRange(row, cW).getValue()) {
      sh.getRange(row, cW).setValue(stamp);
      if (cC && !sh.getRange(row, cC).getValue()) sh.getRange(row, cC).setValue('GBP');
    }
  }
}
