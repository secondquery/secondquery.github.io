/**
 * Search term n-gram analyser
 * A free Google Ads script from Second Query: https://secondquery.com/google-ads-scripts/
 * Version 1.0, November 2026. Free to use and adapt; please keep this header.
 *
 * WHAT IT DOES
 * Splits every search term from your Search campaigns into single words, two-word phrases
 * and three-word phrases ("n-grams"), adds up impressions, clicks, cost and conversions for
 * each one, and writes the results to a Google Sheet. The Summary tab shows the totals and a
 * chart of the costliest phrases that haven't converted, which are usually your best
 * negative keyword themes. The other tabs list every n-gram so you can sort and filter.
 *
 * It only reads data. It never changes anything in your account.
 *
 * HOW TO USE IT
 * 1. In Google Ads, go to Tools > Bulk actions > Scripts, click +, and paste this in.
 * 2. Leave SPREADSHEET_URL blank for the first run. The script creates a Sheet and logs its link.
 * 3. Click Preview to check it, then Run. Paste the Sheet's link into SPREADSHEET_URL to reuse it.
 * 4. Optional: schedule it weekly.
 */

// ---- Settings -------------------------------------------------------------------------
var SPREADSHEET_URL = '';          // Blank = create a new Sheet. Paste a Sheet URL here to reuse it.
var LOOKBACK_DAYS = 30;            // Days of search terms to analyse, ending yesterday.
var MIN_IMPRESSIONS = 1;           // Leave out n-grams with fewer impressions than this.
var WASTE_MIN_COST = 0;            // Flag n-grams with no conversions once cost reaches this.
                                   // 0 = use twice your average cost per conversion.
var CAMPAIGN_NAME_CONTAINS = '';   // Only include campaigns whose name contains this. Blank = all.
var EMAIL = '';                    // Optional: email the Sheet link when the run finishes.
// ----------------------------------------------------------------------------------------

var BRAND = { ink: '#06222e', pink: '#ff2e7e', soft: '#eaf6fa', rule: '#b2d3dd', white: '#ffffff' };
var TABS = [
  { n: 1, name: 'Single words' },
  { n: 2, name: 'Two-word phrases' },
  { n: 3, name: 'Three-word phrases' }
];

function main() {
  var account = AdsApp.currentAccount();
  var tz = account.getTimeZone();
  var currency = account.getCurrencyCode();
  var range = dateRange_(LOOKBACK_DAYS, tz);

  var terms = fetchSearchTerms_(range);
  if (!terms.length) {
    Logger.log('No search terms found between ' + range.from + ' and ' + range.to + '. Nothing to write.');
    return;
  }

  var totals = sum_(terms);
  var avgCpa = totals.conversions > 0 ? totals.cost / totals.conversions : 0;
  var wasteAt = WASTE_MIN_COST > 0 ? WASTE_MIN_COST : 2 * avgCpa;

  var ss = openSpreadsheet_(account.getName());
  var summaryRows = [];
  TABS.forEach(function (tab) {
    var grams = buildNgrams_(terms, tab.n);
    grams.forEach(function (g) { g.flag = flag_(g, wasteAt, avgCpa); });
    writeGramTab_(ss, tab.name, grams, currency);
    summaryRows.push({ tab: tab, grams: grams });
  });
  writeSummary_(ss, account.getName(), range, currency, totals, avgCpa, wasteAt, summaryRows);

  var url = ss.getUrl();
  Logger.log('Done. ' + terms.length + ' search terms analysed. Sheet: ' + url);
  if (EMAIL) {
    MailApp.sendEmail(EMAIL, 'Search term n-grams: ' + account.getName(),
      'Your n-gram analysis for ' + range.from + ' to ' + range.to + ' is ready:\n' + url +
      '\n\nFrom the free Second Query n-gram script: https://secondquery.com/google-ads-scripts/');
  }
}

