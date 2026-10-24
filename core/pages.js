// Multiple Facebook pages. The token in Settings is the "default page"; extra pages live here.
const { col } = require('./db');
const S = require('./settings');
const fb = require('./facebook');
const { enc, dec } = require('./crypto');
const L = require('./logger');

let cache = null;
const bust = () => { cache = null; };
async function all() {
  if (cache) return cache;
  cache = (await col('pages').find({}).toArray()).map((r) => ({ ...r, token: dec(r.token) }));
  return cache;
}
const defaultPage = (id) => ({ pageId: String(id || ''), name: S.get('page_name'), token: S.get('fb_page_token'), bot_on: true, messenger_on: true, comment_on: true, active: true, default: true });

async function byFbId(id) {
  const p = (await all()).find((x) => x.pageId === String(id));
  if (p) return p.active === false ? null : p;
  return S.get('fb_page_token') ? defaultPage(id) : null;
}
const byId = async (pageId) => (pageId ? byFbId(pageId) : S.get('fb_page_token') ? defaultPage('') : null);

async function add(token) {
  const info = await fb.runWith({ token }, () => fb.pageInfo());
  await col('pages').updateOne({ pageId: String(info.id) }, { $set: { name: info.name, token: enc(token), active: true, updatedAt: new Date() }, $setOnInsert: { pageId: String(info.id), bot_on: true, messenger_on: true, comment_on: true, createdAt: new Date() } }, { upsert: true });
  bust();
  L.ok('pages', `Page add hoyeche: ${info.name} (${info.id})`);
  return info;
}
async function update(pageId, patch) {
  const set = {};
  for (const k of ['bot_on', 'messenger_on', 'comment_on', 'active']) if (k in patch) set[k] = !!patch[k];
  if (patch.name) set.name = String(patch.name);
  await col('pages').updateOne({ pageId }, { $set: set });
  bust();
}
async function remove(pageId) { await col('pages').deleteOne({ pageId }); bust(); }
async function list() {
  return (await all()).map((p) => ({ pageId: p.pageId, name: p.name, bot_on: p.bot_on !== false, messenger_on: p.messenger_on !== false, comment_on: p.comment_on !== false, active: p.active !== false, last4: String(p.token).slice(-4) }));
}
module.exports = { byFbId, byId, add, update, remove, list, bust };
