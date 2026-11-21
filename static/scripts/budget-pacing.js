/**
 * Monthly budget pacing monitor
 * A free Google Ads script from Second Query: https://secondquery.com/google-ads-scripts/
 * Version 1.0, November 2026. Free to use and adapt; please keep this header.
 *
 * WHAT IT DOES
 * Tracks spend this month against your monthly budget. It works out spend to date, where you
 * should be by now, the run rate over the last seven days, the projected month-end spend and
 * the daily spend needed to land on budget. It writes this to a Google Sheet with a chart of
 * actual against ideal spend and a table by campaign, and emails you if the month is heading
 * over or under budget by more than your tolerance.
 *
 * It only reads data. It never changes budgets or anything else in your account.
 *
 * HOW TO USE IT
 * 1. In Google Ads, go to Tools > Bulk actions > Scripts, click +, and paste this in.
 * 2. Set MONTHLY_BUDGET (in your account currency) and, if you like, EMAIL.
 * 3. Leave SPREADSHEET_URL blank for the first run; the script creates a Sheet and logs its link.
 * 4. Click Preview, then Run. Schedule it daily.
 */

// ---- Settings -------------------------------------------------------------------------
var MONTHLY_BUDGET = 10000;         // This month's budget, in the account's currency.
var CAMPAIGN_NAME_CONTAINS = '';    // Only include campaigns whose name contains this. Blank = all.
var TOLERANCE = 0.10;               // Email when the projection is more than 10% over or under.
var SPREADSHEET_URL = '';           // Blank = create a new Sheet. Paste a Sheet URL here to reuse it.
var EMAIL = '';                     // Optional: one address, or several separated by commas.
// ----------------------------------------------------------------------------------------

var BRAND = { ink: '#06222e', pink: '#ff2e7e', soft: '#eaf6fa', quiet: '#3a5763', white: '#ffffff' };

function main() {
  var account = AdsApp.currentAccount();
  var tz = account.getTimeZone();
  var currency = account.getCurrencyCode();
  var now = new Date();
  var today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)), d = Number(today.slice(8, 10));
  var daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  var monthStart = today.slice(0, 8) + '01';
  var elapsed = d - 1;                       // full days so far, up to yesterday
  var daysLeft = daysInMonth - elapsed;      // including today

  if (elapsed === 0) {
    Logger.log('It is the first day of the month, so there is no spend to pace yet.');
    return;
  }
  var yesterday = Utilities.formatDate(new Date(now.getTime() - 864e5), tz, 'yyyy-MM-dd');
  var daily = fetchDaily_(monthStart, yesterday);
  var dates = [];
  for (var i = 1; i <= elapsed; i++) dates.push(today.slice(0, 8) + (i < 10 ? '0' : '') + i);

  var spend = 0, cumulative = [];
  dates.forEach(function (date, idx) {
    spend += daily.byDate[date] || 0;
    cumulative.push([date, round_(daily.byDate[date] || 0), round_(spend), round_(MONTHLY_BUDGET * (idx + 1) / daysInMonth)]);
  });
  var last7 = dates.slice(-7);
  var runRate = last7.reduce(function (a, dt) { return a + (daily.byDate[dt] || 0); }, 0) / last7.length;
  var ideal = MONTHLY_BUDGET * elapsed / daysInMonth;
  var projected = spend + runRate * daysLeft;
  var needed = Math.max(0, (MONTHLY_BUDGET - spend) / daysLeft);
  var pace = ideal ? spend / ideal : 0;
  var gap = MONTHLY_BUDGET ? (projected - MONTHLY_BUDGET) / MONTHLY_BUDGET : 0;
  var status = Math.abs(gap) <= TOLERANCE ? 'On track' : gap > 0 ? 'Heading over budget' : 'Heading under budget';

  var summary = {
    month: Utilities.formatDate(now, tz, 'MMMM yyyy'), currency: currency, budget: MONTHLY_BUDGET, spend: spend,
    ideal: ideal, pace: pace, runRate: runRate, projected: projected, needed: needed, status: status, gap: gap,
    elapsed: elapsed, daysInMonth: daysInMonth, daysLeft: daysLeft
  };
  var ss = openSpreadsheet_(account.getName());
  writePacing_(ss, account.getName(), summary, cumulative, daily.byCampaign, last7);
  Logger.log(status + ': spent ' + round_(spend) + ' of ' + MONTHLY_BUDGET + ', projected ' + round_(projected) + '. Sheet: ' + ss.getUrl());

  if (EMAIL && status !== 'On track') {
    MailApp.sendEmail({
      to: EMAIL,
      subject: 'Budget pacing: ' + account.getName() + ' is ' + status.toLowerCase() + ' (' + summary.month + ')',
      htmlBody: emailHtml_(account.getName(), summary, ss.getUrl())
    });
  }
}