// Search terms from Search campaigns, rolled up by term.
function fetchSearchTerms_(range) {
  var query =
    'SELECT campaign.name, search_term_view.search_term, metrics.impressions, metrics.clicks, ' +
    'metrics.cost_micros, metrics.conversions, metrics.conversions_value ' +
    'FROM search_term_view ' +
    "WHERE segments.date BETWEEN '" + range.from + "' AND '" + range.to + "' " +
    "AND campaign.advertising_channel_type = 'SEARCH' AND metrics.impressions > 0";
  var rows = AdsApp.search(query);
  var byTerm = {};
  var filter = CAMPAIGN_NAME_CONTAINS.toLowerCase();
  while (rows.hasNext()) {
    var row = rows.next();
    if (filter && String(row.campaign.name).toLowerCase().indexOf(filter) < 0) continue;
    var term = String(row.searchTermView.searchTerm || '').trim();
    if (!term) continue;
    var m = row.metrics;
    var t = byTerm[term] || (byTerm[term] = { term: term, impressions: 0, clicks: 0, cost: 0, conversions: 0, value: 0 });
    t.impressions += num_(m.impressions);
    t.clicks += num_(m.clicks);
    t.cost += num_(m.costMicros) / 1e6;
    t.conversions += num_(m.conversions);
    t.value += num_(m.conversionsValue);
  }
  return Object.keys(byTerm).map(function (k) { return byTerm[k]; });
}

