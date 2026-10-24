// FB Shop Agent: entry point. Only 3 env vars are needed: ADMIN_PASSWORD, MONGODB_URI, SECRET_KEY.
const express = require('express');
const path = require('path');
const L = require('./core/logger');

process.on('uncaughtException', (e) => L.error('crash', 'uncaughtException: ' + e.message, e));
process.on('unhandledRejection', (e) => L.error('crash', 'unhandledRejection: ' + ((e && e.message) || e), e));

const missing = ['ADMIN_PASSWORD', 'MONGODB_URI', 'SECRET_KEY'].filter((k) => !process.env[k]);
const state = { ready: false, err: missing.length ? `Render > Environment e ei variable gulo nai: ${missing.join(', ')}` : '' };

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// health first, so Render + UptimeRobot work even while booting
app.get('/health', (req, res) => res.json({ ok: state.ready, uptime: Math.round(process.uptime()), error: state.err || undefined }));
app.use(express.json({ limit: '8mb', verify: (req, res, buf) => { req.rawBody = buf; } }));

const db = require('./core/db');
const S = require('./core/settings');
const M = require('./core/media');
const auth = require('./core/auth');
const fb = require('./core/facebook');
const Pages = require('./core/pages');
const N = require('./core/notify');
const O = require('./core/orders');
const P = require('./core/products');
const bus = require('./core/bus');
const agent = require('./core/agent');
const modules = require('./core/modules');
const { col } = db;

app.use((req, res, next) => { M.setHost(`${req.protocol}://${req.get('host')}`); next(); });
app.get('/media/:id', async (req, res) => {
  if (!state.ready) return res.sendStatus(503);
  const m = await M.serve(req.params.id).catch(() => null);
  if (!m) return res.sendStatus(404);
  res.set({ 'Content-Type': m.mime, 'Cache-Control': 'public, max-age=86400' }).send(m.buf);
});
app.use(['/api', '/webhook'], (req, res, next) => (state.ready ? next() : res.status(503).json({ error: state.err || 'Server shuru hocche, ektu opekkha korun' })));
app.use(require('./core/webhook').router);
app.post('/api/login', auth.login);
app.post('/api/logout', auth.logout);
app.use('/api', auth.require, require('./core/api'));
app.use((err, req, res, next) => { L.error('http', `${req.method} ${req.originalUrl}: ${err.message}`, err); res.status(500).json({ error: err.message }); });
app.use(express.static(path.join(__dirname, 'public')));

const port = process.env.PORT || 3000;
app.listen(port, () => L.info('boot', `Server port ${port} e shuru (DB connect hocche...)`));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function timers() {
  setInterval(() => O.expireUnpaid().catch((e) => L.error('timer', e.message, e)), 10 * 60000);
  setInterval(() => subscribeAll().catch(() => {}), 3600e3);
  setInterval(() => agent.followUps().catch((e) => L.error('followup', e.message, e)), 10 * 60000);
  // check Facebook token every 6h
  setInterval(async () => {
    if (!S.get('fb_page_token')) return;
    try { await fb.pageInfo(); L.ok('facebook', 'Token health check thik ache'); subscribeAll().catch(() => {}); } catch (e) { L.error('facebook', 'Token health check fail: ' + e.message); N.admin('system', 'Facebook token e shomossha', e.message); }
  }, 6 * 3600e3);
  // daily report 22:00 Dhaka
  let lastDay = '';
  setInterval(async () => {
    const d = new Date(Date.now() + 6 * 3600e3);
    const day = d.toISOString().slice(0, 10);
    if (d.getUTCHours() !== 22 || lastDay === day || !S.get('daily_report')) return;
    lastDay = day;
    const start = new Date(Date.parse(day + 'T00:00:00Z') - 6 * 3600e3);
    const rows = await col('orders').aggregate([{ $match: { test: { $ne: true }, createdAt: { $gte: start } } }, { $group: { _id: '$status', n: { $sum: 1 }, sum: { $sum: '$total' } } }]).toArray();
    const g = (s) => rows.find((x) => x._id === s) || { n: 0, sum: 0 };
    const total = rows.filter((x) => x._id !== 'cancelled').reduce((a, x) => a + x.sum, 0);
    N.admin('daily_report', `Ajker report (${day})`, `Notun order: ${rows.reduce((a, x) => a + x.n, 0)}\nBikri (cancel bade): ${O.money(total)}\nConfirmed ${g('confirmed').n}, Shipped ${g('shipped').n}, Delivered ${g('delivered').n}, Cancelled ${g('cancelled').n}`);
  }, 60000);
}

async function subscribeAll() {
  if (S.get('fb_page_token')) {
    const pgs = await fb.pagesFromUserToken(S.get('fb_page_token')).catch(() => []);
    if (pgs.length) { await S.save({ fb_page_token: pgs[0].access_token }); L.ok('facebook', 'Saved token User token chhilo, Page Token e bodlano holo: ' + pgs[0].name); }
    await fb.ensureSubscribed(null, 'Main page');
  }
  for (const p of await Pages.list().catch(() => [])) {
    if (!p.active) continue;
    const full = await Pages.byFbId(p.pageId).catch(() => null);
    if (full) await fb.ensureSubscribed(full, p.name || p.pageId);
  }
}

async function boot() {
  if (missing.length) return L.error('boot', state.err);
  for (;;) {
    try { await db.connect(process.env.MONGODB_URI); break; } catch (e) {
      state.err = 'MongoDB connect hoy ni: ' + e.message + ' | Atlas > Network Access e 0.0.0.0/0 allow ache? URI er user/password thik? URI er shesh e database naam ache?';
      L.error('boot', state.err);
      await sleep(15000);
    }
  }
  modules.loadAll();
  await S.load();
  if (!S.get('fb_verify_token')) await S.save({ fb_verify_token: S.randomToken() });
  fb.hooks.onTokenError = (e) => N.admin('system', 'Facebook token kaj korche na', e.message);
  modules.initAll(app, [auth.require, auth.need('orders')], { S, col, O, L, N, bus, agent, fb, P, Pages });
  timers();
  state.ready = true; state.err = '';
  // make sure Facebook really sends page messages to this server
  setTimeout(() => subscribeAll().catch(() => {}), 3000);
  L.ok('boot', 'Shob ready. Panel khulun, Settings theke Facebook ar AI key boshan.');
}
boot().catch((e) => { state.err = 'Boot fail: ' + e.message; L.error('boot', state.err, e); });
