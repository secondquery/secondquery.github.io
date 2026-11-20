{
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* mobile navigation */
  const menuBtn = document.querySelector('.menu-btn');
  const nav = document.getElementById('nav');
  if (menuBtn && nav) {
    menuBtn.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', String(open));
    });
  }

  /* hero: the search bar types real buyer questions and the one independent result answers each */
  const typed = document.getElementById('typed');
  const snippet = document.getElementById('snippet');
  const crumb = document.getElementById('crumbpath');
  if (typed && snippet) {
    const pairs = [
      ['should we change our ppc agency', 'Get an independent read on what is working before you move the account, from someone who is not pitching for it.', 'decision-review'],
      ['new head of performance first 90 days', 'Give your new lead a specialist Google Ads baseline in ten working days, so they start with a plan, not three months of discovery.', 'decision-review'],
      ['bring google ads in-house', 'Know what to keep, what to rebuild and what your team should own first, before the move costs you a quarter.', 'services'],
      ['where should the next £20k a month go', 'Find where extra budget is likely to work hardest, and what you need to measure before you scale it.', 'decision-review'],
      ['is performance max taking credit for our brand', 'Separate what Performance Max finds from what it simply claims, and decide what to do about it.', 'approach'],
      ['is ai max worth switching on', 'Judge it on your own margins and search terms, not on platform averages.', 'insights']
    ];
    const setResult = i => {
      snippet.style.opacity = 0;
      setTimeout(() => {
        snippet.textContent = pairs[i][1];
        if (crumb) crumb.textContent = pairs[i][2];
        snippet.style.opacity = 1;
      }, 220);
    };
    if (reduce) {
      typed.textContent = pairs[0][0];
      setResult(0);
    } else {
      let i = 0, ch = 0, deleting = false;
      const step = () => {
        if (document.getElementById('heroform') && document.getElementById('heroform').classList.contains('active')) return;
        const q = pairs[i][0];
        if (!deleting) {
          ch++;
          typed.textContent = q.slice(0, ch);
          if (ch === q.length) {
            setResult(i);
            deleting = true;
            return setTimeout(step, 3600);
          }
          return setTimeout(step, 45 + Math.random() * 55);
        }
        ch -= 2;
        typed.textContent = q.slice(0, Math.max(ch, 0));
        if (ch <= 0) {
          deleting = false;
          ch = 0;
          i = (i + 1) % pairs.length;
          return setTimeout(step, 380);
        }
        return setTimeout(step, 18);
      };
      setTimeout(step, 600);
    }
  }

  /* insights filter */
  const filterBar = document.querySelector('.filters');
  if (filterBar) {
    const cards = [...document.querySelectorAll('[data-tags]')];
    filterBar.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      filterBar.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      const t = b.dataset.tag;
      cards.forEach(c => { c.hidden = t !== 'all' && !c.dataset.tags.split('|').includes(t); });
    });
  }

  /* contact: brief builder with a brief-strength meter */
  const form = document.getElementById('brief');
  if (form) {
    const labelEl = document.getElementById('strength-label');
    const bars = [...document.querySelectorAll('.meter i')];
    const items = [...document.querySelectorAll('.strength li')];
    const status = document.getElementById('status');
    const val = n => (form.elements[n] && form.elements[n].value || '').trim();
    const checked = n => [...form.querySelectorAll(`input[name="${n}"]:checked`)].map(x => x.value);
    const checks = () => [
      val('name') && val('email').includes('@'),
      val('company').length > 1,
      checked('decision').length > 0,
      val('spend') !== '',
      val('details').length >= 80
    ];
    const names = ['Poor', 'Average', 'Good', 'Very good', 'Excellent'];
    const update = () => {
      const c = checks();
      const score = c.filter(Boolean).length;
      items.forEach((li, k) => li.classList.toggle('done', !!c[k]));
      const lit = Math.min(4, Math.round(score * 4 / 5));
      bars.forEach((b, k) => b.classList.toggle('on', k < lit));
      labelEl.textContent = score === 0 ? 'Not started' : names[Math.max(0, score - 1)];
    };
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    update();

    const optSel = form.elements.option;
    const want = new URLSearchParams(location.search).get('option');
    if (optSel && want && [...optSel.options].some(o => o.value === want)) {
      optSel.value = want;
      const picked = document.getElementById('picked');
      if (picked) { picked.hidden = false; picked.querySelector('b').textContent = optSel.options[optSel.selectedIndex].text; }
    }
    const briefText = () => [
      `Option: ${optSel && optSel.value ? optSel.options[optSel.selectedIndex].text : 'Not sure yet'}`,
      `Name: ${val('name')}`,
      `Role: ${val('role')}`,
      `Company: ${val('company')}`,
      `Email: ${val('email')}`,
      `Decision: ${checked('decision').join(', ') || 'Not said'}`,
      `Monthly Google Ads spend: ${val('spend') || 'Not said'}`,
      `Timing: ${val('timing') || 'Not said'}`,
      '',
      val('details')
    ].join('\n');

    form.addEventListener('submit', e => {
      e.preventDefault();
      if (!val('name') || !val('email').includes('@')) {
        status.textContent = 'Please add your name and a work email so I can reply.';
        return;
      }
      const subject = `Second Query brief: ${val('company') || val('name')}`;
      const href = `mailto:sam@secondquery.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(briefText())}`;
      window.location.href = href;
      status.textContent = 'Your email app should open with the brief filled in. If it does not, use Copy brief and email it to sam@secondquery.com.';
    });

    const copyBtn = document.getElementById('copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(briefText());
          status.textContent = 'Brief copied. Paste it into an email to sam@secondquery.com.';
        } catch (err) {
          status.textContent = 'Copy is blocked in this browser. Please email sam@secondquery.com directly.';
        }
      });
    }
  }

  /* 404: show the path people searched for */
  const miss = document.getElementById('missing-path');
  if (miss) miss.textContent = decodeURIComponent(location.pathname);
}

