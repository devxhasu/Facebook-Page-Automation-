const { col, nextId } = require('./db');
const S = require('./settings');
const P = require('./products');
const N = require('./notify');
const bus = require('./bus');
const L = require('./logger');

const PHONE = /^(?:\+?88)?(01[3-9]\d{8})$/;
const normPhone = (p) => { const m = String(p || '').replace(/[\s-]/g, '').match(PHONE); return m ? m[1] : null; };
// obvious fake numbers: 01711111111, 01712121212, 0171234567x ...
function isFakePhone(p) {
  const d = String(p).slice(3);
  if (new Set(d.split('')).size <= 2) return true;
  if ('0123456789'.includes(d.slice(0, 6)) || '9876543210'.includes(d.slice(0, 6))) return true;
  if (/(\d{2})\1{3,}/.test(d) || /(\d{3})\1{2,}/.test(d)) return true;
  return false;
}
const money = (n) => Math.round(Number(n) || 0).toLocaleString('en-US') + ' tk';
const OPEN = ['pending', 'awaiting_payment', 'payment_review', 'confirmed'];
const MODE_NAME = { cod: 'Cash on Delivery', delivery_advance: 'Delivery charge advance', full_advance: 'Full advance' };
const isTrusted = (c) => !c.flagged && (c.orders_done || 0) >= Math.max(1, S.num('trusted_after'));
const ci = (o) => { const r = {}; for (const k of Object.keys(o || {})) r[k.toLowerCase()] = o[k]; return r; };

// ---- price calculation (server decides every number, AI never does) ----
async function calc(customer, items, { inside_dhaka = false, coupon = '', extra_discount_pct = 0 } = {}) {
  if (!Array.isArray(items) || !items.length) return { error: 'no_items' };
  const lines = [];
  let subtotal = 0;
  for (const it of items) {
    const p = await P.get(it.code);
    if (!p || !p.active) return { error: 'product_not_found', code: it.code };
    const qty = Math.max(1, parseInt(it.qty || 1) || 1);
    if (p.stock < qty) return { error: 'out_of_stock', code: p.code, name: p.name, stock: p.stock };
    const given = ci(it.options);
    const chosen = {};
    for (const o of p.options || []) {
      const v = given[o.name.toLowerCase()];
      if (v == null || v === '') return { error: 'missing_option', code: p.code, name: p.name, option: o.name, values: o.values };
      const hit = o.values.find((x) => x.toLowerCase() === String(v).toLowerCase());
      if (!hit) return { error: 'invalid_option', code: p.code, name: p.name, option: o.name, values: o.values };
      chosen[o.name] = hit;
    }
    lines.push({ code: p.code, name: p.name, variant: p.variant, qty, price: p.price, options: chosen, total: p.price * qty });
    subtotal += p.price * qty;
  }
  // bundle offers: every code of a bundle in the cart -> bundle price
  let bundleDisc = 0;
  const applied = [];
  for (const b of await col('bundles').find({ active: { $ne: false } }).toArray()) {
    const codes = (b.codes || []).map((x) => String(x).trim().toUpperCase()).filter(Boolean);
    if (codes.length < 2) continue;
    const qtys = codes.map((cd) => lines.filter((l) => l.code.toUpperCase() === cd).reduce((a, l) => a + l.qty, 0));
    const times = Math.min(...qtys);
    if (times < 1) continue;
    const unit = codes.reduce((a, cd) => a + lines.find((l) => l.code.toUpperCase() === cd).price, 0);
    const save = (unit - Number(b.price)) * times;
    if (save > 0) { bundleDisc += save; applied.push(b.name); }
  }
  let discount = bundleDisc, couponUsed = '';
  if (coupon) {
    const c = await col('coupons').findOne({ code: String(coupon).trim().toUpperCase() });
    if (c && c.active !== false && subtotal >= (Number(c.min) || 0) && (!Number(c.maxUses) || (c.uses || 0) < Number(c.maxUses))) {
      discount += c.type === 'flat' ? Number(c.value) || 0 : (subtotal * (Number(c.value) || 0)) / 100;
      couponUsed = c.code;
    } else return { error: 'invalid_coupon' };
  }
  const pct = Math.min(Math.max(Number(extra_discount_pct) || 0, 0), S.num('max_discount_pct'));
  if (pct > 0) discount += (subtotal * pct) / 100;
  discount = Math.min(Math.round(discount), subtotal);
  const net = subtotal - discount;
  const freeMin = S.num('free_delivery_min');
  const free = freeMin > 0 && net >= freeMin;
  const delivery = free ? 0 : inside_dhaka ? S.num('delivery_inside') : S.num('delivery_outside');
  const total = net + delivery;
  const modes = [];
  if (S.get('pay_cod') && (isTrusted(customer) || S.get('new_customer_cod'))) modes.push({ mode: 'cod', pay_now: 0 });
  if (S.get('pay_delivery_adv') && delivery > 0) modes.push({ mode: 'delivery_advance', pay_now: delivery });
  if (S.get('pay_full_adv')) modes.push({ mode: 'full_advance', pay_now: total });
  if (!modes.length) return { error: 'no_payment_method' };
  return { ok: true, bundles: applied, lines, subtotal, discount, coupon: couponUsed, delivery, total, inside_dhaka: !!inside_dhaka, modes, free_delivery_gap: freeMin > 0 && !free ? freeMin - net : 0 };
}

