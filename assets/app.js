/* معرض الصور والفيديو — يقرأ data.json المُولّد آليًا */
(() => {
  'use strict';

  const $  = (s) => document.querySelector(s);
  const PAGE = 32;                 // عدد العناصر في كل دفعة تحميل
  const NEW_DAYS = 7;              // مدة ظهور وسم "جديد"

  let CFG = {};
  let ASSET_V = '';                // رقم إصدار الملفات — يمنع عرض شعار قديم من الذاكرة المؤقتة
  let ALL = [];                    // كل العناصر
  let view = [];                   // العناصر بعد التصفية
  let shown = 0;                   // كم عنصرًا عُرض من view
  let lbIndex = -1;

  /* ---------- الوضع الليلي ---------- */
  function initTheme(pref) {
    const saved = localStorage.getItem('theme');
    const mode = saved || pref || 'dark';
    document.documentElement.dataset.theme = mode;
    document.querySelector('meta[name=theme-color]')
      ?.setAttribute('content', mode === 'dark' ? '#141110' : '#fbf8f6');
  }
  $('#themeBtn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    initTheme(next);
  });

  /* ---------- أدوات ---------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function waLink(itemTitle) {
    const num = String(CFG.whatsapp || '').replace(/\D/g, '');
    if (!num) return null;
    const msg = (CFG.whatsappMessage || '') + (itemTitle || '');
    return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
  }

  /** وسم "جديد" يُحسب وقت العرض، فيختفي وحده بعد NEW_DAYS بلا إعادة نشر. */
  function isRecent(item) {
    if (item.isNew === true) return true;              // توافق مع نسخ قديمة من data.json
    if (!item.added) return false;
    const t = Date.parse(item.added);
    return Number.isFinite(t) && (Date.now() - t) < NEW_DAYS * 864e5;
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 2200);
  }

  /* ---------- الترويسة ---------- */
  function renderHeader() {
    const name = CFG.brandName || 'المعرض';
    document.title = CFG.tagline ? `${name} — ${CFG.tagline}` : name;
    $('#brandName').textContent = name;
    $('#tagline').textContent = CFG.tagline || '';
    $('#footerBrand').textContent = `© ${new Date().getFullYear()} ${name}`;

    if (CFG.accent) document.documentElement.style.setProperty('--accent', CFG.accent);

    if (CFG.logo) {
      const slot = $('#logoSlot');
      const src = CFG.logo + (ASSET_V ? `?v=${encodeURIComponent(ASSET_V)}` : '');
      slot.innerHTML = `<img src="${esc(src)}" alt="${esc(name)}">`;
      slot.hidden = false;
      document.querySelector('.hero').classList.add('has-logo');
    }

    const links = [];
    const wa = waLink('');
    if (wa)            links.push(['واتساب', wa]);
    if (CFG.instagram) links.push(['انستقرام', `https://instagram.com/${String(CFG.instagram).replace(/^@/, '')}`]);
    if (CFG.phone)     links.push(['اتصال', `tel:${CFG.phone}`]);
    if (CFG.email)     links.push(['البريد', `mailto:${CFG.email}`]);
    if (CFG.location)  links.push(['الموقع', CFG.location]);

    $('#heroLinks').innerHTML = links
      .map(([label, href]) => `<a href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`)
      .join('');

    if (wa) { const f = $('#waFab'); f.href = wa; f.hidden = false; }
  }

  /* ---------- التصنيفات ---------- */
  function renderFilters() {
    const counts = new Map();
    ALL.forEach((i) => i.category && counts.set(i.category, (counts.get(i.category) || 0) + 1));
    if (counts.size < 2) return;                      // تصنيف واحد = لا داعي للأزرار

    // الأكثر منتجاتٍ أولًا — يضع تشكيلتك الأقوى أمام العين مباشرة
    const cats = [...counts.entries()].sort((a, b) => b[1] - a[1]);

    // بلا أعداد — العميل لا يعنيه كم قطعة في كل تصنيف. الأعداد تظهر في لوحة التحكم فقط.
    $('#filters').innerHTML =
      [['الكل', '*'], ...cats.map(([c]) => [c, c])]
        .map(([label, val], i) =>
          `<button class="chip" data-cat="${esc(val)}" aria-pressed="${i === 0}">${esc(label)}</button>`)
        .join('');

    $('#filters').addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      $('#filters').querySelectorAll('.chip')
        .forEach((c) => c.setAttribute('aria-pressed', String(c === btn)));
      applyFilter(btn.dataset.cat);
    });
  }

  function applyFilter(cat) {
    view = cat === '*' ? ALL : ALL.filter((i) => i.category === cat);
    shown = 0;
    $('#grid').innerHTML = '';
    $('#emptyState').hidden = view.length > 0;
    $('#totalCount').textContent = view.length;
    renderMore();
  }

  /* ---------- الشبكة ---------- */
  function cardHTML(item, idx) {
    const vid = item.type === 'video'
      ? `<span class="badge-video"><svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg></span>` : '';
    const isNew = isRecent(item) ? `<span class="badge-new">جديد</span>` : '';

    return `<figure class="card" data-idx="${idx}" style="animation-delay:${Math.min(idx % PAGE, 11) * 26}ms">
      <div class="card-media">
        <img src="${esc(item.thumb || item.src)}" alt="${esc(item.title || '')}" loading="lazy" decoding="async">
        ${vid}${isNew}
      </div>
      <figcaption>
        <span class="card-name">${esc(item.title || '')}</span>
        <span class="card-cat">${esc(item.category || '')}</span>
      </figcaption>
    </figure>`;
  }

  function renderMore() {
    const slice = view.slice(shown, shown + PAGE);
    if (!slice.length) return;
    $('#grid').insertAdjacentHTML('beforeend',
      slice.map((it, i) => cardHTML(it, shown + i)).join(''));
    shown += slice.length;
  }

  new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && shown < view.length) renderMore();
  }, { rootMargin: '900px' }).observe($('#sentinel'));

  $('#grid').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card) openLightbox(Number(card.dataset.idx));
  });

  /* ---------- العارض ---------- */
  function openLightbox(i) {
    if (i < 0 || i >= view.length) return;
    lbIndex = i;
    const item = view[i];

    $('#lbStage').innerHTML = item.type === 'video'
      ? `<video src="${esc(item.src)}" controls autoplay playsinline preload="metadata"${item.thumb ? ` poster="${esc(item.thumb)}"` : ''}></video>`
      : `<img src="${esc(item.src)}" alt="${esc(item.title || '')}">`;

    $('#lbTitle').textContent = item.title || '';
    $('#lbCat').textContent   = item.category || '';

    const wa = waLink(item.title);
    const waBtn = $('#lbWa');
    if (wa) { waBtn.href = wa; waBtn.hidden = false; } else { waBtn.hidden = true; }

    $('#lbPrev').style.visibility = i > 0 ? '' : 'hidden';
    $('#lbNext').style.visibility = i < view.length - 1 ? '' : 'hidden';

    $('#lightbox').hidden = false;
    document.body.style.overflow = 'hidden';
    history.replaceState(null, '', '#' + encodeURIComponent(item.id));
  }

  function closeLightbox() {
    $('#lightbox').hidden = true;
    $('#lbStage').innerHTML = '';           // يوقف تشغيل الفيديو
    document.body.style.overflow = '';
    lbIndex = -1;
    history.replaceState(null, '', location.pathname + location.search);
  }

  const step = (d) => openLightbox(lbIndex + d);

  $('#lbClose').addEventListener('click', closeLightbox);
  $('#lbPrev').addEventListener('click', () => step(-1));
  $('#lbNext').addEventListener('click', () => step(1));
  $('#lightbox').addEventListener('click', (e) => {
    if (e.target.id === 'lightbox' || e.target.id === 'lbStage') closeLightbox();
  });

  document.addEventListener('keydown', (e) => {
    if ($('#lightbox').hidden) return;
    if (e.key === 'Escape') closeLightbox();
    // في RTL يظل السهم الأيسر = التالي منطقيًا حسب اتجاه التصفح
    if (e.key === 'ArrowLeft')  step(1);
    if (e.key === 'ArrowRight') step(-1);
  });

  // السحب بالإصبع
  let touchX = 0;
  $('#lightbox').addEventListener('touchstart', (e) => { touchX = e.changedTouches[0].clientX; }, { passive: true });
  $('#lightbox').addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 55) step(dx > 0 ? -1 : 1);
  }, { passive: true });

  $('#lbShare').addEventListener('click', async () => {
    const item = view[lbIndex];
    if (!item) return;
    const url = location.origin + location.pathname + '#' + encodeURIComponent(item.id);
    try {
      if (navigator.share) await navigator.share({ title: item.title || CFG.brandName, url });
      else { await navigator.clipboard.writeText(url); toast('تم نسخ الرابط'); }
    } catch { /* ألغى المستخدم المشاركة */ }
  });

  /* ---------- الإقلاع ---------- */
  async function getJSON(path, fallback) {
    try {
      const r = await fetch(path + '?v=' + Date.now());
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch (err) {
      console.warn('تعذّر تحميل ' + path, err);
      return fallback;
    }
  }

  (async function boot() {
    const [cfg, data] = await Promise.all([
      getJSON('site.config.json', {}),
      getJSON('data.json', { items: [] }),
    ]);

    CFG = cfg;
    ASSET_V = data.version || '';
    initTheme(CFG.defaultTheme);
    renderHeader();

    ALL = Array.isArray(data) ? data : (data.items || []);
    ALL.sort((a, b) => (Date.parse(b.added) || 0) - (Date.parse(a.added) || 0));

    renderFilters();
    applyFilter('*');

    // فتح عنصر محدد إذا جاء الرابط بمعرّف
    const hash = decodeURIComponent(location.hash.slice(1));
    if (hash) {
      const idx = view.findIndex((i) => i.id === hash);
      if (idx > -1) {
        while (shown <= idx && shown < view.length) renderMore();
        openLightbox(idx);
      }
    }
  })();
})();
