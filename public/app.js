// Bookmark single-page app (no build step).
import { cropImage } from './crop.js';
import { makeReader } from './reader.js';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stem = (w) => (w.length > 4 ? w.replace(/(ing|ed|es|s|ly)$/, '') : w);
const app = $('#app');
const state = { user: null };
let nav = 0;

const STATUS = { want: 'Want to Read', reading: 'Reading', completed: 'Completed' };
const MARK = { highlight: 'Highlight', underline: 'Underline', bracket: 'Bracket', manual: 'Marked by you' };
const PATHS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  library: '<path d="M4 4h4v16H4zM10 4h4v16h-4z"/><path d="m16.5 5.5 3.5-1 3 14.5-3.5 1z" transform="translate(-2 0)"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  note: '<path d="M4 5h16v11H9l-5 4z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  marker: '<path d="m4 20 4-1 10-10-3-3L5 16z"/><path d="M14 7l3 3"/>',
  eraser: '<path d="m7 21-4-4 11-11 7 7-6 6H7z"/><path d="M10 10l7 7"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2 5.3M20 4v7h-7"/>',
  out: '<path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M16 8l4 4-4 4M20 12H9"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  github: '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>',
  linkedin: '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>',
};
const CREATOR = { name: 'Jency Diyora', linkedin: 'https://www.linkedin.com/in/jency-diyora/', github: 'https://github.com/imjnc' };
const creatorLinks = (cls = '') => `<a class="btn sm icon ghost ${cls}" href="${CREATOR.linkedin}" target="_blank" rel="noopener noreferrer" aria-label="${CREATOR.name} on LinkedIn" title="LinkedIn">${ic('linkedin')}</a><a class="btn sm icon ghost ${cls}" href="${CREATOR.github}" target="_blank" rel="noopener noreferrer" aria-label="${CREATOR.name} on GitHub" title="GitHub">${ic('github')}</a>`;
const ic = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[n]}</svg>`;
const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8a1 1 0 0 1 1 1v14l-5-3-5 3V5a1 1 0 0 1 1-1z"/></svg>';
const LOGO = `<a class="logo" href="#/"><span class="mk">${ICON}</span><span class="nm">Bookmark</span></a>`;
const fmtDate = (d) => (d ? new Date(d + (d.length === 10 ? 'T00:00' : '')).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');

// ---------- helpers ----------
async function api(path, { method = 'GET', body, form } = {}) {
  const opt = { method, headers: {}, credentials: 'same-origin' };
  if (form) opt.body = form;
  else if (body !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch('/api' + path, opt);
  let j = null;
  try { j = await r.json(); } catch { /* empty */ }
  if (r.status === 401 && !path.startsWith('/auth/')) { state.user = null; route(); throw new Error('Please sign in'); }
  if (!r.ok) throw new Error(j?.error || 'Request failed');
  return j;
}
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 3500);
}
const go = (h) => { if (location.hash === h) route(); else location.hash = h; };
function parseHash() {
  const [p, qs = ''] = location.hash.slice(1).split('?');
  return { parts: p.split('/').filter(Boolean), q: new URLSearchParams(qs) };
}
function hl(text, terms = []) {
  const stems = [...new Set(terms.map((t) => stem(t.toLowerCase())).filter((t) => t.length > 1))];
  if (!stems.length) return esc(text);
  const re = new RegExp('\\b(' + stems.map(escRe).join('|') + ')\\w*', 'gi');
  let out = '', last = 0, m;
  while ((m = re.exec(text))) { out += esc(text.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>'; last = m.index + m[0].length; }
  return out + esc(text.slice(last));
}
const queryTerms = (q) => (q || '').toLowerCase().match(/[a-z0-9]+/g) || [];
const coverHtml = (b) => (b.cover ? `<img src="${esc(b.cover)}" alt="" loading="lazy">` : `<span>${esc(b.title)}</span>`);
const statusPill = (s) => `<span class="pill ${s}">${STATUS[s] || s}</span>`;
const imgSrc = (id) => `/api/images/${id}/file`;
// Responsive WebP thumbnails (320/640/1280 wide, never upscaled) for lists and previews.
const thumb = (id, sizes, alt = '') => {
  const u = (w) => `/api/images/${id}/thumb?w=${w}`;
  return `<img src="${u(640)}" srcset="${u(320)} 320w, ${u(640)} 640w, ${u(1280)} 1280w" sizes="${sizes}" alt="${esc(alt)}" loading="lazy" decoding="async">`;
};
const SIZE_GRID = '(max-width: 639px) 45vw, 170px';

// Dialog with a close (X). Close, Esc and Back all ask first when the user typed something.
function modal(html) {
  const d = document.createElement('dialog');
  d.innerHTML = `<button type="button" class="xbtn" data-x aria-label="Close">${ic('x')}</button>${html}`;
  document.body.append(d);
  d.dirty = false;
  d.addEventListener('input', () => (d.dirty = true));
  d.addEventListener('close', () => d.remove());
  d.requestClose = () => { if (!d.dirty || confirm('Close without saving? What you entered will be lost.')) d.close(); };
  d.addEventListener('cancel', (e) => { e.preventDefault(); d.requestClose(); });
  $('[data-x]', d).onclick = d.requestClose;
  d.showModal();
  return d;
}

// Form wiring shared by dialogs: step-by-step on phones, everything visible on larger screens.
// Validation is custom (novalidate forms) so errors appear next to the field in both layouts.
function wireForm(d, { onClear = () => {}, extra = () => true } = {}) {
  const form = $('form', d), els = $$('.step', form), mq = matchMedia('(max-width: 639px)');
  const back = $('[data-back]', d), next = $('[data-next]', d), save = $('[data-save]', d);
  let i = 0;
  const show = () => {
    const m = mq.matches;
    form.classList.toggle('stepped', m);
    els.forEach((e, k) => e.classList.toggle('cur', k === i));
    $('.fill', form).style.width = ((i + 1) / els.length) * 100 + '%';
    $('.stepmeta', form).textContent = `Step ${i + 1} of ${els.length}: ${els[i].dataset.title}`;
    back.hidden = !m || i === 0; next.hidden = !m || i === els.length - 1; save.hidden = m && i < els.length - 1;
  };
  const fieldError = (el, msg) => {
    let e = el.nextElementSibling?.dataset.auto ? el.nextElementSibling : null;
    if (!msg) { e?.remove(); el.removeAttribute('aria-invalid'); return; }
    if (!e) { e = document.createElement('div'); e.className = 'ferr'; e.dataset.auto = '1'; e.setAttribute('role', 'alert'); el.after(e); }
    e.textContent = msg; el.setAttribute('aria-invalid', 'true');
  };
  const validate = (root) => {
    let first = null;
    $$('input, select, textarea', root).forEach((el) => {
      const ok = el.checkValidity();
      fieldError(el, ok ? '' : el.validationMessage || 'This field is required');
      if (!ok && !first) first = el;
    });
    const extraOk = extra(root);
    first?.focus();
    return !first && extraOk !== false;
  };
  form.addEventListener('input', (e) => fieldError(e.target, ''));
  next.onclick = () => { if (validate(els[i])) { i++; show(); $('input, select, textarea', els[i])?.focus(); } };
  back.onclick = () => { i--; show(); };
  // Enter on an early step must go to the next step, not save.
  form.addEventListener('submit', (e) => { if (mq.matches && i < els.length - 1) { e.preventDefault(); e.stopImmediatePropagation(); next.click(); } }, true);
  $('[data-clear]', d).onclick = () => {
    if (d.dirty && !confirm('Clear the form? Everything you entered will be removed.')) return;
    form.reset(); $$('.ferr[data-auto]', form).forEach((e) => e.remove()); $$('[aria-invalid]', form).forEach((e) => e.removeAttribute('aria-invalid'));
    onClear(); d.dirty = false; i = 0; show();
  };
  mq.addEventListener('change', show);
  show();
  return { validate: () => validate(form) };
}

// Upload with progress (fetch cannot report upload progress).
function xhrUpload(url, fd, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.responseType = 'json';
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => {
      if (x.status === 401) { state.user = null; route(); return reject(new Error('Please sign in')); }
      x.status < 300 ? resolve(x.response) : reject(new Error(x.response?.error || 'Upload failed'));
    };
    x.onerror = () => reject(new Error('Network error. Check your connection and try again.'));
    x.send(fd);
  });
}
const checkImage = (f) => (!/^image\//.test(f.type) ? `${f.name} is not an image` : f.size > 30 * 1024 * 1024 ? `${f.name} is over 30 MB` : '');
const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

// ---------- theme ----------
const root = document.documentElement;
const themeNow = () => root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
function syncTheme() {
  const dark = themeNow() === 'dark';
  $$('[data-theme-btn]').forEach((b) => {
    const label = dark ? 'Light mode' : 'Dark mode';
    b.setAttribute('aria-label', 'Switch to ' + label.toLowerCase()); b.title = label;
    b.innerHTML = ic(dark ? 'sun' : 'moon') + (b.dataset.themeBtn === 'rail' ? `<span class="lbl">${label}</span>` : '');
  });
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-theme-btn]')) return;
  const n = themeNow() === 'dark' ? 'light' : 'dark';
  root.dataset.theme = n;
  try { localStorage.setItem('bm-theme', n); } catch { /* private mode: still applies for this visit */ }
  syncTheme();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncTheme);

// ---------- shell ----------
function renderTop() {
  const top = $('#top');
  $('#shell').classList.toggle('out', !state.user);
  $('#mbar').innerHTML = state.user ? `${LOGO}<div class="row" style="gap:0"><button class="btn sm icon ghost" data-theme-btn="bar"></button>${creatorLinks()}</div>` : '';
  if (!state.user) { top.innerHTML = ''; return; }
  const { parts } = parseHash();
  const cur = parts[0] === 'library' || parts[0] === 'book' ? 'library' : parts[0] === 'ebooks' || parts[0] === 'read' ? 'books' : parts[0] === 'search' || parts[0] === 'image' || !parts[0] ? 'search' : '';
  const link = (href, name, icon, label) => `<a class="navl ${cur === name ? 'on' : ''}" href="${href}" ${cur === name ? 'aria-current="page"' : ''}>${ic(icon)}<span class="lbl">${label}</span></a>`;
  top.innerHTML = `
    <div class="railhead">${LOGO}<button class="btn sm icon ghost" data-theme-btn="bar"></button></div>
    ${link('#/', 'search', 'search', 'Search')}
    ${link('#/library', 'library', 'library', 'Library')}
    ${link('#/ebooks', 'books', 'book', 'Books')}
    <button class="navl" id="nb">${ic('plus')}<span class="lbl">Add book</span></button>
    <button class="navl" id="nu">${ic('upload')}<span class="lbl">Upload</span></button>
    <div class="rail-grow"></div><div class="rail-sep"></div>
    <div class="rail-credit"><span class="small muted">Created by</span><div class="row" style="gap:0;margin-left:-.5rem">${creatorLinks()}</div></div>
    <div class="rail-user">${esc(state.user.name || state.user.email)}</div>
    <button class="navl" id="out" title="Sign out">${ic('out')}<span class="lbl">Sign out</span></button>`;
  $('#nb').onclick = () => bookModal();
  $('#nu').onclick = () => uploadModal(parseHash().parts[0] === 'book' ? parseHash().parts[1] : undefined);
  $('#out').onclick = async () => { await api('/auth/logout', { method: 'POST' }); state.user = null; location.hash = '#/'; route(); };
}

async function route() {
  nav++;
  const my = nav;
  reader().leave();
  window.scrollTo(0, 0);
  if (!state.user) {
    try { state.user = await api('/auth/me'); } catch { /* not signed in */ }
  }
  renderTop();
  syncTheme();
  if (!state.user) return viewAuth();
  const { parts, q } = parseHash();
  app.innerHTML = '<p class="muted"><span class="spin"></span> Loading…</p>';
  try {
    if (!parts[0]) await viewHome();
    else if (parts[0] === 'library') await viewLibrary();
    else if (parts[0] === 'book') await viewBook(parts[1], my);
    else if (parts[0] === 'search') await viewSearch(q);
    else if (parts[0] === 'image') await viewImage(parts[1], q, my);
    else if (parts[0] === 'ebooks') await reader().viewBooks();
    else if (parts[0] === 'read') await reader().viewReader(parts[1], my);
    else app.innerHTML = '<div class="empty">Page not found. <a href="#/">Go home</a></div>';
  } catch (e) {
    if (my === nav) app.innerHTML = `<div class="empty">${esc(e.message)}<br><a href="#/">Go home</a></div>`;
  }
}
window.addEventListener('hashchange', route);

// ---------- auth ----------
function viewAuth() {
  let mode = 'login';
  const draw = () => {
    app.innerHTML = `
    <form class="auth" id="af">
      <div class="row between">${LOGO}<button type="button" class="btn sm icon ghost" data-theme-btn="bar"></button></div>
      <h1>${mode === 'login' ? 'Welcome back' : 'Create your library'}</h1>
      <p>Find anything you've read, from a few remembered words.</p>      ${mode === 'register' ? '<label for="n">Name (optional)</label><input id="n" name="name" type="text" autocomplete="name">' : ''}
      <label for="e">Email</label><input id="e" name="email" type="email" required autocomplete="email">
      <label for="p">Password ${mode === 'register' ? '(8+ characters)' : ''}</label>
      <input id="p" name="password" type="password" required minlength="${mode === 'register' ? 8 : 1}" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}">
      <div class="err" id="er"></div>
      <div class="row between" style="margin-top:.6rem">
        <button class="btn primary" type="submit">${mode === 'login' ? 'Sign in' : 'Create account'}</button>
        <button class="btn sm" type="button" id="sw">${mode === 'login' ? 'New here? Sign up' : 'Have an account? Sign in'}</button>
      </div>
    </form>
    <div class="row small muted" style="margin-top:2rem;gap:.2rem;justify-content:center">Created by ${creatorLinks()}</div>`;
    syncTheme();
    $('#sw').onclick = () => { mode = mode === 'login' ? 'register' : 'login'; draw(); };
    $('#af').onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      try { state.user = await api('/auth/' + mode, { method: 'POST', body }); route(); }
      catch (err) { $('#er').textContent = err.message; }
    };
  };
  draw();
}

// ---------- home ----------
const EXAMPLES = [
  'a line about the cost of acquiring a customer',
  'the equation for calculating profit',
  'why startups fail',
  'a quote about consistency',
];
// Every book gets one of seven spine colours, stable per title.
const bc = (s = '') => 'bc' + ([...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 7);
const HOW = [
  { cls: 'pink', icon: 'upload', title: 'Save a page', text: 'Photograph or screenshot any page. Crop it if you like; your original stays untouched.', act: 'upload' },
  { cls: 'lime', icon: 'marker', title: 'We read it for you', text: 'Every word is indexed, and highlights, underlines and brackets are picked out.', act: 'library' },
  { cls: 'amber', icon: 'search', title: 'Search by memory', text: 'Type a word or describe the idea. Keyword and meaning search work together.', act: 'search' },
  { cls: 'cream', icon: 'lock', title: 'Only yours', text: 'Your pages and text are private to your account. Nothing is searched online.', act: null },
];
async function viewHome() {
  const d = await api('/home');
  const first = d.totals.books === 0;
  const prompts = d.searches.length ? d.searches : EXAMPLES;
  const tile = (cls, icon, label, n) => `<div class="tile ${cls}"><div class="ti"><span class="tic">${ic(icon)}</span>${label}</div><b>${n}</b></div>`;
  app.innerHTML = `
    <section class="ask">
      <div class="stickers"><span class="stk s1">Private to your account</span><span class="stk s2">Finds ideas, not just words</span></div>
      <h1>What are you trying to remember?</h1>
      <form class="field" id="hs" role="search">
        ${ic('search')}
        <input type="search" name="q" placeholder="Search anything you've read" aria-label="Search your library" autofocus autocomplete="off">
        <span class="hint" aria-hidden="true">/</span>
        <button type="submit">Search</button>
      </form>
      <div class="try-h"><span>${d.searches.length ? 'Recent searches' : 'Try asking for'}</span>${d.searches.length ? '<button id="clr">Clear</button>' : ''}</div>
      <div class="chips2">${prompts.map((s, i) => `<button class="bc${(i * 2 + 1) % 7}" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    </section>
    <section class="tiles" aria-label="Your library at a glance">
      ${tile('lilac', 'library', 'Books', d.totals.books)}${tile('coral', 'copy', 'Saved pages', d.totals.images)}${tile('sky', 'marker', 'Searchable passages', d.totals.passages)}
    </section>
    <section class="block"><div class="sec-h"><h2>How Bookmark works</h2></div>
      <div class="how">${HOW.map((h, i) => {
        const inner = `<span class="gl">${ic(h.icon)}</span><span><span class="n">0${i + 1}.</span><h3>${h.title}</h3><p>${h.text}</p></span>${h.act ? `<span class="go" aria-hidden="true">${ic('arrow')}</span>` : ''}`;
        return h.act ? `<button class="hw ${h.cls}" data-act="${h.act}">${inner}</button>` : `<div class="hw ${h.cls}">${inner}</div>`;
      }).join('')}</div></section>
    ${first ? `<div class="empty" style="margin-top:2rem"><b>Your library is empty</b>Add a book, then upload photos or screenshots of its pages. Everything readable becomes searchable.
      <div class="row" style="justify-content:center;margin-top:1rem"><button class="btn primary" id="addbook">${ic('plus')}Add your first book</button></div></div>` : ''}
    ${d.books.length ? `<section class="block"><div class="sec-h"><h2>Recently added books</h2><a href="#/library">All books</a></div><div class="grid">${d.books.map(bookCard).join('')}</div></section>` : ''}
    ${d.images.length ? `<section class="block"><div class="sec-h"><h2>Recently saved pages</h2></div><div class="pages">${d.images.map((i) => `
      <a class="pg" href="#/image/${i.id}"><div class="im">${thumb(i.id, SIZE_GRID, 'Saved page from ' + i.title)}</div>
      <div class="cap"><b>${esc(i.title)}</b><br><span class="muted">${i.page ? 'Page ' + i.page : 'Page unknown'}</span></div></a>`).join('')}</div></section>` : ''}`;
  $('#hs').onsubmit = (e) => { e.preventDefault(); const q = new FormData(e.target).get('q').trim(); if (q) go('#/search?q=' + encodeURIComponent(q)); };
  $$('.chips2 button').forEach((c) => (c.onclick = () => go('#/search?q=' + encodeURIComponent(c.dataset.q))));
  $$('.hw[data-act]').forEach((c) => (c.onclick = () => ({ upload: () => uploadModal(), library: () => go('#/library'), search: () => $('#hs input').focus() })[c.dataset.act]()));
  $('#clr')?.addEventListener('click', async () => { await api('/searches', { method: 'DELETE' }); route(); });
  $('#addbook')?.addEventListener('click', () => bookModal());
}
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.querySelector('dialog[open]')) {
    const i = $('#hs input, #sf input');
    if (i) { e.preventDefault(); i.focus(); }
  }
});

