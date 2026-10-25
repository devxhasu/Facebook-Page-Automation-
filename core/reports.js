// Sales reports for the panel + Telegram (today / 7 days / 30 days).
const { col } = require('./db');
const O = require('./orders');
const P = require('./products');

const startOf = (days) => { const d = new Date(Date.now() + 6 * 3600e3); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() - 6 * 3600e3 - (days - 1) * 86400e3); };

async function summary(days = 1) {
  const from = startOf(days);
  const orders = await col('orders').find({ test: { $ne: true }, createdAt: { $gte: from } }).toArray();
  const live = orders.filter((o) => o.status !== 'cancelled');
  const revenue = live.reduce((a, o) => a + (o.total || 0), 0);
  const prod = {};
  for (const o of live) for (const l of o.lines || []) {
    const k = `${l.name}${l.variant ? ' (' + l.variant + ')' : ''}`;
    prod[k] = prod[k] || { name: k, qty: 0, revenue: 0 };
    prod[k].qty += l.qty; prod[k].revenue += l.total || 0;
  }
  const top = Object.values(prod).sort((a, b) => b.qty - a.qty).slice(0, 8);
  const sizes = {};
  for (const o of live) for (const l of o.lines || []) for (const [k, v] of Object.entries(l.options || {})) { const kk = `${k}: ${v}`; sizes[kk] = (sizes[kk] || 0) + l.qty; }
  const topOpts = Object.entries(sizes).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, qty]) => ({ name, qty }));
  const bySrc = {};
  for (const o of live) if (o.post_id) bySrc[o.post_id] = (bySrc[o.post_id] || 0) + 1;
  const posts = Object.entries(bySrc).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([post_id, n]) => ({ post_id, orders: n }));
  const newCust = await col('customers').countDocuments({ test: { $ne: true }, createdAt: { $gte: from } });
  const chats = await col('customers').countDocuments({ test: { $ne: true }, lastMsgAt: { $gte: from } });
  const hot = await col('customers').countDocuments({ test: { $ne: true }, hot: { $gte: 40 } });
  const prods = (await P.all()).filter((p) => p.active);
  const lowStock = prods.filter((p) => p.stock <= 3).map((p) => ({ code: p.code, name: `${p.name}${p.variant ? ' ' + p.variant : ''}`, stock: p.stock }));
  const soldOut = [];
  for (const p of prods) for (const o of p.options || []) for (const v of o.out || []) soldOut.push(`${p.name}${p.variant ? ' ' + p.variant : ''}: ${o.name} ${v}`);
  const cnt = (s) => orders.filter((o) => o.status === s).length;
  return {
    days, orders: orders.length, live: live.length, revenue, avg: live.length ? Math.round(revenue / live.length) : 0,
    cancelled: cnt('cancelled'), delivered: cnt('delivered'), shipped: cnt('shipped'), pending: cnt('pending') + cnt('awaiting_payment') + cnt('payment_review'),
    newCust, chats, hot, conversion: newCust ? Math.round((live.length / newCust) * 100) : 0,
    top, topOpts, posts, lowStock, soldOut,
  };
}
const text = (r, title) => [
  `${title}`,
  `Order: ${r.live} ta | Bikri: ${O.money(r.revenue)}${r.avg ? ' | Gor: ' + O.money(r.avg) : ''}`,
  `Notun customer ${r.newCust}, chat ${r.chats}, Hot ${r.hot}`,
  `Cancelled ${r.cancelled}, Delivered ${r.delivered}, Shipped ${r.shipped}`,
  r.top.length ? 'Best seller: ' + r.top.slice(0, 3).map((t) => `${t.name} x${t.qty}`).join(', ') : '',
  r.topOpts.length ? 'Beshi chay: ' + r.topOpts.slice(0, 3).map((t) => `${t.name} (${t.qty})`).join(', ') : '',
  r.lowStock.length ? 'Stock kom: ' + r.lowStock.slice(0, 5).map((t) => `${t.name} (${t.stock})`).join(', ') : '',
].filter(Boolean).join('\n');

module.exports = { summary, text };