const lineText = (l) => {
  const opt = Object.entries(l.options || {}).map(([k, v]) => `${k}: ${v}`).join(', ');
  return `${l.name}${l.variant ? ' (' + l.variant + ')' : ''}${opt ? ' [' + opt + ']' : ''} x ${l.qty} = ${money(l.total)}`;
};

function previewText(c, cu) {
  return [
    'Apnar order er hishab:',
    ...c.lines.map(lineText),
    c.bundles && c.bundles.length ? `Bundle offer: ${c.bundles.join(', ')}` : null,
    c.discount ? `Discount: -${money(c.discount)}` : null,
    `Delivery charge: ${money(c.delivery)}`,
    `Mot: ${money(c.total)}`,
    `Naam: ${cu.name || cu.fbname || '-'}`,
    `Phone: ${cu.phone || '-'}`,
    `Address: ${cu.address || '-'}`,
    '',
    'Shob thik thakle "confirm" likhun.',
  ].filter((x) => x !== null).join('\n');
}

function summaryText(o) {
  const paid = o.paid || 0;
  return [
    `Order #${o.id} confirm hoyeche`,
    ...o.lines.map(lineText),
    o.discount ? `Discount: -${money(o.discount)}` : null,
    `Delivery: ${money(o.delivery)}`,
    `Total: ${money(o.total)}`,
    paid ? `Paid: ${money(paid)}` : null,
    `Delivery te dite hobe: ${money(Math.max(0, o.total - paid))}`,
    '',
    `Naam: ${o.name}`, `Phone: ${o.phone}`, `Address: ${o.address}`,
    `Delivery shomoy: ${S.get('delivery_time')}`,
    'Order er status jante likhun: "amar order koi?"',
  ].filter((x) => x !== null).join('\n');
}

async function paymentInstructions(o) {
  const ms = await col('pay_methods').find({ active: { $ne: false } }).toArray();
  const nums = ms.length ? ms.map((m) => `${m.name}: ${m.number}${m.note ? ' (' + m.note + ')' : ''}`).join('\n') : S.get('pay_numbers');
  return [
    `Order #${o.id} peyechi. Confirm korte ${money(o.required_now)} pathan:`,
    nums, '', S.get('pay_note'),
    'Pathiye shudhu TrxID ar je number theke pathalen ta likhe din.',
  ].join('\n');
}

async function paymentInstructionsFor(o, m) {
  return [
    `Order #${o.id} peyechi ji. ${money(o.required_now)} ${m.name} e Send Money korun:`,
    `${m.number}${m.note ? ' (' + m.note + ')' : ''}`,
    '',
    'Pathiye TrxID likhe din (ba je number theke pathalen tar last 4 digit).',
  ].join('\n');
}