function fetchDaily_(from, to) {
  var query =
    'SELECT campaign.name, segments.date, metrics.cost_micros FROM campaign ' +
    "WHERE segments.date BETWEEN '" + from + "' AND '" + to + "' AND metrics.cost_micros > 0";
  var rows = AdsApp.search(query);
  var byDate = {}, byCampaign = {};
  var filter = CAMPAIGN_NAME_CONTAINS.toLowerCase();
  while (rows.hasNext()) {
    var r = rows.next();
    var name = String(r.campaign.name);
    if (filter && name.toLowerCase().indexOf(filter) < 0) continue;
    var cost = num_(r.metrics.costMicros) / 1e6;
    byDate[r.segments.date] = (byDate[r.segments.date] || 0) + cost;
    var c = byCampaign[name] || (byCampaign[name] = { total: 0, days: {} });
    c.total += cost;
    c.days[r.segments.date] = (c.days[r.segments.date] || 0) + cost;
  }
  return { byDate: byDate, byCampaign: byCampaign };
}

function writePacing_(ss, accountName, s, cumulative, byCampaign, last7) {
  var sh = ss.getSheetByName('Pacing') || ss.insertSheet('Pacing', 0);
  sh.getCharts().forEach(function (c) { sh.removeChart(c); });
  sh.clear();
  var blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);

  sh.getRange('A1').setValue('Budget pacing · ' + s.month).setFontSize(20).setFontWeight('bold').setFontColor(BRAND.ink);
  sh.getRange('A2').setValue(accountName + '  ·  updated ' + cumulative[cumulative.length - 1][0] +
    (CAMPAIGN_NAME_CONTAINS ? '  ·  campaigns containing "' + CAMPAIGN_NAME_CONTAINS + '"' : '')).setFontColor(BRAND.quiet);
  sh.getRange('A3').setValue(s.status).setFontWeight('bold').setFontSize(13)
    .setFontColor(s.status === 'On track' ? '#1d6b3f' : '#c20a52');

  var labels = ['Budget', 'Spent so far', 'Should have spent', 'Pace', 'Last 7 days, per day', 'Projected month end', 'Needed per day to land on budget'];
  var values = [s.budget, round_(s.spend), round_(s.ideal), s.pace, round_(s.runRate), round_(s.projected), round_(s.needed)];
  sh.getRange(5, 1, 1, labels.length).setValues([labels]).setFontColor(BRAND.quiet).setFontSize(9).setWrap(true);
  sh.getRange(6, 1, 1, values.length).setValues([values]).setFontSize(15).setFontWeight('bold').setFontColor(BRAND.ink)
    .setNumberFormat('#,##0');
  sh.getRange(6, 4).setNumberFormat('0%');
  sh.getRange(7, 1).setValue('Amounts in ' + s.currency + '. Day ' + s.elapsed + ' of ' + s.daysInMonth + ', ' + s.daysLeft + ' days left including today.')
    .setFontColor(BRAND.quiet).setFontSize(9);

  // Daily table, feeding the chart.
  var top = 9;
  var head = [['Date', 'Spend', 'Cumulative spend', 'Ideal cumulative']];
  sh.getRange(top, 1, 1, 4).setValues(head).setBackground(BRAND.ink).setFontColor(BRAND.white).setFontWeight('bold');
  sh.getRange(top + 1, 1, cumulative.length, 4).setValues(cumulative);
  sh.getRange(top + 1, 2, cumulative.length, 3).setNumberFormat('#,##0.00');
  bands_(sh, top + 1, 4, cumulative.length);

  var chart = sh.newChart().asLineChart()
    .addRange(sh.getRange(top, 1, cumulative.length + 1, 1))
    .addRange(sh.getRange(top, 3, cumulative.length + 1, 2))
    .setNumHeaders(1)
    .setTitle('Cumulative spend against ideal')
    .setColors([BRAND.pink, '#7fa7b5'])
    .setOption('series', { 1: { lineDashStyle: [6, 4] } })
    .setOption('vAxis.format', '#,##0')
    .setOption('width', 620)
    .setOption('height', 320)
    .setPosition(top, 6, 0, 0)
    .build();
  sh.insertChart(chart);

  // Campaign table.
  var ctop = top + cumulative.length + 3;
  sh.getRange(ctop, 1).setValue('By campaign').setFontWeight('bold').setFontSize(13).setFontColor(BRAND.ink);
  var chead = ['Campaign', 'Spent so far', 'Share', 'Last 7 days, per day'];
  var crow = Object.keys(byCampaign).map(function (name) {
    var c = byCampaign[name];
    var l7 = last7.reduce(function (a, dt) { return a + (c.days[dt] || 0); }, 0) / last7.length;
    return [name, round_(c.total), s.spend ? c.total / s.spend : 0, round_(l7)];
  }).sort(function (a, b) { return b[1] - a[1]; });
  sh.getRange(ctop + 1, 1, 1, 4).setValues([chead]).setBackground(BRAND.ink).setFontColor(BRAND.white).setFontWeight('bold');
  if (crow.length) {
    sh.getRange(ctop + 2, 1, crow.length, 4).setValues(crow);
    sh.getRange(ctop + 2, 2, crow.length, 1).setNumberFormat('#,##0.00');
    sh.getRange(ctop + 2, 3, crow.length, 1).setNumberFormat('0%');
    sh.getRange(ctop + 2, 4, crow.length, 1).setNumberFormat('#,##0.00');
    bands_(sh, ctop + 2, 4, crow.length);
  }
  sh.getRange(ctop + 3 + crow.length, 1).setValue('Free script from Second Query · secondquery.com/google-ads-scripts')
    .setFontColor(BRAND.pink).setFontSize(9);
  sh.setColumnWidth(1, 260);
  for (var col = 2; col <= 4; col++) sh.setColumnWidth(col, 130);
  sh.setFrozenRows(0);
  sh.setHiddenGridlines(true);
}

