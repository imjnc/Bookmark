// Crop editor. The picture can be zoomed and panned; a crop frame (preset ratio or free) is moved and
// resized by its body, edges and corners. Output = the source pixels under the frame: never enlarged,
// and the untouched original is returned when the frame covers the whole image.
const PRESETS = {
  orig: { label: 'Original', r: null },      // null: keep the image's own ratio
  square: { label: 'Square 1:1', r: 1 },
  portrait: { label: 'Portrait 3:4', r: 3 / 4 },
  landscape: { label: 'Landscape 4:3', r: 4 / 3 },
  wide: { label: 'Wide 16:9', r: 16 / 9 },
  cover: { label: 'Cover 2:3', r: 2 / 3 },
  custom: { label: 'Custom', r: 0 },          // 0: free ratio
};
const MIN = 40, ZMAX = 6;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const X = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export async function cropImage(file, { presets = ['orig', 'square', 'portrait', 'landscape', 'wide', 'custom'], preset = presets[0], cap = 4096, title = 'Crop image', step = '' } = {}) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch { URL.revokeObjectURL(url); throw new Error('This image could not be opened'); }
  const nw = img.naturalWidth, nh = img.naturalHeight;

  const d = document.createElement('dialog');
  d.className = 'cropper';
  d.innerHTML = `
    <button type="button" class="xbtn" data-cancel aria-label="Cancel">${X}</button>
    <h2>${title}</h2>${step ? `<p class="muted small" style="margin:-.3rem 0 .6rem">${step}</p>` : ''}
    <div class="cropgrid">
      <div class="cropwrap"><div class="cropstage" id="cs" tabindex="0" aria-label="Crop area. Drag the frame to move it, drag its edges or corners to resize it, drag outside it to move the image. Arrow keys move the frame.">
        <img alt="" draggable="false"><div class="cbox">${HANDLES.map((h) => `<i class="ch ${h}" data-h="${h}"></i>`).join('')}</div></div></div>
      <div class="cropside">
        <div class="row" role="group" aria-label="Crop shape" id="pr">${presets.map((p) => `<button type="button" class="btn sm" data-p="${p}" aria-pressed="false">${PRESETS[p].label}</button>`).join('')}</div>
        <label for="cz">Zoom</label>
        <div class="row nowrap zrow"><button type="button" class="btn sm icon" data-zo aria-label="Zoom out">−</button><input id="cz" type="range" min="1" max="${ZMAX}" step="0.01" value="1"><button type="button" class="btn sm icon" data-zi aria-label="Zoom in">+</button></div>
        <div class="prevbox"><span class="small muted">Preview</span><canvas id="cp" aria-label="Preview of the cropped image"></canvas><p class="small muted" id="ci" aria-live="polite"></p></div>
      </div>
    </div>
    <div class="row between formfoot"><button type="button" class="btn ghost" data-reset>Reset</button><div class="row nowrap"><button type="button" class="btn" data-cancel>Cancel</button><button type="button" class="btn primary" data-save>Apply crop</button></div></div>`;
  document.body.append(d);
  const $ = (q) => d.querySelector(q);
  const stage = $('#cs'), pic = stage.querySelector('img'), bx = $('.cbox'), cp = $('#cp');
  pic.src = url;

  // All geometry is in stage pixels. s() = stage px per source px.
  let SW = 0, SH = 0, s0 = 1, z = 1, tx = 0, ty = 0, cur = preset, box = { x: 0, y: 0, w: 0, h: 0 }, lastW = 0;
  const s = () => s0 * z;
  const ratio = () => (cur === 'custom' ? 0 : PRESETS[cur].r ?? nw / nh);
  const bounds = () => { const x = Math.max(0, tx), y = Math.max(0, ty); return { x, y, w: Math.min(SW, tx + nw * s()) - x, h: Math.min(SH, ty + nh * s()) - y }; };
  const clampImage = () => { const w = nw * s(), h = nh * s(); tx = w >= SW ? clamp(tx, SW - w, 0) : (SW - w) / 2; ty = h >= SH ? clamp(ty, SH - h, 0) : (SH - h) / 2; };
  const clampBox = () => {
    const B = bounds(), r = ratio();
    let { w, h } = box;
    if (r) { const k = Math.min(1, B.w / w, B.h / h); w *= k; h *= k; }
    else { w = clamp(w, Math.min(MIN, B.w), B.w); h = clamp(h, Math.min(MIN, B.h), B.h); }
    box = { x: clamp(box.x, B.x, B.x + B.w - w), y: clamp(box.y, B.y, B.y + B.h - h), w, h };
  };
  const fitBox = () => {
    const B = bounds(), r = ratio();
    if (!r) return clampBox();
    const w = Math.min(B.w, B.h * r), h = w / r;
    box = { x: B.x + (B.w - w) / 2, y: B.y + (B.h - h) / 2, w, h };
  };
  const region = () => { const k = s(), sx = clamp((box.x - tx) / k, 0, nw), sy = clamp((box.y - ty) / k, 0, nh); return { sx, sy, sw: Math.min(box.w / k, nw - sx), sh: Math.min(box.h / k, nh - sy) }; };

  let raf = 0;
  const preview = () => {
    raf = 0;
    const { sx, sy, sw, sh } = region();
    cp.width = Math.max(1, Math.round(Math.min(sw, 360))); cp.height = Math.max(1, Math.round((cp.width * sh) / sw));
    cp.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, cp.width, cp.height);
    const k = Math.min(1, cap / Math.max(sw, sh));
    $('#ci').textContent = `Output ${Math.round(sw * k)} × ${Math.round(sh * k)} px` + (k < 1 ? `, reduced from ${Math.round(sw)} × ${Math.round(sh)}` : ', original resolution');
  };
  const draw = () => {
    Object.assign(pic.style, { width: nw * s() + 'px', height: nh * s() + 'px', transform: `translate(${tx}px,${ty}px)` });
    Object.assign(bx.style, { left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px' });
    $('#cz').value = z;
    if (!raf) raf = requestAnimationFrame(preview);
  };
  const marks = () => $('#pr').querySelectorAll('[data-p]').forEach((b) => { const on = b.dataset.p === cur; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  const layout = () => {
    const wrapW = $('.cropwrap').clientWidth || 320;
    if (wrapW === lastW) return; // mobile browser bars resize the window constantly; only a real width change resets
    lastW = wrapW;
    const maxH = Math.max(220, Math.min(window.innerHeight * 0.55, 560));
    SW = Math.min(wrapW, maxH * (nw / nh)); SH = SW * (nh / nw);
    stage.style.width = SW + 'px'; stage.style.height = SH + 'px';
    reset();
  };
  const reset = () => { cur = preset; z = 1; s0 = SW / nw; tx = ty = 0; clampImage(); fitBox(); marks(); draw(); };
  const zoomAt = (nz, px = SW / 2, py = SH / 2) => {
    nz = clamp(nz, 1, ZMAX);
    const k = nz / z; tx = px - (px - tx) * k; ty = py - (py - ty) * k; z = nz;
    clampImage(); clampBox(); draw();
  };

  // Resize from a handle; edges move one side, corners two. A locked ratio is kept.
  const resize = (h, dx, dy, b0) => {
    const B = bounds(), r = ratio();
    let l = b0.x, t = b0.y, rt = b0.x + b0.w, b = b0.y + b0.h;
    if (h.includes('w')) l += dx; if (h.includes('e')) rt += dx; if (h.includes('n')) t += dy; if (h.includes('s')) b += dy;
    l = clamp(l, B.x, rt - MIN); rt = clamp(rt, l + MIN, B.x + B.w); t = clamp(t, B.y, b - MIN); b = clamp(b, t + MIN, B.y + B.h);
    if (r) {
      let w = rt - l, hh = b - t;
      const horiz = /[we]/.test(h), vert = /[ns]/.test(h);
      if (horiz && !vert) { hh = w / r; t = b0.y + b0.h / 2 - hh / 2; b = t + hh; }
      else if (vert && !horiz) { w = hh * r; l = b0.x + b0.w / 2 - w / 2; rt = l + w; }
      else { if (w / r > hh) hh = w / r; else w = hh * r; if (h.includes('w')) l = rt - w; else rt = l + w; if (h.includes('n')) t = b - hh; else b = t + hh; }
    }
    box = { x: l, y: t, w: rt - l, h: b - t };
    clampBox();
  };

  // Pointers: one finger/mouse moves the frame, a handle, or (outside the frame) the image; two fingers pinch-zoom.
  const ptrs = new Map();
  let op = null, pinch = null;
  const at = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const mid = () => { const [a, b] = [...ptrs.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }; };
  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, at(e));
    if (ptrs.size === 2) { pinch = { ...mid(), z0: z }; op = null; return; }
    const h = e.target.closest('[data-h]')?.dataset.h;
    op = { type: h ? 'resize' : e.target.closest('.cbox') ? 'move' : 'pan', h, p0: at(e), b0: { ...box }, t0: { x: tx, y: ty } };
  });
  stage.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, at(e));
    if (pinch && ptrs.size === 2) {
      const m = mid();
      zoomAt(pinch.z0 * (m.d / pinch.d), m.x, m.y);
      tx += m.x - pinch.x; ty += m.y - pinch.y; pinch.x = m.x; pinch.y = m.y;
      clampImage(); clampBox(); draw();
      return;
    }
    if (!op) return;
    const p = at(e), dx = p.x - op.p0.x, dy = p.y - op.p0.y;
    if (op.type === 'resize') resize(op.h, dx, dy, op.b0);
    else if (op.type === 'move') { box = { ...op.b0, x: op.b0.x + dx, y: op.b0.y + dy }; clampBox(); }
    else { tx = op.t0.x + dx; ty = op.t0.y + dy; clampImage(); clampBox(); }
    draw();
  });
  const up = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (!ptrs.size) op = null; };
  stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
  stage.addEventListener('wheel', (e) => { e.preventDefault(); const p = at(e); zoomAt(z * (e.deltaY < 0 ? 1.1 : 1 / 1.1), p.x, p.y); }, { passive: false });
  stage.addEventListener('keydown', (e) => {
    const n = e.shiftKey ? 20 : 4, k = { ArrowLeft: [-n, 0], ArrowRight: [n, 0], ArrowUp: [0, -n], ArrowDown: [0, n] }[e.key];
    if (k) { e.preventDefault(); box = { ...box, x: box.x + k[0], y: box.y + k[1] }; clampBox(); draw(); }
    else if (e.key === '+' || e.key === '=') zoomAt(z * 1.25);
    else if (e.key === '-') zoomAt(z / 1.25);
  });
  $('#cz').addEventListener('input', (e) => zoomAt(parseFloat(e.target.value)));
  $('[data-zi]').onclick = () => zoomAt(z * 1.25);
  $('[data-zo]').onclick = () => zoomAt(z / 1.25);
  $('[data-reset]').onclick = reset;
  $('#pr').addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    cur = b.dataset.p; if (cur !== 'custom') fitBox(); marks(); draw();
  });

  return new Promise((resolve) => {
    let result = null;
    const onResize = () => layout();
    window.addEventListener('resize', onResize);
    d.addEventListener('close', () => { window.removeEventListener('resize', onResize); cancelAnimationFrame(raf); URL.revokeObjectURL(url); d.remove(); resolve(result); });
    d.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = () => d.close()));
    $('[data-save]').onclick = async () => {
      const { sx, sy, sw, sh } = region();
      // Frame covers the whole picture: hand back the original file untouched (no re-encoding).
      if (sx < 1 && sy < 1 && sw > nw - 2 && sh > nh - 2 && Math.max(nw, nh) <= cap) { result = { blob: file, name: file.name, cropped: false }; return d.close(); }
      const k = Math.min(1, cap / Math.max(sw, sh));
      const ow = Math.max(1, Math.round(sw * k)), oh = Math.max(1, Math.round(sh * k));
      const c = document.createElement('canvas'); c.width = ow; c.height = oh;
      const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, Math.round(sx), Math.round(sy), Math.round(sw), Math.round(sh), 0, 0, ow, oh);
      const toBlob = (t, q) => new Promise((r) => c.toBlob(r, t, q));
      let blob = await toBlob('image/webp', 0.92), ext = 'webp';
      if (!blob || blob.type !== 'image/webp') { blob = await toBlob('image/jpeg', 0.92); ext = 'jpg'; }
      if (!blob) return;
      result = { blob, name: file.name.replace(/\.[^.]+$/, '') + '-crop.' + ext, cropped: true };
      d.close();
    };
    d.showModal();
    layout();
  });
}
