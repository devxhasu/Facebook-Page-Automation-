// Messages the shop starts itself (cart reminder, review ask, back-in-stock).
// Facebook only lets a page message a customer within 24h of the customer's last message. So:
//  - if the customer wrote in the last 23h the message is sent at once,
//  - otherwise it waits in the "outbox" and goes out as the first line the next time the customer writes.
const { col } = require('./db');
const S = require('./settings');
const L = require('./logger');
const I = require('./i18n');
const N = require('./notify');

I.add({
  'or.reminder': {
    bl: ['Apnar {name} order ta ekhono baki. Confirm korbo?', '{name} ta ekhono apnar jonno rakha ache. Order ta confirm kore dibo?'],
    bn: ['আপনার {name} অর্ডারটা এখনো বাকি। কনফার্ম করবো?', '{name} টা এখনো আপনার জন্য রাখা আছে। অর্ডারটা কনফার্ম করে দিবো?'],
    en: ['Your order for {name} is still pending. Shall I confirm it?', 'We are still holding {name} for you. Want me to confirm the order?'],
  },
  'or.review': {
    bl: ['Apnar order #{id} ta kemon laglo? Kono shomossha thakle bolben.', 'Order #{id} peyechen to? Product ta kemon laglo bolben.'],
    bn: ['আপনার অর্ডার #{id} কেমন লাগলো? কোনো সমস্যা থাকলে বলবেন।', 'অর্ডার #{id} পেয়েছেন তো? প্রোডাক্টটা কেমন লাগলো বলবেন।'],
    en: ['How did you like order #{id}? Let us know if anything is wrong.', 'Did order #{id} arrive well? Tell us how you liked it.'],
  },
  'or.coupon': { bl: ' Porer order e {code} code e {pct}% discount pabenn.', bn: ' পরের অর্ডারে {code} কোডে {pct}% ডিসকাউন্ট পাবেন।', en: ' Use code {code} for {pct}% off your next order.' },
  'or.restock': {
    bl: ['Apni je {name} chaichilen ta ekhon stock e ashche. Nite chan?', '{name} abar stock e ashche, nibo?'],
    bn: ['আপনি যে {name} চেয়েছিলেন সেটা এখন স্টকে এসেছে। নিতে চান?', '{name} আবার স্টকে এসেছে, নিবেন?'],
    en: ['The {name} you wanted is back in stock. Would you like it?', '{name} is available again. Shall I get it for you?'],
  },
  'or.restock_opt': {
    bl: ['{name} er {value} {option} ta ekhon stock e ashche. Nite chan?'],
    bn: ['{name} এর {value} {option} টা এখন স্টকে এসেছে। নিতে চান?'],
    en: ['{name} in {option} {value} is back in stock. Would you like it?'],
  },
});

const HOUR = 3600e3;
const inWindow = (c) => c && c.lastMsgAt && Date.now() - +new Date(c.lastMsgAt) < 23 * HOUR;

async function queue(psid, kind, text, { pageId = '', key = '' } = {}) {
  const k = key || `${psid}:${kind}`;
  const dup = await col('outbox').findOne({ key: k });
  if (dup) return dup;
  const row = { psid, kind, text, pageId, key: k, sent: false, createdAt: new Date() };
  await col('outbox').insertOne(row);
  const c = await col('customers').findOne({ psid });
  if (inWindow(c) && !(c.human_until && c.human_until > Date.now())) {
    const ok = await N.customer(psid, text, { pageId }).catch(() => false);
    if (ok) { await col('outbox').updateOne({ key: k }, { $set: { sent: true, sentAt: new Date(), via: 'now' } }); await col('messages').insertOne({ psid, role: 'assistant', text, t: Date.now() }).catch(() => {}); }
  }
  return row;
}

// waiting messages for a customer who just wrote (max 2, newest 3 days)
async function pending(c) {
  const rows = await col('outbox').find({ psid: c.psid, sent: false, createdAt: { $gt: new Date(Date.now() - 3 * 24 * HOUR) } }).sort({ createdAt: 1 }).limit(4).toArray();
  const busy = !!(c.sel || c.draft);
  return rows.filter((r) => !(busy && r.kind === 'review')).slice(0, 2);
}
const done = (rows) => Promise.all(rows.map((r) => col('outbox').updateOne({ key: r.key }, { $set: { sent: true, sentAt: new Date(), via: 'next_message' } })));

