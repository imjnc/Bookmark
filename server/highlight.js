// Conventional computer-vision detection of coloured highlights, underlines,
// black lines and side brackets. Works on raw RGB pixels; no AI cost.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function prep(data, width, height, channels) {
  const lum = new Uint8Array(width * height);
  const sat = new Uint8Array(width * height); // 0..255
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; p < lum.length; p++, i += channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
    lum[p] = l;
    hist[l]++;
    sat[p] = mx ? ((mx - mn) / mx) * 255 : 0;
  }
  let acc = 0;
  let paper = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= lum.length * 0.8) { paper = v; break; }
  }
  return { lum, sat, paper, dark: clamp(paper * 0.5, 40, 150) };
}

function hueName(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn || 1;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return h < 20 || h >= 340 ? 'red' : h < 70 ? 'yellow' : h < 170 ? 'green' : h < 260 ? 'blue' : 'pink';
}

// Longest run of "dark" pixels along a scan, tolerating tiny gaps.
function longestRun(count, at) {
  let run = 0, longest = 0, gap = 0;
  for (let i = 0; i < count; i++) {
    if (at(i)) { run++; gap = 0; if (run > longest) longest = run; }
    else if (run && ++gap <= 3) { /* tolerate tiny breaks */ }
    else { run = 0; gap = 0; }
  }
  return longest;
}

/**
 * @param img        {data,width,height,channels}
 * @param lines      [{x0,y0,x1,y1}] in pixels
 * @param paragraphs [[lineIdx...]] used for bracket detection
 * @returns per-line [{mark, conf, color?}]
 */
export function detectMarks(img, lines, paragraphs) {
  const { data, width: W, height: H, channels } = img;
  const { lum, sat, paper, dark } = prep(data, W, H, channels);

  // A fully tinted page (sepia reader mode, coloured paper) means colour is not a highlight signal.
  const step = Math.max(1, Math.floor(lum.length / 40000));
  let tinted = 0, sampled = 0;
  for (let p = 0; p < lum.length; p += step, sampled++) {
    if (sat[p] > 80 && lum[p] > paper * 0.6) tinted++;
  }
  const colourUsable = tinted / sampled < 0.45;

  const out = lines.map(() => ({ mark: null, conf: 0 }));

  lines.forEach((ln, li) => {
    const x0 = clamp(Math.floor(ln.x0), 0, W - 1), x1 = clamp(Math.ceil(ln.x1), x0 + 1, W);
    const y0 = clamp(Math.floor(ln.y0), 0, H - 1), y1 = clamp(Math.ceil(ln.y1), y0 + 1, H);
    const lh = y1 - y0, lw = x1 - x0;

    // Case A: coloured highlight = most non-ink pixels under the line are saturated
    if (colourUsable) {
      let col = 0, bg = 0, rs = 0, gs = 0, bs = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = y * W + x;
          if (lum[p] < dark) continue;
          bg++;
          if (sat[p] > 80 && lum[p] > paper * 0.45) {
            col++;
            const i = p * channels;
            rs += data[i]; gs += data[i + 1]; bs += data[i + 2];
          }
        }
      }
      const frac = bg ? col / bg : 0;
      if (frac > 0.5) {
        out[li] = { mark: 'highlight', conf: Math.min(1, frac), color: hueName(rs / col, gs / col, bs / col) };
        return;
      }
    }

    // Cases B/C: underline or black line directly beneath the text
    const ys = clamp(y0 + Math.floor(lh * 0.72), 0, H - 1);
    const ye = clamp(y1 + Math.ceil(lh * 0.6), ys + 1, H);
    let best = 0;
    for (let y = ys; y < ye; y++) {
      best = Math.max(best, longestRun(lw, (i) => lum[y * W + x0 + i] < dark) / lw);
    }
    if (best >= 0.6) out[li] = { mark: 'underline', conf: Math.min(1, best) };
  });

  // Case C: vertical bracket / side bar next to a paragraph
  paragraphs.forEach((idxs) => {
    if (!idxs.length) return;
    const bx0 = Math.min(...idxs.map((i) => lines[i].x0)), bx1 = Math.max(...idxs.map((i) => lines[i].x1));
    const by0 = Math.min(...idxs.map((i) => lines[i].y0)), by1 = Math.max(...idxs.map((i) => lines[i].y1));
    const ph = by1 - by0;
    if (ph < 12) return;
    const margin = Math.max(8, Math.round(W * 0.05));
    const ys = clamp(Math.floor(by0 - ph * 0.1), 0, H - 1);
    const ye = clamp(Math.ceil(by1 + ph * 0.1), ys + 1, H);
    let best = 0;
    for (const [a, b] of [[bx0 - margin, bx0 - 2], [bx1 + 2, bx1 + margin]]) {
      for (let x = clamp(Math.round(a), 0, W - 1); x < clamp(Math.round(b), 1, W); x++) {
        best = Math.max(best, longestRun(ye - ys, (i) => lum[(ys + i) * W + x] < dark) / ph);
      }
    }
    if (best >= 0.75) idxs.forEach((i) => { if (!out[i].mark) out[i] = { mark: 'bracket', conf: Math.min(1, best) }; });
  });

  return out;
}