function bookCard(b) {
  const n = b.imageCount ?? 0;
  return `<a class="book ${bc(b.title)}" href="#/book/${b.id}"><div class="cover">${coverHtml(b)}</div>
    <div class="t">${esc(b.title)}</div><div class="m">${esc(b.author || 'Unknown author')}</div>
    <div>${statusPill(b.status)}<span class="pill">${n} page${n === 1 ? '' : 's'}</span></div>
    ${b.startedOn ? `<div class="m small" style="margin-top:.2rem">Started ${fmtDate(b.startedOn)}</div>` : ''}</a>`;
}

// ---------- library ----------
async function viewLibrary() {
  const sort = localStorage.getItem('bm-sort') || 'added';
  const books = await api('/books?sort=' + sort);
  app.innerHTML = `
    <div class="row between" style="margin-bottom:1.4rem"><h1 style="margin:0">Library</h1>
      <div class="row nowrap libtools"><label for="sort" class="small muted" style="margin:0">Sort by</label><select id="sort">
        ${[['added', 'Date added'], ['title', 'Title'], ['author', 'Author'], ['status', 'Reading status']].map(([v, l]) => `<option value="${v}" ${v === sort ? 'selected' : ''}>${l}</option>`).join('')}
      </select><button class="btn primary" id="add">${ic('plus')}Add book</button></div></div>
    ${books.length ? `<div class="grid">${books.map(bookCard).join('')}</div>` : '<div class="empty"><b>No books yet</b>Add your first book to start saving pages.</div>'}`;
  $('#sort').onchange = (e) => { localStorage.setItem('bm-sort', e.target.value); route(); };
  $('#add').onclick = () => bookModal();
}

