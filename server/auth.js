import crypto from 'node:crypto';
import { db } from './db.js';

const hash = (pw, salt = crypto.randomBytes(16).toString('hex')) =>
  `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
const verify = (pw, stored) => {
  const [salt, h] = stored.split(':');
  const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export function cookie(req, name) {
  const m = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?,?)').run(token, userId);
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 90}`);
}

export function requireUser(req, res, next) {
  const token = cookie(req, 'sid');
  const row = token && db.prepare(
    'SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(token);
  if (!row) return res.status(401).json({ error: 'Not signed in' });
  req.user = row;
  next();
}

export function authRoutes(app) {
  app.post('/api/auth/register', (req, res) => {
    const { email, password, name } = req.body || {};
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const e = email.trim().toLowerCase();
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(e)) return res.status(409).json({ error: 'Email already registered' });
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO users (id,email,name,password_hash) VALUES (?,?,?,?)').run(id, e, name?.trim() || null, hash(password));
    startSession(res, id);
    res.json({ id, email: e, name: name?.trim() || null });
  });
  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body || {};
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
    if (!u || !verify(String(password || ''), u.password_hash)) return res.status(401).json({ error: 'Wrong email or password' });
    startSession(res, u.id);
    res.json({ id: u.id, email: u.email, name: u.name });
  });
  app.post('/api/auth/logout', (req, res) => {
    const t = cookie(req, 'sid');
    if (t) db.prepare('DELETE FROM sessions WHERE token = ?').run(t);
    res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
    res.json({ ok: true });
  });
  app.get('/api/auth/me', requireUser, (req, res) => res.json(req.user));
}
