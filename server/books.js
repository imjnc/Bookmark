import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { db, DATA_DIR, UPLOAD_DIR, ftsPut, ftsDelete } from './db.js';
import { requireUser } from './auth.js';
import { enqueue, processImage } from './ocr.js';
import { lookupBooks } from './metadata.js';
import { embed, toBlob } from './embed.js';
import { ok, bad, rm } from './util.js';

const STATUSES = ['want', 'reading', 'completed'];
const THUMBS = path.join(DATA_DIR, 'thumbs');
const THUMB_W = [320, 640, 1280];
const rmThumbs = (id) => THUMB_W.forEach((w) => rm(path.join(THUMBS, `${id}-${w}.webp`)));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _f, cb) => { const dir = path.join(UPLOAD_DIR, req.user.id); fs.mkdirSync(dir, { recursive: true }); cb(null, dir); },
    filename: (_r, file, cb) => cb(null, crypto.randomUUID() + (path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.jpg')),
  }),
  limits: { fileSize: 30 * 1024 * 1024, files: 40 },
  fileFilter: (_r, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

const ownBook = (id, uid) => db.prepare('SELECT * FROM books WHERE id = ? AND user_id = ?').get(id, uid);
const ensureBook = (id, uid) => ownBook(id, uid) || (process.env.VERCEL ? (db.prepare("INSERT OR IGNORE INTO books (id, user_id, title) VALUES (?, ?, 'My Book')").run(id, uid), ownBook(id, uid)) : null);
const ownImage = (id, uid) => db.prepare('SELECT * FROM images WHERE id = ? AND user_id = ?').get(id, uid);
const ownPassage = (id, uid) => db.prepare('SELECT * FROM passages WHERE id = ? AND user_id = ?').get(id, uid);

const bookOut = (b) => ({
  id: b.id, title: b.title, author: b.author, isbn: b.isbn, status: b.status,
  startedOn: b.started_on, completedOn: b.completed_on, notes: b.notes,
  tags: b.tags ? b.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
  cover: b.cover_path ? `/api/books/${b.id}/cover` : b.cover_url || null,
  createdAt: b.created_at, imageCount: b.image_count ?? undefined,
});

function bookFields(body) {
  const status = STATUSES.includes(body.status) ? body.status : 'want';
  const tags = Array.isArray(body.tags) ? body.tags.join(',') : String(body.tags || '');
  return {
    title: String(body.title || '').trim(), author: String(body.author || '').trim() || null,
    isbn: String(body.isbn || '').trim() || null, status,
    started_on: body.startedOn || null, completed_on: body.completedOn || null,
    notes: String(body.notes || '').trim() || null,
    tags: tags.split(',').map((t) => t.trim()).filter(Boolean).join(','),
    cover_url: /^https:\/\/covers\.openlibrary\.org\//.test(body.coverUrl || '') ? body.coverUrl : null,
  };
}

export function bookRoutes(app) {
  // ---------- home ----------
  app.get('/api/home', requireUser, (req, res) => {
    const u = req.user.id;
    ok(res, {
      books: db.prepare(`SELECT b.*, (SELECT COUNT(*) FROM images i WHERE i.book_id = b.id) AS image_count FROM books b WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 8`).all(u).map(bookOut),
      images: db.prepare(`SELECT i.id, i.status, i.page_number AS page, i.created_at AS createdAt, b.title, b.author, b.id AS bookId FROM images i JOIN books b ON b.id = i.book_id WHERE i.user_id = ? ORDER BY i.created_at DESC, i.rowid DESC LIMIT 10`).all(u),
      searches: db.prepare('SELECT query FROM searches WHERE user_id = ? ORDER BY id DESC LIMIT 8').all(u).map((r) => r.query),
      totals: db.prepare(`SELECT (SELECT COUNT(*) FROM books WHERE user_id = ?) AS books, (SELECT COUNT(*) FROM images WHERE user_id = ?) AS images, (SELECT COUNT(*) FROM passages WHERE user_id = ?) AS passages`).get(u, u, u),
    });
  });
  // ---------- books ----------
  app.get('/api/books', requireUser, (req, res) => {
    const sort = { title: 'LOWER(b.title)', author: 'LOWER(b.author)', status: "CASE b.status WHEN 'reading' THEN 0 WHEN 'want' THEN 1 ELSE 2 END", added: 'b.created_at DESC' }[req.query.sort] || 'b.created_at DESC';
    const rows = db.prepare(`SELECT b.*, (SELECT COUNT(*) FROM images i WHERE i.book_id = b.id) AS image_count FROM books b WHERE b.user_id = ? ORDER BY ${sort}, b.rowid DESC`).all(req.user.id);
    ok(res, rows.map(bookOut));
  });
  app.get('/api/metadata', requireUser, async (req, res) => {
    const { q, isbn } = req.query;
    if (!q && !isbn) return bad(res, 'Enter a title or ISBN');
    try { ok(res, await lookupBooks({ q, isbn })); } catch (e) { bad(res, e.message, 502); }
  });

  app.post('/api/books', requireUser, upload.single('cover'), (req, res) => {
    const f = bookFields(req.body);
    if (!f.title) { rm(req.file?.path); return bad(res, 'Title is required'); }
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO books (id,user_id,title,author,isbn,cover_path,cover_url,started_on,completed_on,status,notes,tags) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, req.user.id, f.title, f.author, f.isbn, req.file?.path || null, req.file ? null : f.cover_url, f.started_on, f.completed_on, f.status, f.notes, f.tags);
    ok(res, bookOut(ownBook(id, req.user.id)));
  });
  app.put('/api/books/:id', requireUser, upload.single('cover'), (req, res) => {
    const b = ownBook(req.params.id, req.user.id);
    if (!b) { rm(req.file?.path); return bad(res, 'Book not found', 404); }
    const f = bookFields(req.body);
    if (!f.title) { rm(req.file?.path); return bad(res, 'Title is required'); }
    let coverPath = b.cover_path, coverUrl = b.cover_url;
    if (req.file) { rm(b.cover_path); coverPath = req.file.path; coverUrl = null; }
    else if (f.cover_url) { rm(b.cover_path); coverPath = null; coverUrl = f.cover_url; }
    db.prepare(`UPDATE books SET title=?,author=?,isbn=?,cover_path=?,cover_url=?,started_on=?,completed_on=?,status=?,notes=?,tags=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(f.title, f.author, f.isbn, coverPath, coverUrl, f.started_on, f.completed_on, f.status, f.notes, f.tags, b.id);
    ok(res, bookOut(ownBook(b.id, req.user.id)));
  });
  app.delete('/api/books/:id', requireUser, (req, res) => {
    const b = ownBook(req.params.id, req.user.id);
    if (!b) return bad(res, 'Book not found', 404);
    db.prepare('SELECT id FROM passages WHERE book_id = ?').all(b.id).forEach((p) => ftsDelete(p.id));
    db.prepare('SELECT id, path FROM images WHERE book_id = ?').all(b.id).forEach((i) => { rm(i.path); rmThumbs(i.id); });
    rm(b.cover_path);
    db.prepare('DELETE FROM passages WHERE book_id = ?').run(b.id);
    db.prepare('DELETE FROM notes WHERE book_id = ?').run(b.id);
    db.prepare('DELETE FROM books WHERE id = ?').run(b.id);
    ok(res);
  });
  app.get('/api/books/:id/cover', requireUser, (req, res) => {
    const b = ownBook(req.params.id, req.user.id);
    if (!b?.cover_path) return bad(res, 'No cover', 404);
    res.sendFile(path.resolve(b.cover_path));
  });
  app.get('/api/books/:id', requireUser, (req, res) => {
    const b = ensureBook(req.params.id, req.user.id);
    if (!b) return bad(res, 'Book not found', 404);
    const images = db.prepare(`SELECT i.id, i.status, i.error, i.page_number AS page, i.created_at AS createdAt, (SELECT substr(group_concat(p.text, ' '), 1, 140) FROM passages p WHERE p.image_id = i.id) AS excerpt, (SELECT COUNT(*) FROM passages p WHERE p.image_id = i.id) AS passageCount, (SELECT COUNT(*) FROM passages p WHERE p.image_id = i.id AND (p.highlighted = 1 OR p.important = 1)) AS highlightCount FROM images i WHERE i.book_id = ? ORDER BY i.created_at DESC, i.rowid DESC`).all(b.id);
    const highlights = db.prepare(`SELECT p.id, p.text, p.highlight_text AS highlightText, p.mark_type AS markType, p.important, p.image_id AS imageId, i.page_number AS page FROM passages p JOIN images i ON i.id = p.image_id WHERE p.book_id = ? AND (p.highlighted = 1 OR p.important = 1) ORDER BY i.created_at DESC, p.idx`).all(b.id);
    const notes = db.prepare('SELECT id, content, image_id AS imageId, passage_id AS passageId, created_at AS createdAt FROM notes WHERE book_id = ? AND user_id = ? ORDER BY created_at DESC').all(b.id, req.user.id);
    ok(res, { book: bookOut({ ...b, image_count: images.length }), images, highlights, notes });
  });

  // ---------- images ----------
  app.post('/api/books/:id/images', requireUser, upload.array('images', 40), async (req, res) => {
    const b = ensureBook(req.params.id, req.user.id);
    if (!b) { (req.files || []).forEach((f) => rm(f.path)); return bad(res, 'Book not found', 404); }
    if (!req.files?.length) return bad(res, 'No valid images received');
    const page = parseInt(req.body.page, 10);
    const out = [];
    for (const f of req.files) {
      const id = crypto.randomUUID();
      db.prepare('INSERT INTO images (id,user_id,book_id,path,mime,original_name,page_number) VALUES (?,?,?,?,?,?,?)')
        .run(id, req.user.id, b.id, f.path, f.mimetype, f.originalname, Number.isFinite(page) && req.files.length === 1 ? page : null);
      if (process.env.VERCEL) { try { await processImage(id); } catch (e) { console.error('OCR failed:', e); } }
      else enqueue(id);
      out.push({ id, name: f.originalname });
    }
    ok(res, { images: out });
  });
  app.get('/api/images/:id/file', requireUser, (req, res) => {
    const i = ownImage(req.params.id, req.user.id);
    if (!i) return bad(res, 'Image not found', 404);
    res.sendFile(path.resolve(i.path));
  });
  app.get('/api/images/:id/thumb', requireUser, async (req, res) => {
    const i = ownImage(req.params.id, req.user.id);
    if (!i) return bad(res, 'Image not found', 404);
    const w = THUMB_W.find((x) => x >= Number(req.query.w)) || THUMB_W[THUMB_W.length - 1];
    const f = path.join(THUMBS, `${i.id}-${w}.webp`);
    try {
      if (!fs.existsSync(f)) {
        fs.mkdirSync(THUMBS, { recursive: true });
        const tmp = `${f}.${crypto.randomUUID()}.tmp`;
        await sharp(i.path).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 78 }).toFile(tmp);
        fs.renameSync(tmp, f);
      }
      res.set('Cache-Control', 'private, max-age=86400');
      res.sendFile(f);
    } catch { res.sendFile(path.resolve(i.path)); }
  });
  app.get('/api/images/:id', requireUser, (req, res) => {
    const i = ownImage(req.params.id, req.user.id);
    if (!i) return bad(res, 'Image not found', 404);
    const passages = db.prepare(`SELECT id, idx, text, original_text AS originalText, bbox, lines, highlighted, mark_type AS markType,
        highlight_text AS highlightText, confidence, is_equation AS isEquation, important, corrected FROM passages WHERE image_id = ? ORDER BY idx`).all(i.id)
      .map((p) => ({ ...p, bbox: JSON.parse(p.bbox), lines: JSON.parse(p.lines), highlighted: !!p.highlighted, isEquation: !!p.isEquation, important: !!p.important, corrected: !!p.corrected, confidence: p.confidence == null ? null : Math.round(p.confidence) }));
    const notes = db.prepare('SELECT id, content, passage_id AS passageId, created_at AS createdAt FROM notes WHERE image_id = ? AND user_id = ? ORDER BY created_at DESC').all(i.id, req.user.id);
    ok(res, {
      image: { id: i.id, status: i.status, error: i.error, page: i.page_number, width: i.width, height: i.height, name: i.original_name, createdAt: i.created_at },
      book: bookOut(ownBook(i.book_id, req.user.id)), passages, notes,
    });
  });
  app.put('/api/images/:id', requireUser, (req, res) => {
    const i = ownImage(req.params.id, req.user.id);
    if (!i) return bad(res, 'Image not found', 404);
    const n = parseInt(req.body.page, 10);
    db.prepare('UPDATE images SET page_number = ? WHERE id = ?').run(Number.isFinite(n) && n > 0 ? n : null, i.id);
    ok(res);
  });
  app.post('/api/images/:id/reprocess', requireUser, (req, res) => {
    const i = ownImage(req.params.id, req.user.id);
    if (!i) return bad(res, 'Image not found', 404);
    db.prepare("UPDATE images SET status = 'pending' WHERE id = ?").run(i.id);
    enqueue(i.id);
    ok(res);
  });
  app.delete('/api/images/:id', requireUser, (req, res) => {
    const i = ownImage(req.params.id, req.user.id);
    if (!i) return bad(res, 'Image not found', 404);
    db.prepare('SELECT id FROM passages WHERE image_id = ?').all(i.id).forEach((p) => ftsDelete(p.id));
    db.prepare('DELETE FROM passages WHERE image_id = ?').run(i.id);
    db.prepare('DELETE FROM notes WHERE image_id = ?').run(i.id);
    db.prepare('DELETE FROM images WHERE id = ?').run(i.id);
    rm(i.path);
    rmThumbs(i.id);
    ok(res);
  });

  app.post('/api/images/:id/mark', requireUser, (req, res) => {
    const i = ownImage(req.params.id, req.user.id);
    if (!i) return bad(res, 'Image not found', 404);
    const r = req.body?.rect;
    if (!r || ![r.x, r.y, r.w, r.h].every(Number.isFinite)) return bad(res, 'Invalid selection');
    const clear = !!req.body.clear;
    let touched = 0;
    for (const p of db.prepare('SELECT id, lines FROM passages WHERE image_id = ?').all(i.id)) {
      const lines = JSON.parse(p.lines);
      let changed = false;
      lines.forEach((l) => {
        const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
        if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) {
          l.mark = clear ? null : 'manual'; l.color = null; changed = true; touched++;
        }
      });
      if (!changed) continue;
      const marked = lines.filter((l) => l.mark);
      db.prepare('UPDATE passages SET lines = ?, highlighted = ?, mark_type = ?, highlight_text = ? WHERE id = ?').run(
        JSON.stringify(lines), marked.length / lines.length >= 0.3 ? 1 : 0,
        marked.length ? (marked.find((l) => l.mark === 'manual') ? 'manual' : marked[0].mark) : null, marked.length ? marked.map((l) => l.text).join(' ') : null, p.id);
    }
    ok(res, { touched });
  });

  // ---------- passages ----------
  app.put('/api/passages/:id', requireUser, async (req, res) => {
    const p = ownPassage(req.params.id, req.user.id);
    if (!p) return bad(res, 'Passage not found', 404);
    const { text, important } = req.body || {};
    if (typeof important === 'boolean') db.prepare('UPDATE passages SET important = ? WHERE id = ?').run(important ? 1 : 0, p.id);
    if (typeof text === 'string') {
      const t = text.replace(/\s+/g, ' ').trim();
      if (!t) return bad(res, 'Text cannot be empty');
      const { vec, model } = await embed(t);
      db.prepare('UPDATE passages SET text = ?, corrected = ?, embedding = ?, embed_model = ? WHERE id = ?').run(t, t === p.original_text ? 0 : 1, toBlob(vec), model, p.id);
      ftsPut(p.id, req.user.id, t);
    }
    ok(res);
  });

  // ---------- notes ----------
  app.post('/api/notes', requireUser, (req, res) => {
    const { bookId, imageId, passageId, content } = req.body || {};
    if (!String(content || '').trim()) return bad(res, 'Write something first');
    let book = bookId, image = imageId;
    if (passageId) {
      const p = ownPassage(passageId, req.user.id);
      if (!p) return bad(res, 'Passage not found', 404);
      book = p.book_id; image = p.image_id;
    } else if (imageId) {
      const i = ownImage(imageId, req.user.id);
      if (!i) return bad(res, 'Image not found', 404);
      book = i.book_id;
    } else if (!bookId || !ownBook(bookId, req.user.id)) return bad(res, 'Book not found', 404);
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO notes (id,user_id,book_id,image_id,passage_id,content) VALUES (?,?,?,?,?,?)').run(id, req.user.id, book, image || null, passageId || null, String(content).trim());
    ok(res, { id });
  });
  app.delete('/api/notes/:id', requireUser, (req, res) => {
    db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    ok(res);
  });
}