// ---------- book details ----------
async function viewBook(id, my) {
  const d = await api('/books/' + id);
  const b = d.book;
  app.innerHTML = `
    <a class="back" href="#/library">${ic('back')}Library</a>
    <div class="bookhead" style="margin-top:.8rem">
      <div class="book ${bc(b.title)}"><div class="cover">${coverHtml(b)}</div></div>
      <div>
        <h1 style="margin-bottom:.15em">${esc(b.title)}</h1>
        <div class="muted">${esc(b.author || 'Unknown author')}${b.isbn ? ' · ISBN ' + esc(b.isbn) : ''}</div>
        <div style="margin:.4rem 0">${statusPill(b.status)}${b.tags.map((t) => `<span class="pill">#${esc(t)}</span>`).join('')}</div>
        <div class="small muted">${b.startedOn ? 'Started ' + fmtDate(b.startedOn) : 'Start date not set'}${b.completedOn ? ' · Finished ' + fmtDate(b.completedOn) : ''}</div>
        ${b.notes ? `<p class="small" style="max-width:60ch">${esc(b.notes)}</p>` : ''}
        <div class="row" style="margin-top:.9rem">
          <button class="btn primary" id="up">${ic('upload')}Upload pages</button>
          <button class="btn" id="sb">${ic('search')}Search this book</button>
          <button class="btn ghost" id="eb">${ic('edit')}Edit</button><button class="btn ghost danger" id="db">${ic('trash')}Delete</button>
        </div>
      </div>
    </div>
    <section><div class="sec-h"><h2>Saved pages (${d.images.length})</h2></div>
    ${d.images.length ? `<div class="pages">${d.images.map((i) => `
      <a class="pg" href="#/image/${i.id}"><div class="im">${thumb(i.id, SIZE_GRID, "Saved page")}</div>
      <div class="cap">${i.page ? 'Page ' + i.page : '<span class="muted">Page unknown</span>'}<br>
        ${i.status === 'done' ? `<span class="pill">${i.passageCount} passages</span>${i.highlightCount ? `<span class="pill mark">${i.highlightCount} marked</span>` : ''}`
          : i.status === 'failed' ? '<span class="pill fail">Text not read</span>' : '<span class="pill warn"><span class="spin"></span> Reading</span>'}
        ${i.excerpt ? `<div class="ex">${esc(i.excerpt)}</div>` : ''}</div></a>`).join('')}</div>`
      : `<div class="empty"><b>No pages saved yet</b>Upload photos or screenshots of pages from this book.</div>`}
    </section>
    ${d.highlights.length ? `<section class="block"><div class="sec-h"><h2>Marked passages</h2></div>${d.highlights.map((h) => `
      <a class="quoteblock" href="#/image/${h.imageId}?p=${h.id}">
        <div class="q">${esc(h.highlightText || h.text)}</div>
        <div class="small muted" style="margin-top:.3rem">${h.page ? 'Page ' + h.page : 'Page unknown'}${h.markType ? ' · ' + (MARK[h.markType] || h.markType) : ''}${h.important ? ' · Important' : ''}</div></a>`).join('')}</section>` : ''}
    <section class="block"><div class="sec-h"><h2>Notes</h2></div>
      <form class="row nowrap" id="nf"><input type="text" name="content" placeholder="Add a note about this book" aria-label="Note" required><button class="btn">Add note</button></form>
      <div id="notes">${d.notes.map(noteHtml).join('')}</div></section>`;
  $('#up').onclick = () => uploadModal(b.id);
  $('#sb').onclick = () => go('#/search?q=*&book=' + b.id);
  $('#eb').onclick = () => bookModal(b);
  $('#db').onclick = async () => {
    if (!confirm(`Delete "${b.title}" and all its saved pages? This cannot be undone.`)) return;
    await api('/books/' + b.id, { method: 'DELETE' }); toast('Book deleted'); go('#/library');
  };
  $('#nf').onsubmit = async (e) => {
    e.preventDefault();
    await api('/notes', { method: 'POST', body: { bookId: b.id, content: new FormData(e.target).get('content') } });
    route();
  };
  bindNoteDeletes();
  if (d.images.some((i) => i.status === 'pending' || i.status === 'processing')) setTimeout(() => { if (my === nav) viewBook(id, my).catch(() => {}); }, 2500);
}
const noteHtml = (n) => `<div class="note"><span>${esc(n.content)}</span><button class="btn sm icon ghost" data-del-note="${n.id}" aria-label="Delete note">${ic('x')}</button></div>`;
function bindNoteDeletes() {
  $$('[data-del-note]').forEach((b) => (b.onclick = async () => { await api('/notes/' + b.dataset.delNote, { method: 'DELETE' }); route(); }));
}

// ---------- add / edit book ----------
const stepHead = '<div class="stepbar"><div class="prog"><div class="fill"></div></div><p class="stepmeta small muted" aria-live="polite"></p></div>';
const formFoot = (saveLabel) => `<div class="err" id="er" role="alert"></div>
  <div class="row between formfoot">
    <button type="button" class="btn ghost danger" data-clear>Clear form</button>
    <div class="row nowrap"><button type="button" class="btn" data-back hidden>Back</button><button type="button" class="btn primary" data-next hidden>Next</button><button class="btn primary" data-save id="sv">${saveLabel}</button></div>
  </div>`;

function bookModal(book) {
  const b = book || {};
  let cover = null;      // cropped cover chosen by the user (replaces the file input's value on save)
  let coverUrl = '';
  const d = modal(`
    <form id="bf" method="dialog" novalidate>
      <h2>${book ? 'Edit book' : 'Add book'}</h2>${stepHead}
      <fieldset class="step" data-title="Book"><legend class="sr">Book</legend>
        <label for="lk">Find details by title or ISBN (optional)</label>
        <div class="row nowrap"><input id="lk" type="text" placeholder="e.g. Zero to One or 9780804139298"><button type="button" class="btn" id="lkb">Look up</button></div>
        <div id="sg"></div>
        <label for="t">Title *</label><input id="t" name="title" type="text" required value="${esc(b.title)}">
        <label for="a">Author</label><input id="a" name="author" type="text" value="${esc(b.author)}">
        <label for="i">ISBN</label><input id="i" name="isbn" type="text" value="${esc(b.isbn)}">
      </fieldset>
      <fieldset class="step" data-title="Reading"><legend class="sr">Reading</legend>
        <label for="s">Status</label><select id="s" name="status">${Object.entries(STATUS).map(([v, l]) => `<option value="${v}" ${(b.status || 'reading') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <div class="two"><div><label for="st">Date started</label><input id="st" name="startedOn" type="date" value="${esc(b.startedOn)}"></div>
        <div><label for="co">Date completed</label><input id="co" name="completedOn" type="date" value="${esc(b.completedOn)}"></div></div>
      </fieldset>
      <fieldset class="step" data-title="Details"><legend class="sr">Details</legend>
        <label for="tg">Tags (comma separated)</label><input id="tg" name="tags" type="text" value="${esc((b.tags || []).join(', '))}">
        <label for="nt">Notes</label><textarea id="nt" name="notes" rows="2">${esc(b.notes)}</textarea>
        <label for="cv">Cover image (optional)</label><input id="cv" name="cover" type="file" accept="image/*">
        <div id="cvp" class="small muted" aria-live="polite"></div>
        <input type="hidden" name="coverUrl" id="cu">
      </fieldset>
      ${formFoot(book ? 'Save' : 'Add book')}
    </form>`);
  const clearCover = () => { cover = null; if (coverUrl) URL.revokeObjectURL(coverUrl); coverUrl = ''; $('#cvp', d).innerHTML = ''; };
  const st = wireForm(d, { onClear: () => { clearCover(); $('#sg', d).innerHTML = ''; $('#cu', d).value = ''; } });
  d.addEventListener('close', clearCover);

  const runLookup = async () => {
    const v = $('#lk', d).value.trim();
    if (!v) return;
    $('#sg', d).innerHTML = '<p class="muted small"><span class="spin"></span> Searching…</p>';
    try {
      const isIsbn = /^[0-9Xx-]{10,17}$/.test(v);
      const res = await api('/metadata?' + (isIsbn ? 'isbn=' : 'q=') + encodeURIComponent(v));
      $('#sg', d).innerHTML = res.length ? res.map((r, i) => `<button type="button" class="sugg" data-i="${i}">
        ${r.coverUrl ? `<img src="${esc(r.coverUrl)}" alt="">` : '<img alt="">'}<span><b>${esc(r.title)}</b><br><span class="muted small">${esc(r.author || '')}${r.year ? ' · ' + r.year : ''}</span></span></button>`).join('')
        : '<p class="muted small">No matches. Fill in the details manually.</p>';
      $$('.sugg', d).forEach((s) => (s.onclick = () => {
        const r = res[s.dataset.i];
        $('#t', d).value = r.title || ''; $('#a', d).value = r.author || ''; $('#i', d).value = r.isbn || ''; $('#cu', d).value = r.coverUrl || '';
        d.dirty = true;
        $('#sg', d).innerHTML = `<p class="small" style="color:var(--ok)">Filled from “${esc(r.title)}”. You can still edit anything.</p>`;
      }));
    } catch (e) { $('#sg', d).innerHTML = `<p class="err">${esc(e.message)}. You can enter details manually.</p>`; }
  };
  $('#lkb', d).onclick = runLookup;
  $('#lk', d).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); runLookup(); } };

  $('#cv', d).onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const bad = checkImage(f);
    if (bad) { $('#cvp', d).innerHTML = `<span class="ferr">${esc(bad)}</span>`; e.target.value = ''; return; }
    try {
      const r = await cropImage(f, { presets: ['cover', 'orig', 'square', 'custom'], preset: 'cover', cap: 1600, title: 'Crop cover' });
      if (!r) { e.target.value = ''; return; }
      clearCover();
      cover = r.cropped ? new File([r.blob], r.name, { type: r.blob.type }) : f;
      coverUrl = URL.createObjectURL(cover);
      $('#cvp', d).innerHTML = `<div class="row nowrap"><img class="cvthumb" src="${coverUrl}" alt="Cover preview"><span>${r.cropped ? 'Cropped' : 'Original'} cover, ${kb(cover.size)}</span></div>`;
      d.dirty = true;
    } catch (err) { $('#cvp', d).innerHTML = `<span class="ferr">${esc(err.message)}</span>`; e.target.value = ''; }
  };

  $('#bf', d).onsubmit = async (e) => {
    e.preventDefault();
    if (!st.validate()) return;
    const fd = new FormData(e.target);
    fd.delete('cover');
    if (cover) fd.append('cover', cover, cover.name);
    $('#sv', d).disabled = true;
    try {
      const saved = await api(book ? '/books/' + book.id : '/books', { method: book ? 'PUT' : 'POST', form: fd });
      d.close(); toast(book ? 'Book updated' : 'Book added');
      go('#/book/' + saved.id);
    } catch (err) { $('#er', d).textContent = err.message; $('#sv', d).disabled = false; }
  };
}

