/**
 * Performance anomaly alert
 * A free Google Ads script from Second Query: https://secondquery.com/google-ads-scripts/
 * Version 1.0, November 2026. Free to use and adapt; please keep this header.
 *
 * WHAT IT DOES
 * Every morning, compares yesterday with the same weekday over the previous few weeks, for
 * the account and for each campaign. If cost, clicks, conversions or cost per conversion
 * moved further than your thresholds, or a campaign that normally spends stopped spending,
 * it emails you a short table of what changed. Comparing like-for-like weekdays avoids false
 * alarms from normal weekend dips.
 *
 * It only reads data. It never changes anything in your account. No email means nothing
 * unusual happened.
 *
 * HOW TO USE IT
 * 1. In Google Ads, go to Tools > Bulk actions > Scripts, click +, and paste this in.
 * 2. Put your email address in EMAIL. Click Preview, then Run.
 * 3. Schedule it daily, early in the morning (for example 6am).
 */

// ---- Settings -------------------------------------------------------------------------
var EMAIL = 'you@example.com';      // One address, or several separated by commas.
var WEEKS_TO_COMPARE = 4;           // How many previous same weekdays make the baseline.
var MIN_BASELINE_CLICKS = 20;       // Only check campaigns averaging at least this many clicks.
var THRESHOLDS = {                  // Alert when yesterday moves more than this from the baseline.
  cost: 0.40,                       // 0.40 = 40% up or down
  clicks: 0.40,
  conversions: 0.50,
  costPerConv: 0.50
};
var MIN_BASELINE_CONVERSIONS = 3;   // Only judge conversions and cost / conv. above this baseline.
var CAMPAIGN_NAME_CONTAINS = '';    // Only include campaigns whose name contains this. Blank = all.
// ----------------------------------------------------------------------------------------

function main() {
  var account = AdsApp.currentAccount();
  var tz = account.getTimeZone();
  var currency = account.getCurrencyCode();
  var yesterday = Utilities.formatDate(new Date(Date.now() - 864e5), tz, 'yyyy-MM-dd');
  var baseDays = [];
  for (var w = 1; w <= WEEKS_TO_COMPARE; w++) {
    baseDays.push(Utilities.formatDate(new Date(Date.now() - (1 + 7 * w) * 864e5), tz, 'yyyy-MM-dd'));
  }
  var from = baseDays[baseDays.length - 1];

  var data = fetchDaily_(from, yesterday);
  var findings = [];
  Object.keys(data).forEach(function (id) {
    var c = data[id];
    var check = compare_(c.name, c.days, yesterday, baseDays);
    if (check) findings.push(check);
  });
  var total = compare_('Whole account', totalDays_(data), yesterday, baseDays);
  if (total) findings.unshift(total);

  if (!findings.length) {
    Logger.log('Nothing unusual on ' + yesterday + ' against the last ' + WEEKS_TO_COMPARE + ' same weekdays.');
    return;
  }
  var weekday = Utilities.formatDate(new Date(Date.now() - 864e5), tz, 'EEEE');
  var subject = 'Google Ads: ' + findings.length + ' thing' + (findings.length > 1 ? 's' : '') +
    ' to check in ' + account.getName() + ' (' + yesterday + ')';
  MailApp.sendEmail({ to: EMAIL, subject: subject, htmlBody: emailHtml_(account.getName(), weekday, yesterday, currency, findings) });
  Logger.log('Sent an alert with ' + findings.length + ' finding(s) to ' + EMAIL);
}

function fetchDaily_(from, to) {
  var query =
    'SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.clicks, metrics.conversions ' +
    'FROM campaign ' +
    "WHERE segments.date BETWEEN '" + from + "' AND '" + to + "' AND campaign.status != 'REMOVED'";
  var rows = AdsApp.search(query);
  var out = {};
  var filter = CAMPAIGN_NAME_CONTAINS.toLowerCase();
  while (rows.hasNext()) {
    var r = rows.next();
    var name = String(r.campaign.name);
    if (filter && name.toLowerCase().indexOf(filter) < 0) continue;
    var id = String(r.campaign.id);
    var c = out[id] || (out[id] = { name: name, days: {} });
    var d = c.days[r.segments.date] || (c.days[r.segments.date] = { cost: 0, clicks: 0, conversions: 0 });
    d.cost += num_(r.metrics.costMicros) / 1e6;
    d.clicks += num_(r.metrics.clicks);
    d.conversions += num_(r.metrics.conversions);
  }
  return out;
}

function totalDays_(data) {
  var days = {};
  Object.keys(data).forEach(function (id) {
    var c = data[id];
    Object.keys(c.days).forEach(function (date) {
      var t = days[date] || (days[date] = { cost: 0, clicks: 0, conversions: 0 });
      t.cost += c.days[date].cost;
      t.clicks += c.days[date].clicks;
      t.conversions += c.days[date].conversions;
    });
  });
  return days;
}

