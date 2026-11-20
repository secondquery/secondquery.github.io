/* Account X-ray: reads Google Ads / Microsoft Advertising CSV exports entirely in the browser.
   Nothing is uploaded: files are read with FileReader and analysed in memory.
   The rules and thresholds live in /static/xray-rules.json, which is reviewed monthly against platform guidance. */
(() => {
  const root = document.getElementById('xray');
  if (!root) return;
  const $ = s => root.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const gbp = n => (n < 0 ? '-£' : '£') + Math.round(Math.abs(n)).toLocaleString('en-GB');
  const gbp2 = n => '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = n => (isFinite(n) ? Math.round(n * 100) : 0) + '%';
  const int = n => Math.round(n).toLocaleString('en-GB');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- rules (thresholds and sources), reviewed monthly ---------- */
  let RULES = {
    reviewedLabel: '', thresholds: {
      brandShareLook: 0.2, brandSharePriority: 0.4, pmaxShareLook: 0.4, lostBudgetCap: 10, lostRankHigh: 30,
      zeroConvSpendLook: 0.03, zeroConvSpendPriority: 0.1, termWasteLook: 0.12, termWastePriority: 0.25,
      openMatchLook: 0.5, lowDataConversions: 15, workingIndex: 1.1, weakIndex: 0.7, manualShareLook: 0.2
    }, rules: []
  };
  const TH = () => RULES.thresholds;
  const ruleLink = id => {
    const r = RULES.rules.find(x => x.id === id);
    if (!r || !r.sources || !r.sources.length) return '';
    return `<a class="why" href="${esc(r.sources[0].url)}" rel="noopener" target="_blank">Why: ${esc(r.sources[0].title.replace(/^.*?: /, ''))}</a>`;
  };
  fetch('/static/xray-rules.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(j => {
    if (!j) return;
    RULES = { ...RULES, ...j, thresholds: { ...RULES.thresholds, ...(j.thresholds || {}) } };
    document.querySelectorAll('[data-rules-reviewed]').forEach(el => { el.textContent = RULES.reviewedLabel; });
    const list = document.getElementById('xr-rules');
    if (list) list.innerHTML = RULES.rules.map(r => `<li><b>${esc(r.title)}</b><span>${esc(r.how)}</span><span class="src">${r.sources.map(s => `<a href="${esc(s.url)}" rel="noopener" target="_blank">${esc(s.title)}</a>`).join(' · ')}</span></li>`).join('');
  }).catch(() => {});

  /* platform tabs */
  root.querySelectorAll('.xtabs button').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('.xtabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    root.querySelectorAll('.xtab').forEach(p => { p.hidden = p.dataset.pane !== b.dataset.tab; });
  }));

  const status = $('#xr-status'), out = $('#xr-out'), fileIn = $('#xr-file'), drop = $('#xr-drop'), brandIn = $('#xr-brand'), reset = $('#xr-reset');
  const state = { campaigns: null, terms: null, sample: false, names: [], msgs: [] };

  /* ---------- reading files ---------- */
  const decode = buf => {
    const b = new Uint8Array(buf);
    if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(buf.slice(2));
    if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(buf.slice(2));
    let zeros = 0;
    for (let i = 1; i < Math.min(b.length, 400); i += 2) if (b[i] === 0) zeros++;
    if (zeros > 60) return new TextDecoder('utf-16le').decode(buf);
    return new TextDecoder('utf-8').decode(buf).replace(/^﻿/, '');
  };

  const parseDelimited = text => {
    const head = text.slice(0, 4000);
    const count = re => (head.match(re) || []).length;
    const tabs = count(/\t/g), commas = count(/,/g), semis = count(/;/g);
    const d = tabs >= commas && tabs > semis ? '\t' : (semis > commas ? ';' : ',');
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === d) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  };

  const num = v => {
    if (v == null) return NaN;
    let s = String(v).trim();
    if (!s || /^-+$/.test(s) || s === ' --') return NaN;
    if (/^</.test(s)) return parseFloat(s.replace(/[^\d.]/g, '')) / 2;
    s = s.replace(/[<>%£$€\s ]/g, '').replace(/,/g, '');
    const n = parseFloat(s);
    return isNaN(n) ? NaN : n;
  };

  const norm = h => String(h || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const findCol = (hdr, tests) => hdr.findIndex(h => tests.some(t => typeof t === 'string' ? h === t : t.test(h)));

  const COLS = {
    campaign: { tests: ['campaign', 'campaign name'], label: 'Campaign' },
    type: { tests: ['campaign type', 'campaign sub type', 'advertising channel type'], label: 'Campaign type', unlocks: 'spotting Performance Max share' },
    cost: { tests: ['cost', 'spend', /^cost \(/], label: 'Cost / Spend' },
    conv: { tests: ['conversions', 'conv.', 'conv'], label: 'Conversions' },
    value: { tests: ['conv. value', 'conversion value', 'conversions value', 'revenue', 'total conv. value'], label: 'Conv. value / Revenue', unlocks: 'judging return on ad spend, not just cost per conversion' },
    clicks: { tests: ['clicks'], label: 'Clicks', unlocks: 'click counts in the tables' },
    lost: { tests: [/lost.*budget/], label: 'Lost impression share (budget)', unlocks: 'finding efficient campaigns held back by budget' },
    rank: { tests: [/lost.*rank/], label: 'Lost impression share (rank)', unlocks: 'seeing whether ad quality or bids hold you back' },
    bid: { tests: ['bid strategy type', 'bid strategy', 'bidding strategy type'], label: 'Bid strategy type', unlocks: 'checking manual bidding' },
    impr: { tests: ['impr.', 'impressions', 'impr'], label: 'Impressions', unlocks: 'weighting impression share correctly across days' },
    share: { tests: ['search impr. share', 'impr. share (%)', 'impression share', 'search impression share', 'impr. share'], label: 'Search impr. share', unlocks: 'combining impression share accurately across days' },
    date: { tests: ['day', 'date', 'week', 'month', 'quarter', 'gregorian date', 'time period', 'week (mon - sun)', 'week (sun - sat)', 'week (monday)'], label: 'Day / week (optional)', unlocks: 'spotting trends across the period' },
    term: { tests: ['search term', 'search query'], label: 'Search term' },
    match: { tests: ['match type', 'search term match type', 'delivered match type', 'keyword match type', 'bid match type'], label: 'Match type', unlocks: 'measuring AI Mode exposure' }
  };
  const WANT = {
    campaigns: { required: ['campaign', 'cost', 'conv'], recommended: ['type', 'value', 'lost', 'rank', 'share', 'impr', 'date'] },
    terms: { required: ['term', 'cost', 'conv'], recommended: ['match', 'value'] }
  };

  const readTable = text => {
    const rows = parseDelimited(text).filter(r => r.some(c => String(c).trim() !== ''));
    let hi = -1;
    for (let i = 0; i < Math.min(rows.length, 25); i++) {
      const h = rows[i].map(norm);
      if (h.some(x => ['campaign', 'campaign name', 'search term', 'search query'].includes(x)) &&
          h.some(x => ['cost', 'spend', 'clicks'].includes(x) || /^cost/.test(x))) { hi = i; break; }
    }
    if (hi < 0) return null;
    const hdr = rows[hi].map(norm);
    const cols = {};
    Object.entries(COLS).forEach(([k, v]) => { cols[k] = findCol(hdr, v.tests); });
    const pre = rows.slice(0, hi).map(r => r.join(' ').trim()).filter(Boolean);
    const dateLine = pre.map(l => l.replace(/^report time:\s*/i, '')).find(l => /\d/.test(l) && /(-|–|to)/.test(l) && /(\d{4})/.test(l)) || '';
    const isTotal = r => r.slice(0, 3).some(c => /^\s*total/i.test(String(c)));
    const totals = rows.slice(hi + 1).filter(isTotal);
    const data = rows.slice(hi + 1).filter(r => !isTotal(r) && !/microsoft corporation|^\s*©/i.test(r.join(' ')));
    let fileTotal = null;
    if (totals.length && cols.cost >= 0) {
      const pick = totals.find(r => /account|campaigns|search terms|filtered/i.test(r.slice(0, 3).join(' '))) || totals[0];
      const c = num(pick[cols.cost]);
      if (!isNaN(c)) fileTotal = { cost: c, conv: cols.conv >= 0 ? num(pick[cols.conv]) : NaN };
    }
    const ms = hdr.includes('spend') || hdr.includes('campaign name') || hdr.includes('delivered match type');
    const kind = cols.term >= 0 ? 'terms' : (cols.campaign >= 0 ? 'campaigns' : null);
    return { cols, data, kind, platform: ms ? 'Microsoft Advertising' : 'Google Ads', dateLine, fileTotal };
  };

  /* ---------- classification ---------- */
  const brandWords = () => (brandIn.value || '').toLowerCase().split(',').map(s => s.trim()).filter(s => s.length > 1);
  const isBrandTerm = t => brandWords().some(b => t.includes(b));
  const words = n => ' ' + n.toLowerCase().replace(/[_|\-–:/\\.,()[\]]+/g, ' ').replace(/\s+/g, ' ') + ' ';

  const chanFromType = t => {
    t = (t || '').toLowerCase();
    if (!t.trim()) return null;
    if (/performance max/.test(t)) return 'Performance Max';
    if (/shopping/.test(t)) return 'Shopping';
    if (/demand gen|discovery/.test(t)) return 'Demand Gen';
    if (/video|youtube/.test(t)) return 'Video';
    if (/display|audience/.test(t)) return 'Display';
    if (/\bapp\b/.test(t)) return 'App';
    if (/hotel|travel/.test(t)) return 'Travel';
    if (/smart/.test(t)) return 'Smart';
    if (/local/.test(t)) return 'Local';
    if (/search/.test(t)) return 'Search';
    return 'Other';
  };
  const chanFromName = n => {
    const w = words(n);
    if (/ pmax | p max | performance max /.test(w)) return 'Performance Max';
    if (/ shopping | pla | smart shopping /.test(w)) return 'Shopping';
    if (/ demand gen | dgen | discovery /.test(w)) return 'Demand Gen';
    if (/ youtube | yt | video /.test(w)) return 'Video';
    if (/ display | gdn | remarketing | rmkt | retargeting /.test(w)) return 'Display';
    if (/ search | dsa | rlsa /.test(w)) return 'Search';
    return null;
  };
  const PERF = new Set(['Search', 'Shopping', 'Performance Max']);
  const AWARE = new Set(['Display', 'Video', 'Demand Gen']);
  const IS_OK = new Set(['Search', 'Shopping']);

  const classify = (c, hasType) => {
    const w = words(c.name);
    const typed = chanFromType(c.type);
    const named = chanFromName(c.name);
    c.channel = typed || named || 'Unknown';
    c.chanSource = typed ? 'type' : (named ? 'name' : 'none');
    c.mismatch = !!(typed && named && named !== typed && !(typed === 'Search' && named === 'Search'));
    c.nameChan = named;
    const userBrand = brandWords().some(b => c.name.toLowerCase().includes(b));
    const nonBrand = / non brand | nonbrand | nb | generic | category | prospecting | prospect /.test(w);
    const comp = / competitor | competitors | comp | conquest | conquesting | rival | vs /.test(w);
    const dsa = / dsa | dynamic /.test(w);
    const brandWord = / brand | branded /.test(w) && !/ brand awareness | brand building | brand lift | brand video /.test(w);
    c.intent = 'Not applicable'; c.conf = 'n/a';
    const searchLike = c.channel === 'Search' || (c.channel === 'Unknown' && !hasType);
    if (searchLike) {
      if (dsa) { c.intent = 'Dynamic Search Ads'; c.conf = 'medium'; }
      else if (comp) { c.intent = 'Competitor'; c.conf = 'medium'; }
      else if (nonBrand) { c.intent = 'Generic'; c.conf = 'medium'; }
      else if (userBrand && brandWord) { c.intent = 'Brand'; c.conf = 'high'; }
      else if (userBrand || brandWord) { c.intent = 'Brand'; c.conf = 'medium'; }
      else { c.intent = 'Unclear'; c.conf = 'low'; }
      if (c.channel === 'Unknown' && c.conf === 'high') c.conf = 'medium';
    } else if (c.channel === 'Shopping') { c.intent = 'Shopping'; c.conf = c.chanSource === 'type' ? 'high' : 'low'; }
    else if (c.channel === 'Performance Max') { c.intent = (userBrand || brandWord) ? 'Mixed (name mentions brand)' : 'Mixed'; c.conf = 'low'; }
    else if (AWARE.has(c.channel)) { c.intent = 'Awareness or remarketing'; c.conf = c.chanSource === 'type' ? 'medium' : 'low'; }
    else { c.intent = 'Unknown'; c.conf = 'low'; }
    c.isBrand = c.intent === 'Brand';
  };

  /* ---------- dates ---------- */
  const parseDate = (s, ms) => {
    s = String(s || '').trim();
    if (!s) return null;
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(+m[1], m[2] - 1, +m[3]);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      let a = +m[1], b = +m[2];
      const dayFirst = a > 12 ? true : (b > 12 ? false : !ms);
      return dayFirst ? new Date(+m[3], b - 1, a) : new Date(+m[3], a - 1, b);
    }
    const t = Date.parse(s.replace(/^[A-Za-z]{3,9},?\s+/, ''));
    return isNaN(t) ? null : new Date(t);
  };
  const fmtDate = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  /* ---------- campaign analysis ---------- */
  const analyseCampaigns = t => {
    const c = t.cols;
    if (c.cost < 0) return { error: 'I could not find a Cost or Spend column in the campaign report.' };
    const ms = t.platform === 'Microsoft Advertising';
    const map = new Map();
    const byDate = new Map();
    let dated = 0;
    t.data.forEach(r => {
      const name = String(r[c.campaign] || '').trim();
      if (!name || name === '--') return;
      const cost = num(r[c.cost]) || 0, conv = c.conv >= 0 ? (num(r[c.conv]) || 0) : 0, value = c.value >= 0 ? (num(r[c.value]) || 0) : 0;
      const clicks = c.clicks >= 0 ? (num(r[c.clicks]) || 0) : 0, impr = c.impr >= 0 ? (num(r[c.impr]) || 0) : 0;
      const type = c.type >= 0 ? String(r[c.type] || '').trim() : '';
      const key = name + '\u0000' + type;
      const e = map.get(key) || { name, type, bid: '', cost: 0, conv: 0, value: 0, clicks: 0, impr: 0, rows: 0, is: { elig: 0, lb: 0, lr: 0, w: 0, wlb: 0, wlr: 0, n: 0, slb: 0, slr: 0, approx: false, seen: false }, periods: new Map() };
      e.cost += cost; e.conv += conv; e.value += value; e.clicks += clicks; e.impr += impr; e.rows++;
      if (c.bid >= 0 && !e.bid) e.bid = String(r[c.bid] || '');
      const lb = c.lost >= 0 ? num(r[c.lost]) : NaN, lr = c.rank >= 0 ? num(r[c.rank]) : NaN, sh = c.share >= 0 ? num(r[c.share]) : NaN;
      if (!isNaN(lb) || !isNaN(lr)) {
        e.is.seen = true;
        if (!isNaN(sh) && sh > 0 && impr > 0) {
          const elig = impr / (sh / 100);
          e.is.elig += elig; e.is.lb += elig * ((isNaN(lb) ? 0 : lb) / 100); e.is.lr += elig * ((isNaN(lr) ? 0 : lr) / 100);
        } else if (impr > 0) {
          e.is.w += impr; e.is.wlb += impr * (isNaN(lb) ? 0 : lb); e.is.wlr += impr * (isNaN(lr) ? 0 : lr); e.is.approx = true;
        } else {
          e.is.n++; e.is.slb += isNaN(lb) ? 0 : lb; e.is.slr += isNaN(lr) ? 0 : lr; e.is.approx = true;
        }
      }
      if (c.date >= 0) {
        const d = parseDate(r[c.date], ms);
        if (d) {
          dated++;
          const k = d.getTime();
          const p = byDate.get(k) || { cost: 0, conv: 0, value: 0 };
          p.cost += cost; p.conv += conv; p.value += value; byDate.set(k, p);
          const q = e.periods.get(k) || { cost: 0, conv: 0, value: 0 };
          q.cost += cost; q.conv += conv; q.value += value; e.periods.set(k, q);
        }
      }
      map.set(key, e);
    });
    const list = [...map.values()].filter(x => x.cost > 0 || x.conv > 0);
    if (!list.length) return { error: 'The campaign report had no rows with spend in it.' };
    const hasType = c.type >= 0;
    const isPerf = x => PERF.has(x.channel) || (x.channel === 'Unknown' && !hasType);
    list.forEach(x => {
      classify(x, hasType);
      const i = x.is;
      x.lost = NaN; x.rank = NaN; x.isApprox = false;
      if (i.seen && IS_OK.has(x.channel)) {
        if (i.elig > 0 && !i.approx) { x.lost = i.lb / i.elig * 100; x.rank = i.lr / i.elig * 100; }
        else if (i.elig + i.w > 0) { const tot = i.elig + i.w; x.lost = (i.lb * 100 + i.wlb) / tot; x.rank = (i.lr * 100 + i.wlr) / tot; x.isApprox = x.rows > 1; }
        else if (i.n) { x.lost = i.slb / i.n; x.rank = i.slr / i.n; x.isApprox = x.rows > 1; }
      }
    });
    const sum = (arr, k) => arr.reduce((a, x) => a + x[k], 0);
    const cost = sum(list, 'cost'), conv = sum(list, 'conv'), value = sum(list, 'value');
    const useValue = value > 0 && sum(list.filter(x => x.value > 0), 'cost') >= 0.5 * sum(list.filter(x => PERF.has(x.channel)), 'cost');
    const eff = (cs, cv, vl) => useValue ? (cs ? vl / cs : NaN) : (cv ? cs / cv : NaN);
    const comparable = list.filter(x => isPerf(x) && !x.isBrand);
    const base = eff(sum(comparable, 'cost'), sum(comparable, 'conv'), sum(comparable, 'value'));
    list.forEach(x => {
      x.eff = eff(x.cost, x.conv, x.value);
      x.idx = !isFinite(base) || !isFinite(x.eff) || x.conv < 0.5 ? NaN : (useValue ? x.eff / base : base / x.eff);
    });
    // a "brand" campaign that performs like non-brand is probably not pure brand
    list.filter(x => x.isBrand).forEach(x => { if (isFinite(x.idx) && x.idx < 1.3) { x.conf = 'low'; x.brandWeak = true; } });
    // period info
    let periodLabel = t.dateLine || '';
    let dates = [...byDate.keys()].sort((a, b) => a - b);
    if (dates.length) periodLabel = `${fmtDate(new Date(dates[0]))} to ${fmtDate(new Date(dates[dates.length - 1]))}`;
    return { list, cost, conv, value, useValue, base, comparable, byDate, dates, dated, periodLabel, n: list.length, hasIS: c.lost >= 0 || c.rank >= 0, hasType, isPerf };
  };

  /* ---------- search terms analysis ---------- */
  const analyseTerms = t => {
    const c = t.cols;
    if (c.cost < 0) return { error: 'I could not find a Cost or Spend column in the search terms report.' };
    const map = new Map();
    let hidden = 0;
    t.data.forEach(r => {
      const term = String(r[c.term] || '').trim().toLowerCase();
      if (!term || term === '--') return;
      const cost = num(r[c.cost]) || 0, conv = c.conv >= 0 ? (num(r[c.conv]) || 0) : 0;
      if (/^other search terms/.test(term)) { hidden += cost; return; }
      const e = map.get(term) || { term, cost: 0, conv: 0 };
      e.cost += cost; e.conv += conv; map.set(term, e);
    });
    const list = [...map.values()];
    if (!list.length) return { error: 'The search terms report had no search terms with data.' };
    const cost = list.reduce((a, x) => a + x.cost, 0) + hidden, conv = list.reduce((a, x) => a + x.conv, 0);
    const zeroCost = list.filter(x => x.conv < 0.5).reduce((a, x) => a + x.cost, 0);
    const longCost = list.filter(x => x.term.split(/\s+/).length >= 5).reduce((a, x) => a + x.cost, 0);
    const qCost = list.filter(x => /^(how|what|why|which|when|where|can|is|are|do|does|should)\b/.test(x.term)).reduce((a, x) => a + x.cost, 0);
    const brandCost = list.filter(x => isBrandTerm(x.term)).reduce((a, x) => a + x.cost, 0);
    return { list, cost, conv, zeroCost, longCost, qCost, brandCost, hidden, n: list.length };
  };

  /* ---------- insight engine: compute candidates, score, pick the strongest few ---------- */
  const fmtEff = (v, useValue) => !isFinite(v) ? 'n/a' : (useValue ? v.toFixed(2) + 'x ROAS' : gbp2(v) + ' per conversion');
  const pctDiff = idx => Math.round(Math.abs(idx - 1) * 100);
  const list3 = names => names.length <= 2 ? names.join(' and ') : names.slice(0, 2).join(', ') + ' and ' + (names.length - 2) + ' more';
  const q = s => '‘' + s + '’';

  const candidates = (C, T) => {
    const out = [];
    const add = (o) => { if (o) out.push({ evidence: 1, distinct: 0.7, ...o, score: 40 * Math.min(1, o.sig) + 30 * Math.min(1, o.mag) + 20 * (o.evidence ?? 1) + 10 * (o.distinct ?? 0.7) }); };
    if (C) {
      const tot = C.cost, uv = C.useValue;
      const sum = (arr, k) => arr.reduce((a, x) => a + x[k], 0);
      const eff = arr => uv ? sum(arr, 'value') / sum(arr, 'cost') : sum(arr, 'cost') / sum(arr, 'conv');

      // 1. brand vs non-brand
      const brand = C.list.filter(x => x.isBrand && x.conf !== 'low');
      const nb = C.comparable;
      const bCost = sum(brand, 'cost'), nbCost = sum(nb, 'cost');
      if (brand.length && bCost / tot >= 0.03 && nbCost / tot >= 0.2 && sum(brand, 'conv') >= 5) {
        const be = eff(brand), ne = eff(nb);
        const ratio = uv ? be / ne : ne / be;
        if (isFinite(ratio) && ratio >= 2) add({
          id: 'brand', family: 'brand', sig: (bCost + nbCost) / tot, mag: Math.log2(ratio) / 3, evidence: brand.some(x => x.conf === 'high') ? 0.9 : 0.7, distinct: 0.8,
          head: 'Brand and non-brand are telling very different stories',
          metrics: [`Brand: ${fmtEff(be, uv)}`, `Non-brand: ${fmtEff(ne, uv)}`],
          text: `${uv ? `Brand search is returning around ${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)} times what the rest of your performance activity does` : `Brand search is converting at around ${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)} times lower cost than the rest of your performance activity`}. Looking at the overall account average alone may be hiding part of the picture, and brand results raise their own question about how much of that demand would have arrived anyway.`,
          note: brand.some(x => x.conf === 'high') ? '' : 'Brand campaigns identified from their names.'
        });
      }

      // 2. growth signals: stronger Search/Shopping campaigns losing impression share to budget
      const growth = C.list.filter(x => IS_OK.has(x.channel) && !x.isBrand && x.idx >= 1.15 && x.lost >= 15 && x.cost / tot >= 0.02 && x.conv >= 5);
      if (growth.length) {
        const maxLost = Math.max(...growth.map(x => x.lost));
        const approx = growth.some(x => x.isApprox);
        add({
          id: 'growth', family: 'budget', sig: sum(growth, 'cost') / tot * 2, mag: Math.min(1, maxLost / 40) * Math.min(1, (Math.max(...growth.map(x => x.idx)) - 1) / 0.5), evidence: approx ? 0.6 : 0.9, distinct: 1,
          head: 'Some stronger Search campaigns are running into budget limits',
          metrics: [`${growth.length} campaign${growth.length > 1 ? 's' : ''}`, `up to ${Math.round(maxLost)}% of impressions lost to budget`],
          text: `${list3(growth.map(x => q(x.name)))} ${growth.length > 1 ? 'are' : 'is'} returning above the comparable average while also reporting meaningful impression share lost to budget. That could be worth exploring in more detail, although strong past returns don't guarantee the same from extra spend, and lost impression share isn't the same as lost revenue.`,
          note: approx ? 'Impression share is combined across days, so it\'s approximate.' : ''
        });
      }

      // 3. below-average investment among comparable campaigns
      const weak = C.comparable.filter(x => isFinite(x.idx) && x.idx <= 0.65 && x.cost / tot >= 0.02);
      const wCost = sum(weak, 'cost');
      if (weak.length && wCost / tot >= 0.1) {
        const wIdx = uv ? (sum(weak, 'value') / wCost) / C.base : C.base / (wCost / Math.max(1, sum(weak, 'conv')));
        add({
          id: 'weak', family: 'efficiency', sig: wCost / tot * 1.5, mag: 1 - wIdx, evidence: 0.9, distinct: 0.9,
          head: 'A meaningful share of investment is going into below-average campaigns',
          metrics: [`${gbp(wCost)} · ${pct(wCost / tot)} of spend`, uv ? `${pctDiff(wIdx)}% lower return than comparable activity` : `${pctDiff(1 / wIdx)}% higher cost per conversion`],
          text: `${list3(weak.sort((a, b) => b.cost - a.cost).map(x => q(x.name)))} ${weak.length > 1 ? 'are' : 'is'} delivering noticeably weaker reported returns than similar campaigns in the account. Understanding what's driving that difference could reveal opportunities. Lower reported returns don't necessarily mean unprofitable, as margins and each campaign's role matter.`
        });
      }

      // 4. spend with no reported conversions
      const zero = C.list.filter(x => x.conv < 0.5 && x.cost > 0);
      const zCost = sum(zero, 'cost');
      if (zCost / tot >= 0.04) {
        const aware = zero.filter(x => AWARE.has(x.channel));
        const mostlyAware = sum(aware, 'cost') >= 0.6 * zCost;
        add({
          id: 'zero', family: 'zero', sig: zCost / tot * 2, mag: Math.min(1, zCost / tot / 0.2), evidence: 0.9, distinct: 0.7,
          head: `${pct(zCost / tot)} of spend has no reported conversions`,
          metrics: [`${gbp(zCost)}`, `${zero.length} campaign${zero.length > 1 ? 's' : ''}`],
          text: mostlyAware
            ? `Most of it sits in ${[...new Set(aware.map(x => x.channel))].join(' and ')} activity, which may well have an awareness or remarketing role. If so, the interesting question is how that role is being measured, because the campaign export alone can't show it.`
            : `It sits mainly in ${list3(zero.sort((a, b) => b.cost - a.cost).map(x => q(x.name)))}. Reported conversions aren't the whole story, but it's worth being clear on what that activity is there to do and how it's judged.`
        });
      }

      // 5. concentration
      const sorted = C.list.slice().sort((a, b) => b.cost - a.cost);
      const top = sorted[0];
      const topShare = top.cost / tot, top2 = sorted.length > 1 ? (top.cost + sorted[1].cost) / tot : topShare;
      if (C.n >= 3 && (topShare >= 0.35 || top2 >= 0.55)) {
        const rest = C.comparable.filter(x => x !== top);
        const diff = isFinite(top.idx) && rest.length ? top.idx : NaN;
        const interesting = topShare >= 0.5 || (isFinite(diff) && Math.abs(diff - 1) >= 0.2);
        if (interesting) add({
          id: 'conc', family: top.channel === 'Performance Max' ? 'channel' : 'concentration', sig: topShare, mag: Math.min(1, (topShare - 0.25) / 0.5) + (isFinite(diff) ? Math.min(0.5, Math.abs(diff - 1)) : 0), evidence: 1, distinct: 0.6,
          head: topShare >= 0.35 ? `One campaign carries ${pct(topShare)} of the account` : `Two campaigns carry ${pct(top2)} of the account`,
          metrics: [q(top.name), `${top.channel}`],
          text: `That isn't a problem in itself, but it means the account's overall results are closely tied to how ${topShare >= 0.35 ? 'one campaign behaves' : 'two campaigns behave'}.` + (isFinite(diff) && Math.abs(diff - 1) >= 0.2 ? ` ${q(top.name)} is also returning ${diff > 1 ? 'better' : 'worse'} than comparable activity by about ${pctDiff(diff)}%, so it shapes the headline more than it might appear.` : '')
        });
      }

      // 6. Performance Max vs non-brand Search
      const pm = C.list.filter(x => x.channel === 'Performance Max');
      const ns = C.list.filter(x => x.channel === 'Search' && !x.isBrand);
      const pmCost = sum(pm, 'cost'), nsCost = sum(ns, 'cost');
      if (pmCost / tot >= 0.15 && nsCost / tot >= 0.15 && sum(pm, 'conv') >= 20 && sum(ns, 'conv') >= 20) {
        const pe = eff(pm), se = eff(ns);
        const r = uv ? pe / se : se / pe;
        if (isFinite(r) && (r >= 1.4 || r <= 0.7)) add({
          id: 'pmax', family: 'channel', sig: (pmCost + nsCost) / tot, mag: Math.min(1, Math.abs(Math.log2(r)) / 1.5), evidence: 0.8, distinct: 0.8,
          head: 'Performance Max and non-brand Search are returning quite differently',
          metrics: [`Performance Max: ${fmtEff(pe, uv)}`, `Non-brand Search: ${fmtEff(se, uv)}`],
          text: `They aren't quite like-for-like. Performance Max blends several channels and can pick up searches for your own brand, which tends to lift its headline return${r < 1 ? ', so trailing Search here is notable' : ''}. Separating those effects is usually where the useful answers are.`
        });
      } else if (pmCost / tot >= 0.5) {
        add({
          id: 'pmaxshare', family: 'channel', sig: pmCost / tot, mag: (pmCost / tot - 0.4) / 0.5, evidence: 0.9, distinct: 0.5,
          head: `Performance Max carries ${pct(pmCost / tot)} of the investment`,
          metrics: [`${pm.length} campaign${pm.length > 1 ? 's' : ''}`, gbp(pmCost)],
          text: 'That makes the account heavily reliant on one automated campaign type. Its headline results blend channels and can include brand searches, so a campaign export alone can\'t show what it is genuinely adding.'
        });
      }

      // 7. structure: names that don't match what campaigns are
      const mm = C.list.filter(x => x.mismatch);
      if (C.hasType && mm.length && (mm.length >= 2 || mm[0].cost / tot >= 0.05)) {
        const ex = mm.sort((a, b) => b.cost - a.cost)[0];
        add({
          id: 'names', family: 'structure', sig: sum(mm, 'cost') / tot + 0.2, mag: Math.min(1, mm.length / 4), evidence: 1, distinct: 0.6,
          head: "Campaign names don't always match what the campaigns are",
          metrics: [`${mm.length} of ${C.n} campaigns`],
          text: `For example, ${q(ex.name)} reads like ${/^[aeiou]/i.test(ex.nameChan) ? 'an' : 'a'} ${ex.nameChan} campaign but runs as ${/^[aeiou]/i.test(ex.channel) ? 'an' : 'a'} ${ex.channel} campaign. It sounds minor, but inconsistent naming makes performance much harder to read at a glance, especially for anyone new to the account.`
        });
      }

      // 8. structure: brand not clearly separated
      const searchCost = sum(C.list.filter(x => x.channel === 'Search'), 'cost');
      const unclear = C.list.filter(x => x.channel === 'Search' && (x.intent === 'Unclear' || x.brandWeak));
      const brandAny = C.list.some(x => x.isBrand && !x.brandWeak);
      if (searchCost / tot >= 0.2 && (!brandAny || sum(unclear, 'cost') / searchCost >= 0.3)) {
        add({
          id: 'brandsep', family: 'brand', sig: searchCost / tot, mag: !brandAny ? 0.6 : sum(unclear, 'cost') / searchCost, evidence: 0.5, distinct: 0.6,
          head: !brandAny ? "Brand and non-brand aren't clearly separated" : 'Part of the Search activity is hard to classify',
          metrics: [!brandAny ? 'No clear brand campaign' : `${pct(sum(unclear, 'cost') / searchCost)} of Search spend`],
          text: !brandAny
            ? "From the campaign data alone, it isn't clear where searches for your own brand sit. If they're blended with non-brand, the combined return can make both look different from reality."
            : `Campaigns such as ${q(unclear.sort((a, b) => b.cost - a.cost)[0].name)} don't make their purpose clear from their names or results. That's common in accounts that have grown over time, and it makes the true brand and non-brand picture harder to see.`,
          note: 'Based on campaign names and reported results.'
        });
      }

      // 9. fragmentation
      const perfC = C.list.filter(C.isPerf);
      const lowData = perfC.filter(x => x.conv < (TH().lowDataConversions || 15));
      if (perfC.length >= 12 && lowData.length / perfC.length >= 0.5) {
        add({
          id: 'frag', family: 'structure', sig: sum(lowData, 'cost') / tot + 0.2, mag: lowData.length / perfC.length, evidence: 0.8, distinct: 0.6,
          head: 'Results are spread across a lot of small campaigns',
          metrics: [`${lowData.length} of ${perfC.length} campaigns`, `under ${TH().lowDataConversions || 15} conversions each`],
          text: "That isn't automatically a problem, and plenty of accounts are structured this way for good reasons. It does mean automated bidding has less to learn from in each campaign, which can make results more volatile."
        });
      }

      // 10. trend across the period
      if (C.dates.length >= 14) {
        const mid = C.dates[Math.floor(C.dates.length / 2)];
        const half = (k) => { const a = { cost: 0, conv: 0, value: 0 }; C.byDate.forEach((v, d) => { if ((d < mid) === (k === 0)) { a.cost += v.cost; a.conv += v.conv; a.value += v.value; } }); return a; };
        const h1 = half(0), h2 = half(1);
        const e1 = uv ? h1.value / h1.cost : h1.cost / h1.conv, e2 = uv ? h2.value / h2.cost : h2.cost / h2.conv;
        const change = uv ? e2 / e1 - 1 : e1 / e2 - 1;
        const enough = Math.min(h1.conv, h2.conv) >= 30;
        if (enough && isFinite(change) && Math.abs(change) >= 0.15) {
          let mover = null, best = 0;
          C.list.forEach(x => {
            const a = { cost: 0, conv: 0, value: 0 }, b2 = { cost: 0, conv: 0, value: 0 };
            x.periods.forEach((v, d) => { const t2 = d < mid ? a : b2; t2.cost += v.cost; t2.conv += v.conv; t2.value += v.value; });
            const delta = uv ? (b2.value - a.value) : (b2.conv - a.conv);
            if (Math.sign(delta) === Math.sign(change) && Math.abs(delta) > best) { best = Math.abs(delta); mover = x; }
          });
          const spendChange = h2.cost / h1.cost - 1;
          add({
            id: 'trend', family: 'trend', sig: 0.7, mag: Math.min(1, Math.abs(change) / 0.4), evidence: 0.85, distinct: 0.95,
            head: change < 0 ? 'Returns weakened noticeably through the period' : 'Returns improved noticeably through the period',
            metrics: [`${fmtEff(e1, uv)} → ${fmtEff(e2, uv)}`, `spend ${spendChange >= 0 ? 'up' : 'down'} ${pct(Math.abs(spendChange))}`],
            text: `Comparing the first and second half of the period, ${uv ? 'return on ad spend' : 'cost per conversion'} moved by about ${pct(Math.abs(change))}${mover ? `, and ${q(mover.name)} accounts for more of the shift than any other campaign` : ''}. It's worth knowing whether that's seasonal, competitive or something that changed in the account.`
          });
        } else {
          // the account held steady overall, but has a significant campaign moved?
          let pick = null, pickScore = 0;
          C.list.filter(x => C.isPerf(x) && x.cost / tot >= 0.1).forEach(x => {
            const a = { cost: 0, conv: 0, value: 0 }, b2 = { cost: 0, conv: 0, value: 0 };
            x.periods.forEach((v, d) => { const t2 = d < mid ? a : b2; t2.cost += v.cost; t2.conv += v.conv; t2.value += v.value; });
            if (Math.min(a.conv, b2.conv) < 15 || !a.cost || !b2.cost) return;
            const x1 = uv ? a.value / a.cost : a.cost / a.conv, x2 = uv ? b2.value / b2.cost : b2.cost / b2.conv;
            const ch = uv ? x2 / x1 - 1 : x1 / x2 - 1;
            const sc = Math.abs(ch) * (x.cost / tot);
            if (Math.abs(ch) >= 0.25 && sc > pickScore) { pickScore = sc; pick = { x, x1, x2, ch }; }
          });
          if (pick) add({
            id: 'ctrend', family: 'trend', sig: pick.x.cost / tot * 2, mag: Math.min(1, Math.abs(pick.ch) / 0.5), evidence: 0.8, distinct: 0.95,
            head: `${q(pick.x.name)} has ${pick.ch < 0 ? 'weakened' : 'strengthened'} through the period`,
            metrics: [`${fmtEff(pick.x1, uv)} \u2192 ${fmtEff(pick.x2, uv)}`, `${pct(pick.x.cost / tot)} of spend`],
            text: `Its ${uv ? 'return on ad spend' : 'cost per conversion'} moved by about ${pct(Math.abs(pick.ch))} between the first and second half of the period, while the account overall held fairly steady. It's worth understanding whether that's seasonal, competitive or something that changed in the campaign.`
          });
        }
      }
    }

    if (T) {
      const ws = T.cost ? T.zeroCost / T.cost : 0;
      if (ws >= 0.15) add({
        id: 'terms', family: 'terms', sig: ws * 1.5, mag: Math.min(1, ws / 0.35), evidence: 0.85, distinct: 0.8,
        head: "A noticeable share of search spend isn't reaching converting searches",
        metrics: [`${pct(ws)} of search term spend`, gbp(T.zeroCost)],
        text: "Some of that is the normal cost of finding new demand. The pattern in which searches are involved is often more revealing than the total, and it's one of the first things a deeper review looks at."
      });
      const ls = T.cost ? T.longCost / T.cost : 0, qs = T.cost ? T.qCost / T.cost : 0;
      if (ls >= 0.2 || qs >= 0.12) add({
        id: 'long', family: 'terms2', sig: Math.max(ls, qs), mag: Math.min(1, Math.max(ls, qs) / 0.4), evidence: 0.8, distinct: 0.75,
        head: 'Searches are getting longer and more conversational',
        metrics: [`${pct(ls)} of spend on 5+ word searches`, `${pct(qs)} on question-style searches`],
        text: "That's the kind of search Google's AI Mode encourages, and ads are due to start appearing there in the UK. Accounts relying on broad match or Performance Max are most exposed to how that changes things."
      });
    }
    return out;
  };

  const select = cands => {
    const sorted = cands.filter(c => c.score >= 30).sort((a, b) => b.score - a.score);
    const picked = [], fam = new Set();
    for (const c of sorted) {
      if (fam.has(c.family)) continue;
      if (picked.length >= 3 && c.score < 50) break;
      picked.push(c); fam.add(c.family);
      if (picked.length === 4) break;
    }
    return picked;
  };

  /* ---------- dashboard: headline figures and charts ---------- */
  const GROUPS = [
    { k: 'brand', label: 'Brand Search', c: '--c1', dk: false },
    { k: 'nonbrand', label: 'Non-brand Search', c: '--c2', dk: false },
    { k: 'pmax', label: 'Performance Max', c: '--c3', dk: false },
    { k: 'shopping', label: 'Shopping', c: '--c4', dk: true },
    { k: 'aware', label: 'Display, Video and Demand Gen', c: '--c5', dk: false },
    { k: 'other', label: 'Other or unclassified', c: '--cx', dk: true }
  ];
  const G = Object.fromEntries(GROUPS.map(g => [g.k, g]));
  const groupOf = (x, hasType) => {
    if (x.channel === 'Performance Max') return 'pmax';
    if (x.channel === 'Shopping') return 'shopping';
    if (AWARE.has(x.channel)) return 'aware';
    if (x.isBrand && (x.channel === 'Search' || (x.channel === 'Unknown' && !hasType))) return 'brand';
    if (x.channel === 'Search') return 'nonbrand';
    return 'other';
  };
  const short = (s, n = 34) => s.length > n ? s.slice(0, n - 1) + '…' : s;
  const pct1 = n => !isFinite(n) ? '-' : (n > 0 && n < 0.01 ? '<1%' : Math.round(n * 100) + '%');
  const compact = n => n >= 1e6 ? '£' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'm' : n >= 1e4 ? '£' + Math.round(n / 1e3) + 'k' : n >= 1e3 ? '£' + (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : gbp(n);
  const tipAttr = s => `data-tip="${esc(s)}" tabindex="0"`;
  const card = (title, sub, body, table, wide) => `<figure class="dcard${wide ? ' wide' : ''}"><figcaption><h3>${esc(title)}</h3>${sub ? `<p>${esc(sub)}</p>` : ''}</figcaption>${body}${table ? `<details class="tview"><summary>Show as a table</summary><div class="tablewrap">${table}</div></details>` : ''}</figure>`;
  const tbl = (head, rows) => `<table class="ctable"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const legend = items => `<ul class="dlegend">${items.map(i => `<li><i style="background:var(${i.c})"></i>${esc(i.label)}</li>`).join('')}</ul>`;

  // one whole split into parts (tall segmented bar)
  const segBar = (parts, name) => {
    const total = parts.reduce((a, p) => a + p.v, 0);
    if (!(total > 0)) return '';
    return `<div class="segrow"><span class="segname">${esc(name)}</span><div class="seg" role="img" aria-label="${esc(name + ': ' + parts.filter(p => p.v > 0).map(p => `${p.label} ${pct1(p.v / total)}`).join(', '))}">${parts.filter(p => p.v > 0).map(p => {
      const s = p.v / total;
      return `<span class="segp${p.dk ? ' dk' : ''}" style="flex-grow:${s.toFixed(5)};background:var(${p.c})" ${tipAttr(`${name} · ${p.label}: ${p.fmt} (${pct1(s)})`)}>${s >= 0.1 ? `<b>${pct1(s)}</b>` : ''}</span>`;
    }).join('')}</div></div>`;
  };

  // ranked horizontal bars, optional reference line (r = 0..1 of the track)
  const hbars = (rows, ref) => `<div class="hbars"${ref != null ? ` style="--r:${Math.max(0, Math.min(1, ref)).toFixed(4)}"` : ''}>${rows.map(r => `<div class="hb"><span class="hbl" title="${esc(r.label)}">${esc(short(r.label))}</span><span class="hbt${ref != null ? ' ref' : ''}"><i style="width:${Math.max(0.5, r.w * 100).toFixed(2)}%;background:var(${r.c})" ${tipAttr(r.tip)}></i></span><span class="hbv">${esc(r.val)}</span></div>`).join('')}</div>`;

  // columns over time, with an optional line in a second chart (never a second axis)
  const niceMax = m => { if (!(m > 0)) return 1; const p = Math.pow(10, Math.floor(Math.log10(m))); const f = m / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; };
  const plot = (pts, kind, fmtAxis, fmtTip, color) => {
    const vals = pts.map(p => p.v).filter(v => isFinite(v));
    if (vals.length < 2) return '';
    const max = niceMax(Math.max(...vals) * 1.08);
    const n = pts.length, bw = 100 / n;
    const ticks = [0, 0.5, 1].map(f => `<span class="gl" style="bottom:${f * 100}%"><em>${esc(fmtAxis(max * f))}</em></span>`).join('');
    const xl = [0, Math.floor((n - 1) / 2), n - 1].map(i => `<span style="left:${(i + 0.5) * bw}%">${esc(pts[i].label)}</span>`).join('');
    let marks = '';
    if (kind === 'col') {
      marks = pts.map((p, i) => `<span class="col" style="left:${(i * bw + bw * 0.18).toFixed(3)}%;width:${(bw * 0.64).toFixed(3)}%;height:${(Math.max(0, p.v) / max * 100).toFixed(2)}%;background:var(${color})" ${tipAttr(fmtTip(p))}></span>`).join('');
    } else {
      const xy = pts.map((p, i) => isFinite(p.v) ? `${((i + 0.5) * bw).toFixed(3)},${(100 - p.v / max * 100).toFixed(3)}` : null);
      const segs = []; let cur = [];
      xy.forEach(v => { if (v) cur.push(v); else { if (cur.length) segs.push(cur); cur = []; } });
      if (cur.length) segs.push(cur);
      marks = `<svg class="lsvg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${segs.map(s => s.length > 1 ? `<polyline points="${s.join(' ')}" style="stroke:var(${color})"/>` : '').join('')}</svg>`;
      const last = pts.map((p, i) => [p, i]).filter(([p]) => isFinite(p.v)).pop();
      marks += pts.map((p, i) => isFinite(p.v) ? `<span class="hit" style="left:${(i * bw).toFixed(3)}%;width:${bw.toFixed(3)}%" ${tipAttr(fmtTip(p))}><i style="bottom:${(p.v / max * 100).toFixed(2)}%;background:var(${color})"></i></span>` : '').join('');
      if (last) marks += `<span class="dot" style="left:${((last[1] + 0.5) * bw).toFixed(3)}%;bottom:${(last[0].v / max * 100).toFixed(2)}%;background:var(${color})"></span>`;
    }
    return `<div class="plot" role="img" aria-label="Chart: see the table view for values"><div class="pa">${ticks}${marks}</div><div class="xl">${xl}</div></div>`;
  };

  const weekKey = t => { const d = new Date(t); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const dshort = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  const renderDash = (C, T) => {
    const cards = [];
    const tiles = [];
    const resName = C && C.useValue ? 'conversion value' : 'conversions';
    if (C) {
      const groups = GROUPS.map(g => ({ ...g, cost: 0, conv: 0, value: 0, n: 0 }));
      const GI = Object.fromEntries(groups.map(g => [g.k, g]));
      C.list.forEach(x => { const g = GI[groupOf(x, C.hasType)]; g.cost += x.cost; g.conv += x.conv; g.value += x.value; g.n++; x.grp = g.k; });
      const res = g => C.useValue ? g.value : g.conv;
      const totRes = C.useValue ? C.value : C.conv;
      const present = groups.filter(g => g.cost > 0 || res(g) > 0);

      // headline figures
      tiles.push({ l: 'Spend', v: gbp(C.cost), n: `${int(C.n)} campaign${C.n === 1 ? '' : 's'}${C.dates.length ? ` · ${C.dates.length > 1 ? Math.round((C.dates[C.dates.length - 1] - C.dates[0]) / 864e5) + 1 + ' days' : '1 day'}` : ''}` });
      tiles.push({ l: 'Conversions', v: int(C.conv), n: C.value > 0 ? `${gbp(C.value)} conversion value` : 'as reported in the file' });
      tiles.push(C.useValue ? { l: 'Return on ad spend', v: (C.value / C.cost).toFixed(2) + 'x', n: isFinite(C.base) ? `non-brand: ${C.base.toFixed(2)}x` : '' }
        : { l: 'Cost per conversion', v: C.conv ? gbp2(C.cost / C.conv) : '-', n: isFinite(C.base) ? `non-brand: ${gbp2(C.base)}` : '' });
      if (GI.brand.cost > 0 && totRes > 0) tiles.push({ l: `Brand share of ${resName}`, v: pct1(res(GI.brand) / totRes), n: `from ${pct1(GI.brand.cost / C.cost)} of spend` });
      const isRows = C.list.filter(x => IS_OK.has(x.channel) && isFinite(x.lost));
      if (isRows.length) {
        const w = isRows.reduce((a, x) => a + x.cost, 0);
        const lb = isRows.reduce((a, x) => a + x.lost * x.cost, 0) / w, lr = isRows.reduce((a, x) => a + (isFinite(x.rank) ? x.rank : 0) * x.cost, 0) / w;
        tiles.push({ l: 'Search impressions lost to budget', v: Math.round(lb) + '%', n: `${Math.round(lr)}% lost to rank` });
      }

      // 1. where the money goes vs where results come from
      if (present.length > 1) {
        const gap = present.map(g => ({ g, d: (totRes ? res(g) / totRes : 0) - g.cost / C.cost })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
        const title = Math.abs(gap.d) >= 0.08 ? `${gap.g.label}: ${pct1(gap.g.cost / C.cost)} of spend, ${pct1(res(gap.g) / totRes)} of ${resName}` : 'Spend and results are spread fairly evenly across channels';
        const body = segBar(present.map(g => ({ v: g.cost, c: g.c, dk: g.dk, label: g.label, fmt: gbp(g.cost) })), 'Spend') +
          (totRes > 0 ? segBar(present.map(g => ({ v: res(g), c: g.c, dk: g.dk, label: g.label, fmt: C.useValue ? gbp(res(g)) : int(res(g)) + ' conversions' })), C.useValue ? 'Conv. value' : 'Conversions') : '') + legend(present);
        cards.push(card(title, `How spend and ${resName} split by channel. Brand and non-brand are inferred from campaign names${brandWords().length ? ' and the brand names you entered' : ''}.`, body,
          tbl(['Channel', 'Spend', 'Share of spend', C.useValue ? 'Conv. value' : 'Conversions', 'Share'], present.map(g => [g.label, gbp(g.cost), pct1(g.cost / C.cost), C.useValue ? gbp(res(g)) : int(res(g)), totRes ? pct1(res(g) / totRes) : '-'])), true));
      }

      // 2. return by campaign against the non-brand average
      const withRes = C.list.filter(x => x.grp !== 'brand' && (C.useValue ? x.value > 0 : x.conv >= 1) && x.cost > 0).sort((a, b) => b.cost - a.cost).slice(0, 12);
      const brandC = C.list.filter(x => x.grp === 'brand' && x.cost > 0);
      const zero = C.list.filter(x => x.cost > 0 && x.conv < 0.5).sort((a, b) => b.cost - a.cost);
      if (withRes.length >= 2) {
        const effOf = x => C.useValue ? x.value / x.cost : x.cost / x.conv;
        withRes.sort((a, b) => C.useValue ? effOf(b) - effOf(a) : effOf(a) - effOf(b));
        const vmax = niceMax(Math.max(...withRes.map(effOf), isFinite(C.base) ? C.base : 0) * 1.05);
        const fmtE = v => C.useValue ? v.toFixed(2) + 'x' : gbp2(v);
        const better = x => C.useValue ? effOf(x) >= C.base : effOf(x) <= C.base;
        const nb = withRes.filter(x => x.grp !== 'brand');
        const beat = nb.filter(better).length;
        const title = isFinite(C.base) && nb.length ? `${beat} of ${nb.length} non-brand campaign${nb.length > 1 ? 's' : ''} beat the non-brand average` : (C.useValue ? 'Return on ad spend by campaign' : 'Cost per conversion by campaign');
        const sub = `${C.useValue ? 'Return on ad spend (conversion value ÷ spend). Longer is better.' : 'Cost per conversion. Shorter is better.'}${isFinite(C.base) ? ` The line marks the non-brand average of ${fmtE(C.base)}.` : ''} Colours show the channel.`;
        let body = hbars(withRes.map(x => ({ label: x.name, w: effOf(x) / vmax, c: G[x.grp].c, val: fmtE(effOf(x)), tip: `${x.name} · ${fmtE(effOf(x))} · ${gbp(x.cost)} spend · ${C.useValue ? gbp(x.value) + ' value' : int(x.conv) + ' conversions'}` })), isFinite(C.base) ? C.base / vmax : null);
        const usedG = GROUPS.filter(g => withRes.some(x => x.grp === g.k));
        body += legend(usedG);
        if (brandC.length) { const bc = brandC.reduce((a, x) => a + x.cost, 0), bv = brandC.reduce((a, x) => a + (C.useValue ? x.value : x.conv), 0); body += `<p class="dnote"><b>Brand Search</b> isn't shown, so it doesn't squash the scale: it ${C.useValue ? `returns ${(bv / bc).toFixed(2)}x` : `costs ${bv >= 1 ? gbp2(bc / bv) : '-'} per conversion`}.</p>`; }
        if (zero.length) body += `<p class="dnote"><b>No conversions:</b> ${zero.slice(0, 4).map(x => `${esc(short(x.name, 40))} (${gbp(x.cost)})`).join(', ')}${zero.length > 4 ? ` and ${zero.length - 4} more` : ''}.</p>`;
        cards.push(card(title, sub, body, tbl(['Campaign', 'Channel', 'Spend', C.useValue ? 'Conv. value' : 'Conversions', C.useValue ? 'ROAS' : 'Cost per conversion'], C.list.slice().sort((a, b) => b.cost - a.cost).map(x => [x.name, x.channel, gbp(x.cost), C.useValue ? gbp(x.value) : int(x.conv), (C.useValue ? x.value > 0 : x.conv >= 0.5) ? fmtE(effOf(x)) : '-']))));
      }

      // 3. room to grow: impression share in Search and Shopping
      const isList = C.list.filter(x => IS_OK.has(x.channel) && isFinite(x.lost)).sort((a, b) => b.lost - a.lost).slice(0, 10);
      if (isList.length) {
        const capped = isList.filter(x => x.lost >= 15);
        const title = capped.length ? `${capped.length} campaign${capped.length > 1 ? 's lose' : ' loses'} 15% or more of impressions to budget` : 'Budget isn\'t the main limit in Search; rank is';
        const body = `<div class="isbars">${isList.map(x => {
          const lb = Math.max(0, x.lost), lr = Math.max(0, isFinite(x.rank) ? x.rank : 0), won = Math.max(0, 100 - lb - lr);
          return `<div class="isb"><span class="hbl" title="${esc(x.name)}">${esc(short(x.name))}</span><div class="seg thin">${[[won, '--c1', 'Impressions won'], [lb, '--hl', 'Lost to budget'], [lr, '--cx', 'Lost to rank']].filter(p => p[0] > 0.2).map(p => `<span class="segp" style="flex-grow:${p[0].toFixed(2)};background:var(${p[1]})" ${tipAttr(`${x.name} · ${p[2]}: ${Math.round(p[0])}%${x.isApprox ? ' (approx.)' : ''}`)}></span>`).join('')}</div><span class="hbv">${Math.round(lb)}%</span></div>`;
        }).join('')}</div>` + legend([{ c: '--c1', label: 'Impressions won' }, { c: '--hl', label: 'Lost to budget (the % on the right)' }, { c: '--cx', label: 'Lost to rank' }]);
        cards.push(card(title, 'Search impression share for Search and Shopping campaigns. Budget-limited campaigns that already perform well are where extra spend is most likely to help.', body,
          tbl(['Campaign', 'Impression share', 'Lost to budget', 'Lost to rank'], isList.map(x => [x.name, Math.round(Math.max(0, 100 - x.lost - (isFinite(x.rank) ? x.rank : 0))) + '%', Math.round(x.lost) + '%' + (x.isApprox ? ' (approx.)' : ''), isFinite(x.rank) ? Math.round(x.rank) + '%' : '-']))));
      }

      // 4. trend over time
      const spanDays = C.dates.length > 1 ? (C.dates[C.dates.length - 1] - C.dates[0]) / 864e5 : 0;
      if (C.dates.length >= 4 && spanDays >= 13) {
        const weekly = (C.dates[C.dates.length - 1] - C.dates[0]) / 864e5 > 27;
        const buckets = new Map();
        C.dates.forEach(t => { const k = weekly ? weekKey(t) : t; const b = buckets.get(k) || { cost: 0, conv: 0, value: 0 }; const p = C.byDate.get(t); b.cost += p.cost; b.conv += p.conv; b.value += p.value; buckets.set(k, b); });
        const pts = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([k, b]) => ({ t: k, label: dshort(k), ...b }));
        const half = Math.floor(pts.length / 2);
        const sumP = (a, k) => a.reduce((s, p) => s + p[k], 0);
        const a1 = pts.slice(0, half), a2 = pts.slice(pts.length - half);
        const ch = (x, y) => y ? (x - y) / y : NaN;
        const spendCh = ch(sumP(a2, 'cost'), sumP(a1, 'cost'));
        const e1 = C.useValue ? sumP(a1, 'value') / sumP(a1, 'cost') : sumP(a1, 'cost') / sumP(a1, 'conv'), e2 = C.useValue ? sumP(a2, 'value') / sumP(a2, 'cost') : sumP(a2, 'cost') / sumP(a2, 'conv');
        const effCh = ch(e2, e1);
        const dir = v => !isFinite(v) ? 'about the same' : Math.abs(v) < 0.03 ? 'about the same' : (v > 0 ? 'up ' : 'down ') + Math.round(Math.abs(v) * 100) + '%';
        const unit = weekly ? 'week' : 'day';
        cards.push(card(`Spend ${dir(spendCh)} in the second half of the period`, `Spend per ${unit}.${weekly ? ' Weeks start on Monday, so the first and last may be partial.' : ''}`,
          plot(pts.map(p => ({ label: p.label, v: p.cost, raw: p })), 'col', compact, p => `${weekly ? 'Week of ' : ''}${p.label}: ${gbp(p.v)} spend`, '--c1'),
          tbl([weekly ? 'Week starting' : 'Day', 'Spend', 'Conversions', C.useValue ? 'ROAS' : 'Cost per conversion'], pts.map(p => [p.label, gbp(p.cost), int(p.conv), C.useValue ? (p.cost ? (p.value / p.cost).toFixed(2) + 'x' : '-') : (p.conv >= 1 ? gbp2(p.cost / p.conv) : '-')]))));
        const effPts = pts.map(p => ({ label: p.label, v: C.useValue ? (p.cost ? p.value / p.cost : NaN) : (p.conv >= 1 ? p.cost / p.conv : NaN) }));
        cards.push(card(`${C.useValue ? 'Return on ad spend' : 'Cost per conversion'} ${dir(effCh)} over the same period`, `${C.useValue ? 'Return on ad spend' : 'Cost per conversion'} per ${unit}, across all campaigns. Recent ${unit}s can rise as delayed conversions are still being counted.`,
          plot(effPts, 'line', v => C.useValue ? v.toFixed(1) + 'x' : compact(v), p => `${weekly ? 'Week of ' : ''}${p.label}: ${C.useValue ? p.v.toFixed(2) + 'x' : gbp2(p.v)}`, '--hl'), ''));
      }
    }

    if (T) {
      if (!C) {
        tiles.push({ l: 'Search term spend', v: gbp(T.cost), n: `${int(T.n)} search terms` });
        tiles.push({ l: 'Conversions', v: int(T.conv), n: T.conv ? `${gbp2(T.cost / T.conv)} per conversion` : '' });
      }
      tiles.push({ l: 'Search term spend with no conversions', v: pct1(T.zeroCost / T.cost), n: gbp(T.zeroCost) });
      const brandC = T.list.filter(x => isBrandTerm(x.term));
      const bCost = brandC.reduce((a, x) => a + x.cost, 0);
      const convNB = T.list.filter(x => !isBrandTerm(x.term) && x.conv >= 0.5).reduce((a, x) => a + x.cost, 0);
      const zeroNB = T.list.filter(x => !isBrandTerm(x.term) && x.conv < 0.5).reduce((a, x) => a + x.cost, 0);
      const parts = [
        { v: bCost, c: '--c1', label: 'Brand searches', fmt: gbp(bCost) },
        { v: convNB, c: '--c2', label: 'Other searches that converted', fmt: gbp(convNB) },
        { v: T.hidden, c: '--cx', dk: true, label: 'Not shown by Google ("Other search terms")', fmt: gbp(T.hidden) },
        { v: zeroNB, c: '--hl', label: 'Other searches with no conversions', fmt: gbp(zeroNB) }
      ];
      cards.push(card(`${pct1(zeroNB / T.cost)} of search term spend went on non-brand searches with no conversions`, 'Where search term spend went over the period. Some spend with no conversions is normal: the question is whether it\'s the right kind.',
        segBar(parts, 'Search term spend') + legend(parts.filter(p => p.v > 0)),
        tbl(['Group', 'Spend', 'Share'], parts.filter(p => p.v > 0).map(p => [p.label, gbp(p.v), pct1(p.v / T.cost)])), true));
      const topZero = T.list.filter(x => x.conv < 0.5).sort((a, b) => b.cost - a.cost).slice(0, 8);
      if (topZero.length >= 2) {
        const m = topZero[0].cost;
        cards.push(card('The searches costing most with nothing to show', 'Search terms with spend but no conversions, by spend. Worth checking against your negative keywords.',
          hbars(topZero.map(x => ({ label: x.term, w: x.cost / m, c: '--hl', val: gbp(x.cost), tip: `"${x.term}" · ${gbp(x.cost)} · no conversions` }))),
          tbl(['Search term', 'Spend', 'Conversions'], topZero.map(x => [x.term, gbp(x.cost), '0']))));
      }
      const topConv = T.list.filter(x => x.conv >= 0.5).sort((a, b) => b.conv - a.conv).slice(0, 8);
      if (topConv.length >= 2) {
        const m = topConv[0].conv;
        cards.push(card('The searches bringing in the most conversions', 'Search terms by reported conversions. Brand searches are in blue.',
          hbars(topConv.map(x => ({ label: x.term, w: x.conv / m, c: isBrandTerm(x.term) ? '--c1' : '--c2', val: int(x.conv), tip: `"${x.term}" · ${int(x.conv)} conversions · ${gbp(x.cost)}` }))) + legend([{ c: '--c1', label: 'Brand' }, { c: '--c2', label: 'Non-brand' }].filter(l => topConv.some(x => (l.c === '--c1') === isBrandTerm(x.term)))),
          tbl(['Search term', 'Conversions', 'Spend'], topConv.map(x => [x.term, int(x.conv), gbp(x.cost)]))));
      }
    }
    return { tiles, html: cards.join('') };
  };

  // one tooltip for every chart mark (mouse and keyboard)
  const tip = document.createElement('div');
  tip.className = 'xtip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true;
  out.appendChild(tip);
  const showTip = (el, x, y) => {
    tip.textContent = el.dataset.tip; tip.hidden = false;
    const r = out.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = x - r.left - tw / 2, top = y - r.top - th - 12;
    left = Math.max(8, Math.min(left, r.width - tw - 8));
    if (top < 8) top = y - r.top + 18;
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  };
  out.addEventListener('mousemove', e => { const el = e.target.closest('[data-tip]'); if (el && out.contains(el)) showTip(el, e.clientX, e.clientY); else tip.hidden = true; });
  out.addEventListener('mouseleave', () => { tip.hidden = true; });
  out.addEventListener('focusin', e => { const el = e.target.closest('[data-tip]'); if (!el) return; const b = el.getBoundingClientRect(); showTip(el, b.left + b.width / 2, b.top); });
  out.addEventListener('focusout', () => { tip.hidden = true; });

  /* ---------- rendering ---------- */
  const readCheck = (t, a, kind) => {
    const want = WANT[kind];
    const found = k => t.cols[k] >= 0;
    const chips = [...want.required, ...want.recommended].map(k => {
      const ok = found(k), req = want.required.includes(k);
      return `<span class="col ${ok ? 'ok' : (req ? 'miss req' : 'miss')}" title="${ok ? 'Found' : (COLS[k].unlocks ? 'Add it to unlock ' + COLS[k].unlocks : 'Missing')}">${ok ? '✓' : '+'} ${esc(COLS[k].label)}</span>`;
    }).join('');
    const missing = want.recommended.filter(k => !found(k) && COLS[k].unlocks).map(k => `<li><b>${esc(COLS[k].label)}</b> unlocks ${esc(COLS[k].unlocks)}.</li>`).join('');
    let rec;
    if (t.fileTotal && isFinite(t.fileTotal.cost)) {
      const ok = Math.abs(t.fileTotal.cost - a.cost) <= Math.max(1, t.fileTotal.cost * 0.005);
      rec = `<p class="rc ${ok ? 'ok' : 'warn'}">${ok ? '✓' : '!'} Your file's total spend is ${gbp2(t.fileTotal.cost)}. The X-ray read ${gbp2(a.cost)}${ok ? ', so every row was counted once.' : '. The difference is usually removed or filtered rows.'}</p>`;
    } else rec = `<p class="rc">There's no total row in the file, so check this against your account: the X-ray read ${gbp2(a.cost)} of spend.</p>`;
    const rows = kind === 'campaigns' ? `${int(a.n)} campaigns${a.dated ? ` from ${int(t.data.length)} daily or weekly rows` : ''}` : `${int(a.n)} search terms`;
    return `<div class="readcheck"><div class="rchead"><b>${esc(t.platform)} ${kind === 'terms' ? 'search terms report' : 'campaign report'}</b><span>${rows}</span></div>${rec}<div class="cols">${chips}</div>${missing ? `<details><summary>Columns that would sharpen the read</summary><ul>${missing}</ul></details>` : ''}</div>`;
  };

  const classTable = C => {
    const rows = C.list.slice().sort((a, b) => b.cost - a.cost).slice(0, 40);
    const confLabel = { high: 'High', medium: 'Medium', low: 'Low', 'n/a': '-' };
    return `<div class="tablewrap"><table class="ctable"><thead><tr><th>Campaign</th><th>Channel</th><th>Likely purpose</th><th>Confidence</th><th>Spend</th></tr></thead><tbody>${rows.map(x => `<tr><td>${esc(x.name)}${x.mismatch ? '<small>name suggests ' + esc(x.nameChan) + '</small>' : ''}</td><td>${esc(x.channel)}${x.chanSource === 'name' ? '<small>from name</small>' : ''}</td><td>${esc(x.intent)}${x.brandWeak ? '<small>performs like non-brand</small>' : ''}</td><td><span class="conf ${x.conf.replace('/', '')}">${confLabel[x.conf]}</span></td><td>${gbp(x.cost)}</td></tr>`).join('')}</tbody></table></div>`;
  };

  const render = () => {
    const C = state.campaigns && !state.campaigns.error ? state.campaigns : null;
    const T = state.terms && !state.terms.error ? state.terms : null;
    const errs = [...state.msgs, ...[state.campaigns, state.terms].filter(x => x && x.error).map(x => x.error)];
    state.msgs = [];
    if (!C && !T) { out.hidden = true; status.textContent = errs.join(' ') || 'Nothing readable in that file.'; return; }
    status.textContent = errs.join(' ');

    const D = renderDash(C, T);
    $('#xr-tiles').innerHTML = D.tiles.map(t => `<div class="xtile"><span>${esc(t.l)}</span><b>${esc(t.v)}</b>${t.n ? `<small>${esc(t.n)}</small>` : ''}</div>`).join('');
    $('#xr-dash').innerHTML = D.html;
    const tiles = D.tiles.map(t => [t.l, t.v]);
    const period = (C && C.periodLabel) || (state.raw_t && state.raw_t.dateLine) || '';
    $('#xr-period').textContent = period ? 'Reporting period: ' + period : 'Reporting period: not stated in the file';

    const picks = select(candidates(C, T));
    state.picks = picks;
    const obs = picks.length ? picks.map(p => `<article class="obs"><h3>${esc(p.head)}</h3>${p.metrics && p.metrics.length ? `<div class="obsm">${p.metrics.map(m => `<span>${esc(m)}</span>`).join('')}</div>` : ''}<p>${esc(p.text)}</p>${p.note ? `<p class="obsnote">${esc(p.note)}</p>` : ''}</article>`).join('')
      : `<article class="obs"><h3>Nothing dramatic stands out</h3><p>On the numbers in this file, the account looks fairly balanced. That's useful to know, and it usually means the more interesting questions sit beneath the campaign level: search terms, bidding and how results are measured.</p></article>`;
    $('#xr-obs').innerHTML = obs;

    let how = '';
    if (C) how += readCheck(state.raw_c, C, 'campaigns');
    if (T) how += readCheck(state.raw_t, T, 'terms');
    if (C) how += `<h3 style="margin-top:22px">How each campaign was classified</h3><p class="xhelp">Channel comes from the campaign type column when it's there. Purpose is inferred from names and results, so treat it as a best guess.</p>` + classTable(C);
    $('#xr-how').innerHTML = how;

    $('#xr-label').textContent = state.sample ? 'Sample data' : (state.names.join(' + ') || 'Your account');
    const text = ['Second Query Account X-ray' + (state.sample ? ' (sample data)' : ''), period ? 'Period: ' + period : '', tiles.map(t => `${t[0]}: ${t[1]}`).join(' | '), '', 'What caught our attention:', ...picks.map((p, i) => `${i + 1}. ${p.head} (${(p.metrics || []).join('; ')}). ${p.text}`)].filter(x => x !== null).join('\n');
    state.summary = text;
    $('#xr-talk').href = 'mailto:sam@secondquery.com?subject=' + encodeURIComponent('Account X-ray results') + '&body=' + encodeURIComponent(text + '\n\nWhat I would like to understand better:\n');
    state.aiPayload = buildAiPayload(C, T, period, picks);
    document.dispatchEvent(new CustomEvent('xray:ready'));
    out.hidden = false;
    reset.hidden = false;
    if (!state.fromBrand) out.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    state.fromBrand = false;
  };

  /* a compact, aggregated summary for the optional AI read (never the raw file) */
  const buildAiPayload = (C, T, period, picks) => ({
    period,
    platform: state.names.join(' + '),
    currency: 'GBP',
    totals: C ? { spend: Math.round(C.cost), conversions: Math.round(C.conv), conversionValue: Math.round(C.value), campaigns: C.n } : { spend: Math.round(T.cost), conversions: Math.round(T.conv), searchTerms: T.n },
    campaigns: C ? C.list.slice().sort((a, b) => b.cost - a.cost).slice(0, 40).map(x => ({
      name: x.name, channel: x.channel, likelyPurpose: x.intent, confidence: x.conf, spend: Math.round(x.cost), conversions: Math.round(x.conv * 10) / 10,
      conversionValue: Math.round(x.value), lostISBudget: isFinite(x.lost) ? Math.round(x.lost) : null, lostISRank: isFinite(x.rank) ? Math.round(x.rank) : null, isApprox: x.isApprox
    })) : [],
    trend: C && C.dates.length >= 14 ? { days: C.dates.length } : null,
    searchTerms: T ? { spend: Math.round(T.cost), zeroConversionSpendShare: Math.round(T.zeroCost / T.cost * 100), longQueryShare: Math.round(T.longCost / T.cost * 100), questionShare: Math.round(T.qCost / T.cost * 100) } : null,
    ruleBasedObservations: picks.map(p => p.head)
  });

  const ingest = (text, name) => {
    const t = readTable(text);
    if (!t || !t.kind) {
      state.msgs.push(`${name}: I couldn't find a campaign or search term column. Check it's a CSV or TSV export from Google Ads or Microsoft Advertising.`);
      return false;
    }
    const missingReq = WANT[t.kind].required.filter(k => t.cols[k] < 0);
    if (missingReq.includes('cost')) { state.msgs.push(`${name}: there's no Cost or Spend column. Add it and download again.`); return false; }
    if (missingReq.includes('conv')) state.msgs.push(`${name}: there's no Conversions column, so the read will be limited. Add it and download again.`);
    if (t.kind === 'campaigns') { state.raw_c = t; state.campaigns = analyseCampaigns(t); }
    else { state.raw_t = t; state.terms = analyseTerms(t); }
    state.names.push(`${t.platform} ${t.kind === 'terms' ? 'search terms' : 'campaigns'}`);
    return true;
  };

  /* Microsoft Advertising downloads CSVs inside a .zip: open it here, in the browser */
  const unzip = async buf => {
    const b = new Uint8Array(buf), dv = new DataView(buf);
    let e = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('zip');
    const count = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const files = [];
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (!/\.(csv|tsv|txt)$/i.test(name)) continue;
      const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      const data = b.slice(start, start + csize);
      if (method === 0) files.push({ name, buf: data.buffer });
      else if (method === 8 && 'DecompressionStream' in window) files.push({ name, buf: await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer() });
      else throw new Error('zip');
    }
    return files;
  };
  const readFile = f => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsArrayBuffer(f); });

  const handleFiles = async files => {
    const list = [...files].slice(0, 4);
    if (!list.length) return;
    Object.assign(state, { campaigns: null, terms: null, raw_c: null, raw_t: null, sample: false, names: [], msgs: [] });
    status.textContent = 'Reading…';
    for (const f of list) {
      if (f.size > 25 * 1024 * 1024) { state.msgs.push(`${f.name} is over 25 MB. Try a shorter date range.`); continue; }
      if (/\.xlsx?$/i.test(f.name)) { state.msgs.push(`${f.name}: Excel files can't be read here. Download the report as CSV (or .zip (CSV) from Microsoft Advertising) instead.`); continue; }
      try {
        const buf = await readFile(f);
        const h = new Uint8Array(buf.slice(0, 4));
        if (h[0] === 0x50 && h[1] === 0x4b && h[2] === 3 && h[3] === 4) {
          const inner = await unzip(buf);
          if (!inner.length) state.msgs.push(`${f.name}: there's no CSV inside that .zip.`);
          inner.slice(0, 4).forEach(x => ingest(decode(x.buf), x.name));
        } else ingest(decode(buf), f.name);
      } catch (e) {
        state.msgs.push(`${f.name}: that file couldn't be read.${/\.zip$/i.test(f.name) ? ' Try opening the .zip and dropping in the CSV inside it.' : ''}`);
      }
    }
    render();
  };

  fileIn.addEventListener('change', () => handleFiles(fileIn.files));
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => handleFiles(e.dataTransfer.files));

  brandIn.addEventListener('change', () => {
    if (state.raw_c) state.campaigns = analyseCampaigns(state.raw_c);
    if (state.raw_t) state.terms = analyseTerms(state.raw_t);
    if (state.raw_c || state.raw_t) { state.fromBrand = true; render(); }
  });

  reset.addEventListener('click', () => {
    Object.assign(state, { campaigns: null, terms: null, raw_c: null, raw_t: null, sample: false, names: [], msgs: [] });
    out.hidden = true; reset.hidden = true; status.textContent = ''; fileIn.value = '';
    document.dispatchEvent(new CustomEvent('xray:reset'));
  });

  $('#xr-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(state.summary || ''); status.textContent = 'Summary copied.'; }
    catch (e) { status.textContent = 'Copy is blocked in this browser.'; }
  });

  window.SQXray = { get payload() { return state.aiPayload; }, get summary() { return state.summary; } };

  /* ---------- sample data (a made-up homeware retailer, Google Ads format) ---------- */
  const SAMPLE_CAMPAIGNS = `Campaign performance report
"1 August 2026 - 31 October 2026"
Campaign status,Campaign,Campaign type,Bid strategy type,Budget,Cost,Impr.,Clicks,Conversions,Conv. value,Search impr. share,Search lost IS (budget),Search lost IS (rank)
Enabled,Brand - Exact,Search,Target impression share,"400.00","18,361.20","264,612","59,640","1,920.00","288,000.00",> 90%,< 10%,< 10%
Enabled,Non-brand - Sofas,Search,Maximise conversion value,"350.00","29,520.30","630,990","24,312",456.00,"123,120.00",41.20%,31.40%,27.40%
Enabled,Non-brand - Beds,Search,Maximise conversion value,"250.00","21,616.65","542,820","18,960",288.00,"74,880.00",48.90%,22.80%,28.30%
Enabled,Non-brand - Generic furniture,Search,Manual CPC,"300.00","26,880.60","1,206,354","29,733",123.00,"22,140.00",22.10%,0.00%,77.90%
Enabled,Non-brand - Garden,Search,Maximise conversions,"120.00","6,102.00","88,410","3,920",11.00,"2,750.00",36.00%,12.50%,51.50%
Enabled,PMax - All products,Performance Max,Maximise conversion value,"900.00","72,932.25","5,707,653","63,012","1,494.00","313,740.00",--,--,--
Enabled,PMax - Clearance,Performance Max,Maximise conversion value,"200.00","13,440.90","1,833,660","14,610",174.00,"24,360.00",--,--,--
Enabled,Display remarketing,Display,Maximise clicks,"100.00","8,820.00","5,640,360","9,312",0.00,0.00,--,--,--
Enabled,Demand Gen - Prospecting,Demand Gen,Maximise conversions,"150.00","10,832.70","2,833,506","6,864",12.00,"1,920.00",--,--,--
Total: Account,,,,,"208,506.60","18,748,365","230,363","4,478.00","850,910.00",,,`;

  const SAMPLE_TERMS = `Search terms report
"1 August 2026 - 31 October 2026"
Search term,Match type,Added/Excluded,Campaign,Ad group,Clicks,Impr.,Cost,Conversions,Conv. value
acme home,Exact match,Added,Brand - Exact,Brand,"28,230","93,600","7,230.60","1,164.00","174,600.00"
acme home sofas,Phrase match,None,Brand - Exact,Brand,"8,640","26,820","2,461.20",288.00,"43,200.00"
acme home discount code,Phrase match,None,Brand - Exact,Brand,"3,306","12,900","1,206.30",0.00,0.00
grey corner sofa,Broad match,None,Non-brand - Sofas,Corner sofas,"3,720","114,300","4,836.00",102.00,"27,540.00"
corner sofa bed with storage,Phrase match,None,Non-brand - Sofas,Sofa beds,"2,580","57,660","3,312.90",66.00,"17,820.00"
velvet sofa 3 seater,Exact match,None,Non-brand - Sofas,3 seaters,"2,106","38,640","2,737.80",57.00,"15,390.00"
how to clean a fabric sofa,Broad match,None,Non-brand - Sofas,Corner sofas,"4,464","198,030","3,571.20",0.00,0.00
best sofa for a small living room uk,Broad match,None,Non-brand - Sofas,3 seaters,"1,536","66,900","1,920.00",6.00,"1,620.00"
sofa jobs london,Broad match,None,Non-brand - Generic furniture,Furniture,"630","29,520","888.30",0.00,0.00
free sofa collection near me,Broad match,None,Non-brand - Sofas,Corner sofas,"1,932","73,230","2,415.00",0.00,0.00
second hand sofa free,Broad match,None,Non-brand - Generic furniture,Furniture,"1,170","45,060","1,404.00",0.00,0.00
king size bed frame,Phrase match,None,Non-brand - Beds,Bed frames,"2,760","60,330","3,588.00",72.00,"18,720.00"
ottoman storage bed double,Exact match,None,Non-brand - Beds,Storage beds,"1,830","34,260","2,433.90",54.00,"14,040.00"
what size bed fits in a box room,Broad match,None,Non-brand - Beds,Bed frames,"2,106","92,640","2,527.20",0.00,0.00
diy bed frame plans,Broad match,None,Non-brand - Beds,Bed frames,"1,065","42,300","1,278.00",0.00,0.00
furniture,Broad match,None,Non-brand - Generic furniture,Furniture,"6,312","420,660","8,521.50",27.00,"4,860.00"
furniture shop jobs,Broad match,None,Non-brand - Generic furniture,Furniture,"954","36,900","1,144.80",0.00,0.00
cheap furniture,Broad match,None,Non-brand - Generic furniture,Furniture,"4,560","188,400","5,472.00",18.00,"3,240.00"
sofa,Performance Max,None,PMax - All products,--,"11,640","631,200","12,804.00",183.00,"49,410.00"
acme sofa sale,Performance Max,None,PMax - All products,--,"7,230","122,640","4,338.00",426.00,"89,460.00"
mid century sideboard oak,Performance Max,None,PMax - All products,--,"3,360","132,600","4,032.00",84.00,"22,680.00"
how to paint a wooden sideboard,Performance Max,None,PMax - All products,--,"2,790","154,200","3,069.00",0.00,0.00
Other search terms,--,None,--,--,"9,480","402,000","10,320.00",96.00,"21,600.00"
Total: Search terms,,,,,"112,401","3,074,790","91,511.70","2,643.00","504,180.00"`;

  const weeklySample = csv => {
    const rows = parseDelimited(csv);
    const hi = rows.findIndex(r => r.includes('Campaign') && r.includes('Cost'));
    const hdr = rows[hi], data = rows.slice(hi + 1).filter(r => r[0] && !/^total/i.test(r[0]));
    const ix = n => hdr.indexOf(n);
    const sums = ['Cost', 'Impr.', 'Clicks', 'Conversions', 'Conv. value'].map(ix);
    const W = 13, start = new Date(2026, 7, 3);
    const weeks = [...Array(W)].map((_, i) => { const d = new Date(start); d.setDate(d.getDate() + i * 7); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    const out = [];
    const fmt = (v, dp) => '"' + v.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp }) + '"';
    const tot = sums.map(() => 0);
    data.forEach((r, k) => {
      const cw = weeks.map((_, i) => 1 + 0.16 * Math.sin(i * 0.9 + k) + 0.02 * (i - 6));
      const fade = /sofas|clearance/i.test(r[1]) ? 0.035 : (/brand/i.test(r[1]) ? -0.01 : 0.004);
      const vw = weeks.map((_, i) => cw[i] * (1 + fade * (6 - i)));
      const cs = cw.reduce((a, b) => a + b, 0), vs = vw.reduce((a, b) => a + b, 0);
      weeks.forEach((wk, i) => {
        const row = r.slice();
        sums.forEach((c, j) => {
          const base = num(r[c]) || 0;
          const share = (j >= 3 ? vw[i] / vs : cw[i] / cs);
          const v = j === 1 || j === 2 ? Math.round(base * share) : Math.round(base * share * 100) / 100;
          tot[j] += v;
          row[c] = fmt(v, j === 1 || j === 2 ? 0 : 2);
        });
        row.splice(2, 0, wk);
        out.push(row.map(x => /^"/.test(x) || !/[,"]/.test(x) ? x : '"' + x + '"').join(','));
      });
    });
    const h2 = hdr.slice(); h2.splice(2, 0, 'Week');
    const totalRow = h2.map((h, i) => i === 0 ? 'Total: Account' : '');
    sums.forEach((c, j) => { totalRow[c + (c >= 2 ? 1 : 0)] = fmt(Math.round(tot[j] * 100) / 100, j === 1 || j === 2 ? 0 : 2); });
    return ['Campaign performance report', '"3 August 2026 - 1 November 2026"', h2.join(','), ...out, totalRow.join(',')].join('\n');
  };

  $('#xr-sample').addEventListener('click', () => {
    Object.assign(state, { campaigns: null, terms: null, raw_c: null, raw_t: null, sample: true, names: [], msgs: [] });
    brandIn.value = 'acme';
    ingest(weeklySample(SAMPLE_CAMPAIGNS), 'sample');
    ingest(SAMPLE_TERMS, 'sample');
    state.sample = true;
    render();
  });

  // copy the Report editor prompt
  root.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
    const el = document.getElementById(b.dataset.copy);
    try { await navigator.clipboard.writeText(el.textContent); b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1600); }
    catch (e) { b.textContent = 'Select and copy'; }
  }));
})();

