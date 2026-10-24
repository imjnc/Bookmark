import { db } from './db.js';
import { embed, fromBlob, cosine, minSimilarity, toBlob } from './embed.js';
import { contentTokens, tokenize, stem } from './text.js';
import { requireUser } from './auth.js';
import { ok, bad } from './util.js';

// Optional AI query understanding: expands a natural-language question into search terms.
// It only helps *retrieve* the user's own passages; it never answers from general knowledge.
const expansionCache = new Map();
async function expandQuery(q) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || q.trim().split(/\s+/).length < 2) return [];
  if (expansionCache.has(q)) return expansionCache.get(q);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.BOOKMARK_QUERY_MODEL || 'claude-haiku-5-5',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `A user is searching their own book notes for: "${q}"\nReturn ONLY a JSON array (max 8) of short search terms, synonyms, abbreviations or phrases that a relevant passage might contain. No explanation.`,
        }],
      }),
      signal: AbortSignal.timeout(6000),
    });
    const j = await res.json();
    const text = j.content?.[0]?.text || '[]';
    const arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
    const terms = arr.filter((s) => typeof s === 'string').slice(0, 8);
    expansionCache.set(q, terms);
    return terms;
  } catch {
    return [];
  }
}

const ftsQuote = (s) => `"${s.replace(/"/g, '')}"`;

