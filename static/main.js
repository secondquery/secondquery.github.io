{
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* cookie consent, Google Ads and Google Analytics: nothing loads until the visitor accepts */
  const ADS_ID = 'AW-18587102702';
  const GA4_ID = 'G-43M1VJ9SGS'; // GA4 property secondquery.com
  const LEAD_SEND_TO = 'AW-18587102702/G8ePCMKg2LwdEO7bgp9F';
  const EC_ON = true; // enhanced conversions: a hashed email is sent with the conversion, only with consent
  // what each enquiry is worth, in GBP: the price of the option picked (monthly options count three months)
  const OPTION_VALUE = { 'consultation': 295, 'focused-review': 795, 'decision-review': 1750, 'advisory': 4500,
    'expert-session': 295, 'second-opinion': 795, 'workshop': 1250, 'team-advisory': 6000 };
  const CONSENT_KEY = 'sq-consent-v1';
  const readConsent = () => {
    try { const c = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null'); if (c && Date.now() - c.t < 182 * 864e5) return c.v; } catch (e) {}
    return null;
  };
  const saveConsent = v => { try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ v, t: Date.now() })); } catch (e) {} };
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  let tagLoaded = false;
  const loadTag = () => {
    if (tagLoaded) return;
    tagLoaded = true;
    gtag('consent', 'default', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'denied', analytics_storage: 'granted' });
    gtag('js', new Date());
    gtag('config', ADS_ID, { allow_enhanced_conversions: EC_ON });
    if (GA4_ID) gtag('config', GA4_ID, { allow_google_signals: false, allow_ad_personalization_signals: false, cookie_expires: 33696000 });
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ADS_ID;
    document.head.appendChild(s);
  };
  // GA4 events: only sent once the visitor has accepted and the tag is loaded
  const track = (name, params) => { if (tagLoaded && GA4_ID) gtag('event', name, Object.assign({ send_to: GA4_ID }, params || {})); };
  window.sqTrack = track;
  const clearAdCookies = () => {
    document.cookie.split(';').map(c => c.trim().split('=')[0]).filter(n => /^(_gcl_|_ga)/.test(n)).forEach(n => {
      document.cookie = n + '=; Max-Age=0; path=/';
      document.cookie = n + '=; Max-Age=0; path=/; domain=.' + location.hostname.replace(/^www\./, '');
    });
  };
  const showCookieBar = () => {
    let bar = document.getElementById('cookiebar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'cookiebar';
      bar.className = 'cookiebar';
      bar.setAttribute('role', 'region');
      bar.setAttribute('aria-label', 'Cookie choice');
      bar.innerHTML = '<p><b>One cookie question.</b> If you accept, Google Ads and Google Analytics set cookies so I can see which pages and ads lead to enquiries. No ad personalisation, and declining changes nothing on the site. <a href="/privacy/#cookies">Privacy notice</a></p>' +
        '<div class="cb-btns"><button type="button" class="btn ghost" data-c="denied">Decline</button><button type="button" class="btn" data-c="granted">Accept</button></div>';
      document.body.appendChild(bar);
      bar.addEventListener('click', e => {
        const b = e.target.closest('button[data-c]');
        if (!b) return;
        saveConsent(b.dataset.c);
        bar.hidden = true;
        if (b.dataset.c === 'granted') loadTag();
        else { if (tagLoaded) gtag('consent', 'update', { ad_storage: 'denied', ad_user_data: 'denied', analytics_storage: 'denied' }); clearAdCookies(); }
      });
    }
    bar.hidden = false;
  };
  const consentNow = readConsent();
  if (consentNow === 'granted') loadTag();
  else if (consentNow === null) showCookieBar();
  document.querySelectorAll('[data-cookie-settings]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); showCookieBar(); }));

  /* ad click IDs: kept in the page address as people move around the site */
  const CLICK_KEYS = ['gclid', 'gbraid', 'wbraid', 'msclkid'];
  const qp = new URLSearchParams(location.search);
  const clickIds = CLICK_KEYS.filter(k => qp.get(k)).map(k => [k, qp.get(k).slice(0, 200)]);
  if (clickIds.length) {
    document.querySelectorAll('a[href^="/"]').forEach(a => {
      const u = new URL(a.getAttribute('href'), location.origin);
      clickIds.forEach(([k, v]) => u.searchParams.set(k, v));
      a.setAttribute('href', u.pathname + u.search + u.hash);
    });
  }

  /* copy buttons for code blocks */
  document.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const el = document.getElementById(btn.dataset.copy);
      if (!el) return;
      const label = btn.textContent;
      try { await navigator.clipboard.writeText(el.textContent); btn.textContent = 'Copied'; track('copy_script', { script_name: btn.dataset.copy.replace(/^code-/, '') }); }
      catch (e) { const box = el.closest('details'); if (box) box.open = true; btn.textContent = 'Select the code below'; }
      setTimeout(() => { btn.textContent = label; }, 2200);
    });
  });

  document.querySelectorAll('a[download]').forEach(a => a.addEventListener('click', () => track('download_script', { script_name: a.getAttribute('href').split('/').pop().replace(/\.js$/, '') })));

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
      ['second opinion on our google ads plan', 'Have a senior paid search lead pressure-test your plan before it goes to the leadership team.', 'ppc-teams'],
      ['new head of performance first 90 days', 'Give your new lead an independent Google Ads baseline in their first weeks, so they start with a plan, not three months of discovery.', 'decision-review'],
      ['moving to value based bidding', 'Check the targets, values and learning periods before you switch, not after the numbers move.', 'ppc-teams'],
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

    const started = Date.now();
    const cookieGclid = () => {
      const m = document.cookie.match(/(?:^|; )_gcl_aw=([^;]+)/);
      return m ? decodeURIComponent(m[1]).split('.').slice(2).join('.') : '';
    };
    const endpoint = form.dataset.endpoint || '';
    const mailtoFallback = () => {
      const subject = `Second Query brief: ${val('company') || val('name')}`;
      window.location.href = `mailto:sam@secondquery.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(briefText())}`;
      status.textContent = 'Your email app should open with the brief filled in. If it does not, use Copy brief and email it to sam@secondquery.com.';
    };
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!val('name') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val('email'))) {
        status.textContent = 'Please add your name and a work email so I can reply.';
        return;
      }
      if (!endpoint) { mailtoFallback(); return; }
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = 'Sending…';
      status.textContent = '';
      const consent = readConsent() === 'granted';
      const clicks = Object.fromEntries(clickIds);
      if (consent && !clicks.gclid && cookieGclid()) clicks.gclid = cookieGclid().slice(0, 200);
      const payload = {
        option: optSel && optSel.value ? optSel.options[optSel.selectedIndex].text : 'Not sure yet',
        name: val('name'), email: val('email'), role: val('role'), company: val('company'),
        decision: checked('decision').join(', '), spend: val('spend'), timing: val('timing'), details: val('details'),
        website: val('website'), ms: Date.now() - started, page: location.pathname,
        adConsent: consent, clicks: consent ? clicks : {}
      };
      try {
        const r = await fetch(endpoint, { method: 'POST', body: JSON.stringify(payload) });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || 'not ok');
        if (consent && tagLoaded) {
          if (EC_ON) gtag('set', 'user_data', { email: payload.email });
          const value = (optSel && OPTION_VALUE[optSel.value]) || 795;
          gtag('event', 'conversion', { send_to: LEAD_SEND_TO, value: value, currency: 'GBP', transaction_id: 'brief-' + Date.now() });
          track('generate_lead', { value: value, currency: 'GBP', lead_option: (optSel && optSel.value) || 'not-sure' });
        }
        form.classList.add('sent');
        form.innerHTML = `<div class="sentmsg" role="status"><h2>Thanks, ${payload.name.split(' ')[0].replace(/[<>&"]/g, '')}. Your brief is with me.</h2><p>You'll get a reply within two working days, usually sooner. A copy is on its way to ${payload.email.replace(/[<>&"]/g, '')}.</p><p>In the meantime, the free <a href="/tools/">Account X-ray</a> gives you a first read on your own account.</p></div>`;
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Send brief';
        status.innerHTML = 'That didn\'t send. Please try again, or <a href="#" id="mailfallback">email it instead</a>.';
        const fb = document.getElementById('mailfallback');
        if (fb) fb.addEventListener('click', ev => { ev.preventDefault(); mailtoFallback(); });
      }
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
      { k: ['head of performance', 'just started', 'new role', 'new job', 'inherited', 'first 90', 'first 30', 'first month'], s: 'An independent Google Ads baseline in your first weeks, so you start with a plan rather than months of discovery.', p: 'decision-review', h: '/services/#review' },
      { k: ['budget', 'spend more', 'scale', 'grow', 'growth', 'increase', 'more money', 'next £'], s: 'Find where extra budget is likely to work hardest, where returns are already flattening, and what to measure before you scale.', p: 'how-i-work', h: '/services/#review' },
      { k: ['pmax', 'performance max', 'p max'], s: 'Separate what Performance Max finds from what it simply claims, using the channel and search term reports most teams never open.', p: 'decision-review', h: '/services/#review' },
      { k: ['brand'], s: 'Split brand from non-brand and judge each on its own terms. The account-wide average usually flatters non-brand.', p: 'account-x-ray', h: '/tools/' },
      { k: ['ai max', 'automation', 'auto apply', 'auto-apply', 'recommendation', 'optimisation score', 'optimization score'], s: "Judge automation on your own margins and search terms, not platform averages. Then make it a decision, not a default.", p: 'insights', h: '/insights/ai-max-on-by-default-in-editor/' },
      { k: ['ai mode', 'ai overview', 'overviews', 'gemini', 'chatgpt'], s: "Ads in AI Mode are due in the UK. There's nothing to opt into, so check what your current set-up will do when they arrive.", p: 'insights', h: '/insights/ads-in-ai-mode-uk/' },
      { k: ['cpa', 'cost per', 'cpl', 'expensive', 'rising', 'creep', 'roas', 'return on', 'dropped', 'drop', 'worse', 'declin', 'falling'], s: 'Rising costs rarely have one cause. Tracking, targets, auction pressure and query drift usually arrive together. A Review isolates the one doing the damage.', p: 'decision-review', h: '/services/#review' },
      { k: ['tracking', 'conversion', 'measure', 'attribution', 'ga4', 'analytics', 'offline', 'crm'], s: "If bidding is optimising towards the wrong thing, nothing else matters. It's the first thing every Review checks.", p: 'how-i-work', h: '/approach/' },
      { k: ['learning', 'smart bidding', 'tcpa', 'troas', 'target', 'bid strategy', 'bidding'], s: "The Learning label clears within seven days. The learning doesn't. Work out how long to wait before judging a change.", p: 'learning-clock', h: '/tools/#learning-clock' },
      { k: ['small business', 'small budget', 'myself', 'diy', 'freelancer', 'sole trader', 'small account'], s: 'Smaller accounts are welcome. Most start with the free Account X-ray or a £295 consultation and a one-page plan.', p: 'small-business', h: '/services/#small-business' },
      { k: ['second opinion', 'our plan', 'my plan', 'the plan', 'restructure', 'workshop', 'training', 'train', 'value based', 'value-based', 'sounding board', 'in-house team', 'ppc team', 'our team'], s: 'For in-house PPC teams: send the plan and get a written senior critique within five working days, before you commit to it.', p: 'ppc-teams', h: '/ppc-teams/' },
      { k: ['microsoft', 'bing'], s: 'Microsoft Advertising is part of every Review wherever it carries meaningful spend or opportunity.', p: 'services', h: '/services/' },
      { k: ['audit', 'health', 'check', 'waste', 'wasted', 'negative', 'search term'], s: 'Start with the free Account X-ray: drop in a report and see where the waste is, without uploading anything.', p: 'account-x-ray', h: '/tools/' },
      { k: ['price', 'how much', 'fee', 'pricing', 'cost of', 'charge'], s: 'Fixed prices, agreed up front. For businesses: £295 to £1,750, or £1,500 a month. For in-house PPC teams: £295 to £1,250, or £2,000 a month.', p: 'services', h: '/services/' }
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
      review: { name: 'Decision Review', price: '£1,750', slug: 'decision-review', gets: ['An independent review of the whole account against your decision', 'Clear written advice, the risks and a suggested 90-day plan', 'A 90-minute readout and two weeks of follow-up'] },
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