/* Optional AI read: only shown once an endpoint is configured in /static/ai-config.json */
(() => {
  const box = document.getElementById('xr-ai');
  if (!box) return;
  const ok = document.getElementById('xr-ai-ok'), go = document.getElementById('xr-ai-go'), st = document.getElementById('xr-ai-status'), out = document.getElementById('xr-ai-out');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let endpoint = '';
  const ready = fetch('/static/ai-config.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : {}).then(j => { endpoint = (j && j.endpoint) || ''; }).catch(() => {});
  document.addEventListener('xray:ready', () => ready.then(() => { box.hidden = !endpoint; out.innerHTML = ''; st.textContent = ''; }));
  document.addEventListener('xray:reset', () => { box.hidden = true; out.innerHTML = ''; ok.checked = false; go.disabled = true; });
  ok.addEventListener('change', () => { go.disabled = !ok.checked; });
  go.addEventListener('click', async () => {
    if (!ok.checked || !window.SQXray || !window.SQXray.payload) return;
    go.disabled = true; st.textContent = 'Asking Claude… this usually takes 10 to 20 seconds.'; out.innerHTML = '';
    try {
      const r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payload: window.SQXray.payload }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Something went wrong');
      out.innerHTML = (j.observations || []).map(o => `<article class="obs"><h3>${esc(o.heading)}</h3>${o.metrics && o.metrics.length ? `<div class="obsm">${o.metrics.map(m => `<span>${esc(m)}</span>`).join('')}</div>` : ''}<p>${esc(o.text)}</p></article>`).join('') + (j.closing ? `<p class="xhelp" style="margin-top:12px">${esc(j.closing)}</p>` : '') + '<p class="obsnote" style="margin-top:8px">Written by Claude from the summary above. AI can get things wrong, so treat this as a starting point.</p>';
      st.textContent = '';
    } catch (e) {
      st.textContent = e.message || 'Something went wrong. Please try again later.';
    } finally { go.disabled = !ok.checked; }
  });
})();
