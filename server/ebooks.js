// E-book reader API: PDF upload, library, reading progress, highlights/notes, reader preferences.
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, UPLOAD_DIR } from './db.js';
import { requireUser } from './auth.js';
import { ok, bad, rm } from './util.js';
const COLORS = ['amber', 'pink', 'lime', 'sky'];
const MAX_PDF = 200 * 1024 * 1024;

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _f, cb) => {
      const dir = path.join(UPLOAD_DIR, req.user.id, 'ebooks');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_r, file, cb) => cb(null, crypto.randomUUID() + (file.fieldname === 'file' ? '.pdf' : '.jpg')),
  }),
  limits: { fileSize: MAX_PDF, files: 2 },
  fileFilter: (_r, file, cb) => cb(null, file.fieldname === 'file' ? file.mimetype === 'application/pdf' : file.fieldname === 'cover' && /^image\//.test(file.mimetype)),
});
const fields = upload.fields([{ name: 'file', maxCount: 1 }, { name: 'cover', maxCount: 1 }]);

// A real PDF has "%PDF-" near the start. Trust the bytes, not the browser's MIME type.
const looksLikePdf = (p) => { const fd = fs.openSync(p, 'r'); const b = Buffer.alloc(1024); const n = fs.readSync(fd, b, 0, 1024, 0); fs.closeSync(fd); return b.subarray(0, n).includes('%PDF-'); };

const own = (id, uid) => db.prepare('SELECT * FROM ebooks WHERE id = ? AND user_id = ?').get(id, uid);
const out = (b) => ({
  id: b.id, title: b.title, author: b.author, shelf: b.shelf, pages: b.pages, page: b.page, size: b.size,
  progress: b.pages ? Math.min(100, Math.round((b.page / b.pages) * 100)) : 0,
  cover: b.cover_path ? `/api/ebooks/${b.id}/cover` : null, lastReadAt: b.last_read_at, createdAt: b.created_at,
});
const int = (v, lo, hi) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };
const clean = (s, max) => (typeof s === 'string' ? s.trim().slice(0, max) : '');

const PREF_RULES = {
  mode: (v) => ['single', 'scroll', 'text'].includes(v) && v,
  fit: (v) => ['width', 'page'].includes(v) && v,
  theme: (v) => ['light', 'sepia', 'dark'].includes(v) && v,
  zoom: (v) => Number.isFinite(v) && Math.min(4, Math.max(0.5, v)),
  brightness: (v) => Number.isFinite(v) && Math.min(1.2, Math.max(0.4, v)),
  fontSize: (v) => Number.isFinite(v) && Math.min(40, Math.max(12, v)),
  spacing: (v) => Number.isFinite(v) && Math.min(2.4, Math.max(1.2, v)),
};

