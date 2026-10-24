import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.BOOKMARK_DATA || (process.env.VERCEL ? path.join(os.tmpdir(), 'bookmark-data') : path.join(root, 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'bookmark.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT,
  password_hash TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, author TEXT, isbn TEXT,
  cover_path TEXT, cover_url TEXT,
  started_on TEXT, completed_on TEXT,
  status TEXT NOT NULL DEFAULT 'want' CHECK (status IN ('want','reading','completed')),
  notes TEXT, tags TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  path TEXT NOT NULL, mime TEXT, original_name TEXT, page_number INTEGER,
  width INTEGER, height INTEGER,
  status TEXT NOT NULL DEFAULT 'pending', error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS passages (
  id TEXT PRIMARY KEY, image_id TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, book_id TEXT NOT NULL, idx INTEGER NOT NULL,
  text TEXT NOT NULL, original_text TEXT NOT NULL,
  bbox TEXT,            -- JSON {x,y,w,h} as fractions of the image
  lines TEXT,           -- JSON [{text,x,y,w,h,mark,conf}]
  highlighted INTEGER NOT NULL DEFAULT 0,
  mark_type TEXT, highlight_text TEXT,
  confidence REAL, is_equation INTEGER NOT NULL DEFAULT 0,
  important INTEGER NOT NULL DEFAULT 0, corrected INTEGER NOT NULL DEFAULT 0,
  embedding BLOB, embed_model TEXT
);
CREATE INDEX IF NOT EXISTS idx_passages_user ON passages(user_id);
CREATE INDEX IF NOT EXISTS idx_passages_image ON passages(image_id);
CREATE INDEX IF NOT EXISTS idx_images_book ON images(book_id);
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id TEXT, image_id TEXT, passage_id TEXT, content TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, query TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
-- E-book reader: PDFs, reading progress, annotations, preferences
CREATE TABLE IF NOT EXISTS ebooks (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, author TEXT, shelf TEXT, path TEXT NOT NULL, cover_path TEXT,
  pages INTEGER NOT NULL DEFAULT 0, size INTEGER NOT NULL DEFAULT 0,
  page INTEGER NOT NULL DEFAULT 1, last_read_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ebooks_user ON ebooks(user_id);
CREATE TABLE IF NOT EXISTS ebook_annots (
  id TEXT PRIMARY KEY, ebook_id TEXT NOT NULL REFERENCES ebooks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, page INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('highlight','note')),
  color TEXT, text TEXT, note TEXT, rects TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_annots_book ON ebook_annots(ebook_id);
CREATE TABLE IF NOT EXISTS reader_prefs (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, json TEXT NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS passages_fts USING fts5(
  text, passage_id UNINDEXED, user_id UNINDEXED, tokenize = 'porter unicode61'
);
`);

export const ftsPut = (passageId, userId, text) => {
  db.prepare('DELETE FROM passages_fts WHERE passage_id = ?').run(passageId);
  db.prepare('INSERT INTO passages_fts (text, passage_id, user_id) VALUES (?,?,?)').run(text, passageId, userId);
};
export const ftsDelete = (passageId) =>
  db.prepare('DELETE FROM passages_fts WHERE passage_id = ?').run(passageId);
