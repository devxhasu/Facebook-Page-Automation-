// Owner login = username "admin" + ADMIN_PASSWORD (env). Staff accounts live in MongoDB with permissions.
const crypto = require('crypto');
const { col } = require('./db');
const L = require('./logger');

const PERMS = ['orders', 'products', 'inbox', 'data', 'logs', 'settings', 'test'];
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const sign = (v) => crypto.createHmac('sha256', process.env.SECRET_KEY || 'x').update(v).digest('base64url');
const b64 = (s) => Buffer.from(String(s)).toString('base64url');
const fails = new Map();
const ucache = new Map();
const bust = () => ucache.clear();

const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(String(pw), salt, 32).toString('hex');
function checkPw(pw, stored) {
  const [salt, h] = String(stored || '').split(':');
  if (!salt || !h) return false;
  const x = crypto.scryptSync(String(pw), salt, 32), y = Buffer.from(h, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function cookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
}
function sessionName(req) {
  const [u, exp, sig] = cookie(req, 'sid').split('.');
  if (!u || !exp || !sig || Number(exp) < Date.now()) return '';
  const e = sign(u + '.' + exp);
  try { if (sig.length === e.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(e))) return Buffer.from(u, 'base64url').toString(); } catch {}
  return '';
}
async function getUser(name) {
  if (name === 'admin') return { username: 'admin', role: 'owner', perms: PERMS };
  const c = ucache.get(name);
  if (c && Date.now() - c.t < 20000) return c.u;
  const d = await col('users').findOne({ username: name });
  const u = d && d.active !== false ? { username: d.username, role: 'staff', perms: (d.perms || []).filter((p) => PERMS.includes(p)) } : null;
  ucache.set(name, { t: Date.now(), u });
  return u;
}

async function login(req, res) {
  const ip = req.ip;
  const f = fails.get(ip) || { n: 0, until: 0 };
  if (f.until > Date.now()) return res.status(429).json({ error: 'Onek bar vul password dilen. 15 minute pore try korun.' });
  const name = String((req.body && req.body.username) || 'admin').trim().toLowerCase();
  const pw = String((req.body && req.body.password) || '');
  let ok = false;
  if (name === 'admin') ok = crypto.timingSafeEqual(sha(pw), sha(process.env.ADMIN_PASSWORD || ''));
  else { const d = await col('users').findOne({ username: name, active: { $ne: false } }); ok = !!d && checkPw(pw, d.pass); }
  if (!ok) {
    f.n++; if (f.n >= 8) { f.until = Date.now() + 15 * 60000; f.n = 0; }
    fails.set(ip, f);
    L.warn('auth', `Vul username/password diye login try (${name}, ${ip})`);
    return res.status(401).json({ error: 'Username ba password thik na' });
  }
  fails.delete(ip);
  const exp = String(Date.now() + 7 * 86400e3), u = b64(name);
  res.cookie('sid', `${u}.${exp}.${sign(u + '.' + exp)}`, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 7 * 86400e3 });
  L.ok('auth', `Login: ${name}`);
  res.json({ ok: true });
}
const logout = (req, res) => { res.clearCookie('sid'); res.json({ ok: true }); };
async function require_(req, res, next) {
  try {
    const name = sessionName(req);
    const u = name && (await getUser(name));
    if (!u) return res.status(401).json({ error: 'Login korun' });
    req.user = u;
    next();
  } catch (e) { res.status(500).json({ error: e.message }); }
}
const can = (u, p) => !!u && (u.role === 'owner' || (p !== 'owner' && u.perms.includes(p)));
const need = (p) => (req, res, next) => (can(req.user, p) ? next() : res.status(403).json({ error: 'Ei kaj er permission nai' }));

module.exports = { login, logout, require: require_, need, can, hashPw, bust, PERMS };
