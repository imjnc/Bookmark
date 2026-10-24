// End-to-end smoke test: boots the server on a temp data dir, registers two users,
// uploads fixture pages, waits for OCR, then checks search, marks and privacy.
// Run: python test/make-fixtures.py <dir> && node test/smoke.js <dir>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fixtures = process.argv[2];
if (!fixtures) { console.error('usage: node test/smoke.js <fixtures dir>'); process.exit(2); }
const PORT = 3411, base = `http://localhost:${PORT}`;
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmark-test-'));
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT, BOOKMARK_DATA: data, BOOKMARK_EMBEDDINGS: process.env.BOOKMARK_EMBEDDINGS || 'hash' }, stdio: 'inherit' });

let fails = 0;
const check = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!cond) fails++; };

function client() {
  let cookie = '';
  return async (p, { method = 'GET', body, form } = {}) => {
    const r = await fetch(base + p, { method, headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: form || (body ? JSON.stringify(body) : undefined) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const type = r.headers.get('content-type')?.split(';')[0];
    const buf = type?.startsWith('image/') ? Buffer.from(await r.arrayBuffer()) : null;
    return { status: r.status, type, bytes: buf?.length, json: buf ? null : await r.json().catch(() => null) };
  };
}

try {
  for (let i = 0; i < 60; i++) { try { await fetch(base + '/api/auth/me'); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  const a = client(), b = client();
  check('unauthenticated is rejected', (await client()('/api/books')).status === 401);
  await a('/api/auth/register', { method: 'POST', body: { email: 'a@test.dev', password: 'password123' } });
  await b('/api/auth/register', { method: 'POST', body: { email: 'b@test.dev', password: 'password123' } });

  const book = (await a('/api/books', { method: 'POST', body: { title: 'The Personal MBA', author: 'Josh Kaufman', status: 'reading' } })).json;
  check('book created', !!book?.id);

  const form = new FormData();
  for (const f of fs.readdirSync(fixtures).filter((f) => f.endsWith('.png'))) form.append('images', new Blob([fs.readFileSync(path.join(fixtures, f))], { type: 'image/png' }), f);
  const up = await a(`/api/books/${book.id}/images`, { method: 'POST', form });
  check('images uploaded', up.json?.images?.length >= 4, `(${up.json?.images?.length})`);

  console.log('waiting for OCR (first run downloads language data)…');
  const t0 = Date.now();
  for (;;) {
    const d = (await a(`/api/books/${book.id}`)).json;
    if (d.images.every((i) => i.status === 'done' || i.status === 'failed')) { check('all images processed', d.images.every((i) => i.status === 'done')); break; }
    if (Date.now() - t0 > 240000) { check('OCR finished in time', false); break; }
    await new Promise((r) => setTimeout(r, 2000));
  }

  const s = async (q, extra = '') => (await a('/api/search?q=' + encodeURIComponent(q) + extra)).json;
  let r = await s('costing');
  check('keyword: "costing" finds cost passages', r.results.length > 0 && /cost/i.test(r.results[0].text), r.results[0]?.text?.slice(0, 50));
  r = await s('How do companies calculate the cost of acquiring a customer?');
  check('semantic/NL: finds acquisition cost passage', /acquisition cost/i.test(r.results[0]?.text || ''), r.results[0]?.text?.slice(0, 50));
  check('result carries book + author + unknown page', r.results[0]?.title === 'The Personal MBA' && r.results[0]?.author === 'Josh Kaufman' && r.results[0]?.page === null);
  r = await s('compound interest wealth');
  check('NL: compounding passage found', /compounding/i.test(r.results[0]?.text || ''), r.results[0]?.text?.slice(0, 50));
  r = await s('pricing a product');
  check('un-highlighted page is searchable', /pricing/i.test(r.results[0]?.text || ''));
  r = await s('profit margin', '&equations=1');
  check('equation filter works', r.results.length > 0 && r.results.every((x) => x.isEquation), `(${r.results.length})`);
  r = await s('customer', '&highlighted=1');
  check('coloured highlight detected', r.results.length > 0 && r.results.every((x) => x.highlighted), `mark=${r.results[0]?.markType}`);
  r = await s('compounding patience', '&highlighted=1');
  check('underline detected', r.results.some((x) => x.markType === 'underline'), `(${r.results.length})`);
  check('privacy: other user sees nothing', (await b('/api/search?q=costing')).json.results.length === 0);
  check('privacy: other user cannot open image', (await b(`/api/images/${up.json.images[0].id}`)).status === 404);

  const imgId = up.json.images[0].id;
  const th = await a(`/api/images/${imgId}/thumb?w=300`);
  check('thumbnail served as webp, owner only', th.status === 200 && th.type === 'image/webp' && (await b(`/api/images/${imgId}/thumb?w=300`)).status === 404, th.type);
  const full = await a(`/api/images/${imgId}/thumb?w=5000`);
  check('thumbnail never upscaled (fixture is 1000px wide)', full.status === 200 && full.bytes <= (await a(`/api/images/${imgId}/file`)).bytes * 1.5);


  // ---- e-books ----
  const pdfs = process.env.BM_PDFS || path.join(fixtures, '..', 'bm-pdfs');
  const pdfForm = (name, extra = {}) => { const f = new FormData(); f.append('file', new Blob([fs.readFileSync(path.join(pdfs, name))], { type: 'application/pdf' }), name); f.append('pages', '12'); Object.entries(extra).forEach(([k, v]) => f.append(k, v)); return f; };
  const fake = await a('/api/ebooks', { method: 'POST', form: pdfForm('fake.pdf') });
  check('ebook: a fake PDF is rejected by content, not by name', fake.status === 400 && /not a valid PDF/.test(fake.json?.error), fake.json?.error);
  const eb = (await a('/api/ebooks', { method: 'POST', form: pdfForm('book.pdf', { title: 'The Craft of Pricing', author: 'Test Author', shelf: 'Business' }) })).json;
  check('ebook: valid PDF stored', !!eb?.id && eb.pages === 12 && eb.shelf === 'Business', JSON.stringify(eb));
  const file = await a(`/api/ebooks/${eb.id}/file`);
  check('ebook: file served inline to the owner', file.status === 200 && file.type === 'application/pdf');
  check('ebook: other user cannot read it', (await b(`/api/ebooks/${eb.id}/file`)).status === 404 && (await b('/api/ebooks')).json.length === 0);
  await a(`/api/ebooks/${eb.id}/progress`, { method: 'PUT', body: { page: 7 } });
  const got = (await a(`/api/ebooks/${eb.id}`)).json;
  check('ebook: progress saved (page 7 of 12 = 58%)', got.page === 7 && got.progress === 58, `${got.page} ${got.progress}`);
  check('ebook: page is clamped to the book length', ((await a(`/api/ebooks/${eb.id}/progress`, { method: 'PUT', body: { page: 99 } })), (await a(`/api/ebooks/${eb.id}`)).json.page === 12));
  const hl = (await a(`/api/ebooks/${eb.id}/annots`, { method: 'POST', body: { kind: 'highlight', page: 3, color: 'pink', text: 'Price reflects value', rects: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.03 }] } })).json;
  const nt = (await a(`/api/ebooks/${eb.id}/annots`, { method: 'POST', body: { kind: 'note', page: 4, note: 'Revisit this page' } })).json;
  check('annotations: highlight and note created', hl?.color === 'pink' && hl.rects.length === 1 && nt?.kind === 'note');
  check('annotations: empty highlight/note rejected', (await a(`/api/ebooks/${eb.id}/annots`, { method: 'POST', body: { kind: 'highlight', page: 1, rects: [] } })).status === 400 && (await a(`/api/ebooks/${eb.id}/annots`, { method: 'POST', body: { kind: 'note', page: 1, note: '  ' } })).status === 400);
  await a(`/api/ebook-annots/${nt.id}`, { method: 'PUT', body: { note: 'Edited note' } });
  const list = (await a(`/api/ebooks/${eb.id}/annots`)).json;
  check('annotations: edit saved and listed in page order', list.length === 2 && list[0].page === 3 && list[1].note === 'Edited note');
  check('annotations: other user cannot edit or list them', (await b(`/api/ebook-annots/${hl.id}`, { method: 'PUT', body: { note: 'x' } })).status === 404 && (await b(`/api/ebooks/${eb.id}/annots`)).status === 404);
  await a(`/api/reader/prefs`, { method: 'PUT', body: { theme: 'sepia', brightness: 0.8, mode: 'scroll', evil: 'x', zoom: 99 } });
  const pf = (await a('/api/reader/prefs')).json;
  check('prefs: saved, validated, unknown keys ignored', pf.theme === 'sepia' && pf.brightness === 0.8 && pf.mode === 'scroll' && !('evil' in pf) && pf.zoom === 4, JSON.stringify(pf));
  await a(`/api/ebook-annots/${nt.id}`, { method: 'DELETE' });
  check('annotations: delete', (await a(`/api/ebooks/${eb.id}/annots`)).json.length === 1);
  await a(`/api/ebooks/${eb.id}`, { method: 'DELETE' });
  check('ebook: delete removes the book and its annotations', (await a(`/api/ebooks/${eb.id}`)).status === 404 && (await a('/api/ebooks')).json.length === 0);

  const hit = (await s('acquisition cost')).results[0];
  await a(`/api/passages/${hit.id}`, { method: 'PUT', body: { text: 'Zorblax metric corrected text.' } });
  check('OCR correction re-indexes', (await s('zorblax')).results[0]?.id === hit.id);
} catch (e) { console.error(e); fails++; }
finally {
  srv.kill();
  await new Promise((r) => (srv.exitCode !== null ? r() : srv.once('exit', r)));
  try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* temp dir; OS cleans up */ }
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
