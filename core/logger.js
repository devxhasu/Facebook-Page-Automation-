// Central logger: console (Render logs) + live ring buffer (panel) + MongoDB (14 days)
const subs = new Set();
const ring = [];
let sink = null;

const SECRET = /(EAA[A-Za-z0-9]{20,}|sk-or-[A-Za-z0-9_-]{10,}|AIza[0-9A-Za-z_-]{20,}|xai-[A-Za-z0-9]{10,}|\d{6,}:[A-Za-z0-9_-]{30,}|mongodb(\+srv)?:\/\/[^\s"']+)/g;
const mask = (s) => String(s).replace(SECRET, (m) => m.slice(0, 6) + '****');
const fmt = (m) => {
  if (m == null) return '';
  if (m instanceof Error) return m.stack || m.message;
  if (typeof m === 'string') return m;
  try { return JSON.stringify(m); } catch { return String(m); }
};

function log(type, msg, meta, level = 'info') {
  const e = { t: Date.now(), type, level, msg: mask(msg), meta: meta == null ? undefined : mask(fmt(meta)).slice(0, 1500) };
  ring.push(e);
  if (ring.length > 400) ring.shift();
  const line = `[${new Date(e.t).toISOString()}] ${level.toUpperCase().padEnd(5)} ${String(type).padEnd(9)} ${e.msg}${e.meta ? ' | ' + e.meta : ''}`;
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
  subs.forEach((fn) => { try { fn(e); } catch {} });
  if (sink) sink.insertOne({ ...e, createdAt: new Date(e.t) }).catch(() => {});
}

module.exports = {
  log,
  info: (t, m, x) => log(t, m, x, 'info'),
  ok: (t, m, x) => log(t, m, x, 'ok'),
  warn: (t, m, x) => log(t, m, x, 'warn'),
  error: (t, m, x) => log(t, m, x, 'error'),
  subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
  recent: () => ring.slice(),
  setSink: (c) => { sink = c; },
  clear: async () => { ring.length = 0; if (sink) await sink.deleteMany({}); },
  mask,
};