// Returns a finding when yesterday is outside the thresholds, otherwise null.
function compare_(name, days, yesterday, baseDays) {
  var y = days[yesterday] || { cost: 0, clicks: 0, conversions: 0 };
  var base = { cost: 0, clicks: 0, conversions: 0 };
  baseDays.forEach(function (d) {
    var v = days[d] || { cost: 0, clicks: 0, conversions: 0 };
    base.cost += v.cost / baseDays.length;
    base.clicks += v.clicks / baseDays.length;
    base.conversions += v.conversions / baseDays.length;
  });
  if (base.clicks < MIN_BASELINE_CLICKS) return null;

  var issues = [];
  if (base.cost > 0 && y.cost === 0) {
    issues.push({ metric: 'Cost', note: 'Stopped spending', y: 0, base: base.cost, change: -1 });
  } else {
    pushIfMoved_(issues, 'Cost', y.cost, base.cost, THRESHOLDS.cost);
    pushIfMoved_(issues, 'Clicks', y.clicks, base.clicks, THRESHOLDS.clicks);
  }
  if (base.conversions >= MIN_BASELINE_CONVERSIONS) {
    pushIfMoved_(issues, 'Conversions', y.conversions, base.conversions, THRESHOLDS.conversions);
    var yCpa = y.conversions ? y.cost / y.conversions : null;
    var bCpa = base.cost / base.conversions;
    if (yCpa === null && y.cost > bCpa) {
      issues.push({ metric: 'Cost / conv.', note: 'Spent more than a normal cost per conversion with no conversions', y: y.cost, base: bCpa, change: null });
    } else if (yCpa !== null) {
      pushIfMoved_(issues, 'Cost / conv.', yCpa, bCpa, THRESHOLDS.costPerConv);
    }
  }
  return issues.length ? { name: name, issues: issues } : null;
}

function pushIfMoved_(issues, metric, y, base, limit) {
  if (base <= 0) return;
  var change = (y - base) / base;
  if (Math.abs(change) > limit) issues.push({ metric: metric, note: change > 0 ? 'Up' : 'Down', y: y, base: base, change: change });
}

function emailHtml_(accountName, weekday, date, currency, findings) {
  var cell = 'padding:8px 10px;border-bottom:1px solid #b2d3dd;text-align:left;font:14px Arial,sans-serif;color:#06222e';
  var rows = '';
  findings.forEach(function (f) {
    f.issues.forEach(function (i, n) {
      var money = /Cost/.test(i.metric);
      var fmt = function (v) { return (money ? currency + ' ' : '') + (Math.round(v * 100) / 100).toLocaleString('en-GB'); };
      var pct = i.change === null ? '' : (i.change > 0 ? '+' : '') + Math.round(i.change * 100) + '%';
      var bad = i.change === null || i.metric === 'Cost' || (i.metric === 'Cost / conv.' ? i.change > 0 : i.change < 0);
      var colour = bad ? '#c20a52' : '#1d6b3f';
      rows += '<tr><td style="' + cell + ';font-weight:bold">' + (n === 0 ? esc_(f.name) : '') + '</td>' +
        '<td style="' + cell + '">' + i.metric + '</td>' +
        '<td style="' + cell + '">' + fmt(i.y) + '</td>' +
        '<td style="' + cell + '">' + fmt(i.base) + '</td>' +
        '<td style="' + cell + ';color:' + colour + ';font-weight:bold">' +
        [pct, /^(Up|Down)$/.test(i.note) ? '' : esc_(i.note)].filter(String).join(' · ') + '</td></tr>';
    });
  });
  var th = 'padding:8px 10px;background:#06222e;color:#ffffff;text-align:left;font:bold 13px Arial,sans-serif';
  return '<div style="font:15px Arial,sans-serif;color:#06222e;max-width:720px">' +
    '<p style="font-size:18px;font-weight:bold;margin:0 0 6px">' + esc_(accountName) + ': ' + date + '</p>' +
    '<p style="margin:0 0 14px;color:#3a5763">Yesterday compared with the average of the previous ' + WEEKS_TO_COMPARE + ' ' + weekday + 's.</p>' +
    '<table style="border-collapse:collapse;width:100%"><tr><th style="' + th + '">Campaign</th><th style="' + th + '">Metric</th>' +
    '<th style="' + th + '">Yesterday</th><th style="' + th + '">Usual ' + weekday + '</th><th style="' + th + '">Change</th></tr>' + rows + '</table>' +
    '<p style="margin:16px 0 0;color:#3a5763;font-size:13px">Check recent changes, budgets, disapprovals and conversion tracking first. ' +
    'Free script from <a href="https://secondquery.com/google-ads-scripts/" style="color:#ff2e7e">Second Query</a>.</p></div>';
}

function esc_(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function num_(v) { var n = Number(v); return isFinite(n) ? n : 0; }
