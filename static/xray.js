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
    term: { tests: ['search term', 'search query'], label: 'Search term' },
    match: { tests: ['match type', 'search term match type', 'delivered match type', 'keyword match type', 'bid match type'], label: 'Match type', unlocks: 'measuring AI Mode exposure' }
  };
  const WANT = {
    campaigns: { required: ['campaign', 'cost', 'conv'], recommended: ['type', 'value', 'lost', 'rank', 'bid', 'clicks'] },
    terms: { required: ['term', 'cost', 'conv'], recommended: ['match', 'clicks', 'value'] }
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

  /* ---------- analysis ---------- */
  const brandWords = () => (brandIn.value || '').toLowerCase().split(',').map(s => s.trim()).filter(s => s.length > 1);
  const nonBrandName = n => /non[\s_\-|]*brand|nonbrand|generic/i.test(n);
  const isBrandCampaign = n => !nonBrandName(n) && (/\bbrand/i.test(n) || brandWords().some(b => n.toLowerCase().includes(b)));
  const isBrandTerm = t => brandWords().some(b => t.includes(b));

  const analyseCampaigns = t => {
    const c = t.cols, th = TH();
    if (c.cost < 0) return { error: 'I could not find a Cost or Spend column in the campaign report.' };
    const map = new Map();
    t.data.forEach(r => {
      const name = String(r[c.campaign] || '').trim();
      if (!name) return;
      const cost = num(r[c.cost]) || 0, conv = c.conv >= 0 ? (num(r[c.conv]) || 0) : 0, value = c.value >= 0 ? (num(r[c.value]) || 0) : 0;
      if (!cost && !conv) return;
      const lost = c.lost >= 0 ? num(r[c.lost]) : NaN, rank = c.rank >= 0 ? num(r[c.rank]) : NaN;
      const type = c.type >= 0 ? String(r[c.type] || '') : '';
      const bid = c.bid >= 0 ? String(r[c.bid] || '') : '';
      const e = map.get(name) || { name, type, bid, cost: 0, conv: 0, value: 0, lost: NaN, rank: NaN };
      e.cost += cost; e.conv += conv; e.value += value;
      if (!isNaN(lost)) e.lost = isNaN(e.lost) ? lost : Math.max(e.lost, lost);
      if (!isNaN(rank)) e.rank = isNaN(e.rank) ? rank : Math.max(e.rank, rank);
      map.set(name, e);
    });
    const list = [...map.values()];
    if (!list.length) return { error: 'The campaign report had no rows with spend in it.' };
    const sum = (arr, k) => arr.reduce((a, x) => a + x[k], 0);
    const cost = sum(list, 'cost'), conv = sum(list, 'conv'), value = sum(list, 'value');
    const useValue = value > 0;
    const cpa = conv ? cost / conv : NaN, roas = cost && value ? value / cost : NaN;
    list.forEach(x => { x.brand = isBrandCampaign(x.name); x.pmax = /performance max|pmax|p-max/i.test(x.type + ' ' + x.name); });
    const nb = list.filter(x => !x.brand);
    const nbCost = sum(nb, 'cost'), nbConv = sum(nb, 'conv'), nbValue = sum(nb, 'value');
    const baseRoas = nbCost && nbValue ? nbValue / nbCost : roas, baseCpa = nbConv ? nbCost / nbConv : cpa;
    list.forEach(x => {
      x.cpa = x.conv ? x.cost / x.conv : NaN;
      x.roas = x.cost && x.value ? x.value / x.cost : NaN;
      x.idx = x.conv < 0.5 ? 0 : (useValue && isFinite(baseRoas) ? (x.value / x.cost) / baseRoas : baseCpa / x.cpa);
      x.low = x.conv < th.lowDataConversions;
      if (x.brand) x.verdict = ['info', 'Brand: judge separately'];
      else if (x.conv < 0.5) x.verdict = ['bad', 'No conversions: question it'];
      else if (x.idx >= th.workingIndex && x.lost > th.lostBudgetCap) x.verdict = ['great', 'Working, held back by budget'];
      else if (x.idx >= th.workingIndex && x.rank > th.lostRankHigh) x.verdict = ['good', 'Working, losing on rank'];
      else if (x.idx >= th.workingIndex) x.verdict = ['good', 'Working: protect it'];
      else if (x.idx >= th.weakIndex) x.verdict = ['mid', 'Around average: tune'];
      else x.verdict = ['bad', 'Below average: fix or trim'];
    });
    const winners = nb.filter(x => x.verdict[1] === 'Working, held back by budget');
    const rankLosers = list.filter(x => x.rank > th.lostRankHigh && !x.pmax);
    const manual = list.filter(x => /manual|cpc/i.test(x.bid) && !/enhanced/i.test(x.bid) && x.conv >= th.lowDataConversions);
    return {
      list, cost, conv, value, useValue, cpa, roas, baseRoas, baseCpa, nb,
      brand: list.filter(x => x.brand), pmax: list.filter(x => x.pmax), zero: list.filter(x => x.conv < 0.5 && x.cost > 0),
      winners, rankLosers, manual, hasLost: c.lost >= 0, hasRank: c.rank >= 0, hasBid: c.bid >= 0,
      top: list.slice().sort((a, b) => b.cost - a.cost)[0], n: list.length, lowCount: nb.filter(x => x.low && x.conv >= 0.5).length
    };
  };

  const STOP = new Set('the and for with from near what how why best uk you your are can does buy online sale shop shops store stores in on of to a an is it my me at or by vs not this that do'.split(' '));
  const WASTE = new Set('free jobs job salary salaries career careers vacancy vacancies diy course courses pdf login meaning definition template templates download second used repair repairs clean cleaning paint painting plans tutorial ideas wiki reddit youtube internship apprenticeship manual instructions'.split(' '));
  const matchBucket = m => {
    m = (m || '').toLowerCase();
    if (/broad/.test(m)) return 'Broad match';
    if (/phrase/.test(m)) return 'Phrase match';
    if (/exact/.test(m)) return 'Exact match';
    if (/performance max|pmax/.test(m)) return 'Performance Max';
    if (/ai max|search term matching|dynamic|dsa|url/.test(m)) return 'AI Max or dynamic';
    return m ? 'Other' : 'Not stated';
  };

  const analyseTerms = t => {
    const c = t.cols, th = TH();
    if (c.cost < 0) return { error: 'I could not find a Cost or Spend column in the search terms report.' };
    const map = new Map();
    let hiddenCost = 0;
    t.data.forEach(r => {
      const term = String(r[c.term] || '').trim().toLowerCase();
      if (!term || term === '--') return;
      const cost = num(r[c.cost]) || 0, conv = c.conv >= 0 ? (num(r[c.conv]) || 0) : 0, clicks = c.clicks >= 0 ? (num(r[c.clicks]) || 0) : 0;
      const value = c.value >= 0 ? (num(r[c.value]) || 0) : 0;
      if (/^other search terms/.test(term)) { hiddenCost += cost; return; }
      const match = c.match >= 0 ? matchBucket(r[c.match]) : 'Not stated';
      const e = map.get(term) || { term, cost: 0, conv: 0, clicks: 0, value: 0, matches: {} };
      e.cost += cost; e.conv += conv; e.clicks += clicks; e.value += value;
      e.matches[match] = (e.matches[match] || 0) + cost;
      map.set(term, e);
    });
    const list = [...map.values()];
    if (!list.length) return { error: 'The search terms report had no search terms with data.' };
    const cost = list.reduce((a, x) => a + x.cost, 0) + hiddenCost, conv = list.reduce((a, x) => a + x.conv, 0);
    const zero = list.filter(x => x.conv < 0.5);
    const zeroCost = zero.reduce((a, x) => a + x.cost, 0);
    const wasted = zero.slice().sort((a, b) => b.cost - a.cost).filter(x => x.cost > 0).slice(0, 8);
    const best = list.filter(x => x.conv >= 0.5 && !isBrandTerm(x.term)).sort((a, b) => b.conv - a.conv || a.cost - b.cost).slice(0, 6);
    const brand = list.filter(x => isBrandTerm(x.term));
    const brandCost = brand.reduce((a, x) => a + x.cost, 0), brandConv = brand.reduce((a, x) => a + x.conv, 0);
    const long = list.filter(x => x.term.split(/\s+/).length >= 5);
    const longCost = long.reduce((a, x) => a + x.cost, 0);
    const mix = {};
    list.forEach(x => Object.entries(x.matches).forEach(([k, v]) => { mix[k] = (mix[k] || 0) + v; }));
    const openCost = (mix['Broad match'] || 0) + (mix['Performance Max'] || 0) + (mix['AI Max or dynamic'] || 0);
    const bw = brandWords().flatMap(b => b.split(/\s+/));
    const convWords = new Set();
    list.filter(x => x.conv >= 0.5).forEach(x => x.term.split(/\s+/).forEach(w => convWords.add(w)));
    const wordCost = {}, wordN = {};
    zero.forEach(x => new Set(x.term.split(/\s+/)).forEach(w => {
      if (w.length < 3 || STOP.has(w) || convWords.has(w) || bw.includes(w) || /^\d+$/.test(w)) return;
      wordCost[w] = (wordCost[w] || 0) + x.cost;
      wordN[w] = (wordN[w] || 0) + 1;
    }));
    const negWords = Object.entries(wordCost).filter(e => e[1] > 0 && (wordN[e[0]] > 1 || WASTE.has(e[0]))).sort((a, b) => b[1] - a[1]).slice(0, 10);
    return { list, cost, conv, zeroCost, wasted, best, brandCost, brandConv, longCost, mix, openCost, hasMatch: c.match >= 0, negWords, hiddenCost, n: list.length, th };
  };

  /* ---------- rendering ---------- */
  const sig = (label, valueText, share, level, note, rule) => {
    const w = Math.max(2, Math.min(100, Math.round((share || 0) * 100)));
    const tag = { good: 'Looks healthy', look: 'Worth a look', priority: 'Priority', info: 'For context' }[level];
    return `<div class="sig ${level}"><div class="sigtop"><span>${esc(label)}</span><b>${esc(valueText)}</b></div><div class="sigbar"><i style="width:${w}%"></i></div><div class="sigfoot"><em>${tag}</em><span>${esc(note)}</span></div>${rule ? ruleLink(rule) : ''}</div>`;
  };

  const readCheck = (t, a, kind) => {
    const want = WANT[kind];
    const found = k => t.cols[k] >= 0;
    const chips = [...want.required, ...want.recommended].map(k => {
      const ok = found(k);
      const req = want.required.includes(k);
      return `<span class="col ${ok ? 'ok' : (req ? 'miss req' : 'miss')}" title="${ok ? 'Found' : (COLS[k].unlocks ? 'Add it to unlock ' + COLS[k].unlocks : 'Missing')}">${ok ? '✓' : '+'} ${esc(COLS[k].label)}</span>`;
    }).join('');
    const missing = want.recommended.filter(k => !found(k) && COLS[k].unlocks).map(k => `<li><b>${esc(COLS[k].label)}</b> unlocks ${esc(COLS[k].unlocks)}.</li>`).join('');
    const readCost = a.cost;
    let rec = '';
    if (t.fileTotal && isFinite(t.fileTotal.cost)) {
      const diff = Math.abs(t.fileTotal.cost - readCost);
      const ok = diff <= Math.max(1, t.fileTotal.cost * 0.005);
      rec = `<p class="rc ${ok ? 'ok' : 'warn'}">${ok ? '✓' : '!'} Your file's total spend is ${gbp2(t.fileTotal.cost)}. The X-ray read ${gbp2(readCost)}${ok ? ', so every row was counted.' : '. The difference is usually removed or filtered rows. Check the export includes every campaign.'}</p>`;
    } else {
      rec = `<p class="rc">The file has no total row, so check this against your account: the X-ray read ${gbp2(readCost)} of spend.</p>`;
    }
    const rows = kind === 'campaigns' ? `${int(a.n)} campaigns` : `${int(a.n)} search terms`;
    return `<div class="readcheck"><div class="rchead"><b>${esc(t.platform)} ${kind === 'terms' ? 'search terms report' : 'campaign report'}</b><span>${rows}${t.dateLine ? ' · ' + esc(t.dateLine) : ''}</span></div>${rec}<div class="cols">${chips}</div>${missing ? `<details><summary>Add these columns next time for a fuller read</summary><ul>${missing}</ul></details>` : ''}</div>`;
  };

  const campaignTable = C => {
    const rows = C.list.slice().sort((a, b) => b.cost - a.cost).slice(0, 30);
    const eff = x => C.useValue ? (isFinite(x.roas) ? x.roas.toFixed(2) + 'x' : '-') : (isFinite(x.cpa) ? gbp2(x.cpa) : '-');
    const vs = x => x.brand || x.conv < 0.5 ? '-' : (Math.round((x.idx - 1) * 100) >= 0 ? '+' : '') + Math.round((x.idx - 1) * 100) + '%';
    return `<div class="xterms"><h3>Campaign by campaign</h3><p class="xhelp">Non-brand campaigns are compared with the non-brand average (${C.useValue ? 'return on ad spend ' + (isFinite(C.baseRoas) ? C.baseRoas.toFixed(2) + 'x' : '-') : 'cost per conversion ' + (isFinite(C.baseCpa) ? gbp2(C.baseCpa) : '-')}), so brand doesn't set an impossible bar.</p>
      <div class="tablewrap"><table class="ctable"><thead><tr><th>Campaign</th><th>Spend</th><th>Conv.</th><th>${C.useValue ? 'ROAS' : 'Cost / conv.'}</th><th>vs avg</th>${C.hasLost ? '<th>Lost to budget</th>' : ''}${C.hasRank ? '<th>Lost to rank</th>' : ''}<th>Verdict</th></tr></thead><tbody>
      ${rows.map(x => `<tr><td>${esc(x.name)}${x.type ? `<small>${esc(x.type)}${x.bid ? ' · ' + esc(x.bid) : ''}</small>` : ''}</td><td>${gbp(x.cost)}</td><td>${int(x.conv)}${x.low && x.conv >= 0.5 && !x.brand ? '<small>low data</small>' : ''}</td><td>${eff(x)}</td><td>${vs(x)}</td>${C.hasLost ? `<td>${isNaN(x.lost) ? '-' : Math.round(x.lost) + '%'}</td>` : ''}${C.hasRank ? `<td>${isNaN(x.rank) ? '-' : Math.round(x.rank) + '%'}</td>` : ''}<td><span class="verdict ${x.verdict[0]}">${esc(x.verdict[1])}</span></td></tr>`).join('')}
      </tbody></table></div></div>`;
  };

  const render = () => {
    const C = state.campaigns && !state.campaigns.error ? state.campaigns : null;
    const T = state.terms && !state.terms.error ? state.terms : null;
    const errs = [...state.msgs, ...[state.campaigns, state.terms].filter(x => x && x.error).map(x => x.error)];
    state.msgs = [];
    if (!C && !T) { out.hidden = true; status.textContent = errs.join(' ') || 'Nothing readable in that file.'; return; }
    status.textContent = errs.join(' ');
    const th = TH();
    const signals = [], recs = [], summary = [], working = [], notWorking = [];

    // what the X-ray read
    let checks = '';
    if (C) checks += readCheck(state.raw_c, C, 'campaigns');
    if (T) checks += readCheck(state.raw_t, T, 'terms');
    $('#xr-check').innerHTML = checks;

    // headline tiles
    const tiles = [];
    if (C) {
      tiles.push(['Spend', gbp(C.cost)], ['Conversions', int(C.conv)]);
      if (isFinite(C.roas)) tiles.push(['Return on ad spend', C.roas.toFixed(2) + 'x']);
      else if (isFinite(C.cpa)) tiles.push(['Cost per conversion', gbp2(C.cpa)]);
      tiles.push(['Campaigns', int(C.n)]);
      summary.push(`Spend ${gbp(C.cost)}, ${int(C.conv)} conversions` + (isFinite(C.roas) ? `, ROAS ${C.roas.toFixed(2)}x` : (isFinite(C.cpa) ? `, cost per conversion ${gbp2(C.cpa)}` : '')) + `, ${C.n} campaigns.`);
    } else {
      tiles.push(['Search term spend', gbp(T.cost)], ['Conversions', int(T.conv)], ['Search terms', int(T.n)]);
      if (T.conv) tiles.push(['Cost per conversion', gbp2(T.cost / T.conv)]);
      summary.push(`Search term spend ${gbp(T.cost)}, ${int(T.conv)} conversions across ${int(T.n)} search terms.`);
    }
    $('#xr-tiles').innerHTML = tiles.map(t => `<div class="xtile"><span>${esc(t[0])}</span><b>${esc(t[1])}</b></div>`).join('');

    if (C) {
      const bConv = C.brand.reduce((a, x) => a + x.conv, 0), bCost = C.brand.reduce((a, x) => a + x.cost, 0);
      if (C.brand.length) {
        const s = C.conv ? bConv / C.conv : 0;
        const lvl = s > th.brandSharePriority ? 'priority' : s > th.brandShareLook ? 'look' : 'good';
        signals.push(sig("Brand campaigns' share of conversions", pct(s), s, lvl, `${pct(bCost / C.cost)} of spend goes to brand campaigns.`, 'brand'));
        summary.push(`Brand campaigns: ${pct(s)} of conversions from ${pct(bCost / C.cost)} of spend.`);
        if (s > th.brandShareLook) recs.push([lvl, 'Judge brand and non-brand separately', `Brand campaigns deliver ${pct(s)} of conversions from ${pct(bCost / C.cost)} of spend. Much of that demand would arrive anyway, so the account average flatters non-brand. Set separate targets and report them separately.`, 'brand']);
      } else {
        signals.push(sig('Brand campaigns', 'None found', 0, 'info', 'Enter your brand name above. Brand may also be mixed into other campaigns, including Performance Max.', 'brand'));
      }
      if (C.pmax.length) {
        const s = C.pmax.reduce((a, x) => a + x.cost, 0) / C.cost;
        signals.push(sig('Performance Max share of spend', pct(s), s, s > th.pmaxShareLook ? 'look' : 'info', `${C.pmax.length} Performance Max campaign${C.pmax.length > 1 ? 's' : ''}.`, 'pmax'));
        summary.push(`Performance Max: ${pct(s)} of spend.`);
        if (s > th.pmaxShareLook) recs.push(['look', 'Open up Performance Max', `It takes ${pct(s)} of spend. Check its channel performance and search terms reports, and whether brand exclusions are set, so you know what it adds rather than what it claims.`, 'pmax']);
      }
      if (C.hasLost) {
        signals.push(sig('Efficient campaigns held back by budget', String(C.winners.length), C.winners.length / C.n, C.winners.length ? 'look' : 'good', C.winners.length ? C.winners.slice(0, 3).map(x => x.name).join(', ') : 'No efficient non-brand campaign is losing much impression share to budget.', 'budget'));
        if (C.winners.length) {
          summary.push(`Efficient but budget-capped: ${C.winners.map(x => x.name).join(', ')}.`);
          recs.push(['priority', 'Feed the campaigns that are capped and efficient', `${C.winners.length} campaign${C.winners.length > 1 ? 's are' : ' is'} beating the non-brand average while losing impression share to budget: ${C.winners.slice(0, 3).map(x => x.name).join(', ')}. That's usually the cheapest growth in the account.`, 'budget']);
        }
      } else {
        signals.push(sig('Budget headroom', 'Not in file', 0, 'info', 'Add the lost impression share (budget) column to see which campaigns are capped.', 'budget'));
      }
      if (C.hasRank && C.rankLosers.length) {
        const s = C.rankLosers.reduce((a, x) => a + x.cost, 0) / C.cost;
        signals.push(sig('Spend in campaigns losing heavily on rank', pct(s), s, 'look', C.rankLosers.slice(0, 3).map(x => `${x.name} (${Math.round(x.rank)}%)`).join(', '), 'rank'));
        recs.push(['look', 'Find out why you lose on rank', `${C.rankLosers.length} campaign${C.rankLosers.length > 1 ? 's lose' : ' loses'} more than ${th.lostRankHigh}% of impression share to rank. More budget won't fix that: ad quality, landing pages and bids will.`, 'rank']);
      }
      const zc = C.zero.reduce((a, x) => a + x.cost, 0) / C.cost;
      if (C.zero.length) {
        signals.push(sig('Spend in campaigns with no conversions', pct(zc), zc, zc > th.zeroConvSpendPriority ? 'priority' : 'look', C.zero.slice(0, 3).map(x => x.name).join(', '), 'zero'));
        summary.push(`Campaigns with no conversions: ${pct(zc)} of spend.`);
        if (zc > th.zeroConvSpendLook) recs.push([zc > th.zeroConvSpendPriority ? 'priority' : 'look', 'Decide what the zero-conversion campaigns are for', `${pct(zc)} of spend (${gbp(zc * C.cost)}) sits in campaigns with no recorded conversions. If they have an upper-funnel job, give them a measure that proves it. If not, that budget can move to what's working.`, 'zero']);
      }
      if (C.lowCount) {
        recs.push(['look', 'Read low-volume campaigns with caution', `${C.lowCount} non-brand campaign${C.lowCount > 1 ? 's have' : ' has'} fewer than ${th.lowDataConversions} conversions in this period. Automated bidding has little to learn from, so consider consolidating or bidding to a higher-volume conversion that still predicts value.`, 'lowdata']);
      }
      if (C.hasBid && C.manual.length) {
        const s = C.manual.reduce((a, x) => a + x.cost, 0) / C.cost;
        if (s > th.manualShareLook) recs.push(['look', 'Test Smart Bidding where manual bidding has enough data', `${pct(s)} of spend is on manual bidding in campaigns with enough conversions to support a controlled Smart Bidding test.`, 'manual']);
      }
      C.nb.filter(x => x.verdict[0] === 'good' || x.verdict[0] === 'great').sort((a, b) => b.idx - a.idx).slice(0, 4).forEach(x => working.push(`${x.name}: ${C.useValue ? x.roas.toFixed(2) + 'x return' : gbp2(x.cpa) + ' per conversion'}, ${Math.round((x.idx - 1) * 100)}% better than the non-brand average${x.low ? ' (low data)' : ''}.`));
      C.list.filter(x => x.verdict[0] === 'bad').sort((a, b) => b.cost - a.cost).slice(0, 4).forEach(x => notWorking.push(x.conv < 0.5 ? `${x.name}: ${gbp(x.cost)} spent with no conversions.` : `${x.name}: ${C.useValue ? x.roas.toFixed(2) + 'x return' : gbp2(x.cpa) + ' per conversion'}, ${Math.round((1 - x.idx) * 100)}% worse than the non-brand average.`));
      const topShare = C.top.cost / C.cost;
      signals.push(sig('Biggest single campaign', pct(topShare), topShare, topShare > 0.5 ? 'look' : 'info', C.top.name));
    }

    if (T) {
      const zs = T.cost ? T.zeroCost / T.cost : 0;
      signals.push(sig('Spend on searches that never converted', pct(zs), zs, zs > th.termWastePriority ? 'priority' : zs > th.termWasteLook ? 'look' : 'good', `${gbp(T.zeroCost)} across ${int(T.list.filter(x => x.conv < 0.5).length)} search terms.`, 'terms'));
      summary.push(`Search terms with no conversions: ${pct(zs)} of search term spend (${gbp(T.zeroCost)}).`);
      if (zs > th.termWasteLook) recs.push([zs > th.termWastePriority ? 'priority' : 'look', 'Tidy the search terms', `${pct(zs)} of search term spend (${gbp(T.zeroCost)}) went on searches that didn't convert. The costliest are listed below, with words that only ever appear in non-converting searches: strong negative keyword candidates.`, 'terms']);
      if (T.hiddenCost) signals.push(sig('Spend on searches Google doesn\'t show', pct(T.hiddenCost / T.cost), T.hiddenCost / T.cost, 'info', '"Other search terms": below Google\'s privacy threshold.'));
      if (brandWords().length) {
        const s = T.conv ? T.brandConv / T.conv : 0;
        signals.push(sig("Brand searches' share of conversions", pct(s), s, s > th.brandSharePriority ? 'look' : 'info', `${pct(T.brandCost / T.cost)} of search term spend is on brand searches.`, 'brand'));
      }
      const ls = T.cost ? T.longCost / T.cost : 0;
      signals.push(sig('Spend on long, conversational searches', pct(ls), ls, 'info', 'Searches of five words or more, the style AI Mode encourages.', 'aimode'));
      if (T.hasMatch) {
        const os = T.cost ? T.openCost / T.cost : 0;
        signals.push(sig('Spend open to AI Mode contextual matching', pct(os), os, os > th.openMatchLook ? 'look' : 'info', 'Broad match, AI Max and Performance Max can match to AI Mode conversations, not just the query.', 'aimode'));
        summary.push(`Spend via broad match, AI Max or Performance Max: ${pct(os)}.`);
        if (os > th.openMatchLook) recs.push(['look', 'Get ready for ads in AI Mode', `About ${pct(os)} of search term spend runs through matching Google says is eligible for contextual matching in AI Mode. Write down a baseline now so you can see what changes when UK ads arrive.`, 'aimode']);
      }
      T.best.slice(0, 3).forEach(x => working.push(`Search "${x.term}": ${int(x.conv)} conversions at ${gbp2(x.cost / x.conv)} each.`));
      T.wasted.slice(0, 3).forEach(x => notWorking.push(`Search "${x.term}": ${gbp2(x.cost)} with no conversions.`));
    }
    if (!recs.length) recs.push(['good', 'Nothing alarming in this file', 'The headline signals look reasonable. The bigger questions are usually outside the file: margins, lead quality and attribution.', '']);
    const order = { priority: 0, look: 1, good: 2, info: 3 };
    recs.sort((a, b) => order[a[0]] - order[b[0]]);

    $('#xr-ww').innerHTML = `<div class="ww good"><h3>What's working</h3>${working.length ? `<ul>${working.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '<p class="xhelp">Nothing clearly beats the average in this file yet.</p>'}</div><div class="ww bad"><h3>What isn't</h3>${notWorking.length ? `<ul>${notWorking.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '<p class="xhelp">Nothing clearly underperforms in this file.</p>'}</div>`;
    $('#xr-signals').innerHTML = signals.join('');
    $('#xr-recs').innerHTML = recs.slice(0, 8).map(r => `<li class="${r[0]}"><b>${esc(r[1])}</b><span>${esc(r[2])}</span>${r[3] ? ruleLink(r[3]) : ''}</li>`).join('');

    let detail = C ? campaignTable(C) : '';
    if (T && (T.wasted.length || T.best.length)) {
      detail += '<div class="xterms"><div class="two" style="gap:28px">';
      detail += `<div><h3>Costliest searches with no conversions</h3><div class="tablewrap"><table><thead><tr><th>Search term</th><th>Clicks</th><th>Cost</th></tr></thead><tbody>${T.wasted.map(w => `<tr><td>${esc(w.term)}</td><td>${int(w.clicks)}</td><td>${gbp2(w.cost)}</td></tr>`).join('') || '<tr><td colspan="3">None</td></tr>'}</tbody></table></div></div>`;
      detail += `<div><h3>Best converting non-brand searches</h3><div class="tablewrap"><table><thead><tr><th>Search term</th><th>Conv.</th><th>Cost / conv.</th></tr></thead><tbody>${T.best.map(w => `<tr><td>${esc(w.term)}</td><td>${int(w.conv)}</td><td>${gbp2(w.cost / w.conv)}</td></tr>`).join('') || '<tr><td colspan="3">None</td></tr>'}</tbody></table></div></div>`;
      detail += '</div>';
      if (T.negWords.length) detail += `<h3 style="margin-top:26px">Words that only appear in non-converting searches</h3><div class="negs xnegs">${T.negWords.map(w => `<span>${esc(w[0])} <small>${gbp(w[1])}</small></span>`).join('')}</div><p class="xhelp">Check each one before adding it as a negative keyword: a word can be wasteful in one campaign and valuable in another. Google adds negatives from the search terms report as exact match by default.</p>`;
      detail += '</div>';
    }
    $('#xr-terms').innerHTML = detail;

    $('#xr-label').textContent = state.sample ? 'Sample data' : (state.names.join(' + ') || 'Your account');
    const text = ['Second Query Account X-ray' + (state.sample ? ' (sample data)' : ''), ...summary, '', "What's working:", ...working.map(w => '- ' + w), '', "What isn't:", ...notWorking.map(w => '- ' + w), '', 'Where to look first:', ...recs.slice(0, 8).map((r, i) => `${i + 1}. ${r[1]}: ${r[2]}`)].join('\n');
    state.summary = text;
    $('#xr-talk').href = 'mailto:sam@secondquery.com?subject=' + encodeURIComponent('Account X-ray results') + '&body=' + encodeURIComponent(text + '\n\nWhat I would like to talk through:\n');
    out.hidden = false;
    reset.hidden = false;
    if (!state.fromBrand) out.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    state.fromBrand = false;
  };

  const ingest = (text, name) => {
    const t = readTable(text);
    if (!t || !t.kind) {
      state.msgs.push(`${name}: I couldn't find a campaign or search term column. Check it's a CSV or TSV export from Google Ads or Microsoft Advertising.`);
      return false;
    }
    const missingReq = WANT[t.kind].required.filter(k => t.cols[k] < 0);
    if (missingReq.includes('cost')) { state.msgs.push(`${name}: there's no Cost or Spend column. Add it and download again.`); return false; }
    if (missingReq.includes('conv')) state.msgs.push(`${name}: there's no Conversions column, so results will be limited. Add it and download again.`);
    if (t.kind === 'campaigns') { state.raw_c = t; state.campaigns = analyseCampaigns(t); }
    else { state.raw_t = t; state.terms = analyseTerms(t); }
    state.names.push(`${t.platform} ${t.kind === 'terms' ? 'search terms' : 'campaigns'}`);
    return true;
  };

  const handleFiles = files => {
    const list = [...files].slice(0, 4);
    if (!list.length) return;
    Object.assign(state, { campaigns: null, terms: null, raw_c: null, raw_t: null, sample: false, names: [], msgs: [] });
    status.textContent = 'Reading…';
    let pending = list.length;
    list.forEach(f => {
      if (f.size > 25 * 1024 * 1024) { state.msgs.push(`${f.name} is over 25 MB. Try a shorter date range.`); if (--pending === 0) render(); return; }
      const fr = new FileReader();
      fr.onload = () => { try { ingest(decode(fr.result), f.name); } catch (e) { state.msgs.push(`${f.name}: that file couldn't be read.`); } if (--pending === 0) render(); };
      fr.onerror = () => { state.msgs.push(`${f.name}: that file couldn't be read.`); if (--pending === 0) render(); };
      fr.readAsArrayBuffer(f);
    });
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
  });

  $('#xr-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(state.summary || ''); status.textContent = 'Summary copied.'; }
    catch (e) { status.textContent = 'Copy is blocked in this browser.'; }
  });

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

  $('#xr-sample').addEventListener('click', () => {
    Object.assign(state, { campaigns: null, terms: null, raw_c: null, raw_t: null, sample: true, names: [], msgs: [] });
    brandIn.value = 'acme';
    ingest(SAMPLE_CAMPAIGNS, 'sample');
    ingest(SAMPLE_TERMS, 'sample');
    state.sample = true;
    render();
  });
})();