// Each n-gram counts once per search term, so repeated words don't double count.
function buildNgrams_(terms, n) {
  var map = {};
  terms.forEach(function (t) {
    var words = t.term.toLowerCase().replace(/["“”(),.!?;:|\/]+/g, ' ').split(/\s+/).filter(function (w) { return w; });
    var seen = {};
    for (var i = 0; i + n <= words.length; i++) {
      var gram = words.slice(i, i + n).join(' ');
      if (seen[gram]) continue;
      seen[gram] = true;
      var g = map[gram] || (map[gram] = { gram: gram, terms: 0, impressions: 0, clicks: 0, cost: 0, conversions: 0, value: 0 });
      g.terms += 1;
      g.impressions += t.impressions;
      g.clicks += t.clicks;
      g.cost += t.cost;
      g.conversions += t.conversions;
      g.value += t.value;
    }
  });
  return Object.keys(map)
    .map(function (k) { return map[k]; })
    .filter(function (g) { return g.impressions >= MIN_IMPRESSIONS; })
    .sort(function (a, b) { return b.cost - a.cost; });
}

function flag_(g, wasteAt, avgCpa) {
  if (g.conversions === 0 && wasteAt > 0 && g.cost >= wasteAt) return 'No conversions, high cost';
  if (g.conversions > 0 && avgCpa > 0 && g.cost / g.conversions <= 0.8 * avgCpa) return 'Converts well';
  return '';
}

function writeGramTab_(ss, name, grams, currency) {
  var sh = resetSheet_(ss, name);
  var head = ['N-gram', 'Search terms', 'Impressions', 'Clicks', 'CTR', 'Cost (' + currency + ')', 'Conversions',
    'Conv. rate', 'Cost / conv.', 'Conv. value', 'Value / cost', 'Flag'];
  var data = grams.map(function (g) {
    return [g.gram, g.terms, g.impressions, g.clicks, div_(g.clicks, g.impressions), round_(g.cost), round_(g.conversions),
      div_(g.conversions, g.clicks), g.conversions ? round_(g.cost / g.conversions) : '', round_(g.value),
      g.cost ? round_(g.value / g.cost) : '', g.flag];
  });
  sh.getRange(1, 1, 1, head.length).setValues([head]);
  if (data.length) sh.getRange(2, 1, data.length, head.length).setValues(data);
  styleTable_(sh, head.length, data.length);
  if (data.length) {
    sh.getRange(2, 5, data.length, 1).setNumberFormat('0.0%');
    sh.getRange(2, 8, data.length, 1).setNumberFormat('0.0%');
    sh.getRange(2, 6, data.length, 1).setNumberFormat('#,##0.00');
    sh.getRange(2, 9, data.length, 3).setNumberFormat('#,##0.00');
    var rules = sh.getConditionalFormatRules();
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('No conversions, high cost')
      .setBackground('#ffe3ee').setFontColor('#c20a52').setRanges([sh.getRange(2, 12, data.length, 1)]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Converts well')
      .setBackground('#e2f5ea').setFontColor('#1d6b3f').setRanges([sh.getRange(2, 12, data.length, 1)]).build());
    sh.setConditionalFormatRules(rules);
    sh.getRange(1, 1, data.length + 1, head.length).createFilter();
  }
  sh.setColumnWidth(1, 240);
  sh.setColumnWidth(12, 190);
}

function writeSummary_(ss, accountName, range, currency, totals, avgCpa, wasteAt, tabs) {
  var sh = resetSheet_(ss, 'Summary');
  ss.setActiveSheet(sh);
  ss.moveActiveSheet(1);
  sh.getRange('A1').setValue('Search term n-grams').setFontSize(20).setFontWeight('bold').setFontColor(BRAND.ink);
  sh.getRange('A2').setValue(accountName + '  ·  ' + range.from + ' to ' + range.to + '  ·  Search campaigns' +
    (CAMPAIGN_NAME_CONTAINS ? ' containing "' + CAMPAIGN_NAME_CONTAINS + '"' : '')).setFontColor('#3a5763');

  var kpis = [
    ['Cost (' + currency + ')', round_(totals.cost)],
    ['Clicks', totals.clicks],
    ['Conversions', round_(totals.conversions)],
    ['Average cost / conv.', avgCpa ? round_(avgCpa) : 'n/a'],
    ['Waste threshold', wasteAt ? round_(wasteAt) : 'n/a']
  ];
  sh.getRange(4, 1, 1, kpis.length).setValues([kpis.map(function (k) { return k[0]; })])
    .setFontColor('#3a5763').setFontSize(9);
  sh.getRange(5, 1, 1, kpis.length).setValues([kpis.map(function (k) { return k[1]; })])
    .setFontSize(16).setFontWeight('bold').setFontColor(BRAND.ink).setNumberFormat('#,##0.##');

  // Wasted-spend table across all three tabs, then a chart of the top single words and phrases.
  var row = 8;
  sh.getRange(row, 1).setValue('Costliest n-grams with no conversions').setFontWeight('bold').setFontSize(13).setFontColor(BRAND.ink);
  var head = ['N-gram', 'Type', 'Cost (' + currency + ')', 'Clicks', 'Search terms'];
  var wasted = [];
  tabs.forEach(function (t) {
    t.grams.filter(function (g) { return g.flag === 'No conversions, high cost'; }).slice(0, 10).forEach(function (g) {
      wasted.push([g.gram, t.tab.name, round_(g.cost), g.clicks, g.terms]);
    });
  });
  wasted.sort(function (a, b) { return b[2] - a[2]; });
  wasted = wasted.slice(0, 15);
  sh.getRange(row + 1, 1, 1, head.length).setValues([head]);
  if (wasted.length) {
    sh.getRange(row + 2, 1, wasted.length, head.length).setValues(wasted);
    sh.getRange(row + 2, 3, wasted.length, 1).setNumberFormat('#,##0.00');
  } else {
    sh.getRange(row + 2, 1).setValue(wasteAt ? 'Nothing over the waste threshold. Nice.' : 'No conversions recorded, so set WASTE_MIN_COST to flag waste.');
  }
  styleHeader_(sh.getRange(row + 1, 1, 1, head.length));
  bands_(sh, row + 2, head.length, Math.max(wasted.length, 1));

  if (wasted.length) {
    var chart = sh.newChart().asBarChart()
      .addRange(sh.getRange(row + 1, 1, wasted.length + 1, 1))
      .addRange(sh.getRange(row + 1, 3, wasted.length + 1, 1))
      .setNumHeaders(1)
      .setTitle('No-conversion spend by n-gram')
      .setColors([BRAND.pink])
      .setOption('legend', { position: 'none' })
      .setOption('hAxis.format', '#,##0')
      .setPosition(8, 7, 0, 0)
      .setOption('width', 560)
      .setOption('height', Math.max(260, wasted.length * 28 + 80))
      .build();
    sh.insertChart(chart);
  }

  var notes = row + 4 + Math.max(wasted.length, 1);
  sh.getRange(notes, 1).setValue('How to read this').setFontWeight('bold').setFontColor(BRAND.ink);
  sh.getRange(notes + 1, 1, 3, 1).setValues([
    ['Pink rows have spent at least the waste threshold without a conversion: check the search terms behind them before adding negatives.'],
    ['Green rows convert at 80% or less of your average cost per conversion: candidates for their own keywords or more budget.'],
    ['Each n-gram counts once per search term, so totals across rows add up to more than the account total.']
  ]).setFontColor('#3a5763');
  sh.getRange(notes + 5, 1).setValue('Free script from Second Query · secondquery.com/google-ads-scripts')
    .setFontColor(BRAND.pink).setFontSize(9);
  sh.setColumnWidth(1, 220);
  sh.setColumnWidth(2, 150);
  sh.setHiddenGridlines(true);
}

// ---- Helpers -----------------------------------------------------------------------------
function openSpreadsheet_(accountName) {
  if (SPREADSHEET_URL) return SpreadsheetApp.openByUrl(SPREADSHEET_URL);
  var ss = SpreadsheetApp.create('Search term n-grams: ' + accountName);
  Logger.log('Created a new Sheet. Paste this into SPREADSHEET_URL to reuse it: ' + ss.getUrl());
  return ss;
}

function resetSheet_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (sh) {
    sh.getCharts().forEach(function (c) { sh.removeChart(c); });
    if (sh.getFilter()) sh.getFilter().remove();
    sh.clear();
    sh.clearConditionalFormatRules();
  } else {
    sh = ss.insertSheet(name);
  }
  var blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);
  return sh;
}