function emailHtml_(accountName, s, url) {
  var money = function (v) { return s.currency + ' ' + Math.round(v).toLocaleString('en-GB'); };
  var line = function (k, v) { return '<tr><td style="padding:6px 12px 6px 0;color:#3a5763">' + k + '</td><td style="padding:6px 0;font-weight:bold">' + v + '</td></tr>'; };
  return '<div style="font:15px Arial,sans-serif;color:#06222e;max-width:620px">' +
    '<p style="font-size:18px;font-weight:bold;margin:0 0 4px">' + accountName + ': ' + s.status.toLowerCase() + '</p>' +
    '<p style="margin:0 0 12px;color:#3a5763">' + s.month + ', day ' + s.elapsed + ' of ' + s.daysInMonth + '</p>' +
    '<table style="border-collapse:collapse">' +
    line('Budget', money(s.budget)) + line('Spent so far', money(s.spend)) + line('Projected month end', money(s.projected) + ' (' + (s.gap > 0 ? '+' : '') + Math.round(s.gap * 100) + '%)') +
    line('Last 7 days, per day', money(s.runRate)) + line('Needed per day to land on budget', money(s.needed)) +
    '</table><p style="margin:14px 0 0"><a href="' + url + '" style="color:#ff2e7e">Open the pacing sheet</a></p>' +
    '<p style="margin:14px 0 0;color:#3a5763;font-size:13px">Free script from <a href="https://secondquery.com/google-ads-scripts/" style="color:#ff2e7e">Second Query</a>.</p></div>';
}

function openSpreadsheet_(accountName) {
  if (SPREADSHEET_URL) return SpreadsheetApp.openByUrl(SPREADSHEET_URL);
  var ss = SpreadsheetApp.create('Budget pacing: ' + accountName);
  Logger.log('Created a new Sheet. Paste this into SPREADSHEET_URL to reuse it: ' + ss.getUrl());
  return ss;
}

function bands_(sh, startRow, cols, rows) {
  var colours = [];
  for (var i = 0; i < rows; i++) {
    var line = [];
    for (var j = 0; j < cols; j++) line.push(i % 2 ? BRAND.soft : BRAND.white);
    colours.push(line);
  }
  sh.getRange(startRow, 1, rows, cols).setBackgrounds(colours);
}

function num_(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function round_(v) { return Math.round(v * 100) / 100; }