// ---------- upload ----------
async function uploadModal(bookId) {
  const books = await api('/books');
  if (!books.length) { toast('Add a book first'); return bookModal(); }
  let items = [];  // {file: original, out: what gets uploaded, cropped, url}
  const d = modal(`
    <form id="uf" novalidate>
      <h2>Upload pages</h2>${stepHead}
      <fieldset class="step" data-title="Book"><legend class="sr">Book</legend>
        <label for="ub">Which book are these pages from?</label>
        <select id="ub" name="book" required>${books.map((b) => `<option value="${b.id}" ${b.id === bookId ? 'selected' : ''}>${esc(b.title)}${b.author ? ' — ' + esc(b.author) : ''}</option>`).join('')}</select>
      </fieldset>
      <fieldset class="step" data-title="Pages"><legend class="sr">Pages</legend>
        <label for="uf1">Screenshots or photos of pages</label>
        <input id="uf1" type="file" accept="image/*" multiple>
        <div id="fe" class="ferr" role="alert" hidden></div>
        <ul class="flist" id="fl"></ul>
        <label for="up">Page number (optional, one image only)</label>
        <input id="up" name="page" type="number" min="1" placeholder="Leave blank if unknown">
        <p class="small muted">Crop to remove margins or other text. You can also keep the original. Text is read in the background.</p>
      </fieldset>
      <div class="prog" id="pg" hidden><div class="fill"></div></div>
      ${formFoot('Upload')}
    </form>`);

  const fe = (m) => { const e = $('#fe', d); e.textContent = m || ''; e.hidden = !m; };
  const render = () => {
    $('#fl', d).innerHTML = items.map((it, k) => `<li><img src="${it.url}" alt=""><div class="fn"><b>${esc(it.out.name || it.file.name)}</b><span class="muted small">${kb(it.out.size)} · ${it.cropped ? 'Cropped' : 'Original'}</span></div>
      <button type="button" class="btn sm" data-crop="${k}">Crop</button><button type="button" class="btn sm icon ghost" data-rm="${k}" aria-label="Remove ${esc(it.file.name)}">${ic('x')}</button></li>`).join('');
    const one = items.length === 1;
    $('#up', d).disabled = !one; if (!one) $('#up', d).value = '';
  };
  const setItem = (it, r) => { URL.revokeObjectURL(it.url); it.out = r.cropped ? new File([r.blob], r.name, { type: r.blob.type }) : it.file; it.cropped = r.cropped; it.url = URL.createObjectURL(it.out); };
  const edit = async (it, label) => {
    try {
      const r = await cropImage(it.file, { title: 'Crop page', step: label });
      if (r) { setItem(it, r); d.dirty = true; }
    } catch (e) { fe(e.message); }
    render();
  };
  d.addEventListener('close', () => items.forEach((it) => URL.revokeObjectURL(it.url)));
  const st = wireForm(d, {
    onClear: () => { items.forEach((it) => URL.revokeObjectURL(it.url)); items = []; fe(''); render(); },
    extra: (root) => { if (root.contains($('#uf1', d)) && !items.length) { fe('Choose at least one image.'); return false; } return true; },
  });

  $('#uf1', d).onchange = async (e) => {
    fe('');
    const files = [...e.target.files]; e.target.value = '';
    const errs = files.map(checkImage).filter(Boolean);
    if (errs.length) fe(errs.join('. '));
    const good = files.filter((f) => !checkImage(f));
    if (items.length + good.length > 40) { fe('You can upload up to 40 images at once.'); return; }
    const added = good.map((f) => ({ file: f, out: f, cropped: false, url: URL.createObjectURL(f) }));
    items.push(...added); d.dirty = d.dirty || added.length > 0; render();
    if (added.length === 1) await edit(added[0], 'Preview, crop, or use the original.');
  };
  $('#fl', d).onclick = (e) => {
    const c = e.target.closest('[data-crop]'), r = e.target.closest('[data-rm]');
    if (c) edit(items[c.dataset.crop], `Page ${+c.dataset.crop + 1} of ${items.length}`);
    if (r) { const [it] = items.splice(r.dataset.rm, 1); URL.revokeObjectURL(it.url); render(); }
  };

  $('#uf', d).onsubmit = async (e) => {
    e.preventDefault();
    if (!st.validate()) return;
    const bid = $('#ub', d).value;
    const fd = new FormData();
    items.forEach((it) => fd.append('images', it.out, it.out.name || it.file.name));
    if ($('#up', d).value && items.length === 1) fd.append('page', $('#up', d).value);
    const btn = $('#sv', d), bar = $('#pg', d);
    btn.disabled = true; bar.hidden = false;
    try {
      const r = await xhrUpload(`/api/books/${bid}/images`, fd, (p) => { $('.fill', bar).style.width = p * 100 + '%'; btn.textContent = `Uploading ${Math.round(p * 100)}%`; });
      d.close(); toast(`${r.images.length} page${r.images.length > 1 ? 's' : ''} uploaded. Reading text…`);
      go('#/book/' + bid);
    } catch (err) { $('#er', d).textContent = err.message; btn.disabled = false; btn.textContent = 'Upload'; bar.hidden = true; }
  };
}