/* ---------- playful, in-section interactions ---------- */
{
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const gbp = n => '£' + Math.round(n).toLocaleString('en-GB');

  /* hero: type your own question and the independent result answers it */
  const form = document.getElementById('heroform');
  if (form) {
    const input = document.getElementById('heroq');
    const snippet = document.getElementById('snippet');
    const crumb = document.getElementById('crumbpath');
    const link = document.querySelector('.searchscene .result h3 a');
    const bank = [
      { k: ['agency', 'switch', 'change', 'fire', 'pitch', 'retender', 'tender'], s: "Before you move the account, get an independent read on what's actually working, from someone who isn't pitching for it.", p: 'decision-review', h: '/services/#review' },
      { k: ['in-house', 'inhouse', 'in house', 'bring it', 'own team', 'recruit', 'hire'], s: 'Know what to keep, what to rebuild and what your team should own first, before the move costs you a quarter of performance.', p: 'services', h: '/services/' },
      { k: ['head of performance', 'just started', 'new role', 'new job', 'inherited', 'first 90', 'first 30', 'first month'], s: 'A specialist Google Ads baseline in ten working days, so you start with a plan rather than months of discovery.', p: 'decision-review', h: '/services/#review' },
      { k: ['budget', 'spend more', 'scale', 'grow', 'growth', 'increase', 'more money', 'next £'], s: 'Find where extra budget is likely to work hardest, where returns are already flattening, and what to measure before you scale.', p: 'how-i-work', h: '/approach/#budgetgame' },
      { k: ['pmax', 'performance max', 'p max'], s: 'Separate what Performance Max finds from what it simply claims, using the channel and search term reports most teams never open.', p: 'decision-review', h: '/services/#review' },
      { k: ['brand'], s: 'Split brand from non-brand and judge each on its own terms. The account-wide average usually flatters non-brand.', p: 'account-x-ray', h: '/tools/' },
      { k: ['ai max', 'automation', 'auto apply', 'auto-apply', 'recommendation', 'optimisation score', 'optimization score'], s: "Judge automation on your own margins and search terms, not platform averages. Then make it a decision, not a default.", p: 'insights', h: '/insights/ai-max-on-by-default-in-editor/' },
      { k: ['ai mode', 'ai overview', 'overviews', 'gemini', 'chatgpt'], s: "Ads in AI Mode are due in the UK. There's nothing to opt into, so check what your current set-up will do when they arrive.", p: 'insights', h: '/insights/ads-in-ai-mode-uk/' },
      { k: ['cpa', 'cost per', 'cpl', 'expensive', 'rising', 'creep', 'roas', 'return on', 'dropped', 'drop', 'worse', 'declin', 'falling'], s: 'Rising costs rarely have one cause. Tracking, targets, auction pressure and query drift usually arrive together. A Review isolates the one doing the damage.', p: 'decision-review', h: '/services/#review' },
      { k: ['tracking', 'conversion', 'measure', 'attribution', 'ga4', 'analytics', 'offline', 'crm'], s: "If bidding is optimising towards the wrong thing, nothing else matters. It's the first thing every Review checks.", p: 'how-i-work', h: '/approach/' },
      { k: ['learning', 'smart bidding', 'tcpa', 'troas', 'target', 'bid strategy', 'bidding'], s: "The Learning label clears within seven days. The learning doesn't. Work out how long to wait before judging a change.", p: 'learning-clock', h: '/tools/#learning-clock' },
      { k: ['small business', 'small budget', 'myself', 'diy', 'freelancer', 'sole trader', 'small account'], s: 'Smaller accounts are welcome. Most start with the free Account X-ray or a £295 consultation and a one-page plan.', p: 'small-business', h: '/services/#small-business' },
      { k: ['microsoft', 'bing'], s: 'Microsoft Advertising is part of every Review wherever it carries meaningful spend or opportunity.', p: 'services', h: '/services/' },
      { k: ['audit', 'health', 'check', 'waste', 'wasted', 'negative', 'search term'], s: 'Start with the free Account X-ray: drop in a report and see where the waste is, without uploading anything.', p: 'account-x-ray', h: '/tools/' },
      { k: ['price', 'how much', 'fee', 'pricing', 'cost of', 'charge'], s: 'Fixed prices, agreed up front: £295 for a consultation, £795 for a Focused Review, £1,750 for a Decision Review and £1,500 a month for advisory.', p: 'services', h: '/services/#quiz' }
    ];
    const fallback = { s: "Not every question fits a box. Send it as a brief and you'll get a straight answer within two working days.", p: 'start-a-brief', h: '/contact/' };
    let current = fallback;
    const answer = q => {
      q = q.toLowerCase();
      let best = null, score = 0;
      bank.forEach(a => { const n = a.k.filter(k => q.includes(k)).length; if (n > score) { score = n; best = a; } });
      return best || fallback;
    };
    const show = a => {
      current = a;
      snippet.style.opacity = 0;
      setTimeout(() => { snippet.textContent = a.s; crumb.textContent = a.p; link.href = a.h; snippet.style.opacity = 1; }, 160);
    };
    const activate = () => {
      if (form.classList.contains('active')) return;
      form.classList.add('active');
      input.focus();
    };
    form.addEventListener('click', activate);
    const tryOwn = document.getElementById('tryown');
    if (tryOwn) tryOwn.addEventListener('click', activate);
    let t;
    input.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { if (input.value.trim().length > 2) show(answer(input.value)); }, 260);
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const a = input.value.trim() ? answer(input.value) : current;
      window.location.href = a.h;
    });
  }

  /* "Sound familiar?" cards flip to show what's usually going on */
  document.querySelectorAll('.pain').forEach(card => card.addEventListener('click', () => {
    const open = card.classList.toggle('open');
    card.setAttribute('aria-expanded', String(open));
  }));

  /* a magnifying glass over the sample Review */
  const sheet = document.querySelector('.sheet.lens');
  if (sheet) {
    const doc = sheet.querySelector('.lensdoc');
    const ring = document.createElement('span');
    ring.className = 'lensring';
    sheet.appendChild(ring);
    const R = 92;
    const place = (x, y, r) => {
      doc.style.clipPath = `circle(${r}px at ${x}px ${y}px)`;
      ring.style.transform = `translate(${x - R}px, ${y - R}px)`;
      ring.style.opacity = r ? 1 : 0;
    };
    if (fine) {
      sheet.addEventListener('pointermove', e => {
        const b = sheet.getBoundingClientRect();
        place(e.clientX - b.left, e.clientY - b.top, R);
      });
      sheet.addEventListener('pointerleave', () => place(0, 0, 0));
    } else {
      sheet.addEventListener('click', () => {
        const open = sheet.classList.toggle('reveal');
        doc.style.clipPath = open ? 'circle(150% at 50% 50%)' : 'circle(0px at 50% 50%)';
      });
      const hint = sheet.querySelector('.lenshint');
      if (hint) hint.textContent = 'Tap to read it.';
    }
  }

  /* thirty-second search terms report: click the searches you'd never pay for */
  const game = document.getElementById('neggame');
  if (game) {
    const lane = document.getElementById('ng-lane');
    const startBtn = document.getElementById('ng-start');
    const savedEl = document.getElementById('ng-saved');
    const timeEl = document.getElementById('ng-time');
    const endEl = document.getElementById('ng-end');
    const bad = ['free google ads course', 'ppc jobs london', 'google ads login', 'what is cpc', 'ppc salary uk', 'google ads support phone number', 'adwords certification answers', 'google ads voucher code', 'how to run google ads yourself', 'ppc meaning', 'marketing internship', 'google ads for dummies pdf', 'seo agency near me', 'cheap ppc freelancer'];
    const good = ['google ads consultant uk', 'independent ppc audit', 'second opinion google ads', 'performance max review', 'paid search advisor', 'should we change ppc agency', 'google ads strategy advice'];
    let saved = 0, missed = 0, wrong = 0, timer, spawner, left = 0, running = false;
    const spawn = () => {
      const isBad = Math.random() < 0.72;
      const pool = isBad ? bad : good;
      const term = pool[Math.floor(Math.random() * pool.length)];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'term';
      b.textContent = term;
      b.dataset.bad = isBad ? '1' : '';
      b.dataset.cost = String(isBad ? 4 + Math.floor(Math.random() * 16) : 0);
      b.style.top = (8 + Math.floor(Math.random() * 3) * 34) + 'px';
      const dur = 6.5 + Math.random() * 3;
      if (reduce) {
        b.style.left = (5 + Math.random() * 55) + '%';
        setTimeout(() => expire(b), 3500);
      } else {
        b.style.animationDuration = dur + 's';
        b.addEventListener('animationend', () => expire(b));
      }
      b.addEventListener('click', () => hit(b));
      lane.appendChild(b);
    };
    const expire = b => {
      if (!b.isConnected || b.dataset.done) return;
      if (b.dataset.bad) missed += Number(b.dataset.cost);
      b.remove();
    };
    const hit = b => {
      if (!running || b.dataset.done) return;
      b.dataset.done = '1';
      if (b.dataset.bad) {
        saved += Number(b.dataset.cost);
        b.classList.add('negged');
        b.textContent = '− ' + b.textContent;
      } else {
        wrong++;
        saved = Math.max(0, saved - 25);
        b.classList.add('oops');
        b.textContent = 'that was a good one';
      }
      savedEl.textContent = gbp(saved);
      setTimeout(() => b.remove(), 650);
    };
    const end = () => {
      running = false;
      clearInterval(timer); clearInterval(spawner);
      lane.querySelectorAll('.term').forEach(b => b.remove());
      const lines = [`You blocked ${gbp(saved)} of wasted clicks` + (missed ? ` and let ${gbp(missed)} slip through.` : '.')];
      if (wrong) lines.push(`You also blocked ${wrong} good search${wrong > 1 ? 'es' : ''}, which is the other half of the job.`);
      lines.push('Most real accounts have far more hiding in the search terms report. <a href="/tools/">Run the free Account X-ray</a> to find yours.');
      endEl.innerHTML = lines.join(' ');
      endEl.hidden = false;
      startBtn.textContent = 'Play again';
      lane.appendChild(startBtn);
    };
    startBtn.addEventListener('click', () => {
      saved = 0; missed = 0; wrong = 0; left = 30; running = true;
      savedEl.textContent = '£0'; timeEl.textContent = '30s'; endEl.hidden = true;
      startBtn.remove();
      spawn();
      spawner = setInterval(spawn, 850);
      timer = setInterval(() => { left--; timeEl.textContent = left + 's'; if (left <= 0) end(); }, 1000);
    });
  }

  /* where should the next £20k go? */
  const bg = document.getElementById('budgetgame');
  if (bg) {
    const TOTAL = 20000;
    const curves = { brand: { a: 22, b: 3500 }, nonbrand: { a: 170, b: 24000 }, pmax: { a: 95, b: 15000 } };
    const f = (k, x) => curves[k].a * (1 - Math.exp(-x / curves[k].b));
    const marginal = (k, x) => curves[k].b / (curves[k].a * Math.exp(-x / curves[k].b));
    const cols = [...bg.querySelectorAll('.bcol')];
    const ranges = cols.map(c => c.querySelector('input'));
    const keys = cols.map(c => c.dataset.k);
    const youEl = document.getElementById('bg-you'), bestEl = document.getElementById('bg-best');
    let best = null, bestVal = 0;
    for (let x = 0; x <= TOTAL; x += 500) for (let y = 0; y <= TOTAL - x; y += 500) {
      const v = f('brand', x) + f('nonbrand', y) + f('pmax', TOTAL - x - y);
      if (v > bestVal) { bestVal = v; best = [x, y, TOTAL - x - y]; }
    }
    bestEl.textContent = Math.round(bestVal);
    const draw = () => {
      let total = 0;
      cols.forEach((c, i) => {
        const x = Number(ranges[i].value), k = keys[i], v = f(k, x);
        total += v;
        c.querySelector('.bval').textContent = gbp(x);
        c.querySelector('.bbar i').style.height = Math.min(100, v / 1.1) + '%';
        c.querySelector('.bout').innerHTML = `<b>+${Math.round(v)}</b> sales<br><span>next sale costs ${gbp(marginal(k, x))}</span>`;
      });
      youEl.textContent = Math.round(total);
      bg.classList.toggle('optimal', Math.round(total) >= Math.round(bestVal) - 1);
    };
    const rebalance = changed => {
      const others = ranges.filter((_, i) => i !== changed);
      const want = TOTAL - Number(ranges[changed].value);
      const have = others.reduce((a, r) => a + Number(r.value), 0);
      others.forEach(r => { r.value = String(have ? Math.round((Number(r.value) / have) * want / 500) * 500 : Math.round(want / others.length / 500) * 500); });
      const diff = TOTAL - ranges.reduce((a, r) => a + Number(r.value), 0);
      if (diff) { const r = others.find(o => Number(o.value) + diff >= 0) || others[0]; r.value = String(Number(r.value) + diff); }
    };
    ranges.forEach((r, i) => r.addEventListener('input', () => { rebalance(i); draw(); }));
    document.getElementById('bg-show').addEventListener('click', () => { ranges.forEach((r, i) => { r.value = String(best[i]); }); draw(); });
    draw();
  }

  /* the learning clock */
  document.querySelectorAll('.lclock').forEach(w => {
    const rate = w.querySelector('.lc-rate'), lag = w.querySelector('.lc-lag');
    const rateOut = w.querySelector('.lc-rate-out'), lagOut = w.querySelector('.lc-lag-out');
    const dots = w.querySelector('.lcdots'), res = w.querySelector('.lcresult');
    dots.innerHTML = '<i></i>'.repeat(50);
    const ds = [...dots.children];
    const fmt = d => d < 14 ? `${Math.ceil(d)} days` : d < 120 ? `about ${Math.round(d / 7)} weeks` : `about ${Math.round(d / 30)} months`;
    const draw = () => {
      const r = Number(rate.value), l = Number(lag.value);
      rateOut.textContent = r; lagOut.textContent = l;
      const byLabel = Math.min(50, r);
      ds.forEach((d, i) => d.classList.toggle('on', i < byLabel));
      const days = Math.max(7, (50 / r) * 7, 3 * l);
      let msg = `The "Learning" label clears within 7 days, when you'll have about <b>${Math.min(50, r)}</b> of the ~50 conversions. Plan on <b>${fmt(days)}</b> before judging the change.`;
      if (days > 90) msg += ' At this volume, consider bidding to a higher-volume conversion that still predicts value, or consolidating campaigns.';
      res.innerHTML = msg;
    };
    rate.addEventListener('input', draw); lag.addEventListener('input', draw);
    draw();
  });

  /* cards lean gently towards the cursor */
  if (fine && !reduce) {
    document.querySelectorAll('.post-card, .principle, .xtile').forEach(card => {
      card.addEventListener('pointermove', e => {
        const b = card.getBoundingClientRect();
        const x = (e.clientX - b.left) / b.width - 0.5, y = (e.clientY - b.top) / b.height - 0.5;
        card.style.transform = `perspective(700px) rotateX(${(-y * 4).toFixed(2)}deg) rotateY(${(x * 5).toFixed(2)}deg) translateY(-3px)`;
      });
      card.addEventListener('pointerleave', () => { card.style.transform = ''; });
    });
  }
}