// product (or one sold-out option value) is back: tell everyone who asked
async function restocked(code, opt) {
  const P = require('./products');
  const p = await P.get(code);
  if (!p) return;
  const q = { code, notified: false };
  if (opt) { q.option = opt.option; q.value = opt.value; }
  const rows = await col('waitlist').find(q).toArray();
  for (const w of rows) {
    const c = await col('customers').findOne({ psid: w.psid });
    const lg = c || 'bl';
    const name = `${p.name}${p.variant ? ' ' + p.variant : ''}`;
    const text = opt ? I.t('or.restock_opt', lg, { name, option: opt.option, value: opt.value }) : I.t('or.restock', lg, { name });
    await queue(w.psid, 'restock', text, { pageId: w.pageId || '', key: `restock:${w._id || w.psid}:${Date.now()}` });
    await col('waitlist').updateOne({ psid: w.psid, code, option: w.option, value: w.value, notified: false }, { $set: { notified: true, at: new Date() } });
  }
  if (rows.length) L.ok('outreach', `${p.name}: ${rows.length} jon customer ke "stock e ashche" janano hoyeche/queue hoyeche`);
}
async function addWait(c, ctx, code, opt) {
  const w = { psid: c.psid, pageId: (ctx && ctx.page && ctx.page.pageId) || c.pageId || '', code, name: c.name || c.fbname || c.psid, notified: false, createdAt: new Date() };
  if (opt) { w.option = opt.option; w.value = opt.value; }
  const dup = await col('waitlist').findOne({ psid: c.psid, code, option: w.option, value: w.value, notified: false });
  if (!dup) await col('waitlist').insertOne(w);
}

// ---------- scheduled jobs (every 10 minutes) ----------
async function jobs() {
  // 1) cart reminder: order preview was sent 3-22h ago and the customer never confirmed
  if (S.get('cart_reminder_on') !== false) {
    const P = require('./products');
    const rows = await col('customers').find({ 'draft.at': { $lt: Date.now() - 3 * HOUR, $gt: Date.now() - 22 * HOUR }, test: { $ne: true }, blocked: { $ne: true } }).limit(30).toArray();
    for (const c of rows) {
      if (!c.draft || c.reminded_for === c.draft.at) continue;
      await col('customers').updateOne({ psid: c.psid }, { $set: { reminded_for: c.draft.at } });
      const p = await P.get((c.draft.items[0] || {}).code);
      const name = p ? `${p.name}${p.variant ? ' ' + p.variant : ''}` : 'order';
      await queue(c.psid, 'reminder', I.t('or.reminder', c, { name }), { pageId: c.pageId, key: `reminder:${c.psid}:${c.draft.at}` });
    }
  }
  // 2) review ask 2 days after delivery
  if (S.get('review_on') !== false) {
    const since = new Date(Date.now() - 10 * 24 * HOUR);
    const os = await col('orders').find({ status: 'delivered', test: { $ne: true }, review_asked: { $ne: true }, deliveredAt: { $lt: new Date(Date.now() - 2 * 24 * HOUR), $gt: since } }).limit(30).toArray();
    for (const o of os) {
      await col('orders').updateOne({ id: o.id }, { $set: { review_asked: true } });
      const c = await col('customers').findOne({ psid: o.psid });
      let text = I.t('or.review', c || 'bl', { id: o.id });
      const pct = S.num('review_coupon_pct');
      if (pct > 0) {
        const code = 'THX' + Math.random().toString(36).slice(2, 6).toUpperCase();
        await col('coupons').insertOne({ code, type: 'percent', value: pct, min: 0, maxUses: 1, active: true, note: 'review #' + o.id });
        text += I.t('or.coupon', c || 'bl', { code, pct });
      }
      await queue(o.psid, 'review', text, { pageId: o.pageId, key: `review:${o.id}` });
    }
  }
}
let timer = null;
const start = () => { if (!timer) { timer = setInterval(() => jobs().catch((e) => L.error('outreach', e.message, e)), 10 * 60000); timer.unref && timer.unref(); } };

module.exports = { queue, pending, done, restocked, addWait, jobs, start, inWindow };