// ---------- search ----------
async function viewSearch(q) {
  const query = q.get('q') || '';
  const f = { book: q.get('book') || '', author: q.get('author') || '', status: q.get('status') || '', highlighted: q.get('highlighted') === '1', equations: q.get('equations') === '1', group: q.get('group') === 'image' };
  const books = await api('/books');
  const authors = [...new Set(books.map((b) => b.author).filter(Boolean))].sort();
  const sq = query === '*' ? '' : query;
  app.innerHTML = `
    <form class="field searchhead" id="sf" role="search">${ic('search')}<input type="search" name="q" value="${esc(sq)}" placeholder="Search your library" aria-label="Search your library" autocomplete="off" ${sq ? '' : 'autofocus'}><button>Search</button></form>
    <div class="filters" id="fl">
      <select data-k="book" aria-label="Filter by book"><option value="">All books</option>${books.map((b) => `<option value="${b.id}" ${f.book === b.id ? 'selected' : ''}>${esc(b.title)}</option>`).join('')}</select>
      <select data-k="author" aria-label="Filter by author"><option value="">All authors</option>${authors.map((a) => `<option ${f.author === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
      <select data-k="status" aria-label="Filter by reading status"><option value="">Any status</option>${Object.entries(STATUS).map(([v, l]) => `<option value="${v}" ${f.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="btn sm ${f.highlighted ? 'on' : ''}" data-t="highlighted" aria-pressed="${f.highlighted}">Marked passages</button>
      <button class="btn sm ${f.equations ? 'on' : ''}" data-t="equations" aria-pressed="${f.equations}">Equations</button>
      <button class="btn sm ${f.group ? 'on' : ''}" data-t="group" aria-pressed="${f.group}">One result per page</button>
    </div>
    <div id="res"></div>`;
  const apply = (patch) => {
    const n = { ...f, ...patch };
    const p = new URLSearchParams({ q: query });
    ['book', 'author', 'status'].forEach((k) => n[k] && p.set(k, n[k]));
    if (n.highlighted) p.set('highlighted', '1');
    if (n.equations) p.set('equations', '1');
    if (n.group) p.set('group', 'image');
    go('#/search?' + p);
  };
  $('#sf').onsubmit = (e) => { e.preventDefault(); const v = new FormData(e.target).get('q').trim(); if (v) { const p = new URLSearchParams(location.hash.split('?')[1] || ''); p.set('q', v); go('#/search?' + p); } };
  $$('#fl select').forEach((s) => (s.onchange = () => apply({ [s.dataset.k]: s.value })));
  $$('#fl [data-t]').forEach((b) => (b.onclick = () => apply({ [b.dataset.t]: !f[b.dataset.t] })));

  const res = $('#res');
  if (!sq) { res.innerHTML = '<div class="empty"><b>Search everything you have saved</b>Type a word, a concept, or describe it in your own words.</div>'; return; }
  res.innerHTML = '<p class="muted"><span class="spin"></span> Searching your library…</p>';
  const p = new URLSearchParams({ q: sq || '' });
  Object.entries({ book: f.book, author: f.author, status: f.status }).forEach(([k, v]) => v && p.set(k, v));
  if (f.highlighted) p.set('highlighted', '1');
  if (f.equations) p.set('equations', '1');
  if (f.group) p.set('group', 'image');
  const my = nav;
  const data = await api('/search?' + p);
  if (my !== nav) return;
  if (!data.results.length) {
    res.innerHTML = `<div class="empty"><b>Nothing found for “${esc(sq)}”</b>Try fewer words, or describe the idea the way you'd explain it to a friend. Only pages you've saved are searched.</div>`;
    return;
  }
  const how = { both: 'Keyword and meaning', keyword: 'Keyword match', semantic: 'Similar meaning' };
  const cropHtml = (r) => {
    const b = r.bbox;
    if (!b) return '';
    const pad = 0.03;
    const w = Math.min(1, Math.max(0.4, b.w + pad * 2));
    const x = Math.min(Math.max(0, b.x - pad), 1 - w);
    const y = Math.max(0, b.y - pad * 0.6);
    return `<div class="crop" aria-hidden="true"><div class="zoom" style="width:${(100 / w).toFixed(1)}%;transform:translate(${(-x * 100).toFixed(2)}%,${(-y * 100).toFixed(2)}%)">
      ${thumb(r.imageId, "(max-width: 639px) 250vw, 1100px")}<i class="hl" style="left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%"></i></div></div>`;
  };
  res.innerHTML = `<p class="muted small" style="margin:0 0 .8rem">${data.results.length} result${data.results.length > 1 ? 's' : ''}${data.expanded?.length ? ' · also searched for ' + esc(data.expanded.join(', ')) : ''}</p><div class="cards">` +
    data.results.map((r) => {
      const lvl = Math.max(1, Math.ceil(r.relevance / 20));
      return `<a class="hit ${bc(r.title)}" href="#/image/${r.imageId}?p=${r.id}&q=${encodeURIComponent(sq)}" aria-label="Open page from ${esc(r.title)}">
        ${cropHtml(r)}
        <div class="body">
          <div class="src"><div><div class="bk">${esc(r.title)}</div><div class="au">${esc(r.author || 'Unknown author')}</div></div><div class="pgno">${r.page ? 'Page ' + r.page : 'Page unknown'}</div></div>
          <div class="quote">${hl(r.snippet, data.terms)}</div>
          <div class="foot">
            <span class="meter" role="img" aria-label="Relevance ${r.relevance} percent">${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= lvl ? 'on' : ''}"></i>`).join('')}</span><span>${how[r.matchType]}</span>
            ${r.highlighted ? `<span class="pill mark">${MARK[r.markType] || 'Marked'}</span>` : ''}${r.isEquation ? '<span class="pill">Equation</span>' : ''}${r.important ? '<span class="pill mark">Important</span>' : ''}
            ${r.confidence != null && r.confidence < 70 && !r.corrected ? '<span class="pill warn">Check text</span>' : ''}${r.matches > 1 ? `<span class="pill">${r.matches} matches on this page</span>` : ''}
          </div></div></a>`;
    }).join('') + '</div>';
}

// ---------- image & passage viewer ----------
async function viewImage(id, q, my) {
  const d = await api('/images/' + id);
  const { image, book, passages, notes } = d;
  const terms = queryTerms(q.get('q'));
  let cur = q.get('p') || null;
  let selMode = null;
  const processing = image.status === 'pending' || image.status === 'processing';

  app.innerHTML = `
    <a class="back" href="#/book/${book.id}">${ic('back')}${esc(book.title)}</a>
    <div class="row between" style="margin:.5rem 0 .4rem;align-items:flex-start">
      <div>
        <h1 style="margin:0 0 .1em">${esc(book.title)}</h1>
        <div class="muted">${esc(book.author || 'Unknown author')} · ${image.page ? 'Page ' + image.page : 'Page unknown'}
          <button class="btn sm ghost" id="setpg">${image.page ? 'Change page' : 'Set page'}</button></div></div>
      <div class="row"><a class="btn sm" href="#/search?q=${encodeURIComponent(q.get('q') || '*')}&book=${book.id}">${ic('search')}More from this book</a>
        <button class="btn sm ghost" id="rp">${ic('refresh')}Re-read text</button><button class="btn sm ghost danger" id="di">${ic('trash')}Delete page</button></div>
    </div>
    <div class="viewer">
      <div>
        <div class="stage" id="stage"><img id="pic" src="${imgSrc(image.id)}" alt="Original page image" draggable="false"></div>
        <div class="tools">
          <button class="btn sm" id="mk" aria-pressed="false">${ic('marker')}Mark text</button><button class="btn sm" id="um" aria-pressed="false">${ic('eraser')}Unmark text</button>
          <a class="btn sm" href="${imgSrc(image.id)}" target="_blank" rel="noopener">${ic('external')}Open original</a>
        </div>
        <p class="legend">Yellow is a detected highlight. A blue underline or bar is a detected underline, black line or bracket. Orange is text you marked. To mark or unmark text, choose a tool and drag over the page. The original image is never changed.</p>
      </div>
      <div id="side">
        ${processing ? '<div class="empty"><span class="spin"></span> Reading the text on this page…</div>' : ''}
        ${image.status === 'failed' ? `<div class="empty"><b>The text could not be read</b>${image.error ? esc(image.error) + '. ' : ''}Choose “Re-read text” to try again.</div>` : ''}
        ${image.status === 'done' && !passages.length ? '<div class="empty"><b>No readable text found</b>Try a sharper photo, or add a note to this page.</div>' : ''}
        <div id="plist">${passages.map(passageHtml).join('')}</div>
        <h3 style="margin-top:1.4rem">Notes on this page</h3>
        <form class="row nowrap" id="pn"><input type="text" name="content" placeholder="Add a note" aria-label="Note on this page" required><button class="btn">Add note</button></form>
        <div>${notes.filter((n) => !n.passageId).map(noteHtml).join('')}</div>
      </div>
    </div>`;

  function passageHtml(p) {
    const pn = notes.filter((n) => n.passageId === p.id);
    return `<div class="passage ${p.id === cur ? 'cur' : ''}" id="p-${p.id}" data-id="${p.id}">
      <div class="tx" data-focus="${p.id}">${hl(p.text, terms)}</div>
      <div class="small" style="margin-top:.3rem">
        ${p.highlighted ? `<span class="pill mark">${MARK[p.markType] || 'Marked'}</span>` : ''}${p.isEquation ? '<span class="pill">Equation</span>' : ''}
        ${p.confidence != null && p.confidence < 70 && !p.corrected ? `<span class="pill warn" title="Reading confidence ${p.confidence}%">Check text</span>` : ''}${p.corrected ? '<span class="pill">Edited</span>' : ''}
      </div>
      <div class="acts">
        <button class="btn sm" data-act="copy" data-id="${p.id}">${ic('copy')}Copy</button>
        <button class="btn sm ${p.important ? 'on' : ''}" data-act="star" data-id="${p.id}" aria-pressed="${p.important}">${ic('star', p.important ? 'fill' : '')}${p.important ? 'Important' : 'Mark important'}</button>
        <button class="btn sm" data-act="edit" data-id="${p.id}">${ic('edit')}Edit text</button>
        <button class="btn sm" data-act="note" data-id="${p.id}">${ic('note')}Add note</button>
      </div>
      <div data-slot="${p.id}"></div>
      ${pn.map(noteHtml).join('')}
    </div>`;
  }

  const stage = $('#stage');
  function drawOverlays() {
    $$('.ov', stage).forEach((o) => o.remove());
    const box = (o, cls) => { const e = document.createElement('div'); e.className = 'ov ' + cls; e.style.cssText = `left:${o.x * 100}%;top:${o.y * 100}%;width:${o.w * 100}%;height:${o.h * 100}%`; stage.append(e); return e; };
    passages.forEach((p) => p.lines.forEach((l) => l.mark && box(l, 'line ' + l.mark)));
    const c = passages.find((p) => p.id === cur);
    if (c) box({ x: c.bbox.x - .005, y: c.bbox.y - .004, w: c.bbox.w + .01, h: c.bbox.h + .008 }, 'focus');
  }
  drawOverlays();
  const focus = (pid, scroll) => {
    cur = pid; drawOverlays();
    $$('.passage').forEach((e) => e.classList.toggle('cur', e.dataset.id === pid));
    if (scroll) $('#p-' + pid)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  if (cur) setTimeout(() => $('#p-' + cur)?.scrollIntoView({ block: 'center' }), 50);

  // passage actions
  $('#plist').addEventListener('click', async (e) => {
    const t = e.target.closest('[data-focus],[data-act]');
    if (!t) return;
    if (t.dataset.focus) return focus(t.dataset.focus, false);
    const pid = t.dataset.id, p = passages.find((x) => x.id === pid), slot = $(`[data-slot="${pid}"]`);
    try {
      if (t.dataset.act === 'copy') { await navigator.clipboard.writeText(p.text); toast('Copied'); }
      if (t.dataset.act === 'star') { await api('/passages/' + pid, { method: 'PUT', body: { important: !p.important } }); route(); }
      if (t.dataset.act === 'edit') {
        slot.innerHTML = `<textarea aria-label="Corrected text">${esc(p.text)}</textarea><div class="row" style="margin-top:.4rem"><button class="btn sm primary" data-save>Save</button><button class="btn sm" data-cancel>Cancel</button></div>`;
        $('[data-cancel]', slot).onclick = () => (slot.innerHTML = '');
        $('[data-save]', slot).onclick = async () => { await api('/passages/' + pid, { method: 'PUT', body: { text: $('textarea', slot).value } }); toast('Text updated and re-indexed'); route(); };
      }
      if (t.dataset.act === 'note') {
        slot.innerHTML = '<div class="row" style="margin-top:.4rem;flex-wrap:nowrap"><input type="text" placeholder="Your note" aria-label="Note"><button class="btn sm primary" data-save>Save</button></div>';
        $('input', slot).focus();
        $('[data-save]', slot).onclick = async () => { await api('/notes', { method: 'POST', body: { passageId: pid, content: $('input', slot).value } }); route(); };
      }
    } catch (err) { toast(err.message); }
  });
  $('#pn').onsubmit = async (e) => { e.preventDefault(); try { await api('/notes', { method: 'POST', body: { imageId: image.id, content: new FormData(e.target).get('content') } }); route(); } catch (err) { toast(err.message); } };
  bindNoteDeletes();

  // click on the image selects the passage under the pointer
  stage.addEventListener('click', (e) => {
    if (selMode) return;
    const r = stage.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    const hit = passages.find((p) => x >= p.bbox.x && x <= p.bbox.x + p.bbox.w && y >= p.bbox.y && y <= p.bbox.y + p.bbox.h);
    if (hit) focus(hit.id, true);
  });

  // manual marking by dragging a rectangle
  const setMode = (m) => { selMode = selMode === m ? null : m; stage.classList.toggle('selecting', !!selMode); $('#mk').classList.toggle('on', selMode === 'mark'); $('#um').classList.toggle('on', selMode === 'clear'); $('#mk').setAttribute('aria-pressed', selMode === 'mark'); $('#um').setAttribute('aria-pressed', selMode === 'clear'); };
  $('#mk').onclick = () => setMode('mark');
  $('#um').onclick = () => setMode('clear');
  let start = null, selBox = null;
  stage.addEventListener('pointerdown', (e) => {
    if (!selMode) return;
    const r = stage.getBoundingClientRect();
    start = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    selBox = document.createElement('div'); selBox.className = 'ov sel'; stage.append(selBox);
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!start) return;
    const r = stage.getBoundingClientRect();
    const x = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1), y = Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1);
    Object.assign(selBox.style, { left: Math.min(start.x, x) * 100 + '%', top: Math.min(start.y, y) * 100 + '%', width: Math.abs(x - start.x) * 100 + '%', height: Math.abs(y - start.y) * 100 + '%' });
  });
  stage.addEventListener('pointerup', async (e) => {
    if (!start) return;
    const r = stage.getBoundingClientRect();
    const x = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1), y = Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1);
    const rect = { x: Math.min(start.x, x), y: Math.min(start.y, y), w: Math.abs(x - start.x), h: Math.abs(y - start.y) };
    start = null; selBox.remove();
    if (rect.w < .01 || rect.h < .005) return;
    try {
      const out = await api(`/images/${image.id}/mark`, { method: 'POST', body: { rect, clear: selMode === 'clear' } });
      toast(out.touched ? 'Updated marked text' : 'No text found in that area');
      if (out.touched) route();
    } catch (err) { toast(err.message); }
  });

  $('#setpg').onclick = async () => {
    const v = prompt('Page number (leave empty if unknown)', image.page || '');
    if (v === null) return;
    await api('/images/' + image.id, { method: 'PUT', body: { page: v } }); route();
  };
  $('#rp').onclick = async () => { await api(`/images/${image.id}/reprocess`, { method: 'POST' }); toast('Reading text again…'); route(); };
  $('#di').onclick = async () => {
    if (!confirm('Delete this image and its extracted text?')) return;
    await api('/images/' + image.id, { method: 'DELETE' }); go('#/book/' + book.id);
  };
  if (processing) setTimeout(() => { if (my === nav) viewImage(id, q, my).catch(() => {}); }, 2500);
}

// The reader is built lazily so it can use helpers defined further down this file.
let R;
function reader() { return (R ??= makeReader({ api, esc, ic, $, $$, modal, wireForm, xhrUpload, toast, go, bc, stepHead, formFoot, kb, getNav: () => nav })); }

route();