/* ---------- which option fits you? (services quiz) ---------- */
{
  const quiz = document.getElementById('quiz');
  if (quiz) {
    const steps = [...quiz.querySelectorAll('.qstep')];
    const result = quiz.querySelector('.qresult');
    const prev = quiz.querySelector('.qprev');
    const bar = quiz.querySelector('.qprog i');
    const answers = {};
    let at = 0;
    const OPT = {
      consultation: { name: 'Strategy consultation', price: '£295', slug: 'consultation', gets: ['One hour on your question, by video call', 'A one-page summary of priorities within two working days', 'The fee comes off a bigger review within 30 days'] },
      focused: { name: 'Focused Review', price: '£795', slug: 'focused-review', gets: ['A proper look at one area: measurement, bidding, search terms or Performance Max', 'Written findings with prioritised fixes in five working days', 'A 45-minute walkthrough and a week of follow-up questions'] },
      review: { name: 'Decision Review', price: '£1,750', slug: 'decision-review', gets: ['An independent review of the whole account against your decision', 'A written recommendation, the risks and a 90-day plan in ten working days', 'A 90-minute readout and two weeks of follow-up'] },
      advisory: { name: 'Decision Review, then Strategic advisory', price: '£1,750 then £1,500 a month', slug: 'advisory', gets: ['A Decision Review to set the baseline', 'Then a monthly memo, strategy call and quarterly test plan', 'Rolling monthly, with no long contract'] }
    };
    const spendText = { s1: 'under £5,000 a month', s2: '£5,000 to £25,000 a month', s3: '£25,000 to £100,000 a month', s4: 'over £100,000 a month' };
    const pick = a => {
      const big = a.spend === 's3' || a.spend === 's4';
      if (a.who === 'none') return ['consultation', 'focused', "You're about to start, so the most useful thing is a plan before you spend: structure, tracking and a sensible first budget."];
      if (a.need === 'quick') return ['consultation', big ? 'review' : 'focused', 'You need a straight answer to one question, and an hour with a one-page plan is the quickest way to get it.'];
      if (a.need === 'area') {
        if (a.spend === 's1') return ['consultation', 'focused', `At ${spendText.s1}, an hour on the part that worries you usually covers it. If you want it gone through properly, the Focused Review is the step up.`];
        return ['focused', big ? 'review' : 'consultation', 'You want one part of the account looked at properly, with fixes written down. That is exactly what the Focused Review is for.'];
      }
      if (a.need === 'full') {
        if (a.spend === 's1') return ['focused', 'consultation', `At ${spendText.s1}, a lighter whole-account Focused Review gives you the full picture without a bigger fee.`];
        return ['review', 'focused', `A decision with real money attached deserves the whole account looked at against it. At ${spendText[a.spend]}, the Decision Review usually pays for itself.`];
      }
      if (a.need === 'ongoing') {
        if (!big) return ['focused', 'consultation', `At ${spendText[a.spend]}, monthly advisory is hard to justify. A Focused Review now, then a consultation each quarter, gives you senior input at the right moments.`];
        return ['advisory', 'review', 'Ongoing senior oversight works best on a shared baseline, so it starts with a Decision Review and then runs month to month.'];
      }
      return ['consultation', 'focused', ''];
    };
    const timing = { week: 'Consultations can usually happen within a few working days. Say your deadline in the brief.', month: 'That timing works well. Say your deadline in the brief so the work is scheduled around it.', quarter: 'Plenty of time to plan this properly.', explore: 'No pressure: the brief just starts a conversation.' };
    const show = i => {
      at = i;
      steps.forEach((s, k) => { s.hidden = k !== i; });
      result.hidden = i < steps.length;
      prev.hidden = i === 0 || i >= steps.length;
      bar.style.width = Math.min(100, (i / steps.length) * 100) + '%';
      if (i < steps.length) {
        steps[i].querySelectorAll('button').forEach(b => b.classList.toggle('chosen', answers[steps[i].dataset.q] === b.dataset.v));
      }
    };
    const finish = () => {
      const [main, alt, why] = pick(answers);
      const o = OPT[main], a = OPT[alt];
      result.querySelector('.qname').textContent = o.name;
      result.querySelector('.qprice').textContent = o.price;
      result.querySelector('.qwhy').textContent = why + ' ' + (timing[answers.when] || '');
      result.querySelector('.qgets').innerHTML = o.gets.map(g => `<li>${g}</li>`).join('');
      const cta = result.querySelector('.qcta');
      cta.href = '/contact/?option=' + o.slug;
      cta.textContent = 'Start a brief for this';
      result.querySelector('.qalt').innerHTML = a ? `Also worth a look: <a href="/contact/?option=${a.slug}">${a.name} (${a.price})</a>` : '';
      show(steps.length);
    };
    steps.forEach((s, i) => s.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      answers[s.dataset.q] = b.dataset.v;
      if (i + 1 < steps.length) show(i + 1); else finish();
    })));
    prev.addEventListener('click', () => show(Math.max(0, at - 1)));
    quiz.querySelector('.qback').addEventListener('click', () => show(0));
    show(0);
  }
}
