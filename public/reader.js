// E-book reader: the Books library (PDF upload, shelves, progress) and the reading view, built on pdf.js.
// Receives app helpers from app.js so the two share one design system and one session.
export function makeReader(ctx) {
  const { api, esc, ic, $, $$, modal, wireForm, xhrUpload, toast, go, bc, stepHead, formFoot, kb, getNav } = ctx;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const HL = ['amber', 'pink', 'lime', 'sky'];
  const HL_NAME = { amber: 'yellow', pink: 'pink', lime: 'green', sky: 'blue' };
  let cleanup = null;
  const leave = () => { cleanup?.(); cleanup = null; document.body.classList.remove('reading'); };

  // ---------- pdf.js (served locally from node_modules) ----------
  let pdfjs = null;
  async function loadPdfjs() {
    if (!pdfjs) {
      pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
      if (!$('#pdfcss')) document.head.insertAdjacentHTML('beforeend', '<link id="pdfcss" rel="stylesheet" href="/vendor/pdfjs-web/pdf_viewer.css">');
    }
    return pdfjs;
  }
  const docOpts = (src) => ({ ...src, cMapUrl: '/vendor/pdfjs-cmaps/', cMapPacked: true, standardFontDataUrl: '/vendor/pdfjs-fonts/', disableAutoFetch: true });
  const pdfError = (e) => (e?.name === 'PasswordException' ? 'This PDF is password protected. Remove the password and try again.'
    : e?.name === 'InvalidPDFException' ? 'That file is not a readable PDF.' : e?.name === 'MissingPDFException' ? 'The file could not be found.' : e?.message || 'The PDF could not be opened.');

  // ---------- upload ----------
  async function uploadModal() {
    const lib = await api('/ebooks');
    const shelves = [...new Set(lib.map((b) => b.shelf).filter(Boolean))].sort();
    let file = null, cover = null, pages = 0, coverUrl = '';
    const d = modal(`
      <form id="ef" novalidate>
        <h2>Upload book</h2>${stepHead}
        <fieldset class="step" data-title="PDF"><legend class="sr">PDF</legend>
          <label for="ef1">PDF file (up to 200 MB)</label>
          <input id="ef1" type="file" accept="application/pdf,.pdf">
          <div id="efs" class="small muted" aria-live="polite"></div>
          <div id="efp" class="row nowrap" style="margin-top:.6rem" hidden><img id="efc" class="cvthumb" alt="Cover preview"><span id="efm" class="small"></span></div>
        </fieldset>
        <fieldset class="step" data-title="Details"><legend class="sr">Details</legend>
          <label for="et">Title *</label><input id="et" name="title" type="text" required>
          <label for="ea">Author</label><input id="ea" name="author" type="text">
          <label for="esh">Shelf (optional)</label><input id="esh" name="shelf" type="text" list="shl" placeholder="e.g. Business">
          <datalist id="shl">${shelves.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
        </fieldset>
        <div class="prog" id="epr" hidden><div class="fill"></div></div>
        ${formFoot('Upload book')}
      </form>`);
    const status = (m, bad) => { const e = $('#efs', d); e.textContent = m; e.className = 'small ' + (bad ? 'ferr' : 'muted'); };
    const reset = () => { file = cover = null; pages = 0; if (coverUrl) URL.revokeObjectURL(coverUrl); coverUrl = ''; $('#efp', d).hidden = true; status(''); };
    const st = wireForm(d, {
      onClear: reset,
      extra: (root) => { if (root.contains($('#ef1', d)) && !file) { status('Choose a PDF to upload.', true); return false; } return true; },
    });
    d.addEventListener('close', reset);

    $('#ef1', d).onchange = async (e) => {
      reset();
      const f = e.target.files[0];
      if (!f) return;
      if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') return status('That is not a PDF file.', true);
      if (f.size > 200 * 1024 * 1024) return status('This PDF is over 200 MB.', true);
      status('Reading the PDF…');
      const url = URL.createObjectURL(f);
      let task = null;
      try {
        const lib = await loadPdfjs();
        task = lib.getDocument(docOpts({ url }));
        const pdf = await task.promise;
        const meta = await pdf.getMetadata().catch(() => null);
        pages = pdf.numPages;
        const pg = await pdf.getPage(1), vp = pg.getViewport({ scale: 1 }), sc = Math.min(1, 420 / vp.width) * 1.5;
        const c = document.createElement('canvas'), v2 = pg.getViewport({ scale: sc });
        c.width = v2.width; c.height = v2.height;
        await pg.render({ canvas: c, viewport: v2 }).promise;
        cover = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
        coverUrl = URL.createObjectURL(cover);
        $('#efc', d).src = coverUrl; $('#efm', d).textContent = `${pages} page${pages === 1 ? '' : 's'} · ${kb(f.size)}`; $('#efp', d).hidden = false;
        file = f;
        $('#et', d).value = (meta?.info?.Title || '').trim() || f.name.replace(/\.pdf$/i, '');
        $('#ea', d).value = (meta?.info?.Author || '').trim();
        d.dirty = true; status('');
      } catch (err) { file = null; status(pdfError(err), true); e.target.value = ''; }
      finally { task?.destroy(); URL.revokeObjectURL(url); }
    };

    $('#ef', d).onsubmit = async (e) => {
      e.preventDefault();
      if (!st.validate()) return;
      const fd = new FormData(e.target);
      fd.append('file', file, file.name); fd.append('pages', pages);
      if (cover) fd.append('cover', cover, 'cover.jpg');
      const btn = $('#sv', d), bar = $('#epr', d);
      btn.disabled = true; bar.hidden = false;
      try {
        await xhrUpload('/api/ebooks', fd, (p) => { $('.fill', bar).style.width = p * 100 + '%'; btn.textContent = `Uploading ${Math.round(p * 100)}%`; });
        d.close(); toast('Book added'); go('#/ebooks');
      } catch (err) { $('#er', d).textContent = err.message; btn.disabled = false; btn.textContent = 'Upload book'; bar.hidden = true; }
    };
  }

  // ---------- Books library ----------
  let shelfFilter = '';
  async function viewBooks() {
    const sort = localStorage.getItem('bm-esort') || 'recent';
    const books = await api('/ebooks?sort=' + sort);
    const shelves = [...new Set(books.map((b) => b.shelf).filter(Boolean))].sort();
    if (shelfFilter && !shelves.includes(shelfFilter)) shelfFilter = '';
    const shown = shelfFilter ? books.filter((b) => b.shelf === shelfFilter) : books;
    const resume = [...books].filter((b) => b.lastReadAt).sort((a, b) => b.lastReadAt.localeCompare(a.lastReadAt)).find((b) => b.progress < 100) || null;
    const cover = (b) => (b.cover ? `<img src="${esc(b.cover)}" alt="" loading="lazy" decoding="async">` : `<span>${esc(b.title)}</span>`);
    const card = (b) => `<article class="ebook ${bc(b.title)}">
      <a class="cover" href="#/read/${b.id}" aria-label="${b.page > 1 ? 'Continue reading' : 'Read'} ${esc(b.title)}">${cover(b)}</a>
      <div class="t">${esc(b.title)}</div><div class="m">${esc(b.author || 'Unknown author')}</div>
      <div class="pbar" role="img" aria-label="${b.progress} percent read"><i style="width:${b.progress}%"></i></div>
      <div class="m small">${b.page > 1 || b.lastReadAt ? `Page ${b.page} of ${b.pages || '?'} · ${b.progress}%` : `${b.pages || '?'} pages · not started`}${b.shelf ? ` · ${esc(b.shelf)}` : ''}</div>
      <div class="row eact"><a class="btn sm primary" href="#/read/${b.id}">${b.page > 1 ? 'Continue' : 'Read'}</a>
        <button class="btn sm icon ghost" data-edit="${b.id}" aria-label="Edit ${esc(b.title)}">${ic('edit')}</button>
        <button class="btn sm icon ghost danger" data-del="${b.id}" aria-label="Remove ${esc(b.title)}">${ic('trash')}</button></div>
    </article>`;
    $('#app').innerHTML = `
      <div class="row between" style="margin-bottom:1.2rem"><h1 style="margin:0">Books</h1>
        <div class="row nowrap libtools"><label for="esort" class="small muted" style="margin:0">Sort by</label><select id="esort">
          ${[['recent', 'Recently read'], ['added', 'Date added'], ['title', 'Title'], ['author', 'Author'], ['progress', 'Progress']].map(([v, l]) => `<option value="${v}" ${v === sort ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <button class="btn primary" id="ebup">${ic('upload')}Upload book</button></div></div>
      ${resume ? `<section class="resume ${bc(resume.title)}"><a class="rcover" href="#/read/${resume.id}">${cover(resume)}</a>
        <div class="rinfo"><span class="n">Continue reading</span><h2>${esc(resume.title)}</h2><p>${esc(resume.author || 'Unknown author')}</p>
        <div class="pbar"><i style="width:${resume.progress}%"></i></div><p class="small">Page ${resume.page} of ${resume.pages || '?'} · ${resume.progress}% read</p>
        <a class="btn primary" href="#/read/${resume.id}">${ic('arrow')}Continue reading</a></div></section>` : ''}
      ${shelves.length ? `<div class="chips2" role="group" aria-label="Shelves" style="margin:1.2rem 0"><button class="${shelfFilter ? '' : 'on'} bcall" data-shelf="">All books</button>${shelves.map((s, i) => `<button class="bc${(i * 2 + 1) % 7} ${shelfFilter === s ? 'on' : ''}" data-shelf="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
      ${shown.length ? `<div class="grid ebgrid" style="margin-top:1.2rem">${shown.map(card).join('')}</div>`
        : `<div class="empty"><b>${books.length ? 'No books on this shelf' : 'No books yet'}</b>${books.length ? 'Choose another shelf.' : 'Upload a PDF to read it here. Your page, highlights and notes are saved as you go.'}
          ${books.length ? '' : `<div class="row" style="justify-content:center;margin-top:1rem"><button class="btn primary" id="eup2">${ic('upload')}Upload your first book</button></div>`}</div>`}`;
    $('#esort').onchange = (e) => { localStorage.setItem('bm-esort', e.target.value); viewBooks(); };
    $('#ebup').onclick = uploadModal;
    const first = $('#eup2'); if (first) first.onclick = uploadModal;
    $$('[data-shelf]').forEach((b) => (b.onclick = () => { shelfFilter = b.dataset.shelf; viewBooks(); }));
    $$('[data-edit]').forEach((b) => (b.onclick = () => editModal(books.find((x) => x.id === b.dataset.edit), shelves)));
    $$('[data-del]').forEach((b) => (b.onclick = async () => {
      const bk = books.find((x) => x.id === b.dataset.del);
      if (!confirm(`Remove "${bk.title}"? The PDF, your notes and highlights will be deleted.`)) return;
      await api('/ebooks/' + bk.id, { method: 'DELETE' }); toast('Book removed'); viewBooks();
    }));
  }

  function editModal(b, shelves) {
    const d = modal(`<form id="ee" novalidate><h2>Edit book</h2>
      <label for="eet">Title *</label><input id="eet" name="title" type="text" required value="${esc(b.title)}">
      <label for="eea">Author</label><input id="eea" name="author" type="text" value="${esc(b.author)}">
      <label for="eesh">Shelf</label><input id="eesh" name="shelf" type="text" list="shl2" value="${esc(b.shelf)}" placeholder="e.g. Business">
      <datalist id="shl2">${shelves.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
      <div class="err" id="er" role="alert"></div>
      <div class="row between formfoot"><button type="button" class="btn" id="ecx">Cancel</button><button class="btn primary">Save</button></div></form>`);
    $('#ecx', d).onclick = d.requestClose;
    $('#ee', d).onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      if (!body.title.trim()) { $('#er', d).textContent = 'Title is required.'; return; }
      try { await api('/ebooks/' + b.id, { method: 'PUT', body }); d.close(); toast('Book updated'); viewBooks(); } catch (err) { $('#er', d).textContent = err.message; }
    };
  }

  // ---------- Reader ----------
  async function viewReader(id, my) {
    leave();
    document.body.classList.add('reading');
    let book, prefs, annots;
    try { [book, prefs, annots] = await Promise.all([api('/ebooks/' + id), api('/reader/prefs'), api('/ebooks/' + id + '/annots')]); }
    catch (e) { $('#app').innerHTML = `<div class="empty"><b>Book not found</b>${esc(e.message)}<br><a href="#/ebooks">Back to books</a></div>`; return; }
    if (my !== getNav()) return;
    const P = { mode: 'single', fit: 'width', zoom: 1, theme: 'light', brightness: 1, fontSize: 20, spacing: 1.6, ...prefs };
    let pdf = null, task = null, N = book.pages || 1, page = clamp(book.page || 1, 1, N), toc = [], seq = 0, wrap = null, observer = null, focus = false, lastW = 0;
    const lib = await loadPdfjs();

    $('#app').innerHTML = `
      <div class="reader theme-${P.theme} ${bc(book.title)}" id="rd" style="--bri:${P.brightness}">
        <header class="rbar top">
          <a class="btn sm icon ghost" href="#/ebooks" aria-label="Back to books">${ic('back')}</a>
          <div class="rtitle"><b>${esc(book.title)}</b><span class="small" id="rch"></span></div>
          <div class="rtools">
            <button class="btn sm icon" id="btoc" aria-label="Contents" aria-expanded="false">${ic('list')}</button>
            <button class="btn sm icon" id="bnotes" aria-label="Notes and highlights" aria-expanded="false">${ic('note')}</button>
            <button class="btn sm icon" id="bset" aria-label="Reading settings" aria-expanded="false"><b>Aa</b></button>
            <button class="btn sm icon" id="bfs" aria-label="Distraction-free full screen">${ic('expand')}</button>
          </div>
        </header>
        <div class="rstage" id="rs" tabindex="0" aria-label="Book pages"></div>
        <footer class="rbar bottom">
          <button class="btn sm icon" id="rprev" aria-label="Previous page">${ic('back')}</button>
          <label class="rpos"><span class="sr">Page</span><input id="rpage" type="number" inputmode="numeric" min="1" max="${N}" value="${page}"><span>/ <b id="rn">${N}</b></span></label>
          <div class="rprog" role="img" aria-label="Reading progress"><i id="rfill"></i></div><span class="small rpct" id="rpct"></span>
          <button class="btn sm icon" id="rnext" aria-label="Next page">${ic('arrow')}</button>
        </footer>
        <aside class="drawer left" id="dtoc" hidden aria-label="Contents"><div class="dhead"><h2>Contents</h2><button class="btn sm icon ghost" data-close aria-label="Close contents">${ic('x')}</button></div><div class="dbody" id="tocb"></div></aside>
        <aside class="drawer" id="dnotes" hidden aria-label="Notes and highlights"><div class="dhead"><h2>Notes &amp; highlights</h2><button class="btn sm icon ghost" data-close aria-label="Close notes">${ic('x')}</button></div><div class="dbody" id="notesb"></div></aside>
        <div class="pop" id="pset" hidden role="dialog" aria-label="Reading settings"></div>
        <div class="seltool" id="sel" hidden role="toolbar" aria-label="Highlight selected text">${HL.map((c) => `<button class="sw c-${c}" data-hl="${c}" aria-label="Highlight ${HL_NAME[c]}"></button>`).join('')}<button class="btn sm" data-hl="note">${ic('note')}Note</button></div>
      </div>`;
    const rd = $('#rd'), stage = $('#rs'), selbar = $('#sel');

    // ---- helpers ----
    const pageCache = new Map();
    const getPage = (n) => { if (!pageCache.has(n)) pageCache.set(n, pdf.getPage(n)); return pageCache.get(n); };
    const fit = (base) => {
      const w = stage.clientWidth - 24, h = stage.clientHeight - 24;
      return (P.fit === 'page' ? Math.max(0.2, Math.min(w / base.width, h / base.height)) : Math.max(0.2, w / base.width)) * P.zoom;
    };
    let saveT = 0, prefT = 0;
    const saveProgress = (now) => {
      clearTimeout(saveT);
      const send = () => fetch(`/api/ebooks/${id}/progress`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page, pages: N }), keepalive: true }).catch(() => {});
      if (now) send(); else saveT = setTimeout(send, 500);
    };
    const savePrefs = () => { clearTimeout(prefT); prefT = setTimeout(() => api('/reader/prefs', { method: 'PUT', body: P }).catch(() => {}), 400); };

    const flatToc = () => { const o = []; const w = (a, depth) => a.forEach((i) => { if (i.page) o.push({ ...i, depth }); w(i.items, depth + 1); }); w(toc, 0); return o; };
    const chapterAt = (p) => { let best = null; for (const c of flatToc()) if (c.page <= p && (!best || c.page >= best.page)) best = c; return best; };

    function updateUi() {
      $('#rpage').value = page;
      $('#rfill').style.width = (page / N) * 100 + '%';
      $('#rpct').textContent = Math.round((page / N) * 100) + '%';
      $('#rprev').disabled = page <= 1; $('#rnext').disabled = page >= N;
      const c = chapterAt(page);
      $('#rch').textContent = c ? c.title : `Page ${page} of ${N}`;
      $$('#tocb .cur').forEach((e) => e.classList.remove('cur'));
      if (c) { const el = $(`#tocb [data-toc="${c.idx}"]`); el?.classList.add('cur'); for (let p = el?.parentElement; p && p.id !== 'tocb'; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true; }
    }
    function setPage(n, { fromScroll } = {}) {
      n = clamp(Math.round(n) || 1, 1, N);
      const dir = n > page ? 'next' : n < page ? 'prev' : '';
      page = n; updateUi(); saveProgress();
      if (fromScroll) return;
      if (P.mode === 'scroll') wrap?.children[n - 1]?.scrollIntoView({ block: 'start' });
      else if (P.mode === 'text') renderText(n, dir);
      else showSingle(n, dir);
    }

    // ---- highlights drawn over each page (fractions of the page box, so zoom never breaks them) ----
    const drawHL = (el, n) => {
      const layer = $('.hll', el); if (!layer) return;
      layer.innerHTML = annots.filter((a) => a.kind === 'highlight' && a.page === n).map((a) => a.rects.map((r) =>
        `<i class="hl c-${a.color}" data-a="${a.id}" style="left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%"></i>`).join('')).join('');
      $('.pnote', el)?.remove();
      if (annots.some((a) => a.kind === 'note' && a.page === n)) el.insertAdjacentHTML('beforeend', `<button class="pnote" aria-label="Notes on this page">${ic('note')}</button>`);
    };
    const redrawHL = (n) => $$(`.rpage[data-p="${n}"]`, stage).forEach((el) => drawHL(el, n));

    // ---- rendering one page: canvas + selectable text layer + highlight layer ----
    async function renderInto(el, n) {
      const pg = await getPage(n);
      const base = pg.getViewport({ scale: 1 }), scale = fit(base), vp = pg.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      el.style.width = vp.width + 'px'; el.style.height = vp.height + 'px';
      el.innerHTML = '<canvas class="pgc"></canvas><div class="hll"></div><div class="textLayer"></div>';
      const canvas = $('canvas', el), hi = pg.getViewport({ scale: scale * dpr });
      canvas.width = Math.floor(hi.width); canvas.height = Math.floor(hi.height);
      canvas.style.width = vp.width + 'px'; canvas.style.height = vp.height + 'px';
      const task = pg.render({ canvas, viewport: hi });
      el._task = task;
      await task.promise;
      const tl = $('.textLayer', el);
      tl.style.setProperty('--scale-factor', scale); tl.style.setProperty('--total-scale-factor', scale); tl.style.setProperty('--user-unit', 1);
      await new lib.TextLayer({ textContentSource: pg.streamTextContent(), container: tl, viewport: vp }).render();
      drawHL(el, n);
    }
    const pageEl = (n) => { const el = document.createElement('div'); el.className = 'rpage'; el.dataset.p = n; return el; };

    async function showSingle(n, dir) {
      const my2 = ++seq;
      const el = pageEl(n);
      try { await renderInto(el, n); } catch (e) { if (e?.name === 'RenderingCancelledException') return; el.innerHTML = `<div class="rerr"><b>This page could not be drawn.</b><span>${esc(e.message)}</span><button class="btn sm" data-retry>Try again</button></div>`; }
      if (my2 !== seq) return;
      stage.className = 'rstage single'; stage.replaceChildren(el);
      stage.classList.toggle('wide', stage.scrollWidth > stage.clientWidth + 4); // zoomed past the screen: allow sideways panning
      if (dir) { el.classList.add('turn-' + dir); }
      stage.scrollTo(0, 0);
      getPage(n + 1).catch(() => {});
    }

    async function buildScroll() {
      observer?.disconnect(); ++seq;
      stage.className = 'rstage scroll'; stage.replaceChildren();
      const base = (await getPage(1)).getViewport({ scale: 1 }), scale = fit(base);
      wrap = document.createElement('div'); wrap.className = 'rscroll';
      for (let n = 1; n <= N; n++) { const el = pageEl(n); el.style.width = base.width * scale + 'px'; el.style.height = base.height * scale + 'px'; wrap.append(el); }
      stage.append(wrap);
      observer = new IntersectionObserver((es) => es.forEach(async (en) => {
        const el = en.target, n = +el.dataset.p;
        if (en.isIntersecting) {
          if (el.dataset.r === '1') return;
          el.dataset.r = '1';
          try { await renderInto(el, n); } catch (e) { if (e?.name !== 'RenderingCancelledException') el.innerHTML = '<div class="rerr"><b>This page could not be drawn.</b></div>'; }
        } else if (el.dataset.r === '1') { el._task?.cancel(); el.dataset.r = '0'; el.innerHTML = ''; } // free memory on long books
      }), { root: stage, rootMargin: '150% 0px' });
      [...wrap.children].forEach((e) => observer.observe(e));
      wrap.children[page - 1]?.scrollIntoView({ block: 'start' });
    }
    let scrollRaf = 0;
    stage.addEventListener('scroll', () => {
      if (P.mode !== 'scroll' || scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        const kids = wrap?.children; if (!kids?.length) return;
        const mid = stage.scrollTop + stage.clientHeight / 3; let lo = 0, hi = kids.length - 1;
        while (lo < hi) { const m = (lo + hi + 1) >> 1; if (wrap.offsetTop + kids[m].offsetTop <= mid) lo = m; else hi = m - 1; }
        if (lo + 1 !== page) setPage(lo + 1, { fromScroll: true });
      });
    });

    // ---- reflowable text view: font size and spacing apply here (PDF pages themselves are fixed layout) ----
    async function renderText(n, dir) {
      const my2 = ++seq;
      const pg = await getPage(n), tc = await pg.getTextContent();
      if (my2 !== seq) return;
      const paras = []; let cur = '', lastY = null, lastH = 12;
      for (const it of tc.items) {
        if (!it.str && !it.hasEOL) continue;
        const y = it.transform[5], h = Math.abs(it.transform[3]) || lastH;
        if (lastY !== null && Math.abs(y - lastY) > h * 0.6) { if (Math.abs(y - lastY) > h * 2.2 && cur) { paras.push(cur); cur = ''; } else if (cur && !/\s$/.test(cur)) cur += ' '; }
        cur += it.str; lastY = y; lastH = h;
      }
      if (cur.trim()) paras.push(cur);
      const text = paras.map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
      stage.className = 'rstage text';
      stage.innerHTML = `<article class="reflow ${dir ? 'turn-' + dir : ''}" style="font-size:${P.fontSize}px;line-height:${P.spacing}">${text.length
        ? text.map((p) => `<p>${esc(p)}</p>`).join('')
        : '<div class="rerr"><b>This page has no selectable text.</b><span>It is probably a scanned image. Switch to Page view to read it.</span></div>'}</article>`;
      stage.scrollTo(0, 0);
    }

    async function rebuild() {
      lastW = stage.clientWidth;
      if (P.mode === 'scroll') await buildScroll(); else if (P.mode === 'text') await renderText(page); else await showSingle(page);
    }

    // ---- contents ----
    async function loadToc() {
      let idx = 0;
      const walk = async (items) => Promise.all(items.map(async (it) => {
        let pg = null;
        try {
          let dest = it.dest; if (typeof dest === 'string') dest = await pdf.getDestination(dest);
          if (Array.isArray(dest)) { const r = dest[0]; pg = r && typeof r === 'object' ? (await pdf.getPageIndex(r)) + 1 : Number.isInteger(r) ? r + 1 : null; }
        } catch { /* entry without a usable target */ }
        return { title: (it.title || 'Untitled').trim(), page: pg, items: await walk(it.items || []) };
      }));
      const ol = await pdf.getOutline().catch(() => null);
      toc = ol?.length ? await walk(ol) : [];
      const number = (a) => a.forEach((i) => { i.idx = idx++; number(i.items); });
      number(toc);
      const body = $('#tocb');
      const node = (i) => {
        const btn = `<button class="toc" data-toc="${i.idx}" ${i.page ? `data-page="${i.page}"` : 'disabled'}><span>${esc(i.title)}</span>${i.page ? `<em>${i.page}</em>` : ''}</button>`;
        return i.items.length ? `<details><summary>${btn}</summary><div class="kids">${i.items.map(node).join('')}</div></details>` : btn;
      };
      body.innerHTML = toc.length ? toc.map(node).join('')
        : `<p class="muted small">This book has no table of contents. Use the page box below, or drag the slider, to move around.</p>
           <input id="jump" type="range" min="1" max="${N}" value="${page}" aria-label="Jump to page"><p class="small muted" id="jumpl">Page ${page} of ${N}</p>`;
      body.onclick = (e) => {
        const b = e.target.closest('[data-page]'); if (!b) return;
        e.preventDefault(); setPage(+b.dataset.page); if (matchMedia('(max-width: 899px)').matches) toggle('#dtoc', false);
      };
      $('#jump')?.addEventListener('input', (e) => { $('#jumpl').textContent = `Page ${e.target.value} of ${N}`; });
      $('#jump')?.addEventListener('change', (e) => setPage(+e.target.value));
      updateUi();
    }

    // ---- notes & highlights panel ----
    const when = (a) => (a.kind === 'note' ? 'Note' : `Highlight`);
    function renderNotes() {
      const list = annots.slice().sort((a, b) => a.page - b.page || a.createdAt.localeCompare(b.createdAt));
      $('#notesb').innerHTML = `
        <form class="newnote" id="nn"><label for="nnt">Add a note to page ${page}</label>
          <textarea id="nnt" rows="3" placeholder="Works on scanned pages too"></textarea><div class="row between"><span class="small muted" id="nne" role="alert"></span><button class="btn sm primary">Save note</button></div></form>
        ${list.length ? list.map((a) => `<article class="annot c-${a.color || 'amber'}" data-id="${a.id}">
          <button class="agoto" data-goto="${a.page}" data-flash="${a.id}"><b>Page ${a.page}</b><span>${when(a)}</span></button>
          ${a.text ? `<blockquote>${esc(a.text)}</blockquote>` : ''}
          <textarea rows="${a.kind === 'note' ? 3 : 2}" data-note="${a.id}" aria-label="${a.kind === 'note' ? 'Note' : 'Add a note to this highlight'}" placeholder="Add a note">${esc(a.note || '')}</textarea>
          <div class="row between"><span class="small muted" data-saved="${a.id}"></span>
            <span class="row nowrap">${a.kind === 'highlight' ? HL.map((c) => `<button class="sw sm c-${c} ${a.color === c ? 'on' : ''}" data-color="${c}" data-id="${a.id}" aria-label="Change colour to ${HL_NAME[c]}"></button>`).join('') : ''}
            <button class="btn sm icon ghost danger" data-del="${a.id}" aria-label="Delete">${ic('trash')}</button></span></div>
        </article>`).join('') : '<p class="muted small">Select text in the book to highlight it, or write a note for any page. Everything is saved automatically.</p>'}`;
    }
    $('#notesb').addEventListener('submit', async (e) => {
      if (e.target.id !== 'nn') return;
      e.preventDefault();
      const note = $('#nnt').value.trim();
      if (!note) { $('#nne').textContent = 'Write something first.'; return; }
      try { annots.push(await api(`/ebooks/${id}/annots`, { method: 'POST', body: { kind: 'note', page, note } })); redrawHL(page); renderNotes(); } catch (err) { $('#nne').textContent = err.message; }
    });
    const noteTimers = {};
    $('#notesb').addEventListener('input', (e) => {
      const id2 = e.target.dataset.note; if (!id2) return;
      const a = annots.find((x) => x.id === id2); clearTimeout(noteTimers[id2]);
      const mark = $(`[data-saved="${id2}"]`); mark.textContent = 'Saving…';
      noteTimers[id2] = setTimeout(async () => {
        try { await api('/ebook-annots/' + id2, { method: 'PUT', body: { note: e.target.value } }); a.note = e.target.value.trim() || null; mark.textContent = 'Saved'; }
        catch (err) { mark.textContent = err.message; }
      }, 600);
    });
    $('#notesb').addEventListener('click', async (e) => {
      const g = e.target.closest('[data-goto]'), del = e.target.closest('[data-del]'), col = e.target.closest('[data-color]');
      if (g) {
        setPage(+g.dataset.goto);
        if (matchMedia('(max-width: 899px)').matches) toggle('#dnotes', false);
        setTimeout(() => $$(`.hl[data-a="${g.dataset.flash}"]`, stage).forEach((h) => { h.classList.add('flash'); setTimeout(() => h.classList.remove('flash'), 1400); }), 500);
      }
      if (del) { await api('/ebook-annots/' + del.dataset.del, { method: 'DELETE' }); const a = annots.find((x) => x.id === del.dataset.del); annots = annots.filter((x) => x.id !== del.dataset.del); redrawHL(a.page); renderNotes(); }
      if (col) { const a = annots.find((x) => x.id === col.dataset.id); a.color = col.dataset.color; await api('/ebook-annots/' + a.id, { method: 'PUT', body: { color: a.color } }); redrawHL(a.page); renderNotes(); }
    });

    // ---- text selection -> highlight ----
    let selT = 0;
    const onSel = () => {
      clearTimeout(selT);
      selT = setTimeout(() => {
        const s = getSelection();
        if (!s || s.isCollapsed || !s.rangeCount) return (selbar.hidden = true);
        const r = s.getRangeAt(0), host = (r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement)?.closest('.textLayer, .rpage');
        if (!host || !stage.contains(host)) return (selbar.hidden = true);
        const rc = r.getBoundingClientRect(), rr = rd.getBoundingClientRect();
        selbar.hidden = false;
        const w = selbar.offsetWidth;
        selbar.style.left = clamp(rc.left + rc.width / 2 - rr.left - w / 2, 8, rr.width - w - 8) + 'px';
        selbar.style.top = (rc.top - rr.top > 64 ? rc.top - rr.top - 52 : rc.bottom - rr.top + 12) + 'px';
      }, 150);
    };
    document.addEventListener('selectionchange', onSel);
    selbar.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the selection alive while clicking
    selbar.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-hl]'); if (!b) return;
      const s = getSelection(); if (!s.rangeCount) return;
      const r = s.getRangeAt(0);
      const el = (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement)?.closest('.rpage');
      if (!el) return;
      const pb = el.getBoundingClientRect();
      const rects = [...r.getClientRects()].filter((q) => q.width > 1 && q.height > 1 && q.height < pb.height * 0.2 && q.left < pb.right && q.right > pb.left && q.top < pb.bottom && q.bottom > pb.top)
        .map((q) => ({ x: (q.left - pb.left) / pb.width, y: (q.top - pb.top) / pb.height, w: q.width / pb.width, h: q.height / pb.height }));
      const text = s.toString().replace(/\s+/g, ' ').trim();
      try {
        const a = await api(`/ebooks/${id}/annots`, { method: 'POST', body: { kind: 'highlight', page: +el.dataset.p, color: b.dataset.hl === 'note' ? 'amber' : b.dataset.hl, text, rects } });
        annots.push(a); redrawHL(a.page); s.removeAllRanges(); selbar.hidden = true;
        if (b.dataset.hl === 'note') { toggle('#dnotes', true); setTimeout(() => $(`[data-note="${a.id}"]`)?.focus(), 50); }
      } catch (err) { toast(err.message); }
    });

    // ---- panels, settings, focus mode ----
    function toggle(sel, on) {
      const el = $(sel), open = on ?? el.hidden;
      ['#dtoc', '#dnotes'].forEach((s) => { if (s !== sel) { $(s).hidden = true; } });
      $('#pset').hidden = true; el.hidden = !open;
      $('#btoc').setAttribute('aria-expanded', !$('#dtoc').hidden); $('#bnotes').setAttribute('aria-expanded', !$('#dnotes').hidden);
      if (open && sel === '#dnotes') renderNotes();
    }
    $('#btoc').onclick = () => toggle('#dtoc');
    $('#bnotes').onclick = () => toggle('#dnotes');
    $$('[data-close]', rd).forEach((b) => (b.onclick = () => { b.closest('.drawer').hidden = true; $('#btoc').setAttribute('aria-expanded', false); $('#bnotes').setAttribute('aria-expanded', false); }));
    stage.addEventListener('click', (e) => {
      if (e.target.closest('.pnote')) toggle('#dnotes', true);
      if (e.target.closest('[data-retry]')) rebuild();
    });

    const seg = (key, opts) => opts.map(([v, l]) => `<button class="btn sm ${P[key] === v ? 'on' : ''}" data-set="${key}" data-v="${v}" aria-pressed="${P[key] === v}">${l}</button>`).join('');
    function drawSettings() {
      $('#pset').innerHTML = `
        <div class="srow"><span>View</span><div class="row">${seg('mode', [['single', 'Page'], ['scroll', 'Scroll'], ['text', 'Text']])}</div></div>
        <div class="srow"><span>Fit</span><div class="row">${seg('fit', [['width', 'Width'], ['page', 'Page']])}</div></div>
        <div class="srow"><span>Zoom</span><div class="row nowrap"><button class="btn sm icon" data-zoom="-1" aria-label="Zoom out">−</button><b id="zl" style="min-width:3.2rem;text-align:center">${Math.round(P.zoom * 100)}%</b><button class="btn sm icon" data-zoom="1" aria-label="Zoom in">+</button></div></div>
        <div class="srow"><span>Theme</span><div class="row">${[['light', 'Light'], ['sepia', 'Sepia'], ['dark', 'Dark']].map(([v, l]) => `<button class="btn sm th-${v} ${P.theme === v ? 'on' : ''}" data-set="theme" data-v="${v}" aria-pressed="${P.theme === v}">${l}</button>`).join('')}</div></div>
        <div class="srow"><label for="sbri">Brightness</label><input id="sbri" type="range" min="0.4" max="1.2" step="0.05" value="${P.brightness}"></div>
        <div class="srow"><label for="sfs">Text size</label><input id="sfs" type="range" min="12" max="40" step="1" value="${P.fontSize}"></div>
        <div class="srow"><label for="ssp">Line spacing</label><input id="ssp" type="range" min="1.2" max="2.4" step="0.1" value="${P.spacing}"></div>
        <p class="small muted">Text size and spacing apply in Text view. PDF pages keep their own layout.</p>`;
    }
    $('#bset').onclick = () => { const p = $('#pset'); const open = p.hidden; ['#dtoc', '#dnotes'].forEach((s) => ($(s).hidden = true)); if (open) drawSettings(); p.hidden = !open; $('#bset').setAttribute('aria-expanded', open); };
    const applyTheme = () => { rd.className = rd.className.replace(/theme-\w+/, 'theme-' + P.theme); rd.style.setProperty('--bri', P.brightness); };
    $('#pset').addEventListener('click', async (e) => {
      const s = e.target.closest('[data-set]'), z = e.target.closest('[data-zoom]');
      if (s) {
        P[s.dataset.set] = s.dataset.v; savePrefs(); drawSettings(); applyTheme();
        if (s.dataset.set === 'mode' || s.dataset.set === 'fit') rebuild();
      }
      if (z) { P.zoom = clamp(Math.round((P.zoom + 0.25 * +z.dataset.zoom) * 100) / 100, 0.5, 4); $('#zl').textContent = Math.round(P.zoom * 100) + '%'; savePrefs(); if (P.mode !== 'text') rebuild(); }
    });
    $('#pset').addEventListener('input', (e) => {
      const m = { sbri: ['brightness', 1], sfs: ['fontSize', 1], ssp: ['spacing', 1] }[e.target.id]; if (!m) return;
      P[m[0]] = +e.target.value; savePrefs(); applyTheme();
      const a = $('.reflow'); if (a) { a.style.fontSize = P.fontSize + 'px'; a.style.lineHeight = P.spacing; }
    });

    const setFocus = async (on) => {
      focus = on; rd.classList.toggle('focus', on); rd.classList.remove('peek');
      document.body.classList.toggle('rfocus', on);
      try { if (on) await rd.requestFullscreen?.(); else if (document.fullscreenElement) await document.exitFullscreen(); } catch { /* full screen may be blocked; the focus layout still applies */ }
      if (P.mode !== 'text') setTimeout(() => lastW !== stage.clientWidth && rebuild(), 100);
    };
    $('#bfs').onclick = () => setFocus(!focus);
    const onFs = () => { if (!document.fullscreenElement && focus) setFocus(false); };
    document.addEventListener('fullscreenchange', onFs);

    // ---- page controls: buttons, box, keys, swipe, tap ----
    $('#rprev').onclick = () => setPage(page - 1);
    $('#rnext').onclick = () => setPage(page + 1);
    $('#rpage').addEventListener('change', (e) => setPage(+e.target.value || page));
    const onKey = (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || e.ctrlKey || e.metaKey) return;
      const k = e.key;
      if (k === 'Escape') { if (!$('#pset').hidden || !$('#dtoc').hidden || !$('#dnotes').hidden) { $('#pset').hidden = true; $('#dtoc').hidden = true; $('#dnotes').hidden = true; } else if (focus) setFocus(false); return; }
      if (P.mode === 'scroll') return;
      if (k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && !e.shiftKey)) { e.preventDefault(); setPage(page + 1); }
      else if (k === 'ArrowLeft' || k === 'PageUp' || (k === ' ' && e.shiftKey)) { e.preventDefault(); setPage(page - 1); }
      else if (k === 'Home') setPage(1); else if (k === 'End') setPage(N);
    };
    document.addEventListener('keydown', onKey);
    let sw = null;
    stage.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') sw = { x: e.clientX, y: e.clientY, t: Date.now(), sl: stage.scrollLeft }; });
    stage.addEventListener('pointerup', (e) => {
      if (!sw || e.pointerType !== 'touch') return;
      const dx = e.clientX - sw.x, dy = e.clientY - sw.y, quick = Date.now() - sw.t < 700; const s0 = sw; sw = null;
      if (getSelection()?.toString()) return;
      if (Math.abs(dx) > 60 && Math.abs(dy) < 50 && quick && P.mode !== 'scroll') {
        const wide = stage.scrollWidth > stage.clientWidth + 4; // zoomed in: let the swipe scroll the page unless it is already at the edge
        const edge = dx < 0 ? stage.scrollLeft + stage.clientWidth >= stage.scrollWidth - 2 : stage.scrollLeft <= 2;
        if (!wide || edge) setPage(page + (dx < 0 ? 1 : -1));
      } else if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && focus && !e.target.closest('.pnote')) rd.classList.toggle('peek');
    });
    stage.addEventListener('click', (e) => { if (focus && e.pointerType !== 'touch' && !e.target.closest('.pnote, .rerr') && !getSelection()?.toString()) rd.classList.toggle('peek'); });
    let rsT = 0;
    const onResize = () => { clearTimeout(rsT); rsT = setTimeout(() => { if (stage.clientWidth !== lastW && P.mode !== 'text') rebuild(); }, 200); };
    window.addEventListener('resize', onResize);
    const onHide = () => saveProgress(true);
    window.addEventListener('pagehide', onHide);

    cleanup = () => {
      saveProgress(true); clearTimeout(prefT); observer?.disconnect(); ++seq;
      document.removeEventListener('selectionchange', onSel); document.removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', onFs);
      window.removeEventListener('resize', onResize); window.removeEventListener('pagehide', onHide);
      document.body.classList.remove('rfocus');
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      task?.destroy();
    };

    // ---- open the PDF ----
    stage.innerHTML = '<p class="muted rwait"><span class="spin"></span> Opening book…</p>';
    try {
      task = lib.getDocument(docOpts({ url: `/api/ebooks/${id}/file`, rangeChunkSize: 262144 }));
      pdf = await task.promise;
      if (my !== getNav()) { task.destroy(); return; }
      N = pdf.numPages; page = clamp(page, 1, N);
      $('#rn').textContent = N; $('#rpage').max = N;
      await loadToc();
      await rebuild();
      updateUi();
      if (page !== book.page || !book.pages) saveProgress();
    } catch (e) {
      stage.innerHTML = `<div class="rerr"><b>This book could not be opened.</b><span>${esc(pdfError(e))}</span><div class="row"><button class="btn sm" id="rtry">Try again</button><a class="btn sm" href="#/ebooks">Back to books</a></div></div>`;
      $('#rtry').onclick = () => viewReader(id, getNav());
    }
  }

  return { viewBooks, viewReader, uploadModal, leave };
}
