/* Account X-ray: reads Google Ads / Microsoft Advertising CSV exports entirely in the browser.
   Nothing is uploaded: files are read with FileReader and analysed in memory. */
(() => {
  const root = document.getElementById('xray');
  if (!root) return;
  const $ = s => root.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const gbp = n => '£' + Math.round(n).toLocaleString('en-GB');
  const gbp2 = n => '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = n => (isFinite(n) ? Math.round(n * 100) : 0) + '%';
  const int = n => Math.round(n).toLocaleString('en-GB');

  /* platform tabs */
  root.querySelectorAll('.xtabs button').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('.xtabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    root.querySelectorAll('.xtab').forEach(p => { p.hidden = p.dataset.pane !== b.dataset.tab; });
  }));

  const status = $('#xr-status'), out = $('#xr-out'), fileIn = $('#xr-file'), drop = $('#xr-drop'), brandIn = $('#xr-brand'), reset = $('#xr-reset');
  const state = { campaigns: null, terms: null, sample: false, names: [] };

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
    const count = ch => (head.match(new RegExp(ch === '\t' ? '\\t' : ch, 'g')) || []).length;
    const tabs = count('\t'), commas = count(','), semis = count(';');
    const d = tabs >= commas && tabs > semis ? '\t' : (semis > commas ? ';' : ',');
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
        } else cell += c;
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
    const cols = {
      campaign: findCol(hdr, ['campaign', 'campaign name']),
      type: findCol(hdr, ['campaign type', 'campaign sub type', 'advertising channel type']),
      cost: findCol(hdr, ['cost', 'spend', /^cost \(/]),
      conv: findCol(hdr, ['conversions', 'conv.', 'conv']),
      value: findCol(hdr, ['conv. value', 'conversion value', 'conversions value', 'revenue', 'total conv. value']),
      clicks: findCol(hdr, ['clicks']),
      lost: findCol(hdr, [/lost.*budget/]),
      term: findCol(hdr, ['search term', 'search query']),
      match: findCol(hdr, ['match type', 'search term match type', 'delivered match type', 'keyword match type', 'bid match type'])
    };
    const data = rows.slice(hi + 1).filter(r => !r.slice(0, 3).some(c => /^\s*total/i.test(String(c))) && !/microsoft corporation|^\s*©/i.test(r.join(' ')));
    const ms = hdr.includes('spend') || hdr.includes('campaign name') || hdr.includes('delivered match type');
    return { cols, data, kind: cols.term >= 0 ? 'terms' : (cols.campaign >= 0 ? 'campaigns' : null), platform: ms ? 'Microsoft Advertising' : 'Google Ads' };
  };

  /* ---------- analysis ---------- */
  const brandWords = () => (brandIn.value || '').toLowerCase().split(',').map(s => s.trim()).filter(s => s.length > 1);
  const nonBrandName = n => /non[\s_\-|]*brand|nonbrand|generic/i.test(n);
  const isBrandCampaign = n => !nonBrandName(n) && (/\bbrand/i.test(n) || brandWords().some(b => n.toLowerCase().includes(b)));
  const isBrandTerm = t => brandWords().some(b => t.includes(b));

  const analyseCampaigns = t => {
    const c = t.cols;
    if (c.cost < 0) return { error: 'I could not find a Cost or Spend column in the campaign report.' };
    const map = new Map();
    t.data.forEach(r => {
      const name = String(r[c.campaign] || '').trim();
      if (!name) return;
      const cost = num(r[c.cost]) || 0, conv = c.conv >= 0 ? (num(r[c.conv]) || 0) : 0, value = c.value >= 0 ? (num(r[c.value]) || 0) : 0;
      if (!cost && !conv) return;
      const lost = c.lost >= 0 ? num(r[c.lost]) : NaN;
      const type = c.type >= 0 ? String(r[c.type] || '') : '';
      const e = map.get(name) || { name, type, cost: 0, conv: 0, value: 0, lost: NaN };
      e.cost += cost; e.conv += conv; e.value += value;
      if (!isNaN(lost)) e.lost = isNaN(e.lost) ? lost : Math.max(e.lost, lost);
      map.set(name, e);
    });
    const list = [...map.values()];
    if (!list.length) return { error: 'The campaign report had no rows with spend in it.' };
    const sum = (arr, k) => arr.reduce((a, x) => a + x[k], 0);
    const cost = sum(list, 'cost'), conv = sum(list, 'conv'), value = sum(list, 'value');
    const cpa = conv ? cost / conv : NaN, roas = cost && value ? value / cost : NaN;
    const brand = list.filter(x => isBrandCampaign(x.name));
    const pmax = list.filter(x => /performance max|pmax|p-max/i.test(x.type + ' ' + x.name));
    const zero = list.filter(x => x.conv < 0.5 && x.cost > 0);
    const hasLost = c.lost >= 0;
    // judge non-brand campaigns against the non-brand average, so brand doesn't set an impossible bar
    const nb = list.filter(x => !isBrandCampaign(x.name));
    const nbCost = sum(nb, 'cost'), nbConv = sum(nb, 'conv'), nbValue = sum(nb, 'value');
    const baseRoas = nbCost && nbValue ? nbValue / nbCost : roas, baseCpa = nbConv ? nbCost / nbConv : cpa;
    const winners = hasLost ? nb.filter(x => x.lost > 10 && x.conv >= 1 && (isFinite(baseRoas) && x.value ? x.value / x.cost >= baseRoas : x.cost / x.conv <= baseCpa)) : [];
    const top = list.slice().sort((a, b) => b.cost - a.cost)[0];
    return { list, cost, conv, value, cpa, roas, brand, pmax, zero, winners, hasLost, top, n: list.length };
  };

  const WASTE = new Set('free jobs job salary salaries career careers vacancy vacancies diy course courses pdf login meaning definition template templates download second used repair repairs clean cleaning paint painting plans tutorial ideas wiki reddit youtube internship apprenticeship manual instructions'.split(' '));
  const STOP = new Set('the and for with from near what how why best uk you your are can does buy cheap online sale shop shops store stores in on of to a an is it my me at or by vs not this that do does'.split(' '));
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
    const c = t.cols;
    if (c.cost < 0) return { error: 'I could not find a Cost or Spend column in the search terms report.' };
    const map = new Map();
    t.data.forEach(r => {
      const term = String(r[c.term] || '').trim().toLowerCase();
      if (!term || term === '--') return;
      const cost = num(r[c.cost]) || 0, conv = c.conv >= 0 ? (num(r[c.conv]) || 0) : 0, clicks = c.clicks >= 0 ? (num(r[c.clicks]) || 0) : 0;
      const match = c.match >= 0 ? matchBucket(r[c.match]) : 'Not stated';
      const e = map.get(term) || { term, cost: 0, conv: 0, clicks: 0, matches: {} };
      e.cost += cost; e.conv += conv; e.clicks += clicks;
      e.matches[match] = (e.matches[match] || 0) + cost;
      map.set(term, e);
    });
    const list = [...map.values()];
    if (!list.length) return { error: 'The search terms report had no search terms with data.' };
    const cost = list.reduce((a, x) => a + x.cost, 0), conv = list.reduce((a, x) => a + x.conv, 0);
    const zero = list.filter(x => x.conv < 0.5);
    const zeroCost = zero.reduce((a, x) => a + x.cost, 0);
    const wasted = zero.slice().sort((a, b) => b.cost - a.cost).filter(x => x.cost > 0).slice(0, 8);
    const brand = list.filter(x => isBrandTerm(x.term));
    const brandCost = brand.reduce((a, x) => a + x.cost, 0), brandConv = brand.reduce((a, x) => a + x.conv, 0);
    const long = list.filter(x => x.term.split(/\s+/).length >= 5);
    const longCost = long.reduce((a, x) => a + x.cost, 0);
    const mix = {};
    list.forEach(x => Object.entries(x.matches).forEach(([k, v]) => { mix[k] = (mix[k] || 0) + v; }));
    const openCost = (mix['Broad match'] || 0) + (mix['Performance Max'] || 0) + (mix['AI Max or dynamic'] || 0);
    const hasMatch = c.match >= 0;
    // single words that appear only in non-converting searches
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
    return { list, cost, conv, zeroCost, wasted, brandCost, brandConv, longCost, mix, openCost, hasMatch, negWords, n: list.length };
  };

  /* ---------- rendering ---------- */
  const sig = (label, valueText, share, level, note) => {
    const w = Math.max(2, Math.min(100, Math.round((share || 0) * 100)));
    const tag = { good: 'Looks healthy', look: 'Worth a look', priority: 'Priority', info: 'For context' }[level];
    return `<div class="sig ${level}"><div class="sigtop"><span>${esc(label)}</span><b>${esc(valueText)}</b></div><div class="sigbar"><i style="width:${w}%"></i></div><div class="sigfoot"><em>${tag}</em><span>${esc(note)}</span></div></div>`;
  };

  const render = () => {
    const C = state.campaigns && !state.campaigns.error ? state.campaigns : null;
    const T = state.terms && !state.terms.error ? state.terms : null;
    const errs = [...(state.msgs || []), ...[state.campaigns, state.terms].filter(x => x && x.error).map(x => x.error)];
    state.msgs = [];
    if (!C && !T) { out.hidden = true; status.textContent = errs.join(' ') || 'Nothing readable in that file.'; return; }
    status.textContent = errs.join(' ');
    const signals = [], recs = [], summary = [];

    // tiles
    const tiles = [];
    if (C) {
      tiles.push(['Spend', gbp(C.cost)], ['Conversions', int(C.conv)]);
      if (isFinite(C.roas)) tiles.push(['Return on ad spend', C.roas.toFixed(2) + 'x']);
      else if (isFinite(C.cpa)) tiles.push(['Cost per conversion', gbp2(C.cpa)]);
      tiles.push(['Campaigns', int(C.n)]);
      summary.push(`Spend ${gbp(C.cost)}, ${int(C.conv)} conversions` + (isFinite(C.roas) ? `, ROAS ${C.roas.toFixed(2)}x` : (isFinite(C.cpa) ? `, cost per conversion ${gbp2(C.cpa)}` : '')) + `, ${C.n} campaigns.`);
    } else if (T) {
      tiles.push(['Search term spend', gbp(T.cost)], ['Conversions', int(T.conv)], ['Search terms', int(T.n)]);
      if (T.conv) tiles.push(['Cost per conversion', gbp2(T.cost / T.conv)]);
      summary.push(`Search term spend ${gbp(T.cost)}, ${int(T.conv)} conversions across ${int(T.n)} search terms.`);
    }
    $('#xr-tiles').innerHTML = tiles.map(t => `<div class="xtile"><span>${esc(t[0])}</span><b>${esc(t[1])}</b></div>`).join('');

    if (C) {
      const bConv = C.brand.reduce((a, x) => a + x.conv, 0), bCost = C.brand.reduce((a, x) => a + x.cost, 0);
      if (C.brand.length) {
        const s = C.conv ? bConv / C.conv : 0;
        const lvl = s > 0.4 ? 'priority' : s > 0.2 ? 'look' : 'good';
        signals.push(sig('Brand campaigns\' share of conversions', pct(s), s, lvl, `${pct(bCost / C.cost)} of spend goes to brand campaigns.`));
        summary.push(`Brand campaigns: ${pct(s)} of conversions from ${pct(bCost / C.cost)} of spend.`);
        if (s > 0.3) recs.push(['priority', 'Judge brand and non-brand separately', `Brand campaigns deliver ${pct(s)} of conversions. Most of that demand would arrive anyway, so the account-wide average flatters non-brand. Set separate targets and report them separately.`]);
      } else {
        signals.push(sig('Brand campaigns', 'None found', 0, 'info', 'Add your brand name above, or brand may be mixed into other campaigns (including Performance Max).'));
      }
      if (C.pmax.length) {
        const s = C.pmax.reduce((a, x) => a + x.cost, 0) / C.cost;
        const lvl = s > 0.5 ? 'look' : 'info';
        signals.push(sig('Performance Max share of spend', pct(s), s, lvl, `${C.pmax.length} Performance Max campaign${C.pmax.length > 1 ? 's' : ''}.`));
        summary.push(`Performance Max: ${pct(s)} of spend.`);
        if (s > 0.4) recs.push(['look', 'Open up Performance Max', `It takes ${pct(s)} of spend. Check the channel performance and search terms reports, and whether brand exclusions are in place, so you know what it's adding rather than claiming.`]);
      }
      if (C.hasLost) {
        const s = C.winners.length / C.n;
        signals.push(sig('Profitable campaigns held back by budget', String(C.winners.length), s, C.winners.length ? 'look' : 'good', C.winners.length ? C.winners.slice(0, 3).map(x => x.name).join(', ') : 'No efficient campaign is losing much impression share to budget.'));
        if (C.winners.length) {
          summary.push(`Budget-capped winners: ${C.winners.map(x => x.name).join(', ')}.`);
          recs.push(['priority', 'Feed the campaigns that are capped and efficient', `${C.winners.length} campaign${C.winners.length > 1 ? 's are' : ' is'} beating the non-brand average while losing impression share to budget: ${C.winners.slice(0, 3).map(x => x.name).join(', ')}. That's usually the cheapest growth in the account.`]);
        }
      } else {
        signals.push(sig('Budget headroom', 'Not in file', 0, 'info', 'Add the "Search lost IS (budget)" column to your export to see which campaigns are capped.'));
      }
      const zc = C.zero.reduce((a, x) => a + x.cost, 0) / C.cost;
      if (C.zero.length) {
        signals.push(sig('Spend in campaigns with no conversions', pct(zc), zc, zc > 0.1 ? 'priority' : 'look', C.zero.slice(0, 3).map(x => x.name).join(', ')));
        summary.push(`Campaigns with no conversions: ${pct(zc)} of spend.`);
        if (zc > 0.05) recs.push(['look', 'Decide what the zero-conversion campaigns are for', `${pct(zc)} of spend sits in campaigns with no recorded conversions. If they have an upper-funnel job, give them a measure that proves it. If not, that budget can move.`]);
      }
      const topShare = C.top.cost / C.cost;
      signals.push(sig('Biggest single campaign', pct(topShare), topShare, topShare > 0.5 ? 'look' : 'info', C.top.name));
    }

    if (T) {
      const zs = T.cost ? T.zeroCost / T.cost : 0;
      signals.push(sig('Spend on searches that never converted', pct(zs), zs, zs > 0.25 ? 'priority' : zs > 0.12 ? 'look' : 'good', `${gbp(T.zeroCost)} across ${int(T.list.filter(x => x.conv < 0.5).length)} search terms.`));
      summary.push(`Search terms with no conversions: ${pct(zs)} of search term spend (${gbp(T.zeroCost)}).`);
      if (zs > 0.15) recs.push(['priority', 'Tidy the search terms', `${pct(zs)} of search term spend went on searches that didn't convert. The words below only ever appear in non-converting searches, which makes them strong candidates for negative keywords.`]);
      if (brandWords().length) {
        const s = T.conv ? T.brandConv / T.conv : 0;
        signals.push(sig('Brand searches\' share of conversions', pct(s), s, s > 0.4 ? 'look' : 'info', `${pct(T.brandCost / T.cost)} of search term spend is on brand searches.`));
      }
      const ls = T.cost ? T.longCost / T.cost : 0;
      signals.push(sig('Spend on long, conversational searches', pct(ls), ls, 'info', 'Searches of five words or more: the style of query AI Mode encourages.'));
      if (T.hasMatch) {
        const os = T.cost ? T.openCost / T.cost : 0;
        signals.push(sig('Spend open to AI Mode contextual matching', pct(os), os, os > 0.6 ? 'look' : 'info', 'Broad match, AI Max and Performance Max can match to AI Mode conversations, not just the query.'));
        summary.push(`Spend via broad match, AI Max or Performance Max: ${pct(os)}.`);
        if (os > 0.5) recs.push(['look', 'Get ready for ads in AI Mode', `About ${pct(os)} of spend runs through matching that Google says is eligible for contextual matching in AI Mode. Write down a baseline now so you can see what changes when UK ads arrive.`]);
      }
    }
    if (!recs.length) recs.push(['good', 'Nothing alarming in this file', 'The headline signals look reasonable. The bigger questions are usually outside the file: margins, lead quality and attribution.']);
    const order = { priority: 0, look: 1, good: 2, info: 3 };
    recs.sort((a, b) => order[a[0]] - order[b[0]]);

    $('#xr-signals').innerHTML = signals.join('');
    $('#xr-recs').innerHTML = recs.slice(0, 5).map(r => `<li class="${r[0]}"><b>${esc(r[1])}</b><span>${esc(r[2])}</span></li>`).join('');

    let terms = '';
    if (T && T.wasted.length) {
      terms += `<div class="xterms"><h3>Costliest searches with no conversions</h3><table><thead><tr><th>Search term</th><th>Clicks</th><th>Cost</th></tr></thead><tbody>${T.wasted.map(w => `<tr><td>${esc(w.term)}</td><td>${int(w.clicks)}</td><td>${gbp2(w.cost)}</td></tr>`).join('')}</tbody></table>`;
      if (T.negWords.length) terms += `<h3 style="margin-top:24px">Words that only appear in non-converting searches</h3><div class="negs xnegs">${T.negWords.map(w => `<span>${esc(w[0])} <small>${gbp(w[1])}</small></span>`).join('')}</div><p class="xhelp">Check each one before adding it as a negative. A word can be wasteful in one campaign and valuable in another.</p>`;
      terms += '</div>';
    }
    $('#xr-terms').innerHTML = terms;

    const label = state.sample ? 'Sample data' : (state.names.join(' + ') || 'Your account');
    $('#xr-label').textContent = label;
    const text = ['Second Query Account X-ray' + (state.sample ? ' (sample data)' : ''), ...summary, '', 'Where to look first:', ...recs.slice(0, 5).map((r, i) => `${i + 1}. ${r[1]}: ${r[2]}`)].join('\n');
    state.summary = text;
    $('#xr-talk').href = 'mailto:sam@secondquery.com?subject=' + encodeURIComponent('Account X-ray results') + '&body=' + encodeURIComponent(text + '\n\nWhat I would like to talk through:\n');
    $('#xr-talk').textContent = 'Email me these results';
    out.hidden = false;
    reset.hidden = false;
    if (!state.fromBrand) out.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    state.fromBrand = false;
  };

  const ingest = (text, name) => {
    const t = readTable(text);
    if (!t || !t.kind) {
      (state.msgs = state.msgs || []).push(`${name}: I couldn't find a campaign or search term column. Check it's a CSV or TSV export from Google Ads or Microsoft Advertising.`);
      return false;
    }
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
      const msg = m => (state.msgs = state.msgs || []).push(m);
      if (f.size > 25 * 1024 * 1024) { msg(`${f.name} is over 25 MB. Try a shorter date range.`); if (--pending === 0) render(); return; }
      const fr = new FileReader();
      fr.onload = () => { try { ingest(decode(fr.result), f.name); } catch (e) { msg(`${f.name}: that file couldn't be read.`); } if (--pending === 0) render(); };
      fr.onerror = () => { msg(`${f.name}: that file couldn't be read.`); if (--pending === 0) render(); };
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

  /* ---------- sample data (a made-up homeware retailer) ---------- */
  const SAMPLE_CAMPAIGNS = `Campaign performance report
"1 October 2026 - 31 October 2026"
Campaign status,Campaign,Campaign type,Budget,Cost,Impr.,Clicks,Conversions,Conv. value,Search lost IS (budget)
Enabled,Brand - Exact,Search,"400.00","6,120.40","88,204","19,880",640.00,"96,000.00",< 10%
Enabled,Non-brand - Sofas,Search,"350.00","9,840.10","210,330","8,104",152.00,"41,040.00",31.40%
Enabled,Non-brand - Beds,Search,"250.00","7,205.55","180,940","6,320",96.00,"24,960.00",22.80%
Enabled,Non-brand - Generic furniture,Search,"300.00","8,960.20","402,118","9,911",41.00,"7,380.00",0.00%
Enabled,PMax - All products,Performance Max,"900.00","24,310.75","1,902,551","21,004",498.00,"104,580.00",--
Enabled,PMax - Clearance,Performance Max,"200.00","4,480.30","611,220","4,870",58.00,"8,120.00",--
Enabled,Display remarketing,Display,"100.00","2,940.00","1,880,120","3,104",0.00,0.00,--
Enabled,Demand Gen - Prospecting,Demand Gen,"150.00","3,610.90","944,502","2,288",4.00,"640.00",--
Total: Account,,,,"67,468.20","6,219,985","75,481",1489.00,"282,720.00",`;

  const SAMPLE_TERMS = `Search terms report
"1 October 2026 - 31 October 2026"
Search term,Match type,Added/Excluded,Campaign,Ad group,Clicks,Impr.,Cost,Conversions,Conv. value
acme home,Exact match,Added,Brand - Exact,Brand,"9,410","31,200","2,410.20",388.00,"58,200.00"
acme home sofas,Phrase match,None,Brand - Exact,Brand,"2,880","8,940","820.40",96.00,"14,400.00"
acme home discount code,Phrase match,None,Brand - Exact,Brand,"1,102","4,300","402.10",0.00,0.00
grey corner sofa,Broad match,None,Non-brand - Sofas,Corner sofas,"1,240","38,100","1,612.00",34.00,"9,180.00"
corner sofa bed with storage,Phrase match,None,Non-brand - Sofas,Sofa beds,"860","19,220","1,104.30",22.00,"5,940.00"
velvet sofa 3 seater,Exact match,None,Non-brand - Sofas,3 seaters,"702","12,880","912.60",19.00,"5,130.00"
how to clean a fabric sofa,Broad match,None,Non-brand - Sofas,Corner sofas,"1,488","66,010","1,190.40",0.00,0.00
best sofa for a small living room uk,Broad match,None,Non-brand - Sofas,3 seaters,"512","22,300","640.00",2.00,"540.00"
sofa jobs london,Broad match,None,Non-brand - Generic furniture,Furniture,"210","9,840","296.10",0.00,0.00
free sofa collection near me,Broad match,None,Non-brand - Sofas,Corner sofas,"644","24,410","805.00",0.00,0.00
second hand sofa free,Broad match,None,Non-brand - Generic furniture,Furniture,"390","15,020","468.00",0.00,0.00
king size bed frame,Phrase match,None,Non-brand - Beds,Bed frames,"920","20,110","1,196.00",24.00,"6,240.00"
ottoman storage bed double,Exact match,None,Non-brand - Beds,Storage beds,"610","11,420","811.30",18.00,"4,680.00"
what size bed fits in a box room,Broad match,None,Non-brand - Beds,Bed frames,"702","30,880","842.40",0.00,0.00
diy bed frame plans,Broad match,None,Non-brand - Beds,Bed frames,"355","14,100","426.00",0.00,0.00
furniture,Broad match,None,Non-brand - Generic furniture,Furniture,"2,104","140,220","2,840.50",9.00,"1,620.00"
furniture shop jobs,Broad match,None,Non-brand - Generic furniture,Furniture,"318","12,300","381.60",0.00,0.00
cheap furniture,Broad match,None,Non-brand - Generic furniture,Furniture,"1,520","62,800","1,824.00",6.00,"1,080.00"
sofa,Performance Max,None,PMax - All products,--,"3,880","210,400","4,268.00",61.00,"16,470.00"
acme sofa sale,Performance Max,None,PMax - All products,--,"2,410","40,880","1,446.00",142.00,"29,820.00"
mid century sideboard oak,Performance Max,None,PMax - All products,--,"1,120","44,200","1,344.00",28.00,"7,560.00"
how to paint a wooden sideboard,Performance Max,None,PMax - All products,--,"930","51,400","1,023.00",0.00,0.00
Total: Search terms,,,,,"33,825","889,980","25,664.30",849.00,"162,920.00"`;

  $('#xr-sample').addEventListener('click', () => {
    Object.assign(state, { campaigns: null, terms: null, sample: true, names: [] });
    brandIn.value = 'acme';
    ingest(SAMPLE_CAMPAIGNS, 'sample');
    ingest(SAMPLE_TERMS, 'sample');
    state.sample = true;
    render();
  });
})();
