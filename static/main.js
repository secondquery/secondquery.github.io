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

    const briefText = () => [
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
