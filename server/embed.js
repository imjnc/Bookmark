import path from 'node:path';
import { DATA_DIR } from './db.js';
import { contentTokens, stem } from './text.js';

const DIM = 384;
let pipe = null;
let tried = false;
let modelName = 'hash-v1';

async function load() {
  if (tried) return;
  tried = true;
  if (process.env.BOOKMARK_EMBEDDINGS === 'hash') return;
  try {
    const { pipeline, env } = await import('@xenova/transformers');
    env.cacheDir = path.join(DATA_DIR, 'models');
    pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    modelName = 'minilm-l6-v2';
    console.log('[embed] using all-MiniLM-L6-v2');
  } catch (e) {
    console.warn('[embed] neural model unavailable, using hashed fallback:', e.message);
  }
}

function fnv(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function hashEmbed(text) {
  const v = new Float32Array(DIM);
  const toks = contentTokens(text).map(stem);
  const add = (f, w) => { const h = fnv(f); v[h % DIM] += (h & 0x10000 ? 1 : -1) * w; };
  toks.forEach((t, i) => { add(t, 1); if (i) add(toks[i - 1] + '_' + t, 0.5); });
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < DIM; i++) v[i] /= n;
  return v;
}

export async function embed(text) {
  await load();
  if (pipe) {
    const out = await pipe(text.slice(0, 2000), { pooling: 'mean', normalize: true });
    return { vec: Float32Array.from(out.data), model: modelName };
  }
  return { vec: hashEmbed(text), model: 'hash-v1' };
}

export const toBlob = (v) => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
export const fromBlob = (b) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
export const cosine = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
export const minSimilarity = (model) => (model === 'hash-v1' ? 0.2 : 0.3);
