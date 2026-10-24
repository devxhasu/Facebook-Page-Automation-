const crypto = require('crypto');
const L = require('./logger');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const sign = (v) => crypto.createHmac('sha256', process.env.SECRET_KEY || 'x').update(v).digest('base64url');
const fails = new Map();

function cookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
}
function valid(req) {
  const [exp, sig] = cookie(req, 'sid').split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const e = sign(exp);
  try { return sig.length === e.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(e)); } catch { return false; }
}
function login(req, res) {
  const ip = req.ip;
  const f = fails.get(ip) || { n: 0, until: 0 };
  if (f.until > Date.now()) return res.status(429).json({ error: 'Onek bar vul password dilen. 15 minute pore try korun.' });
  const ok = crypto.timingSafeEqual(sha((req.body && req.body.password) || ''), sha(process.env.ADMIN_PASSWORD || ''));
  if (!ok) {
    f.n++; if (f.n >= 8) { f.until = Date.now() + 15 * 60000; f.n = 0; }
    fails.set(ip, f);
    L.warn('auth', `Vul password diye login try (${ip})`);
    return res.status(401).json({ error: 'Password thik na' });
  }
  fails.delete(ip);
  const exp = String(Date.now() + 7 * 86400e3);
  res.cookie('sid', exp + '.' + sign(exp), { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 7 * 86400e3 });
  L.ok('auth', 'Admin login hoyeche');
  res.json({ ok: true });
}
const logout = (req, res) => { res.clearCookie('sid'); res.json({ ok: true }); };
const require_ = (req, res, next) => (valid(req) ? next() : res.status(401).json({ error: 'Login korun' }));

module.exports = { login, logout, require: require_, valid };