export function ebookRoutes(app) {
  app.get('/api/ebooks', requireUser, (req, res) => {
    const order = { title: 'LOWER(title)', author: 'LOWER(author)', progress: '(CAST(page AS REAL) / MAX(pages,1)) DESC', added: 'created_at DESC' }[req.query.sort]
      || 'COALESCE(last_read_at, created_at) DESC';
    ok(res, db.prepare(`SELECT * FROM ebooks WHERE user_id = ? ORDER BY ${order}, rowid DESC`).all(req.user.id).map(out));
  });

  app.post('/api/ebooks', requireUser, (req, res) => {
    fields(req, res, (err) => {
      const f = req.files?.file?.[0], c = req.files?.cover?.[0];
      const drop = () => { rm(f?.path); rm(c?.path); };
      if (err) { drop(); return bad(res, err.code === 'LIMIT_FILE_SIZE' ? 'This PDF is over 200 MB.' : err.message); }
      if (!f) { drop(); return bad(res, 'Choose a PDF file.'); }
      if (!looksLikePdf(f.path)) { drop(); return bad(res, 'That file is not a valid PDF.'); }
      const id = crypto.randomUUID();
      const title = clean(req.body.title, 300) || f.originalname.replace(/\.pdf$/i, '');
      db.prepare('INSERT INTO ebooks (id,user_id,title,author,shelf,path,cover_path,pages,size) VALUES (?,?,?,?,?,?,?,?,?)').run(
        id, req.user.id, title, clean(req.body.author, 200) || null, clean(req.body.shelf, 60) || null,
        f.path, c?.path || null, int(req.body.pages, 0, 100000) ?? 0, f.size);
      ok(res, out(own(id, req.user.id)));
    });
  });

  app.get('/api/ebooks/:id/file', requireUser, (req, res) => {
    const b = own(req.params.id, req.user.id);
    if (!b) return bad(res, 'Book not found', 404);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff' });
    res.sendFile(path.resolve(b.path)); // sendFile answers Range requests, so large PDFs stream page by page
  });
  app.get('/api/ebooks/:id/cover', requireUser, (req, res) => {
    const b = own(req.params.id, req.user.id);
    if (!b?.cover_path) return bad(res, 'No cover', 404);
    res.set('Cache-Control', 'private, max-age=86400');
    res.sendFile(path.resolve(b.cover_path));
  });
  app.get('/api/ebooks/:id', requireUser, (req, res) => {
    const b = own(req.params.id, req.user.id);
    return b ? ok(res, out(b)) : bad(res, 'Book not found', 404);
  });

  app.put('/api/ebooks/:id', requireUser, (req, res) => {
    const b = own(req.params.id, req.user.id);
    if (!b) return bad(res, 'Book not found', 404);
    const title = clean(req.body?.title, 300);
    if (!title) return bad(res, 'Title is required');
    db.prepare('UPDATE ebooks SET title = ?, author = ?, shelf = ? WHERE id = ?').run(title, clean(req.body.author, 200) || null, clean(req.body.shelf, 60) || null, b.id);
    ok(res, out(own(b.id, req.user.id)));
  });

  app.put('/api/ebooks/:id/progress', requireUser, (req, res) => {
    const b = own(req.params.id, req.user.id);
    if (!b) return bad(res, 'Book not found', 404);
    const pages = b.pages || int(req.body?.pages, 1, 100000) || 0;
    const page = int(req.body?.page, 1, pages || 100000);
    if (page === null) return bad(res, 'Invalid page');
    db.prepare("UPDATE ebooks SET page = ?, pages = ?, last_read_at = datetime('now') WHERE id = ?").run(page, pages, b.id);
    ok(res);
  });

  app.delete('/api/ebooks/:id', requireUser, (req, res) => {
    const b = own(req.params.id, req.user.id);
    if (!b) return bad(res, 'Book not found', 404);
    db.prepare('DELETE FROM ebooks WHERE id = ?').run(b.id); // annotations go with it (ON DELETE CASCADE)
    rm(b.path); rm(b.cover_path);
    ok(res);
  });

  // ---- highlights and notes ----
  const annotOut = (a) => ({ id: a.id, page: a.page, kind: a.kind, color: a.color, text: a.text, note: a.note, rects: a.rects ? JSON.parse(a.rects) : [], createdAt: a.created_at });
  app.get('/api/ebooks/:id/annots', requireUser, (req, res) => {
    if (!own(req.params.id, req.user.id)) return bad(res, 'Book not found', 404);
    ok(res, db.prepare('SELECT * FROM ebook_annots WHERE ebook_id = ? AND user_id = ? ORDER BY page, created_at').all(req.params.id, req.user.id).map(annotOut));
  });
  app.post('/api/ebooks/:id/annots', requireUser, (req, res) => {
    const b = own(req.params.id, req.user.id);
    if (!b) return bad(res, 'Book not found', 404);
    const { kind, color, text, note, rects } = req.body || {};
    const page = int(req.body?.page, 1, b.pages || 100000);
    if (page === null || !['highlight', 'note'].includes(kind)) return bad(res, 'Invalid annotation');
    const rs = (Array.isArray(rects) ? rects : []).slice(0, 200)
      .filter((r) => r && [r.x, r.y, r.w, r.h].every((n) => Number.isFinite(n) && n >= 0 && n <= 1.5))
      .map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
    if (kind === 'highlight' && !rs.length) return bad(res, 'Select some text first');
    if (kind === 'note' && !clean(note, 5000)) return bad(res, 'Write something first');
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO ebook_annots (id,ebook_id,user_id,page,kind,color,text,note,rects) VALUES (?,?,?,?,?,?,?,?,?)').run(
      id, b.id, req.user.id, page, kind, COLORS.includes(color) ? color : 'amber', clean(text, 2000) || null, clean(note, 5000) || null, rs.length ? JSON.stringify(rs) : null);
    ok(res, annotOut(db.prepare('SELECT * FROM ebook_annots WHERE id = ?').get(id)));
  });
  app.put('/api/ebook-annots/:id', requireUser, (req, res) => {
    const a = db.prepare('SELECT * FROM ebook_annots WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!a) return bad(res, 'Annotation not found', 404);
    const note = req.body?.note === undefined ? a.note : clean(req.body.note, 5000) || null;
    if (a.kind === 'note' && !note) return bad(res, 'A note cannot be empty. Delete it instead.');
    const color = COLORS.includes(req.body?.color) ? req.body.color : a.color;
    db.prepare("UPDATE ebook_annots SET note = ?, color = ?, updated_at = datetime('now') WHERE id = ?").run(note, color, a.id);
    ok(res);
  });
  app.delete('/api/ebook-annots/:id', requireUser, (req, res) => {
    db.prepare('DELETE FROM ebook_annots WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    ok(res);
  });

  // ---- reader preferences (theme, brightness, mode, zoom, text size) ----
  app.get('/api/reader/prefs', requireUser, (req, res) => {
    const r = db.prepare('SELECT json FROM reader_prefs WHERE user_id = ?').get(req.user.id);
    ok(res, r ? JSON.parse(r.json) : {});
  });
  app.put('/api/reader/prefs', requireUser, (req, res) => {
    const cur = JSON.parse(db.prepare('SELECT json FROM reader_prefs WHERE user_id = ?').get(req.user.id)?.json || '{}');
    for (const [k, rule] of Object.entries(PREF_RULES)) {
      const v = rule(req.body?.[k]);
      if (v !== undefined && v !== false) cur[k] = v;
    }
    db.prepare('INSERT INTO reader_prefs (user_id, json) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json').run(req.user.id, JSON.stringify(cur));
    ok(res, cur);
  });
}