function snippet(text, terms, max = 320) {
  if (text.length <= max) return text;
  const lower = text.toLowerCase();
  let pos = -1;
  for (const t of terms) {
    const i = lower.search(new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    if (i >= 0 && (pos < 0 || i < pos)) pos = i;
  }
  if (pos < 0) return text.slice(0, max).trimEnd() + '…';
  const start = Math.max(0, pos - Math.floor(max / 3));
  const end = Math.min(text.length, start + max);
  return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
}

export async function search(userId, q, f = {}) {
  q = String(q || '').trim();
  if (!q) return { query: q, terms: [], results: [] };

  const qTokens = contentTokens(q);
  const baseTokens = qTokens.length ? qTokens : tokenize(q);
  const expansions = await expandQuery(q);
  const extra = expansions.flatMap((e) => (e.includes(' ') ? [e] : [e.toLowerCase()]));

  // --- filters ---
  const where = ['p.user_id = ?'];
  const args = [userId];
  if (f.book) { where.push('p.book_id = ?'); args.push(f.book); }
  if (f.author) { where.push('b.author = ?'); args.push(f.author); }
  if (f.status) { where.push('b.status = ?'); args.push(f.status); }
  if (f.highlighted) where.push('(p.highlighted = 1 OR p.important = 1)');
  if (f.equations) where.push('p.is_equation = 1');
  const filterSql = where.join(' AND ');

  // --- keyword (SQLite FTS5, porter stemmed, prefix match) ---
  const cand = new Map(); // passageId -> {kw, sem}
  const ftsParts = [...baseTokens.map((t) => `${ftsQuote(t)}*`), ...extra.map(ftsQuote)];
  let kwRows = [];
  if (ftsParts.length) {
    try {
      kwRows = db.prepare(
        `SELECT passage_id AS id, bm25(passages_fts) AS s FROM passages_fts
         WHERE passages_fts MATCH ? AND user_id = ? ORDER BY s LIMIT 300`).all(ftsParts.join(' OR '), userId);
    } catch { kwRows = []; }
  }
  const worst = Math.max(...kwRows.map((r) => -r.s), 1e-9);
  kwRows.forEach((r) => cand.set(r.id, { bm: -r.s / worst, sem: 0 }));

  // --- semantic (embeddings, cosine) ---
  const { vec, model } = await embed(q);
  const floor = minSimilarity(model);
  const rows = db.prepare(
    `SELECT p.id, p.embedding FROM passages p JOIN books b ON b.id = p.book_id
     WHERE ${filterSql} AND p.embed_model = ? AND p.embedding IS NOT NULL`).all(...args, model);
  for (const r of rows) {
    const c = cosine(vec, fromBlob(r.embedding));
    if (c >= floor) {
      const s = Math.min(1, (c - floor) / (1 - floor) * 1.6);
      const e = cand.get(r.id) || { bm: 0, sem: 0 };
      e.sem = s;
      cand.set(r.id, e);
    }
  }
  if (!cand.size) return { query: q, terms: [...baseTokens, ...extra], expanded: expansions, results: [] };

  // --- fetch details (applies filters) ---
  const ids = [...cand.keys()];
  const detail = [];
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    detail.push(...db.prepare(
      `SELECT p.id, p.text, p.highlight_text, p.highlighted, p.mark_type, p.is_equation, p.important, p.confidence, p.bbox, p.corrected,
              p.image_id, p.book_id, i.page_number, i.status AS image_status,
              b.title, b.author, b.status AS book_status
       FROM passages p JOIN images i ON i.id = p.image_id JOIN books b ON b.id = p.book_id
       WHERE ${filterSql} AND p.id IN (${chunk.map(() => '?').join(',')})`).all(...args, ...chunk));
  }

  const stems = baseTokens.map(stem);
  const phrase = baseTokens.length > 1 ? baseTokens.join(' ') : null;
  const scored = detail.map((d) => {
    const c = cand.get(d.id);
    const lower = d.text.toLowerCase();
    const words = new Set(tokenize(d.text).map(stem));
    const coverage = stems.length ? stems.filter((s) => words.has(s)).length / stems.length : 0;
    const kw = c.bm || coverage ? 0.6 * coverage + 0.4 * c.bm : 0;
    const hi = Math.max(kw, c.sem), lo = Math.min(kw, c.sem);
    let score = 0.7 * hi + 0.3 * lo;
    if (phrase && lower.includes(phrase)) score += 0.1;
    if (d.highlighted) score += 0.06;
    if (d.important) score += 0.06;
    const type = kw > 0 && c.sem > 0 ? 'both' : kw > 0 ? 'keyword' : 'semantic';
    return { d, score, type };
  }).filter((r) => r.score >= 0.1).sort((a, b) => b.score - a.score);

  const terms = [...new Set([...baseTokens, ...extra.flatMap((e) => e.toLowerCase().split(/\s+/))])];
  let results = scored.map(({ d, score, type }) => ({
    id: d.id, imageId: d.image_id, bookId: d.book_id,
    title: d.title, author: d.author || null, bookStatus: d.book_status,
    page: d.page_number ?? null,                       // null => UI shows "Page unknown"
    text: d.text, snippet: snippet(d.text, terms),
    highlightText: d.highlight_text, highlighted: !!d.highlighted, markType: d.mark_type,
    isEquation: !!d.is_equation, important: !!d.important, corrected: !!d.corrected,
    confidence: d.confidence == null ? null : Math.round(d.confidence),
    bbox: d.bbox ? JSON.parse(d.bbox) : null,
    relevance: Math.min(100, Math.round(score * 100)), matchType: type,
  }));

  if (f.groupBy === 'image') {
    const seen = new Map();
    results.forEach((r) => {
      const g = seen.get(r.imageId);
      if (!g) { r.matches = 1; seen.set(r.imageId, r); } else g.matches++;
    });
    results = [...seen.values()];
  }

  db.prepare('DELETE FROM searches WHERE user_id = ? AND query = ?').run(userId, q);
  db.prepare('INSERT INTO searches (user_id, query) VALUES (?,?)').run(userId, q);
  return { query: q, terms, expanded: expansions, results: results.slice(0, 60) };
}

export function searchRoutes(app) {
  app.get('/api/search', requireUser, async (req, res) => {
    const q = req.query;
    try {
      ok(res, await search(req.user.id, q.q, {
        book: q.book || null, author: q.author || null, status: q.status || null,
        highlighted: q.highlighted === '1', equations: q.equations === '1', groupBy: q.group === 'image' ? 'image' : null,
      }));
    } catch (e) { console.error(e); bad(res, 'Search failed', 500); }
  });

  app.delete('/api/searches', requireUser, (req, res) => {
    db.prepare('DELETE FROM searches WHERE user_id = ?').run(req.user.id);
    ok(res);
  });

  app.post('/api/reindex', requireUser, async (req, res) => {
    const rows = db.prepare('SELECT id, text FROM passages WHERE user_id = ?').all(req.user.id);
    for (const r of rows) {
      const { vec, model } = await embed(r.text);
      db.prepare('UPDATE passages SET embedding = ?, embed_model = ? WHERE id = ?').run(toBlob(vec), model, r.id);
    }
    ok(res, { reindexed: rows.length });
  });
}
