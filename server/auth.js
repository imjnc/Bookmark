import crypto from 'node:crypto';
import { db } from './db.js';

const hash = (pw, salt = crypto.randomBytes(16).toString('hex')) =>
  `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
const verify = (pw, stored) => {
  const [salt, h] = stored.split(':');
  const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const SECRET = process.env.SESSION_SECRET || 'bookmark-secret-key-salt-987';

function signToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function cookie(req, name) {
  const m = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

function startSession(res, user) {
  const payload = { id: user.id, email: user.email, name: user.name || null, exp: Date.now() + 60 * 60 * 24 * 90 * 1000 };
  const token = signToken(payload);
  try { db.prepare('INSERT OR REPLACE INTO sessions (token, user_id) VALUES (?,?)').run(token, user.id); } catch {}
  const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 90}${secure}`);
}

export function requireUser(req, res, next) {
  const token = cookie(req, 'sid');
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  const payload = verifyToken(token);
  if (payload) {
    req.user = { id: payload.id, email: payload.email, name: payload.name };
    try {
      db.prepare('INSERT OR IGNORE INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
        payload.id, payload.email, payload.name || null, 'stateless'
      );
    } catch {}
    return next();
  }
  const row = db.prepare('SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(token);
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
    const user = { id, email: e, name: name?.trim() || null };
    db.prepare('INSERT INTO users (id,email,name,password_hash) VALUES (?,?,?,?)').run(id, e, user.name, hash(password));
    startSession(res, user);
    res.json(user);
  });
  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body || {};
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
    if (!u || !verify(String(password || ''), u.password_hash)) return res.status(401).json({ error: 'Wrong email or password' });
    startSession(res, u);
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