// ---- order creation ----
async function createOrder(customer, mode, { test = false } = {}) {
  const d = customer.draft;
  if (!d) return { error: 'no_draft' };
  if (customer.blocked) return { error: 'blocked' };
  const name = customer.name || customer.fbname;
  const phone = normPhone(customer.phone);
  if (!name) return { error: 'missing_customer_info', need: 'name' };
  if (!phone) return { error: 'missing_customer_info', need: 'phone' };
  if (isFakePhone(phone) && !test) return { error: 'suspicious_phone' };
  if (!customer.address || customer.address.length < 8) return { error: 'missing_customer_info', need: 'address' };
  if (!test) {
    const bl = await col('customers').findOne({ phone, blocked: true });
    if (bl) return { error: 'blocked' };
  }
  const c = await calc(customer, d.items, d.opts);
  if (c.error) return c;
  const m = c.modes.find((x) => x.mode === mode);
  if (!m) return { error: 'mode_not_allowed', allowed: c.modes.map((x) => x.mode) };
  if (!test) {
    const since = new Date(Date.now() - 86400e3);
    const n = await col('orders').countDocuments({ $or: [{ psid: customer.psid }, { phone }], createdAt: { $gte: since }, status: { $ne: 'cancelled' } });
    if (n >= S.num('max_orders_per_day')) { N.admin('attention', 'Order limit chhuyeche', `${name} (${phone}) ajke onek order korche`); return { error: 'daily_limit' }; }
  }
  const dup = !test && (await col('orders').findOne({ phone, createdAt: { $gte: new Date(Date.now() - 86400e3) }, status: { $ne: 'cancelled' }, 'lines.code': { $in: c.lines.map((l) => l.code) } }));
  const id = 1000 + (await nextId('order'));
  const status = mode === 'cod' ? (isTrusted(customer) ? 'confirmed' : 'pending') : 'awaiting_payment';
  const o = {
    id, psid: customer.psid, pageId: customer.pageId || '', name, phone, address: customer.address, inside_dhaka: c.inside_dhaka,
    lines: c.lines, subtotal: c.subtotal, discount: c.discount, coupon: c.coupon, delivery: c.delivery, total: c.total,
    mode, required_now: m.pay_now, paid: 0, status, payments: [], screenshots: [], tracking: null,
    flags: dup ? ['duplicate'] : [], test, createdAt: new Date(), history: [{ status, t: new Date(), by: 'ai' }],
  };
  await col('orders').insertOne(o);
  const prefs = {};
  for (const l of c.lines) for (const [k, v] of Object.entries(l.options || {})) prefs[k] = v;
  await col('customers').updateOne({ psid: customer.psid }, { $set: { draft: null, sel: null, pick_list: null, zone_q: false, lastOrderAt: new Date(), ...(Object.keys(prefs).length ? { prefs: { ...(customer.prefs || {}), ...prefs } } : {}) } });
  customer.draft = null;
  if (c.coupon) await col('coupons').updateOne({ code: c.coupon }, { $inc: { uses: 1 } });
  if (status === 'confirmed') await takeStock(o);
  bus.emit('order:new', o);
  if (!test) {
    const ev = status === 'pending' ? 'order_approval' : status === 'confirmed' ? 'order_new' : 'order_new';
    N.admin(ev, `Notun order #${id} (${MODE_NAME[mode]})`, `${name} ${phone}\nTotal ${money(o.total)}${dup ? '\nSotorko: ekoi product er shathe ager order ache' : ''}`, id);
  }
  L.ok('order', `Order #${id} created (${mode}, ${status}) total ${o.total}`);
  return { order: o };
}

async function takeStock(o) {
  for (const l of o.lines) {
    const p = await P.adjustStock(l.code, -l.qty);
    if (p && p.stock <= S.num('low_stock') && !o.test) N.admin('low_stock', `Stock kom: ${p.name}`, `${p.code} e ${p.stock} ta baki`);
  }
  await col('orders').updateOne({ id: o.id }, { $set: { stockTaken: true } });
}
async function giveStock(o) { for (const l of o.lines) await P.adjustStock(l.code, l.qty); }

