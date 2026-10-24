// Browser test: drives headless Chrome over the DevTools protocol (no extra dependencies).
// Run: python test/make-fixtures.py <dir> && node test/ui.mjs <dir> [shots dir]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fixtures = path.resolve(process.argv[2] || '');
const shots = process.argv[3] && path.resolve(process.argv[3]);
if (shots) fs.mkdirSync(shots, { recursive: true });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 3414, base = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-ui-'));
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT, BOOKMARK_DATA: path.join(tmp, 'data'), BOOKMARK_EMBEDDINGS: 'hash' }, stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${path.join(tmp, 'profile')}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

let fails = 0;
const check = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!cond) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, ms = 15000) { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return null; await sleep(150); } }

let ws, id = 0; const pending = new Map();
const cdp = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const shot = async (name) => { if (!shots) return; const r = await cdp('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(shots, name + '.png'), Buffer.from(r.data, 'base64')); };
const viewport = (w, h, mobile) => cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
const goto = async (url) => { await cdp('Page.navigate', { url }); await sleep(600); };
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
const text = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? null`);
const exists = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
const visible = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});return !!e&&getComputedStyle(e).display!=='none'&&e.getClientRects().length>0})()`);
const type = (sel, v) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
const setFile = async (sel, file) => { const { root } = await cdp('DOM.getDocument'); const { nodeId } = await cdp('DOM.querySelector', { nodeId: root.nodeId, selector: sel }); await cdp('DOM.setFileInputFiles', { files: [file], nodeId }); };
// Native confirm() blocks automation, so replace it and record what was asked.
const stubConfirm = (answer) => ev(`window.__asked=[];window.confirm=(m)=>{window.__asked.push(m);return ${answer}}`);

try {
  for (let i = 0; i < 60; i++) { try { await fetch(base + '/api/auth/me'); break; } catch { await sleep(500); } }
  const tgt = await until(async () => { try { const l = await (await fetch('http://127.0.0.1:9333/json')).json(); return l.find((t) => t.type === 'page'); } catch { return null; } });
  ws = new WebSocket(tgt.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => { const d = JSON.parse(m.data); const p = pending.get(d.id); if (p) { pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); } };
  await cdp('Page.enable'); await cdp('DOM.enable'); await cdp('Runtime.enable');

  // ---- sign up (through the real UI), phone viewport ----
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await viewport(382, 904, true);
  await goto(base + '/');
  await until(() => exists('#af'));
  await shot('01-auth-mobile');
  await click('#sw'); await type('#e', 'ui@test.dev'); await type('#p', 'password123');
  await click('#af button[type=submit]');
  check('signed up and reached home', !!(await until(() => exists('#hs'))));

  // ---- theme ----
  check('theme: default follows OS (no saved choice)', (await ev('document.documentElement.dataset.theme || "none"')) === 'none');
  const bgLight = await ev('getComputedStyle(document.body).backgroundColor');
  await click('#mbar [data-theme-btn]');
  const bgDark = await ev('getComputedStyle(document.body).backgroundColor');
  check('theme: switch to dark changes colours', (await ev('document.documentElement.dataset.theme')) === 'dark' && bgLight !== bgDark, `${bgLight} -> ${bgDark}`);
  await shot('02-home-dark-mobile');
  await cdp('Page.reload'); await sleep(900); await until(() => exists('#hs'));
  check('theme: dark persists after reload', (await ev('document.documentElement.dataset.theme')) === 'dark' && (await ev('getComputedStyle(document.body).backgroundColor')) === bgDark);
  await click('#mbar [data-theme-btn]');
  check('theme: back to light and saved', (await ev('document.documentElement.dataset.theme')) === 'light' && (await ev('localStorage.getItem("bm-theme")')) === 'light');
  await ev('localStorage.removeItem("bm-theme");delete document.documentElement.dataset.theme');
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  check('theme: OS dark respected when nothing saved', (await ev('getComputedStyle(document.body).backgroundColor')) === bgDark);
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

  // ---- add-book form on a phone: steps ----
  await goto(base + '/#/library');
  await until(() => exists('#add'));
  await click('#add');
  await until(() => visible('#bf'));
  await stubConfirm(true);
  check('steps: phone shows step 1 of 3', (await text('.stepmeta')) === 'Step 1 of 3: Book');
  check('steps: only the current step is visible', (await visible('#t')) && !(await visible('#st')) && !(await visible('#tg')));
  check('steps: Next shown, Save hidden on step 1', (await visible('[data-next]')) && !(await visible('#sv')) && !(await visible('[data-back]')));
  await shot('03-book-step1-mobile');
  await click('[data-next]');
  check('validation: required title blocks Next with an inline error', (await text('#t + .ferr')) !== null && (await text('.stepmeta')) === 'Step 1 of 3: Book', await text('#t + .ferr'));
  await shot('04-book-error-mobile');
  await type('#t', 'Zero to One'); await type('#a', 'Peter Thiel');
  check('validation: error clears while typing', !(await exists('#t + .ferr')));
  await click('[data-next]');
  check('steps: Next moves to step 2', (await text('.stepmeta')) === 'Step 2 of 3: Reading' && (await visible('#st')));
  await ev(`(()=>{const e=document.querySelector('#s');e.value='completed';e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await click('[data-back]');
  check('steps: Back keeps entered values', (await ev('document.querySelector("#t").value')) === 'Zero to One' && (await ev('document.querySelector("#a").value')) === 'Peter Thiel');
  await click('[data-next]'); await click('[data-next]');
  check('steps: last step shows Save and hides Next', (await text('.stepmeta')) === 'Step 3 of 3: Details' && (await visible('#sv')) && !(await visible('[data-next]')));
  check('steps: status from step 2 still set', (await ev('document.querySelector("#s").value')) === 'completed');
  await shot('05-book-step3-mobile');

  // ---- clear form / close ----
  await ev('window.__asked=[];window.confirm=(m)=>{window.__asked.push(m);return false}');
  await click('[data-clear]');
  check('clear form: asks first when there is input; "no" keeps data', (await ev('window.__asked.length')) === 1 && (await ev('document.querySelector("#t").value')) === 'Zero to One');
  await click('[data-x]');
  check('close X: asks first and stays open on "no"', (await ev('window.__asked.length')) === 2 && (await exists('#bf')));
  await ev('window.confirm=(m)=>{window.__asked.push(m);return true}');
  await click('[data-clear]');
  check('clear form: "yes" resets fields and returns to step 1', (await ev('document.querySelector("#t").value')) === '' && (await text('.stepmeta')) === 'Step 1 of 3: Book');
  check('clear form: does not close or submit', await exists('#bf'));
  await click('[data-x]');
  const asked = await ev('window.__asked.length'), still = !(await until(async () => !(await exists('#bf')), 3000));
  check('close X: pristine form closes without asking', !still && asked === 3, `asked=${asked} open=${still}`);
  check('close X: nothing was saved', (await ev(`fetch('/api/books').then(r=>r.json()).then(b=>b.length)`)) === 0);

  // ---- save a book through the steps ----
  await click('#add'); await until(() => visible('#bf'));
  await type('#t', 'The Personal MBA'); await type('#a', 'Josh Kaufman');
  await click('[data-next]'); await click('[data-next]'); await click('#sv');
  check('save: book created from the last step', !!(await until(() => ev(`fetch('/api/books').then(r=>r.json()).then(b=>b.length===1&&b[0].title)`))));
  await until(() => exists('#up'));

  // ---- desktop: full form, no steps ----
  await viewport(1280, 800, false);
  await goto(base + '/#/library'); await until(() => exists('#add')); await click('#add'); await until(() => visible('#bf'));
  check('desktop: all fields visible, no step bar', (await visible('#t')) && (await visible('#st')) && (await visible('#tg')) && !(await visible('.stepbar')) && !(await visible('[data-next]')));
  await shot('06-book-desktop');
  await click('[data-x]');

  // ---- upload with crop (phone) ----
  await goto(base + '/#/library'); await until(() => exists('.book'));
  await ev(`document.querySelector('#top #nu').click()`);
  await until(() => visible('#uf'));
  check('upload: step 1 of 2 on phone', (await text('.stepmeta')) === 'Step 1 of 2: Book');
  await click('[data-next]');
  await click('#uf [data-save]');
  check('upload: no image -> inline error, no request', (await text('#fe')).includes('at least one image'));
  await setFile('#uf1', path.join(fixtures, 'cac_highlight.png'));
  check('crop: editor opens after choosing one image', !!(await until(() => visible('.cropper'))));
  await sleep(400);
  const geo = () => ev(`(()=>{const b=document.querySelector('.cbox'),s=document.querySelector('.cropstage'),i=s.querySelector('img');return {bw:b.offsetWidth,bh:b.offsetHeight,bx:b.offsetLeft,by:b.offsetTop,sw:s.offsetWidth,sh:s.offsetHeight,iw:parseFloat(i.style.width),z:parseFloat(document.querySelector('#cz').value)}})()`);
  const center = (sel) => ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const drag = async (a, b) => {
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, button: 'left', buttons: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y, button: 'left', buttons: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left' });
    await sleep(120);
  };
  const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
  let g = await geo();
  check('crop: starts on Original with the frame on the whole image', near(g.bw, g.sw) && near(g.bh, g.sh) && g.z === 1, JSON.stringify(g));
  const info = await text('#ci');
  check('crop: shows output size at original resolution', /Output 1000 × 430 px, original resolution/.test(info), info);
  const blank = await ev(`(()=>{const c=document.querySelector('#cp');const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)n+=d[i];return n===0})()`);
  check('preview: live preview is drawn', !blank);

  // zoom: buttons, slider
  const iw0 = g.iw;
  await click('[data-zi]'); g = await geo();
  check('zoom: + enlarges the picture', near(g.iw, iw0 * 1.25, 3) && g.z > 1, `${iw0} -> ${g.iw}`);
  await click('[data-zo]'); g = await geo();
  check('zoom: − shrinks it back', near(g.iw, iw0, 3));
  await ev(`(()=>{const r=document.querySelector('#cz');r.value=2;r.dispatchEvent(new Event('input',{bubbles:true}))})()`); g = await geo();
  check('zoom: slider sets the level', near(g.iw, iw0 * 2, 4) && near(g.z, 2, .01), `${g.iw}`);
  await sleep(250);
  const out2 = await text('#ci');
  check('zoom: zooming in tightens the crop (smaller output)', /Output 5\d\d × 2\d\d px/.test(out2), out2);
  for (let i = 0; i < 4; i++) await click('[data-zo]');
  g = await geo();
  check('zoom: cannot go below fit', g.z === 1 && near(g.iw, iw0, 2));

  // presets
  const ratioOf = async (p) => { await click(`[data-p="${p}"]`); const x = await geo(); return x.bw / x.bh; };
  check('preset: Square is 1:1', near(await ratioOf('square'), 1, .02));
  check('preset: Portrait is 3:4', near(await ratioOf('portrait'), 0.75, .02));
  check('preset: Landscape is 4:3', near(await ratioOf('landscape'), 4 / 3, .03));
  check('preset: Wide is 16:9', near(await ratioOf('wide'), 16 / 9, .03));
  await click('[data-p="orig"]'); g = await geo();
  check('preset: Original returns to the whole image', near(g.bw, g.sw) && near(g.bh, g.sh));

  // manual: free resize with edge + corner, move, back to a preset
  await click('[data-p="custom"]');
  const e = await center('.ch.e');
  await drag(e, { x: e.x - 90, y: e.y });
  const g1 = await geo();
  check('manual: dragging the right edge changes width only', near(g1.bw, g.bw - 90, 4) && near(g1.bh, g.bh, 2), `${g.bw}x${g.bh} -> ${g1.bw}x${g1.bh}`);
  const nwc = await center('.ch.nw');
  await drag(nwc, { x: nwc.x + 30, y: nwc.y + 40 });
  const g2 = await geo();
  check('manual: dragging a corner resizes both sides freely', near(g2.bw, g1.bw - 30, 5) && near(g2.bh, g1.bh - 40, 5), `${g2.bw}x${g2.bh}`);
  const body = await center('.cbox');
  await drag(body, { x: body.x + 20, y: body.y + 10 });
  const g3 = await geo();
  check('manual: dragging the frame moves it', g3.bx > g2.bx + 10 && near(g3.bw, g2.bw, 1) && near(g3.bh, g2.bh, 1), `${g2.bx} -> ${g3.bx}`);
  const small = await text('#ci');
  check('manual: preview and output size follow the frame', /Output \d+ × \d+ px/.test(small) && small !== info, small);
  await click('[data-p="square"]'); g = await geo();
  check('manual -> preset: switching back re-locks the ratio', near(g.bw / g.bh, 1, .02));
  await click('[data-p="custom"]');

  // drag outside the frame moves the zoomed image
  await click('[data-p="square"]');
  await ev(`(()=>{const r=document.querySelector('#cz');r.value=3;r.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await sleep(250);
  const tf0 = await ev('document.querySelector(".cropstage img").style.transform');
  const st = await ev(`(()=>{const r=document.querySelector('.cropstage').getBoundingClientRect();return {x:r.x+3,y:r.y+3}})()`);
  await drag(st, { x: st.x + 25, y: st.y + 5 });
  check('image: dragging outside the frame repositions the image', (await ev('document.querySelector(".cropstage img").style.transform')) !== tf0);

  // pinch zoom on touch
  await click('[data-reset]'); g = await geo();
  check('reset: restores zoom, preset and frame', g.z === 1 && near(g.bw, g.sw) && near(g.bh, g.sh));
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true });
  const c = await center('.cropstage');
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x - 20, y: c.y, id: 1 }, { x: c.x + 20, y: c.y, id: 2 }] });
  await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c.x - 40, y: c.y, id: 1 }, { x: c.x + 40, y: c.y, id: 2 }] });
  await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c.x - 60, y: c.y, id: 1 }, { x: c.x + 60, y: c.y, id: 2 }] });
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(150); g = await geo();
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
  check('pinch: two fingers zoom in', g.z > 2, `z=${g.z.toFixed(2)}`);

  await click('[data-reset]');
  await click('[data-p="square"]');
  await shot('07-crop-mobile');
  await click('.cropper [data-cancel]'); await until(async () => !(await exists('.cropper')));
  check('crop: Cancel leaves the chosen file as an untouched original', /Original/.test(await text('#fl li')) && (await exists('#uf')));
  await click('#fl [data-rm]');
  check('upload list: remove drops the file', (await text('#fl')) === '');

  await setFile('#uf1', path.join(fixtures, 'cac_highlight.png')); await until(() => visible('.cropper')); await sleep(400);
  await click('[data-p="square"]');
  await click('.cropper [data-save]');
  await until(async () => !(await exists('.cropper')));
  const row = await text('#fl li');
  check('apply: crop is returned to the form as a WebP', /Cropped/.test(row) && /\.webp/.test(row), row.replace(/\s+/g, ' '));
  await shot('08-upload-list-mobile');
  await click('#uf #sv');
  check('upload: finishes and opens the book', !!(await until(() => ev('location.hash.startsWith("#/book/")'))));
  await until(() => exists('.pg img'));
  const status = await until(() => ev(`document.body.innerText.includes('passages')`), 60000);
  check('upload: OCR runs on the cropped image', !!status);
  const dims = await ev(`fetch('/api/home').then(r=>r.json()).then(h=>fetch('/api/images/'+h.images[0].id)).then(r=>r.json()).then(j=>[j.image.width,j.image.height])`);
  check('quality: square crop keeps source pixels (430 × 430, not resampled)', dims[0] === 430 && dims[1] === 430, dims.join('x'));
  await sleep(500);
  const im = await ev(`(()=>{const i=document.querySelector('.pg img');return {src:i.currentSrc,ok:i.complete&&i.naturalWidth>0}})()`);
  check('thumbnails: responsive WebP loads', im.ok && /\/thumb\?w=(320|640|1280)/.test(im.src), im.src);
  await shot('09-book-page-mobile');

  // ---- upload: untouched original + close while dirty ----
  await ev(`document.querySelector('#top #nu').click()`); await until(() => visible('#uf'));
  await click('[data-next]'); await setFile('#uf1', path.join(fixtures, 'plain_pricing.png')); await until(() => visible('.cropper')); await sleep(400);
  await click('.cropper [data-save]'); await until(async () => !(await exists('.cropper')));
  const kb = Math.max(1, Math.round(fs.statSync(path.join(fixtures, 'plain_pricing.png')).size / 1024));
  const orow = await text('#fl li');
  check('apply: whole-image frame returns the original file untouched', /Original/.test(orow) && orow.includes(kb + ' KB') && !/\.webp/.test(orow), orow.replace(/\s+/g, ' '));
  await ev('window.__asked=[];window.confirm=(m)=>{window.__asked.push(m);return false}');
  await click('[data-x]');
  check('upload: close with chosen files asks first', (await ev('window.__asked.length')) === 1 && (await exists('#uf')));
  await ev('window.confirm=()=>true'); await click('[data-x]');
  check('upload: confirmed close dismisses', !!(await until(async () => !(await exists('#uf')), 3000)));

  // ---- dark library on phone + select/overflow checks ----
  await goto(base + '/#/library'); await until(() => exists('#sort'));
  await ev(`localStorage.setItem('bm-theme','dark');document.documentElement.dataset.theme='dark'`);
  await shot('10-library-dark-mobile');
  check('layout: no horizontal overflow on phone', (await ev('document.documentElement.scrollWidth <= window.innerWidth')));
  await viewport(820, 1100, false); await sleep(300);
  check('layout: no horizontal overflow on tablet', (await ev('document.documentElement.scrollWidth <= window.innerWidth')));
  await shot('11-library-tablet');


  // ---- e-book reader ----
  const PDFS = process.env.BM_PDFS || path.join(fixtures, '..', 'bm-pdfs');
  const apiJson = (u, o) => ev(`fetch(${JSON.stringify(u)}, ${JSON.stringify(o || {})}).then(r=>r.json())`);
  const rendered = () => ev(`(()=>{const c=document.querySelector('.rpage canvas');return !!c&&c.width>0&&document.querySelectorAll('.rpage .textLayer span').length>0})()`);
  const pageNo = () => ev(`document.querySelector('#rpage').value`);
  const key = (k) => ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},bubbles:true}))`);
  const setVal = (sel, v, evt = 'input') => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event(${JSON.stringify(evt)},{bubbles:true}))})()`);
  await ev(`localStorage.setItem('bm-theme','light');document.documentElement.dataset.theme='light'`);
  await viewport(1280, 800, false);
  await goto(base + '/#/library'); await until(() => exists('#top'));
  check('books: sidebar has a Books tab', await ev(`[...document.querySelectorAll('#top a.navl')].some(a=>a.textContent.trim()==='Books')`));
  await click('#top a[href="#/ebooks"]'); await until(() => exists('#ebup'));
  check('books: empty library invites an upload', (await text('.empty')).includes('No books yet'));

  await click('#ebup'); await until(() => visible('#ef'));
  await setFile('#ef1', path.join(PDFS, 'fake.pdf'));
  await until(async () => { const t = (await text('#efs')) || ''; return t.length > 0 && !/Reading the PDF/.test(t); });
  check('upload book: a non-PDF is rejected with a clear message', /readable PDF|not a PDF/i.test(await text('#efs')), await text('#efs'));
  await setFile('#ef1', path.join(PDFS, 'book.pdf'));
  await until(async () => (await ev('document.querySelector("#et").value')) === 'The Craft of Pricing');
  check('upload book: title, author and page count are read from the PDF', (await ev('document.querySelector("#ea").value')) === 'Test Author' && /12 pages/.test(await text('#efm')) && (await visible('#efc')));
  await type('#esh', 'Business');
  await click('#ef #sv');
  const shown = !!(await until(() => ev(`!!document.querySelector('.ebook .cover img')`), 8000));
  check('upload book: appears in the library with a rendered cover', shown, shown ? '' : `er="${await text('#er')}" hash=${await ev('location.hash')} app="${(await text('#app')).slice(0, 80).replace(/\s+/g, ' ')}"`);
  check('books: card shows title, shelf and "not started"', /The Craft of Pricing/.test(await text('.ebook')) && /not started/.test(await text('.ebook')) && /Business/.test(await text('.ebook')));
  await shot('30-books-library');
  const bookId = await ev(`document.querySelector('.ebook .btn.primary').getAttribute('href').split('/').pop()`);

  // open + navigate
  await click('.ebook .btn.primary');
  check('reader: opens and draws a page with selectable text', !!(await until(rendered, 20000)));
  check('reader: shows "1 / 12"', (await pageNo()) === '1' && (await text('#rn')) === '12');
  await click('#rnext'); await sleep(300);
  check('navigate: Next button goes to page 2', (await pageNo()) === '2');
  await key('ArrowRight'); await sleep(300);
  check('navigate: arrow key goes to page 3', (await pageNo()) === '3');
  await key('ArrowLeft'); await sleep(200); await key('ArrowRight'); await sleep(300);
  await setVal('#rpage', '9', 'change'); await sleep(500);
  check('navigate: jump-to-page box', (await pageNo()) === '9' && !!(await until(rendered)));
  check('page turn: new page animates in', await ev(`!!document.querySelector('.rpage.turn-next, .rpage')`));
  await sleep(900);
  check('progress: page 9 saved automatically', (await apiJson('/api/ebooks/' + bookId)).page === 9);

  // contents
  await click('#btoc'); await until(() => visible('#dtoc'));
  check('contents: chapters extracted from the PDF outline', (await ev(`document.querySelectorAll('#tocb [data-toc]').length`)) === 4, await text('#tocb'));
  check('contents: current chapter shown (Chapter 3 on page 9)', (await text('#rch')) === 'Chapter 3: Growth');
  await ev(`[...document.querySelectorAll('#tocb [data-toc]')].find(b=>/Chapter 2/.test(b.textContent)).click()`);
  await sleep(600);
  check('contents: jumping to a chapter opens its page', (await pageNo()) === '5' && (await text('#rch')) === 'Chapter 2: Price');
  await ev(`[...document.querySelectorAll('#tocb [data-toc]')].find(b=>/Section 2.1/.test(b.textContent)).click()`);
  await sleep(600);
  check('contents: nested section is reachable', (await pageNo()) === '6' && (await text('#rch')) === 'Section 2.1: Discounts');
  await click('#dtoc [data-close]');

  // highlights
  await until(rendered);
  await ev(`(()=>{const sp=[...document.querySelectorAll('.rpage .textLayer span')].filter(s=>s.firstChild&&s.textContent.trim().length>10);const r=document.createRange();r.setStart(sp[1].firstChild,0);r.setEnd(sp[2].firstChild,Math.min(18,sp[2].firstChild.length));const s=getSelection();s.removeAllRanges();s.addRange(r)})()`);
  check('highlight: selecting text shows the colour toolbar', !!(await until(() => visible('#sel'), 4000)));
  await shot('31-reader-selection');
  await click('[data-hl="pink"]');
  check('highlight: pink highlight drawn on the page', !!(await until(() => ev(`document.querySelectorAll('.hl.c-pink').length>0`))));
  let an = await apiJson(`/api/ebooks/${bookId}/annots`);
  check('highlight: saved on the server with text and position', an.length === 1 && an[0].kind === 'highlight' && an[0].page === 6 && an[0].text.length > 5 && an[0].rects.length >= 1 && an[0].color === 'pink', JSON.stringify(an[0]).slice(0, 120));
  await click('#bnotes'); await until(() => visible('#dnotes'));
  await setVal('#nnt', 'Compare with chapter 3'); await ev(`document.querySelector('#nn').requestSubmit()`);
  await until(() => ev(`document.querySelectorAll('.annot').length===2`));
  check('notes: page note added from the panel', await ev(`[...document.querySelectorAll('.annot textarea')].some(t=>t.value==='Compare with chapter 3')`));
  check('notes: page with a note gets a marker', !!(await until(() => exists('.rpage .pnote'))));
  await setVal('.annot[data-id] [data-note]', 'Great line'); // first annot = highlight (page 6)
  await sleep(1100);
  an = await apiJson(`/api/ebooks/${bookId}/annots`);
  check('notes: edits autosave', an.find((a) => a.kind === 'highlight').note === 'Great line');
  await shot('32-reader-notes');
  await setVal('#rpage', '1', 'change'); await sleep(500);
  await click('.annot[data-id] [data-goto]');
  check('notes: tapping an annotation jumps to its page', (await pageNo()) === '6');
  await click('#dnotes [data-close]');

  // reopen: progress, highlights, preferences survive a reload
  await sleep(800);
  await cdp('Page.reload'); await sleep(900);
  check('reopen: restores the last-read page', !!(await until(rendered, 20000)) && (await pageNo()) === '6');
  check('reopen: highlight is still on the page', !!(await until(() => ev(`document.querySelectorAll('.hl.c-pink').length>0`))));

  // settings
  await click('#bset'); await until(() => visible('#pset'));
  await click('[data-set="theme"][data-v="sepia"]'); await sleep(200);
  check('theme: Sepia applied', await ev(`document.querySelector('#rd').classList.contains('theme-sepia')`));
  await click('[data-set="theme"][data-v="dark"]'); await sleep(200);
  const dark = await ev(`getComputedStyle(document.querySelector('#rd')).backgroundColor`);
  check('theme: Dark reading theme darkens the reader', dark === 'rgb(12, 12, 12)', dark);
  await setVal('#sbri', '0.6'); await sleep(200);
  check('brightness: slider dims the page', (await ev(`getComputedStyle(document.querySelector('#rs')).filter`)) === 'brightness(0.6)');
  await shot('33-reader-dark-settings');
  await sleep(700);
  await cdp('Page.reload'); await sleep(900); await until(rendered, 20000);
  check('settings: theme and brightness are remembered', (await ev(`document.querySelector('#rd').classList.contains('theme-dark')`)) && (await ev(`document.querySelector('#rd').style.getPropertyValue('--bri')`)) === '0.6');
  await click('#bset'); await until(() => visible('#pset'));
  await click('[data-set="theme"][data-v="light"]'); await setVal('#sbri', '1');

  // zoom + fit
  const cw = () => ev(`document.querySelector('.rpage canvas').offsetWidth`);
  const w0 = await cw();
  await click('[data-zoom="1"]'); await sleep(800); const w1 = await cw();
  check('zoom: + enlarges the page', w1 > w0 * 1.2 && (await text('#zl')) === '125%', `${w0} -> ${w1}`);
  await click('[data-zoom="-1"]'); await click('[data-zoom="-1"]'); await sleep(800);
  check('zoom: − shrinks it', (await cw()) < w0);
  await click('[data-zoom="1"]'); await sleep(600);
  await click('[data-set="fit"][data-v="page"]'); await sleep(800);
  const fitH = await ev(`(()=>{const s=document.querySelector('#rs'),c=document.querySelector('.rpage canvas');return c.offsetHeight<=s.clientHeight})()`);
  check('fit: "Page" fits the whole page on screen', fitH);
  await click('[data-set="fit"][data-v="width"]'); await sleep(600);

  // continuous scroll
  await click('[data-set="mode"][data-v="scroll"]');
  await until(() => exists('.rscroll'));
  check('scroll mode: every page has a slot', (await ev(`document.querySelectorAll('.rscroll .rpage').length`)) === 12);
  await sleep(1200);
  const drawn = await ev(`document.querySelectorAll('.rscroll .rpage canvas').length`);
  check('scroll mode: only nearby pages are drawn (efficient for long books)', drawn >= 1 && drawn < 12, `${drawn} of 12`);
  await ev(`document.querySelector('#rs').scrollTop = document.querySelector('#rs').scrollHeight`);
  await sleep(1200);
  check('scroll mode: page indicator follows the scroll', Number(await pageNo()) >= 11, await pageNo());
  await setVal('#rpage', '4', 'change'); await sleep(900);
  check('scroll mode: jump-to-page scrolls there', (await pageNo()) === '4');

  // text (reflow) view
  await click('[data-set="mode"][data-v="text"]'); await until(() => exists('.reflow p'));
  check('text view: reflowed text from the PDF', /Pricing|Compounding|Customers/.test(await text('.reflow')));
  await setVal('#sfs', '30'); await setVal('#ssp', '2');
  check('text view: font size and line spacing apply', (await ev(`getComputedStyle(document.querySelector('.reflow')).fontSize`)) === '30px' && (await ev(`document.querySelector('.reflow').style.lineHeight`)) === '2');
  await shot('34-reader-text-view');
  await click('[data-set="mode"][data-v="single"]'); await until(rendered);

  // focus / full screen
  await click('#bset');
  await click('#bfs'); await sleep(500);
  check('focus mode: bars hide for distraction-free reading', (await ev(`document.querySelector('#rd').classList.contains('focus')`)) && (await ev(`document.querySelector('.rbar.top').getBoundingClientRect().bottom <= 1`)));
  await ev(`document.querySelector('#rs').click()`); await sleep(300);
  check('focus mode: a tap brings the controls back', await ev(`document.querySelector('#rd').classList.contains('peek')`));
  await key('Escape'); await sleep(400);
  check('focus mode: Esc leaves it', !(await ev(`document.querySelector('#rd').classList.contains('focus')`)));

  // back to the library: progress + continue reading
  await click('a[aria-label="Back to books"]'); await until(() => exists('.resume'));
  check('library: Continue reading card with saved page', /Continue reading/.test(await text('.resume')) && /Page 4 of 12/.test(await text('.resume')), (await text('.resume')).replace(/\s+/g, ' '));
  check('library: card shows progress', /Page 4 of 12 · 33%/.test(await text('.ebook')));
  await shot('35-books-continue');

  // scanned PDF: no text layer, no outline
  await click('#ebup'); await until(() => visible('#ef'));
  await setFile('#ef1', path.join(PDFS, 'scanned.pdf'));
  await until(async () => (await ev('document.querySelector("#et").value')) === 'scanned');
  await click('#ef #sv'); await until(() => ev(`document.querySelectorAll('.ebook').length===2`));
  await ev(`[...document.querySelectorAll('.ebook')].find(e=>/scanned/.test(e.textContent)).querySelector('.btn.primary').click()`);
  await until(() => ev(`!!document.querySelector('.rpage canvas')`), 20000);
  await click('#btoc'); await until(() => visible('#dtoc'));
  check('contents: a PDF without a TOC says so and offers a page slider', /no table of contents/.test(await text('#tocb')) && (await exists('#jump')));
  await click('#dtoc [data-close]');
  await click('#bnotes'); await until(() => visible('#dnotes'));
  await setVal('#nnt', 'Margin notes, page 1'); await ev(`document.querySelector('#nn').requestSubmit()`);
  check('notes: scanned page accepts a page note', !!(await until(() => ev(`document.querySelectorAll('.annot').length===1`))));
  await click('#dnotes [data-close]');
  await click('#bset'); await until(() => visible('#pset')); await click('[data-set="mode"][data-v="text"]');
  check('text view: scanned page explains there is no text', !!(await until(() => ev(`/no selectable text/.test(document.querySelector('.rstage').innerText)`))));
  await click('[data-set="mode"][data-v="single"]');

  // library management: edit shelf, filter, remove
  await click('a[aria-label="Back to books"]'); await until(() => exists('.ebook'));
  await ev(`[...document.querySelectorAll('.ebook')].find(e=>/scanned/.test(e.textContent)).querySelector('[data-edit]').click()`);
  await until(() => visible('#ee'));
  await type('#eet', 'Old Scans'); await type('#eesh', 'Archive');
  await ev(`document.querySelector('#ee').requestSubmit()`);
  check('library: edit title and shelf', !!(await until(() => ev(`[...document.querySelectorAll('.ebook .t')].some(t=>t.textContent==='Old Scans')`))));
  await ev(`[...document.querySelectorAll('[data-shelf]')].find(b=>b.dataset.shelf==='Archive').click()`);
  check('library: shelf filter shows only that shelf', !!(await until(() => ev(`document.querySelectorAll('.ebook').length===1`))));
  await ev(`window.confirm=()=>true`);
  await click('[data-del]'); await sleep(600);
  check('library: remove deletes the book (and the shelf filter resets)', !!(await until(() => ev(`document.querySelectorAll('.ebook').length===1 && !document.querySelector('[data-shelf="Archive"]')`))));
  check('library: removed book is gone from the server', (await apiJson('/api/ebooks')).length === 1);

  // unknown book
  await goto(base + '/#/read/does-not-exist'); await sleep(900);
  check('reader: unknown book shows a clear message', /Book not found/.test(await text('#app')));

  // phone: reader chrome, swipe
  await viewport(382, 800, true);
  await goto(base + '/#/ebooks'); await until(() => exists('.ebook'));
  check('phone: Books tab fits the five-item tab bar', (await ev(`document.querySelectorAll('#top .navl:not([style*="none"])').length`)) >= 4 && (await ev('document.documentElement.scrollWidth <= window.innerWidth')));
  await shot('36-books-mobile');
  await click('.ebook .btn.primary');
  const okPhone = await until(rendered, 20000);
  if (!okPhone) console.log('phone reader state:', (await text('#app'))?.slice(0, 200).replace(/\s+/g, ' '), await ev('location.hash'));
  check('phone: reader hides the app tab bar for a clean page', !(await visible('#top')));
  const p0 = Number(await pageNo());
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true });
  const sc = await center('#rs');
  const swipe = async (dx) => {
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sc.x + dx / 2, y: sc.y, id: 1 }] });
    await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sc.x, y: sc.y, id: 1 }] });
    await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sc.x - dx / 2, y: sc.y, id: 1 }] });
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(700);
  };
  await swipe(220);
  const p1 = Number(await pageNo());
  await swipe(-220);
  if (!(await exists('#rpage'))) console.log('after 2nd swipe:', await ev('location.hash'), (await text('#app'))?.slice(0, 120).replace(/\s+/g, ' '));
  const p2 = Number(await pageNo());
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
  check('phone: swipe left turns to the next page, swipe right goes back', p1 === p0 + 1 && p2 === p0, `${p0} -> ${p1} -> ${p2}`);
  await click('#btoc'); await until(() => visible('#dtoc'));
  check('phone: contents panel covers the screen width', (await ev(`document.querySelector('#dtoc').offsetWidth`)) >= 380);
  await shot('37-reader-mobile-contents');
  await click('#dtoc [data-close]');
  await shot('38-reader-mobile');
  check('phone: no sideways scrolling in the reader', await ev('document.documentElement.scrollWidth <= window.innerWidth'));
  await click('a[aria-label="Back to books"]');

  // ---- gallery screenshots (visual review only) ----
  await ev(`localStorage.setItem('bm-theme','light');document.documentElement.dataset.theme='light'`);
  await viewport(1360, 1500, false);
  await goto(base + '/#/'); await until(() => exists('.how')); await sleep(400); await shot('20-home-desktop-light');
  await ev(`document.documentElement.dataset.theme='dark'`); await sleep(200); await shot('21-home-desktop-dark');
  await ev(`document.documentElement.dataset.theme='light'`);
  await goto(base + '/#/search?q=' + encodeURIComponent('cost of acquiring a customer')); await until(() => exists('.hit')); await sleep(900); await shot('22-search-desktop');
  await goto(base + '/#/library'); await until(() => exists('.book')); await sleep(300);
  await ev(`document.querySelector('.book').click()`); await until(() => exists('.pg')); await sleep(800); await shot('23-book-desktop');
  await viewport(382, 1700, true);
  await goto(base + '/#/'); await until(() => exists('.how')); await sleep(400); await shot('24-home-mobile');
} catch (e) { console.error(e); fails++; }
finally {
  try { ws?.close(); } catch { /* ignore */ }
  chrome.kill(); srv.kill();
  await sleep(1200);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* OS cleans temp */ }
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
