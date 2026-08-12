/* لوحة تحكم ELORA — تضيف وتعدّل وتحذف منتجات المتجر مباشرة من الجوال.
   تتصل بمستودع GitHub عبر واجهته البرمجية، وتجمع كل تعديل في حفظة واحدة. */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const KEY = 'elora-admin';

  const IMG_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp'];
  const VID_EXT = ['mp4', 'webm', 'mov', 'm4v', 'ogv'];

  const FULL_MAX  = 1600;   // أطول ضلع للصورة المنشورة
  const THUMB_MAX = 700;    // أطول ضلع للصورة المصغّرة
  const VIDEO_MAX_MB = 24;  // حدّ آمن لرفع الفيديو عبر الواجهة البرمجية

  let CFG = null;                 // {owner, repo, branch, token}
  let ITEMS = [];                 // المنتجات الحالية
  let CATS = [];                  // التصنيفات
  let filterCat = '*';
  let queue = [];                 // الملفات قيد المراجعة
  let editing = null;             // المنتج المفتوح في لوحة الخيارات

  /* ═══════════ أدوات عامة ═══════════ */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ext = (n) => (n.split('.').pop() || '').toLowerCase();
  const stem = (n) => n.replace(/\.[^.]+$/, '');

  /** ينظّف اسم ملف من الرموز التي يرفضها نظام الملفات، ويُبقي العربية كما هي. */
  const safeName = (s) => String(s)
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 80);

  /** يطابق مولّد المعرّفات في tools/build.py حتى تتفق الروابط المباشرة. */
  const makeId = (relPath) => relPath.replace(/\.[^.]+$/, '')
    .normalize('NFKC').replace(/[\s/\\]+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '').replace(/^-+|-+$/g, '').toLowerCase();

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 2600);
  }

  function busy(msg) {
    $('#busyMsg').textContent = msg;
    $('#busy').hidden = false;
  }
  const idle = () => { $('#busy').hidden = true; };

  /* ═══════════ واجهة GitHub ═══════════ */
  async function gh(path, { method = 'GET', body } = {}) {
    const r = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${CFG.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      let detail = '';
      try { detail = (await r.json()).message || ''; } catch { /* رد بلا JSON */ }
      const err = new Error(detail || `HTTP ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return r.status === 204 ? null : r.json();
  }

  const repoBase = () => `/repos/${CFG.owner}/${CFG.repo}`;

  const rawURL = (p) =>
    `https://raw.githubusercontent.com/${CFG.owner}/${CFG.repo}/${CFG.branch}/`
    + p.split('/').map(encodeURIComponent).join('/');

  /**
   * يجمع كل التغييرات في حفظة واحدة (commit).
   * entries: [{path, blob}] لإضافة/استبدال — {path, sha} لنقل ملف موجود — {path, sha:null} للحذف.
   */
  async function commit(entries, message, onProgress) {
    const ref  = await gh(`${repoBase()}/git/ref/heads/${CFG.branch}`);
    const base = ref.object.sha;
    const head = await gh(`${repoBase()}/git/commits/${base}`);

    const tree = [];
    let done = 0;
    const uploads = entries.filter((e) => e.blob).length;

    for (const e of entries) {
      if (e.blob) {
        const content = await toBase64(e.blob);
        const b = await gh(`${repoBase()}/git/blobs`, {
          method: 'POST', body: { content, encoding: 'base64' },
        });
        tree.push({ path: e.path, mode: '100644', type: 'blob', sha: b.sha });
        onProgress?.(++done, uploads);
      } else {
        tree.push({ path: e.path, mode: '100644', type: 'blob', sha: e.sha ?? null });
      }
    }

    const nt = await gh(`${repoBase()}/git/trees`, {
      method: 'POST', body: { base_tree: head.tree.sha, tree },
    });
    const nc = await gh(`${repoBase()}/git/commits`, {
      method: 'POST', body: { message, tree: nt.sha, parents: [base] },
    });
    await gh(`${repoBase()}/git/refs/heads/${CFG.branch}`, {
      method: 'PATCH', body: { sha: nc.sha },
    });
  }

  const toBase64 = (blob) => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1]);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });

  /* ═══════════ معالجة الصور والفيديو في المتصفح ═══════════ */
  function render(source, max, mime, quality) {
    const sw = source.width || source.videoWidth;
    const sh = source.height || source.videoHeight;
    const k = Math.min(1, max / Math.max(sw, sh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * k));
    c.height = Math.max(1, Math.round(sh * k));
    c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
    return new Promise((res) =>
      c.toBlob((b) => res({ blob: b, w: c.width, h: c.height }), mime, quality));
  }

  async function prepImage(file) {
    const bmp = await createImageBitmap(file);
    try {
      const full  = await render(bmp, FULL_MAX,  'image/jpeg', 0.85);
      const thumb = await render(bmp, THUMB_MAX, 'image/webp', 0.8);
      return { kind: 'image', full: full.blob, thumb: thumb.blob,
               w: full.w, h: full.h, outExt: 'jpg', thumbExt: 'webp' };
    } finally { bmp.close?.(); }
  }

  async function prepVideo(file) {
    if (file.size > VIDEO_MAX_MB * 1024 * 1024) {
      throw new Error(`الفيديو أكبر من ${VIDEO_MAX_MB} ميجابايت. اقتصّه أو صغّر جودته.`);
    }
    const url = URL.createObjectURL(file);
    const v = Object.assign(document.createElement('video'),
      { src: url, muted: true, playsInline: true, preload: 'metadata' });
    let thumb = null;
    try {
      await new Promise((res, rej) => {
        v.onloadeddata = res;
        v.onerror = () => rej(new Error('تعذّر قراءة الفيديو'));
        setTimeout(() => rej(new Error('انتهت مهلة قراءة الفيديو')), 15000);
      });
      await new Promise((res) => {
        v.onseeked = res;
        v.currentTime = Math.min(1, (v.duration || 3) / 3);
        setTimeout(res, 4000);                       // بعض الصيغ لا تُطلق seeked
      });
      thumb = (await render(v, THUMB_MAX, 'image/jpeg', 0.8)).blob;
    } catch { /* بلا غلاف — سيظهر الفيديو بخلفية سادة */ }
    finally { URL.revokeObjectURL(url); }

    return { kind: 'video', full: file, thumb,
             w: v.videoWidth || null, h: v.videoHeight || null,
             outExt: ext(file.name), thumbExt: 'jpg' };
  }

  /* ═══════════ تحميل حالة المستودع ═══════════ */
  async function loadItems() {
    const tree = await gh(`${repoBase()}/git/trees/${CFG.branch}?recursive=1`);
    const thumbs = new Map();
    const files = [];

    for (const n of tree.tree) {
      if (n.type !== 'blob' || !n.path.startsWith('media/')) continue;
      const rel = n.path.slice('media/'.length);
      if (rel.startsWith('_thumbs/')) {
        thumbs.set(makeId(rel.slice('_thumbs/'.length)), n);
      } else if (!rel.split('/').some((p) => p.startsWith('_') || p.startsWith('.'))) {
        files.push({ node: n, rel });
      }
    }

    ITEMS = files.map(({ node, rel }) => {
      const parts = rel.split('/');
      const e = ext(rel);
      const type = VID_EXT.includes(e) ? 'video' : IMG_EXT.includes(e) ? 'image' : null;
      if (!type) return null;
      const th = thumbs.get(makeId(rel));
      return {
        path: node.path, sha: node.sha,
        title: stem(parts[parts.length - 1]),
        category: parts.length > 1 ? parts[0] : 'عام',
        type,
        thumbPath: th?.path || null,
        thumbSha: th?.sha || null,
        pending: false,
      };
    }).filter(Boolean);

    ITEMS.sort((a, b) => a.category.localeCompare(b.category, 'ar')
      || a.title.localeCompare(b.title, 'ar'));

    CATS = [...new Set(ITEMS.map((i) => i.category))].sort((a, b) => a.localeCompare(b, 'ar'));
    if (tree.truncated) toast('المستودع كبير — قد لا تظهر كل المنتجات.');
  }

  /* ═══════════ العرض ═══════════ */
  function renderAll() {
    $('#ahCount').textContent = `${ITEMS.length} منتج · ${CATS.length} تصنيف`;
    $('#ahView').href = `https://${CFG.owner}.github.io/${CFG.repo}/`;

    // الأعداد هنا فقط — تساعد على الإدارة، ولا تظهر للعميل في المتجر
    const counts = new Map();
    ITEMS.forEach((i) => counts.set(i.category, (counts.get(i.category) || 0) + 1));

    $('#aFilters').innerHTML =
      [['الكل', '*', ITEMS.length], ...CATS.map((c) => [c, c, counts.get(c) || 0])]
        .map(([label, val, n]) =>
          `<button class="chip" data-cat="${esc(val)}" aria-pressed="${val === filterCat}">${esc(label)}<span class="n">${n}</span></button>`)
        .join('');

    const view = filterCat === '*' ? ITEMS : ITEMS.filter((i) => i.category === filterCat);
    $('#aEmpty').hidden = view.length > 0;

    $('#aGrid').innerHTML = view.map((it) => {
      const i = ITEMS.indexOf(it);
      const src = it.thumbPath ? rawURL(it.thumbPath) : rawURL(it.path);
      return `<button class="acard${it.pending ? ' pending' : ''}" data-i="${i}">
        <img src="${esc(src)}" alt="" loading="lazy" decoding="async">
        ${it.type === 'video' ? '<span class="tag">فيديو</span>' : ''}
        <span class="nm">${esc(it.title)}</span>
      </button>`;
    }).join('');
  }

  $('#aFilters').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    filterCat = b.dataset.cat;
    renderAll();
  });

  $('#aGrid').addEventListener('click', (e) => {
    const b = e.target.closest('.acard');
    if (b) openItem(ITEMS[Number(b.dataset.i)]);
  });

  /* ═══════════ إضافة منتجات ═══════════ */
  $('#btnAdd').addEventListener('click', () => $('#filePick').click());

  $('#filePick').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;

    busy('جارٍ تجهيز الملفات…');
    clearQueue();
    const failed = [];
    for (const f of files) {
      const e2 = ext(f.name);
      try {
        if (IMG_EXT.includes(e2))      queue.push({ file: f, ...(await prepImage(f)) });
        else if (VID_EXT.includes(e2)) queue.push({ file: f, ...(await prepVideo(f)) });
        else failed.push(`${f.name}: صيغة غير مدعومة`);
      } catch (err) {
        failed.push(`${f.name}: ${err.message}`);
      }
    }
    idle();

    if (failed.length) toast(failed[0]);
    if (!queue.length) return;

    queue.forEach((q) => {
      q.title = safeName(stem(q.file.name)
        .replace(/^(IMG|VID|PXL|DSC|PHOTO)[-_ ]*/i, '')
        .replace(/^\d{4}[-_]?\d{2}[-_]?\d{2}([-_ ]?WA)?\d*[-_ ]*/i, '')
        .replace(/[-_]+/g, ' ').trim()) || 'منتج جديد';
      q.category = filterCat !== '*' ? filterCat : (CATS[0] || 'عام');
    });

    renderReview();
    $('#review').hidden = false;
  });

  function catOptions(selected) {
    return [...new Set([...CATS, selected])].filter(Boolean)
      .map((c) => `<option value="${esc(c)}"${c === selected ? ' selected' : ''}>${esc(c)}</option>`)
      .join('') + '<option value="__new__">＋ تصنيف جديد…</option>';
  }

  function renderReview() {
    $('#revList').innerHTML = queue.map((q, i) => {
      const mb = (q.full.size / 1048576).toFixed(1);
      const warn = q.full.size > VIDEO_MAX_MB * 1048576;
      q.preview ||= URL.createObjectURL(q.thumb || q.full);   // مرة واحدة لكل ملف
      return `<div class="rev-item" data-i="${i}">
        <img src="${q.preview}" alt="">
        <div class="rev-f">
          <label>اسم المنتج<input type="text" data-f="title" value="${esc(q.title)}"></label>
          <label>التصنيف<select data-f="category">${catOptions(q.category)}</select></label>
          <div class="rev-size${warn ? ' warn' : ''}">${q.kind === 'video' ? 'فيديو' : 'صورة'} · ${mb} م.ب</div>
          <button class="rev-drop" data-drop="${i}">إزالة من القائمة</button>
        </div>
      </div>`;
    }).join('');
    $('#revPublish').textContent = `نشر ${queue.length} ${queue.length === 1 ? 'منتج' : 'منتجات'}`;
  }

  $('#revList').addEventListener('input', (e) => {
    const row = e.target.closest('.rev-item');
    if (!row) return;
    const q = queue[Number(row.dataset.i)];
    const f = e.target.dataset.f;
    if (f === 'category' && e.target.value === '__new__') {
      const name = safeName(prompt('اسم التصنيف الجديد:') || '');
      if (name) { if (!CATS.includes(name)) CATS.push(name); q.category = name; }
      renderReview();
      return;
    }
    if (f) q[f] = e.target.value;
  });

  $('#revList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-drop]');
    if (!b) return;
    queue.splice(Number(b.dataset.drop), 1);
    if (!queue.length) { $('#review').hidden = true; return; }
    renderReview();
  });

  function clearQueue() {
    queue.forEach((q) => q.preview && URL.revokeObjectURL(q.preview));
    queue = [];
  }

  $('#revClose').addEventListener('click', () => { clearQueue(); $('#review').hidden = true; });

  /** يمنع تصادم الأسماء داخل التصنيف الواحد. */
  function uniquePath(cat, title, outExt, taken) {
    let base = safeName(title) || 'منتج';
    let name = base, n = 2;
    while (taken.has(`media/${cat}/${name}.${outExt}`)) name = `${base} ${n++}`;
    taken.add(`media/${cat}/${name}.${outExt}`);
    return { path: `media/${cat}/${name}.${outExt}`, name };
  }

  $('#revPublish').addEventListener('click', async () => {
    const taken = new Set(ITEMS.map((i) => i.path));
    const entries = [], added = [];

    for (const q of queue) {
      const cat = safeName(q.category) || 'عام';
      const { path, name } = uniquePath(cat, q.title, q.outExt, taken);
      entries.push({ path, blob: q.full });

      let thumbPath = null;
      if (q.thumb) {
        thumbPath = `media/_thumbs/${cat}/${name}.${q.thumbExt}`;
        entries.push({ path: thumbPath, blob: q.thumb });
      }
      added.push({ path, sha: null, title: name, category: cat, type: q.kind,
                   thumbPath, thumbSha: null, pending: true });
    }

    $('#review').hidden = true;
    try {
      busy('جارٍ الرفع…');
      await commit(entries, `إضافة ${queue.length} منتج`,
        (d, t) => busy(`جارٍ الرفع… ${d}/${t}`));

      ITEMS.push(...added);
      CATS = [...new Set(ITEMS.map((i) => i.category))].sort((a, b) => a.localeCompare(b, 'ar'));
      clearQueue();
      renderAll();
      showBanner();
      toast('تم النشر');
    } catch (err) {
      alert('تعذّر النشر: ' + err.message);
    } finally { idle(); }
  });

  /* ═══════════ تعديل / حذف ═══════════ */
  function openItem(it) {
    editing = it;
    $('#isName').textContent = it.title;
    $('#isThumb').src = it.thumbPath ? rawURL(it.thumbPath) : rawURL(it.path);
    $('#isTitle').value = it.title;
    $('#isCat').innerHTML = catOptions(it.category);
    $('#itemSheet').hidden = false;
  }

  const closeItem = () => { $('#itemSheet').hidden = true; editing = null; };
  $('#isClose').addEventListener('click', closeItem);
  $('#itemSheet').addEventListener('click', (e) => { if (e.target.id === 'itemSheet') closeItem(); });

  $('#isCat').addEventListener('change', (e) => {
    if (e.target.value !== '__new__') return;
    const name = safeName(prompt('اسم التصنيف الجديد:') || '');
    if (name && !CATS.includes(name)) CATS.push(name);
    $('#isCat').innerHTML = catOptions(name || editing.category);
  });

  $('#isSave').addEventListener('click', async () => {
    const it = editing;
    if (!it) return;
    const title = safeName($('#isTitle').value);
    const cat   = safeName($('#isCat').value);
    if (!title || !cat) { toast('الاسم والتصنيف مطلوبان'); return; }
    if (title === it.title && cat === it.category) { closeItem(); return; }
    if (it.pending) { toast('انتظر اكتمال نشر هذا المنتج أولًا'); return; }

    const taken = new Set(ITEMS.filter((x) => x !== it).map((x) => x.path));
    const { path: newPath, name } = uniquePath(cat, title, ext(it.path), taken);
    const entries = [{ path: it.path, sha: null }, { path: newPath, sha: it.sha }];

    let newThumb = null;
    if (it.thumbPath && it.thumbSha) {
      newThumb = `media/_thumbs/${cat}/${name}.${ext(it.thumbPath)}`;
      entries.push({ path: it.thumbPath, sha: null }, { path: newThumb, sha: it.thumbSha });
    }

    closeItem();
    try {
      busy('جارٍ الحفظ…');
      await commit(entries, `تعديل ${it.title}`);
      Object.assign(it, { path: newPath, title: name, category: cat,
                          thumbPath: newThumb, pending: true });
      CATS = [...new Set(ITEMS.map((i) => i.category))].sort((a, b) => a.localeCompare(b, 'ar'));
      renderAll();
      showBanner();
      toast('تم الحفظ');
    } catch (err) {
      alert('تعذّر الحفظ: ' + err.message);
    } finally { idle(); }
  });

  $('#isDelete').addEventListener('click', async () => {
    const it = editing;
    if (!it) return;
    if (!confirm(`حذف «${it.title}» نهائيًا من المتجر؟`)) return;

    const entries = [{ path: it.path, sha: null }];
    if (it.thumbPath) entries.push({ path: it.thumbPath, sha: null });

    closeItem();
    try {
      busy('جارٍ الحذف…');
      await commit(entries, `حذف ${it.title}`);
      ITEMS.splice(ITEMS.indexOf(it), 1);
      CATS = [...new Set(ITEMS.map((i) => i.category))].sort((a, b) => a.localeCompare(b, 'ar'));
      if (filterCat !== '*' && !CATS.includes(filterCat)) filterCat = '*';
      renderAll();
      showBanner();
      toast('تم الحذف');
    } catch (err) {
      alert('تعذّر الحذف: ' + err.message);
    } finally { idle(); }
  });

  /* ═══════════ إعدادات المتجر ═══════════ */
  let SITE = null;              // محتوى site.config.json

  const CFG_PATH = 'site.config.json';

  async function loadSite() {
    try {
      const r = await gh(`${repoBase()}/contents/${CFG_PATH}?ref=${CFG.branch}`);
      SITE = JSON.parse(new TextDecoder().decode(
        Uint8Array.from(atob(r.content.replace(/\s/g, '')), (c) => c.charCodeAt(0))));
      SITE._sha = r.sha;
    } catch {
      SITE = {};                // الملف مفقود — ستُنشئه أول عملية حفظ
    }
  }

  /** يحوّل ما يكتبه المستخدم إلى رقم دولي صالح لرابط wa.me. */
  function normalizeWa(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    return d;
  }

  function updateWaPreview() {
    const el = $('#sWaPreview');
    const raw = $('#sWa').value.trim();
    if (!raw) { el.hidden = true; return; }

    const d = normalizeWa(raw);
    el.hidden = false;
    el.classList.remove('bad');

    if (/^0/.test(d)) {
      el.classList.add('bad');
      el.textContent = 'الرقم يبدأ بصفر. احذف الصفر وابدأ برمز الدولة (مثال: 967 لليمن، 966 للسعودية).';
    } else if (d.length < 10 || d.length > 15) {
      el.classList.add('bad');
      el.textContent = `الرقم ${d.length} خانة — تأكد منه. المتوقع بين 10 و 15 خانة مع رمز الدولة.`;
    } else {
      el.textContent = `سيصل الطلب إلى: wa.me/${d}`;
    }
  }

  $('#sWa').addEventListener('input', updateWaPreview);

  $('#btnSettings').addEventListener('click', () => {
    $('#sBrand').value   = SITE.brandName || '';
    $('#sTagline').value = SITE.tagline || '';
    $('#sWa').value      = SITE.whatsapp || '';
    $('#sWaMsg').value   = SITE.whatsappMessage || '';
    $('#sIg').value      = SITE.instagram || '';
    $('#sAccent').value  = /^#[0-9a-f]{6}$/i.test(SITE.accent || '') ? SITE.accent : '#c9963f';
    updateWaPreview();
    $('#settings').hidden = false;
  });

  const closeSettings = () => { $('#settings').hidden = true; };
  $('#setClose').addEventListener('click', closeSettings);
  $('#settings').addEventListener('click', (e) => { if (e.target.id === 'settings') closeSettings(); });

  $('#setSave').addEventListener('click', async () => {
    const wa = normalizeWa($('#sWa').value);
    if (wa && (/^0/.test(wa) || wa.length < 10 || wa.length > 15)
        && !confirm('رقم الواتساب يبدو غير صحيح. الحفظ على أي حال؟')) return;

    const next = {
      ...SITE,
      brandName:       $('#sBrand').value.trim() || 'ELORA',
      tagline:         $('#sTagline').value.trim(),
      logo:            SITE.logo ?? 'assets/logo.png',
      whatsapp:        wa,
      whatsappMessage: $('#sWaMsg').value,
      instagram:       $('#sIg').value.trim().replace(/^@/, ''),
      accent:          $('#sAccent').value,
      defaultTheme:    SITE.defaultTheme ?? 'light',
    };
    delete next._sha;

    closeSettings();
    try {
      busy('جارٍ الحفظ…');
      const blob = new Blob([JSON.stringify(next, null, 2) + '\n'], { type: 'application/json' });
      await commit([{ path: CFG_PATH, blob }], 'تحديث إعدادات المتجر');
      SITE = next;
      await loadSite();                 // لالتقاط بصمة الملف الجديدة
      showBanner();
      toast('تم حفظ الإعدادات');
    } catch (err) {
      alert('تعذّر الحفظ: ' + err.message);
    } finally { idle(); }
  });

  /* ═══════════ عام ═══════════ */
  function showBanner() {
    const b = $('#banner');
    b.textContent = 'تم الحفظ. سيظهر التحديث على المتجر خلال دقيقة تقريبًا — حدّثي صفحة المتجر بعدها.';
    b.hidden = false;
  }

  $('#btnRefresh').addEventListener('click', async () => {
    try {
      busy('جارٍ التحديث…');
      await loadItems();
      await loadSite();
      $('#banner').hidden = true;
      renderAll();
    } catch (err) { alert(err.message); } finally { idle(); }
  });

  $('#btnLogout').addEventListener('click', () => {
    if (!confirm('سيُحذف مفتاح الوصول من هذا الجهاز. متابعة؟')) return;
    localStorage.removeItem(KEY);
    location.reload();
  });

  /* ═══════════ الإعداد والإقلاع ═══════════ */
  $('#btnConnect').addEventListener('click', async () => {
    const owner = $('#fOwner').value.trim().replace(/^@/, '');
    const repo  = $('#fRepo').value.trim();
    const token = $('#fToken').value.trim();
    const err   = $('#setupErr');
    err.hidden = true;

    if (!owner || !repo || !token) {
      err.textContent = 'املأ الحقول الثلاثة.'; err.hidden = false; return;
    }

    CFG = { owner, repo, token, branch: 'main' };
    try {
      busy('جارٍ التحقق…');
      const info = await gh(repoBase());
      CFG.branch = info.default_branch || 'main';
      if (!info.permissions?.push) throw new Error('المفتاح لا يملك صلاحية التعديل على هذا المستودع.');
      localStorage.setItem(KEY, JSON.stringify(CFG));
      await start();
    } catch (e) {
      CFG = null;
      err.textContent = e.status === 401 ? 'المفتاح غير صحيح أو منتهي الصلاحية.'
        : e.status === 404 ? 'لم يُعثر على المستودع. تأكد من اسم الحساب واسم المستودع.'
        : e.message;
      err.hidden = false;
    } finally { idle(); }
  });

  async function start() {
    busy('جارٍ تحميل المنتجات…');
    try {
      await loadItems();
      await loadSite();
      $('#setup').hidden = true;
      $('#app').hidden = false;
      renderAll();
      const wa = normalizeWa(SITE.whatsapp);
      if (wa.length < 10 || wa.length > 15) {
        const b = $('#banner');
        b.textContent = 'رقم الواتساب غير مضبوط — زر الطلب لن يعمل. اضغط ⚙ لضبطه.';
        b.hidden = false;
      }
    } finally { idle(); }
  }

  (async function boot() {
    document.documentElement.dataset.theme = localStorage.getItem('theme') || 'light';
    try { CFG = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { CFG = null; }

    if (!CFG?.token) { $('#setup').hidden = false; return; }
    try {
      await start();
    } catch (e) {
      $('#setup').hidden = false;
      $('#fOwner').value = CFG.owner || '';
      $('#fRepo').value = CFG.repo || '';
      const err = $('#setupErr');
      err.textContent = e.status === 401
        ? 'انتهت صلاحية المفتاح. أنشئ مفتاحًا جديدًا وألصقه هنا.'
        : 'تعذّر الاتصال: ' + e.message;
      err.hidden = false;
    }
  })();
})();