function styleTable_(sh, cols, rows) {
  styleHeader_(sh.getRange(1, 1, 1, cols));
  sh.setFrozenRows(1);
  sh.setFrozenColumns(1);
  if (rows) bands_(sh, 2, cols, rows);
}

function styleHeader_(range) {
  range.setBackground(BRAND.ink).setFontColor(BRAND.white).setFontWeight('bold').setWrap(true);
}

function bands_(sh, startRow, cols, rows) {
  var colours = [];
  for (var i = 0; i < rows; i++) {
    var c = i % 2 ? BRAND.soft : BRAND.white;
    var line = [];
    for (var j = 0; j < cols; j++) line.push(c);
    colours.push(line);
  }
  sh.getRange(startRow, 1, rows, cols).setBackgrounds(colours);
}

function dateRange_(days, tz) {
  var end = new Date(Date.now() - 864e5);
  var start = new Date(end.getTime() - (days - 1) * 864e5);
  return { from: Utilities.formatDate(start, tz, 'yyyy-MM-dd'), to: Utilities.formatDate(end, tz, 'yyyy-MM-dd') };
}

function sum_(rows) {
  return rows.reduce(function (a, r) {
    a.impressions += r.impressions; a.clicks += r.clicks; a.cost += r.cost; a.conversions += r.conversions; a.value += r.value;
    return a;
  }, { impressions: 0, clicks: 0, cost: 0, conversions: 0, value: 0 });
}

function num_(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function div_(a, b) { return b ? a / b : 0; }
function round_(v) { return Math.round(v * 100) / 100; }
