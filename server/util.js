import fs from 'node:fs';

export const ok = (res, data = { ok: true }) => res.json(data);
export const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
export const rm = (p) => { if (p) fs.rm(p, { force: true }, () => {}); };
