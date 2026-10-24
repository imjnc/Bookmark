import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { db, DATA_DIR, ftsPut, ftsDelete } from './db.js';
import { detectMarks } from './highlight.js';
import { embed, toBlob } from './embed.js';

let worker = null;
async function getWorker() {
  if (!worker) {
    const cache = path.join(DATA_DIR, 'tessdata');
    fs.mkdirSync(cache, { recursive: true });
    worker = await createWorker('eng', 1, { cachePath: cache, logger: () => {} });
  }
  return worker;
}

export const isEquation = (t) =>
  /[∑∫√]/.test(t) || (t.length < 240 && /[0-9a-z)]\s*[=+\-*/×÷^≈≤≥]\s*[0-9a-z(]/i.test(t) && /=|[×÷^≈≤≥]/.test(t));

const clean = (s) => s.replace(/-\n(?=[a-z])/g, '').replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();

export async function processImage(imageId) {
  const img = db.prepare('SELECT * FROM images WHERE id = ?').get(imageId);
  if (!img) return;
  db.prepare("UPDATE images SET status = 'processing', error = NULL WHERE id = ?").run(imageId);
  try {
    // Work on an oriented, size-limited copy; the stored original is never touched.
    const base = sharp(img.path).rotate().resize({ width: 2200, withoutEnlargement: true });
    const { data: raw, info } = await base.clone().removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const ocrBuf = await base.clone().grayscale().normalize().png().toBuffer();
    const meta = await sharp(img.path).rotate().metadata();

    const w = await getWorker();
    const { data } = await w.recognize(ocrBuf, {}, { blocks: true });

    const lines = [];
    const paras = [];
    for (const block of data.blocks || []) {
      for (const p of block.paragraphs || []) {
        const idxs = [];
        for (const l of p.lines || []) {
          const text = clean(l.text || '');
          if (!text || l.confidence < 25 || !/[a-z0-9]/i.test(text)) continue;
          idxs.push(lines.length);
          lines.push({ text, x0: l.bbox.x0, y0: l.bbox.y0, x1: l.bbox.x1, y1: l.bbox.y1, conf: l.confidence });
        }
        if (idxs.length) paras.push(idxs);
      }
    }

    const marks = lines.length
      ? detectMarks({ data: raw, width: info.width, height: info.height, channels: info.channels }, lines, paras)
      : [];

    db.prepare('SELECT id FROM passages WHERE image_id = ?').all(imageId).forEach((o) => ftsDelete(o.id));
    db.prepare('DELETE FROM passages WHERE image_id = ?').run(imageId);

    let n = 0;
    for (const idxs of paras) {
      const pl = idxs.map((i) => ({ ...lines[i], mark: marks[i].mark, color: marks[i].color }));
      const text = clean(pl.map((l) => l.text).join(' '));
      if (text.length < 3) continue;
      const x0 = Math.min(...pl.map((l) => l.x0)), y0 = Math.min(...pl.map((l) => l.y0));
      const x1 = Math.max(...pl.map((l) => l.x1)), y1 = Math.max(...pl.map((l) => l.y1));
      const marked = pl.filter((l) => l.mark);
      const counts = {};
      marked.forEach((l) => { counts[l.mark] = (counts[l.mark] || 0) + 1; });
      const markType = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || null;
      const frac = (l) => ({
        text: l.text, x: l.x0 / info.width, y: l.y0 / info.height,
        w: (l.x1 - l.x0) / info.width, h: (l.y1 - l.y0) / info.height,
        mark: l.mark, color: l.color || null, conf: Math.round(l.conf),
      });
      const id = crypto.randomUUID();
      const { vec, model } = await embed(text);
      db.prepare(`INSERT INTO passages (id,image_id,user_id,book_id,idx,text,original_text,bbox,lines,highlighted,mark_type,highlight_text,confidence,is_equation,embedding,embed_model)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, imageId, img.user_id, img.book_id, n++, text, text,
        JSON.stringify({ x: x0 / info.width, y: y0 / info.height, w: (x1 - x0) / info.width, h: (y1 - y0) / info.height }),
        JSON.stringify(pl.map(frac)),
        marked.length / pl.length >= 0.3 ? 1 : 0, markType,
        marked.length ? clean(marked.map((l) => l.text).join(' ')) : null,
        pl.reduce((s, l) => s + l.conf, 0) / pl.length, isEquation(text) ? 1 : 0, toBlob(vec), model);
      ftsPut(id, img.user_id, text);
    }
    db.prepare("UPDATE images SET status = 'done', width = ?, height = ? WHERE id = ?").run(meta.width, meta.height, imageId);
  } catch (e) {
    console.error('[ocr] failed', imageId, e);
    db.prepare("UPDATE images SET status = 'failed', error = ? WHERE id = ?").run(String(e.message || e), imageId);
  }
}

// Background queue: uploads return immediately; OCR runs one image at a time.
const queue = [];
let running = false;
export function enqueue(imageId) {
  if (!queue.includes(imageId)) queue.push(imageId);
  pump();
}
async function pump() {
  if (running) return;
  running = true;
  while (queue.length) await processImage(queue.shift());
  running = false;
}
export function resumePending() {
  db.prepare("SELECT id FROM images WHERE status IN ('pending','processing')").all().forEach((r) => enqueue(r.id));
}
export async function shutdownOcr() { if (worker) await worker.terminate(); }