const NOTICE = {
  confirmed: (o) => summaryText(o),
  shipped: (o) => `Apnar order #${o.id} pathano hoyeche.${o.tracking ? ` ${o.tracking.courier || 'Courier'}: ${o.tracking.code || ''}` : ''}`,
  delivered: (o) => `Order #${o.id} delivered hoyeche. Dhonnobad.`,
  cancelled: (o) => `Order #${o.id} cancel kora hoyeche.${o.paid ? ' Advance er refund niye admin apnar shathe jogajog korbe.' : ''}`,
  returned: (o) => `Order #${o.id} return hishebe nothibhukto hoyeche.`,
};

async function setStatus(id, to, by = 'admin', note = '') {
  const o = await col('orders').findOne({ id: Number(id) });
  if (!o) throw new Error('Order paoa jayni');
  const from = o.status;
  if (from === to) return o;
  const set = { status: to };
  if (to === 'confirmed' && !o.stockTaken) await takeStock(o);
  if (['cancelled', 'returned'].includes(to) && o.stockTaken) { await giveStock(o); set.stockTaken = false; }
  if (to === 'cancelled' && (o.paid || 0) > 0) set.refund_pending = true;
  if (to === 'delivered' && !o.counted && !o.test) { await col('customers').updateOne({ psid: o.psid }, { $inc: { orders_done: 1 } }); set.counted = true; }
  if (to === 'confirmed' && from === 'awaiting_payment' && !o.paid) set.paid = o.required_now;
  await col('orders').updateOne({ id: o.id }, { $set: set, $push: { history: { status: to, t: new Date(), by, note } } });
  const n = { ...o, ...set };
  bus.emit('order:status', n, from);
  L.info('order', `Order #${o.id}: ${from} -> ${to} (${by})`);
  if (['admin', 'system'].includes(by) && NOTICE[to]) await N.customer(o.psid, NOTICE[to](n), { test: o.test, orderId: o.id, pageId: o.pageId });
  if (by === 'customer' && to === 'cancelled') N.admin('order_cancel', `Order #${o.id} customer cancel korechhe`, note);
  return n;
}

// What did the customer type as payment proof? full TrxID, full sender number, or last 4 digits of it
function payRef(text) {
  const s = String(text || '');
  const toks = s.match(/[A-Za-z0-9]+/g) || [];
  for (const t of toks) { const u = t.toUpperCase(); if (/^[A-Z0-9]{8,14}$/.test(u) && /\d/.test(u) && !normPhone(t)) return { trx: u }; }
  for (const t of toks) { const p = normPhone(t); if (p) return { refType: 'number', ref: p }; }
  const m = s.match(/(?<!\d)\d{4}(?!\d)/);
  return m ? { refType: 'last4', ref: m[0] } : null;
}

async function submitPayment(o, { trx, sender, amount, ref, refType }) {
  if (!['awaiting_payment', 'payment_review'].includes(o.status)) return { error: 'not_waiting_for_payment' };
  if (!refType && trx) { const r = payRef(trx); if (r && r.refType && String(trx).replace(/\D/g, '').length <= 11 && !/[A-Za-z]/.test(String(trx))) { refType = r.refType; ref = r.ref; } }
  let t = String(trx || '').trim().toUpperCase();
  let ph = normPhone(sender);
  if (refType) { t = `${refType === 'last4' ? 'LAST4' : 'NUMBER'}-${o.id}-${ref}`; ph = ph || ''; }
  else {
    if (!/^[A-Z0-9]{8,14}$/.test(t)) return { error: 'bad_trx_format' };
    if (!ph) return { error: 'bad_sender_number' };
  }
  const amt = Number(String(amount).replace(/[^\d.]/g, ''));
  if (!amt) return { error: 'bad_amount' };
  if (amt < o.required_now) return { error: 'amount_low', need: o.required_now, sent: amt };
  try { await col('payments').insertOne({ trx: t, orderId: o.id, sender: ph, amount: amt, at: new Date() }); }
  catch (e) { if (e.code === 11000) return { error: 'trx_already_used' }; throw e; }
  await col('orders').updateOne({ id: o.id }, { $set: { status: 'payment_review' }, $push: { payments: { trx: t, sender: ph, amount: amt, at: new Date(), state: 'review' }, history: { status: 'payment_review', t: new Date(), by: 'customer' } } });
  const proof = refType ? `Customer diyeche: ${refType === 'last4' ? 'sender number er last 4 digit' : 'sender number'} ${ref} (TrxID na, nijer account e check korun)` : `TrxID ${t}\nSender ${ph}`;
  if (!o.test) N.admin('payment_review', `Payment verify lagbe: order #${o.id}`, `${proof}\nAmount ${money(amt)} (lagbe ${money(o.required_now)})`, o.id);
  return { ok: true };
}

