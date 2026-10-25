// Customer tags, "hot customer" score and fake-order risk checks.
const { col } = require('./db');
const S = require('./settings');
const L = require('./logger');

const HOUR = 3600e3;
// how close is this customer to buying? 0-100
function hotScore(c) {
  const now = Date.now();
  const last = c.lastMsgAt ? +new Date(c.lastMsgAt) : 0;
  const interestAt = (c.interest && c.interest.at) || 0;
  if (c.lastOrderAt && +new Date(c.lastOrderAt) > interestAt) return 0;
  if (c.blocked || !interestAt || now - interestAt > 3 * 24 * HOUR) return 0;
  let s = 20;
  if (c.sel) s += 20;
  if (c.draft) s += 35;
  if (c.phone) s += 10;
  if (c.address) s += 5;
  if (now - last < 6 * HOUR) s += 10;
  else if (now - last < 24 * HOUR) s += 5;
  if (c.bargain) s += 5;
  if (c.wait_q) s -= 10;
  return Math.max(0, Math.min(100, s));
}

async function tagsFor(c) {
  const tags = [];
  const orders = await col('orders').find({ psid: c.psid, test: { $ne: true } }).toArray();
  const done = orders.filter((o) => o.status === 'delivered').length;
  const bad = orders.filter((o) => ['cancelled', 'returned'].includes(o.status)).length;
  const spent = orders.filter((o) => o.status === 'delivered').reduce((a, o) => a + (o.total || 0), 0);
  const age = Date.now() - +new Date(c.createdAt || Date.now());
  if (!orders.length && age < 3 * 24 * HOUR) tags.push('New');
  if (hotScore(c) >= 40) tags.push('Hot');
  if (done >= 2) tags.push('Repeat');
  if (done >= 5 || spent >= (S.num('vip_spent') || 10000)) tags.push('VIP');
  if (c.flagged || c.blocked || (c.abuse_n || 0) > 0 || bad >= 2) tags.push('Problem');
  if (c.risky) tags.push('Risky');
  return { tags, hot: hotScore(c), spent };
}

async function refresh() {
  const since = new Date(Date.now() - 14 * 24 * HOUR);
  const list = await col('customers').find({ test: { $ne: true }, lastMsgAt: { $gte: since } }).limit(400).toArray();
  for (const c of list) {
    const r = await tagsFor(c);
    await col('customers').updateOne({ psid: c.psid }, { $set: { tags: r.tags, hot: r.hot, spent: r.spent } });
  }
}

// fake / risky order check. score >= 2 => admin must approve even Cash on Delivery
async function risk(c, phone, address) {
  const reasons = [];
  if (S.get('risk_guard_on') === false) return { score: 0, reasons };
  const byPhone = await col('orders').find({ phone, test: { $ne: true } }).toArray();
  const bad = byPhone.filter((o) => ['cancelled', 'returned'].includes(o.status)).length;
  if (bad >= 2) reasons.push(`Ei number e ${bad} ta cancelled/returned order`);
  const others = new Set(byPhone.map((o) => o.psid).filter((x) => x !== c.psid));
  if (others.size >= 2) reasons.push(`Ekoi number onno ${others.size} ta alada account theke`);
  const names = new Set(byPhone.map((o) => String(o.name || '').toLowerCase().trim()).filter(Boolean));
  if (names.size >= 3) reasons.push('Ekoi number e onek alada naam');
  const nm = String(c.name || '').trim();
  if (nm.length < 3 || /^(test|abc|xyz|asdf|aaa+|qwe)/i.test(nm)) reasons.push('Naam shondehojonok');
  const ad = String(address || '');
  if (ad.length < 12 || !/[\p{L}]{3,}/u.test(ad) || /(.)\1{4,}/.test(ad)) reasons.push('Address choto ba ojotik');
  if (c.abuse_n >= 2) reasons.push('Age gali diyechhe');
  if (c.blocked) reasons.push('Blocked customer');
  return { score: reasons.length >= 2 ? 2 : reasons.length, reasons };
}
let timer = null;
const start = () => { if (!timer) { refresh().catch(() => {}); timer = setInterval(() => refresh().catch((e) => L.warn('crm', e.message)), 10 * 60000); timer.unref && timer.unref(); } };

module.exports = { hotScore, tagsFor, refresh, risk, start };
