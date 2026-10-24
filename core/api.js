const express = require('express');
const { ObjectId, EJSON } = require('mongodb');
const { col, ping } = require('./db');
const S = require('./settings');
const L = require('./logger');
const AI = require('./ai');
const fb = require('./facebook');
const P = require('./products');
const O = require('./orders');
const M = require('./media');
const N = require('./notify');
const agent = require('./agent');
const comments = require('./comments');
const modules = require('./modules');
const schema = require('./schema');

const r = express.Router();
const wrap = (f) => (req, res) => Promise.resolve(f(req, res)).catch((e) => { L.error('api', `${req.method} ${req.originalUrl}: ${e.message}`, e); res.status(500).json({ error: e.message }); });
const GEN = { kb: ['title', 'content', 'active'], coupons: ['code', 'type', 'value', 'min', 'maxUses', 'active'], post_links: ['post_id', 'product_code', 'note'] };
const BACKUP = ['settings', 'products', 'customers', 'orders', 'payments', 'kb', 'coupons', 'post_links', 'counters', 'unknown', 'attention'];

r.get('/me', (q, s) => s.json({ ok: true }));

r.get('/dashboard', wrap(async (q, s) => {
  const d = new Date(Date.now() + 6 * 3600e3); d.setUTCHours(0, 0, 0, 0);
  const start = new Date(d.getTime() - 6 * 3600e3);
  const counts = {};
  (await col('orders').aggregate([{ $match: { test: { $ne: true } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]).toArray()).forEach((x) => { counts[x._id] = x.n; });
  const today = await col('orders').aggregate([{ $match: { test: { $ne: true }, createdAt: { $gte: start }, status: { $ne: 'cancelled' } } }, { $group: { _id: null, n: { $sum: 1 }, sum: { $sum: '$total' } } }]).toArray();
  const ai = await AI.status();
  s.json({
    counts, today: { orders: (today[0] && today[0].n) || 0, revenue: (today[0] && today[0].sum) || 0 },
    attention: await col('attention').countDocuments({ resolved: false }), unread: await col('notifications').countDocuments({ read: false }),
    unknown: await col('unknown').countDocuments({ answered: false }),
    bot: { bot_on: S.get('bot_on'), messenger_on: S.get('messenger_on'), comment_on: S.get('comment_on') },
    fb: { ...fb.status, hasToken: !!S.get('fb_page_token') }, ai, uptime: Math.round(process.uptime()), db: await ping().catch(() => false),
    webhook: { url: M.base() + '/webhook', verify: S.get('fb_verify_token') },
  });
}));

// ----- settings -----
r.get('/schema', (q, s) => {
  const sections = [...schema];
  for (const m of modules.list()) sections.push({ id: 'mod_' + m.name, title: m.title + ' (module)', fields: [{ k: `mod_${m.name}_on`, l: 'Module chalu', t: 'bool' }, ...m.fields.map((f) => ({ k: f.key, l: f.label || f.key, t: f.type || (f.secret ? 'secret' : 'text'), h: f.hint }))] });
  s.json({ sections, values: S.masked() });
});
r.post('/settings', wrap(async (q, s) => { await S.save(q.body || {}); L.ok('settings', 'Setting save hoyeche'); s.json({ ok: true }); }));

// ----- facebook connection -----
r.get('/connection', wrap(async (q, s) => {
  const info = { webhook_url: M.base() + '/webhook', verify_token: S.get('fb_verify_token'), has_token: !!S.get('fb_page_token'), status: fb.status };
  if (info.has_token) {
    try {
      const p = await fb.pageInfo();
      info.ok = true; info.page = { id: p.id, name: p.name, category: p.category, fans: p.fan_count, pic: p.picture && p.picture.data && p.picture.data.url };
      comments.setPageId(p.id);
      if (!S.get('page_name')) await S.save({ page_name: p.name });
    } catch (e) { info.ok = false; info.error = e.message; }
    try { info.subscribed = ((await fb.subscribed()).data || []).map((a) => ({ name: a.name, fields: a.subscribed_fields })); } catch (e) { info.subscribed_error = e.message; }
    try { const t = await fb.debugToken(); if (t) info.token = { valid: t.is_valid, type: t.type, expires: t.expires_at ? new Date(t.expires_at * 1000).toISOString().slice(0, 10) : 'never', scopes: t.scopes }; } catch {}
  }
  s.json(info);
}));
r.post('/connection/subscribe', wrap(async (q, s) => { await fb.subscribe(); L.ok('facebook', 'Page webhook e subscribe hoyeche'); s.json({ ok: true }); }));

// ----- AI -----
r.get('/ai/status', wrap(async (q, s) => s.json(await AI.status())));
r.post('/ai/test', wrap(async (q, s) => s.json({ results: await AI.test(String(q.body.provider || '')) })));

// ----- products -----
r.get('/products', wrap(async (q, s) => s.json(await P.all())));
r.post('/products', wrap(async (q, s) => { try { s.json({ ok: true, ...(await P.save(q.body || {})) }); } catch (e) { s.status(400).json({ error: e.message }); } }));
r.delete('/products/:code', wrap(async (q, s) => { await P.remove(q.params.code); s.json({ ok: true }); }));
r.post('/upload', wrap(async (q, s) => {
  const m = String((q.body && q.body.dataUrl) || '').match(/^data:(image\/[a-z+.-]+);base64,(.+)$/);
  if (!m) return s.status(400).json({ error: 'Image format thik na' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 3 * 1024 * 1024) return s.status(400).json({ error: 'Image 3MB er boro' });
  s.json({ url: await M.hostImage(buf, m[1]) });
}));

// ----- orders -----
r.get('/orders', wrap(async (q, s) => {
  const f = {};
  if (q.query.status) f.status = q.query.status;
  s.json(await col('orders').find(f).sort({ id: -1 }).limit(150).toArray());
}));
r.post('/orders/:id/action', wrap(async (q, s) => {
  const id = Number(q.params.id), b = q.body || {};
  switch (b.action) {
    case 'approve': await O.setStatus(id, 'confirmed', 'admin', 'approved'); break;
    case 'payment_received': await O.paymentReceived(id); break;
    case 'payment_reject': await O.paymentRejected(id); break;
    case 'status': await O.setStatus(id, b.status, 'admin', b.note || ''); break;
    case 'tracking': await col('orders').updateOne({ id }, { $set: { tracking: { courier: b.courier || '', code: b.code || '' } } }); break;
    case 'refunded': await col('orders').updateOne({ id }, { $set: { refund_pending: false } }); break;
    case 'delete': await col('orders').deleteOne({ id, test: true }); break;
    default: return s.status(400).json({ error: 'Unknown action' });
  }
  s.json({ ok: true });
}));

// ----- customers / attention / unknown -----
r.get('/customers', wrap(async (q, s) => s.json(await col('customers').find({ test: { $ne: true } }).sort({ lastMsgAt: -1 }).limit(150).toArray())));
r.post('/customers/:psid', wrap(async (q, s) => {
  const a = (q.body || {}).action, set = {};
  if (a === 'block') set.blocked = true; else if (a === 'unblock') set.blocked = false;
  else if (a === 'pause') set.human_until = Date.now() + Math.max(1, S.num('human_pause_min')) * 60000;
  else if (a === 'resume') set.human_until = 0;
  else if (a === 'flag') set.flagged = true; else if (a === 'unflag') set.flagged = false;
  else return s.status(400).json({ error: 'Unknown action' });
  await col('customers').updateOne({ psid: q.params.psid }, { $set: set });
  s.json({ ok: true });
}));
r.get('/attention', wrap(async (q, s) => s.json(await col('attention').find({ resolved: false }).sort({ createdAt: -1 }).limit(100).toArray())));
r.post('/attention/:id/resolve', wrap(async (q, s) => { await col('attention').updateOne({ _id: new ObjectId(q.params.id) }, { $set: { resolved: true } }); s.json({ ok: true }); }));
r.get('/unknown', wrap(async (q, s) => s.json(await col('unknown').find({ answered: false }).sort({ createdAt: -1 }).limit(100).toArray())));
r.post('/unknown/:id/answer', wrap(async (q, s) => {
  const u = await col('unknown').findOne({ _id: new ObjectId(q.params.id) });
  if (!u) return s.status(404).json({ error: 'Paoa jayni' });
  const ans = String((q.body || {}).answer || '').trim();
  if (ans) await col('kb').insertOne({ title: u.q, content: ans, active: true });
  await col('unknown').updateOne({ _id: u._id }, { $set: { answered: true } });
  s.json({ ok: true });
}));

// ----- generic simple collections (knowledge, coupons, post links) -----
r.get('/c/:n', wrap(async (q, s) => { if (!GEN[q.params.n]) return s.sendStatus(404); s.json(await col(q.params.n).find({}).sort({ _id: -1 }).limit(500).toArray()); }));
r.post('/c/:n', wrap(async (q, s) => {
  const n = q.params.n; if (!GEN[n]) return s.sendStatus(404);
  const d = {};
  for (const k of GEN[n]) if (k in (q.body || {})) d[k] = q.body[k];
  if (d.active !== undefined) d.active = d.active === true || d.active === 'true';
  for (const k of ['value', 'min', 'maxUses']) if (k in d) d[k] = Number(d[k]) || 0;
  if (n === 'coupons' && d.code) d.code = String(d.code).trim().toUpperCase();
  if (n === 'post_links' && d.product_code) d.product_code = String(d.product_code).trim().toUpperCase();
  if (q.body._id) await col(n).updateOne({ _id: new ObjectId(q.body._id) }, { $set: d }); else await col(n).insertOne(d);
  s.json({ ok: true });
}));
r.delete('/c/:n/:id', wrap(async (q, s) => { if (!GEN[q.params.n]) return s.sendStatus(404); await col(q.params.n).deleteOne({ _id: new ObjectId(q.params.id) }); s.json({ ok: true }); }));

// ----- notifications -----
r.get('/notifications', wrap(async (q, s) => s.json(await col('notifications').find({}).sort({ createdAt: -1 }).limit(60).toArray())));
r.post('/notifications/read', wrap(async (q, s) => { await col('notifications').updateMany({ read: false }, { $set: { read: true } }); s.json({ ok: true }); }));

// ----- logs -----
r.get('/logs', wrap(async (q, s) => {
  const lim = Math.min(500, Number(q.query.limit) || 200);
  const rows = await col('logs').find({}).sort({ t: -1 }).limit(lim).toArray();
  s.json(rows.reverse().map((x) => ({ t: x.t, type: x.type, level: x.level, msg: x.msg, meta: x.meta })));
}));
r.get('/logs/stream', (q, s) => {
  s.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  s.flushHeaders();
  const send = (e) => s.write(`data: ${JSON.stringify(e)}\n\n`);
  L.recent().slice(-60).forEach(send);
  const un = L.subscribe(send);
  const ka = setInterval(() => s.write(': ping\n\n'), 20000);
  q.on('close', () => { un(); clearInterval(ka); });
});

// ----- test chat -----
r.post('/test-chat', wrap(async (q, s) => s.json({ messages: await agent.testChat((q.body || {}).session, String((q.body || {}).text || '').slice(0, 1000)) })));
r.post('/test-chat/reset', wrap(async (q, s) => {
  const ids = (await col('customers').find({ psid: /^TEST-/ }).toArray()).map((c) => c.psid);
  await col('messages').deleteMany({ psid: { $in: ids } });
  await col('customers').deleteMany({ psid: /^TEST-/ });
  await col('orders').deleteMany({ test: true });
  s.json({ ok: true });
}));

// ----- system -----
r.get('/modules', (q, s) => s.json(modules.list()));
r.post('/system/soft-restart', wrap(async (q, s) => { await S.load(); P.bust(); L.ok('system', 'Soft restart: setting abar load hoyeche'); s.json({ ok: true }); }));
r.post('/system/restart', (q, s) => { L.warn('system', 'Server restart hocche (admin er anurodhe)'); s.json({ ok: true }); setTimeout(() => process.exit(0), 600); });
r.get('/backup', wrap(async (q, s) => {
  const out = {};
  for (const n of BACKUP) out[n] = await col(n).find({}).toArray();
  s.set({ 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="backup-${new Date().toISOString().slice(0, 10)}.json"` });
  s.send(EJSON.stringify(out, { relaxed: false }));
}));
r.post('/restore', wrap(async (q, s) => {
  const data = EJSON.parse(JSON.stringify((q.body || {}).data || {}));
  let n = 0;
  for (const name of BACKUP) {
    if (!Array.isArray(data[name])) continue;
    await col(name).deleteMany({});
    if (data[name].length) await col(name).insertMany(data[name]);
    n++;
  }
  await S.load(); P.bust();
  L.ok('system', `Restore hoyeche (${n} ta collection)`);
  s.json({ ok: true, collections: n });
}));

module.exports = r;