async function paymentReceived(id) {
  const o = await col('orders').findOne({ id: Number(id) });
  if (!o) throw new Error('Order paoa jayni');
  const last = o.payments[o.payments.length - 1];
  const paid = last ? Math.max(last.amount, o.required_now) : o.required_now;
  await col('orders').updateOne({ id: o.id }, { $set: { paid, 'payments.$[l].state': 'verified' } }, { arrayFilters: [{ 'l.state': 'review' }] });
  await col('orders').updateOne({ id: o.id }, { $set: { paid } });
  return setStatus(o.id, 'confirmed', 'admin', 'payment received');
}
async function paymentRejected(id) {
  const o = await col('orders').findOne({ id: Number(id) });
  if (!o) throw new Error('Order paoa jayni');
  await col('orders').updateOne({ id: o.id }, { $set: { status: 'awaiting_payment', 'payments.$[l].state': 'rejected' }, $push: { history: { status: 'awaiting_payment', t: new Date(), by: 'admin', note: 'payment rejected' } } }, { arrayFilters: [{ 'l.state': 'review' }] });
  await N.customer(o.psid, 'Apnar payment verify kora jayni. Shothik TrxID ar number abar likhe din.', { test: o.test, orderId: o.id, pageId: o.pageId });
  return { ok: true };
}

async function updateItems(o, items) {
  if (!OPEN.includes(o.status)) return { error: 'cannot_change_now' };
  const c = await calc({ orders_done: 99 }, items, { inside_dhaka: o.inside_dhaka, coupon: o.coupon });
  if (c.error) return c;
  if (o.stockTaken) await giveStock(o);
  const required = o.mode === 'cod' ? 0 : o.mode === 'delivery_advance' ? c.delivery : c.total;
  const set = { lines: c.lines, subtotal: c.subtotal, discount: c.discount, delivery: c.delivery, total: c.total, required_now: required };
  await col('orders').updateOne({ id: o.id }, { $set: set, $push: { history: { status: o.status, t: new Date(), by: 'customer', note: 'items changed' } } });
  if (o.stockTaken) await takeStock({ ...o, ...set });
  if (!o.test) N.admin('order_cancel', `Order #${o.id} change hoyeche`, `Notun total ${money(c.total)}`, o.id);
  return { ok: true, old_total: o.total, new_total: c.total, paid: o.paid || 0, extra_advance_needed: Math.max(0, required - (o.paid || 0)), due_on_delivery: Math.max(0, c.total - Math.max(o.paid || 0, required)) };
}

async function expireUnpaid() {
  const hrs = S.num('auto_cancel_hours');
  if (!hrs) return;
  const old = await col('orders').find({ status: 'awaiting_payment', createdAt: { $lt: new Date(Date.now() - hrs * 3600e3) } }).toArray();
  for (const o of old) { await setStatus(o.id, 'cancelled', 'system', `payment ${hrs} ghontar moddhe ashe nai`).catch((e) => L.warn('order', e.message)); }
}

module.exports = { paymentInstructionsFor, payRef, isFakePhone, normPhone, money, calc, previewText, summaryText, paymentInstructions, createOrder, setStatus, submitPayment, paymentReceived, paymentRejected, updateItems, expireUnpaid, OPEN, MODE_NAME, isTrusted };
