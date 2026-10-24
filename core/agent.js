// The sales agent: builds the prompt, runs tools, sends human-like replies.
const { col } = require('./db');
const S = require('./settings');
const L = require('./logger');
const AI = require('./ai');
const fb = require('./facebook');
const P = require('./products');
const O = require('./orders');
const N = require('./notify');
const M = require('./media');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const modTools = new Map();
const registerTool = (def, handler) => modTools.set(def.function.name, { def, handler });

// ---------- output channels ----------
const fbOut = (psid) => ({
  typing: () => fb.typing(psid, true).catch(() => {}),
  text: (t) => fb.text(psid, t),
  image: (u) => fb.image(psid, u),
  carousel: (els) => fb.carousel(psid, els),
});
const testOut = (buf) => ({
  typing: async () => {},
  text: async (t) => { buf.push({ type: 'text', text: t }); },
  image: async (u) => { buf.push({ type: 'image', url: u }); },
  carousel: async (els) => { buf.push({ type: 'carousel', items: els.map((e) => ({ title: e.title, subtitle: e.subtitle, image: e.image_url })) }); },
});

// ---------- helpers ----------
const dhakaNow = () => new Date(Date.now() + 6 * 3600e3);
function inHours() {
  if (!S.get('hours_on')) return true;
  const d = dhakaNow(), m = d.getUTCHours() * 60 + d.getUTCMinutes();
  const [a, b] = [S.get('hours_start'), S.get('hours_end')].map((s) => { const [h, mm] = String(s).split(':'); return (+h || 0) * 60 + (+mm || 0); });
  return a <= b ? m >= a && m < b : m >= a || m < b;
}

async function attention(c, reason) {
  if (!c || c.test || String(c.psid).startsWith('TEST')) return;
  const recent = await col('attention').findOne({ psid: c.psid, resolved: false, reason, createdAt: { $gt: new Date(Date.now() - 3600e3) } });
  if (recent) return;
  await col('attention').insertOne({ psid: c.psid, name: c.name || c.fbname || c.psid, reason, resolved: false, createdAt: new Date() });
  N.admin('attention', `Needs attention: ${c.name || c.fbname || c.psid}`, reason);
}

async function getCustomer(ctx) {
  let c = await col('customers').findOne({ psid: ctx.psid });
  if (!c) {
    c = { psid: ctx.psid, name: '', fbname: '', phone: '', address: '', orders_done: 0, createdAt: new Date(), test: ctx.channel === 'test' };
    if (ctx.channel === 'fb') { try { c.fbname = await fb.userName(ctx.psid); } catch (e) { L.warn('agent', 'Customer er naam paoa jayni: ' + e.message); } }
    await col('customers').insertOne(c);
    c = await col('customers').findOne({ psid: ctx.psid });
  }
  return c;
}

async function sendRaw(ctx, text) {
  await col('messages').insertOne({ psid: ctx.psid, role: 'assistant', text, t: Date.now() });
  await ctx.out.text(text);
}
async function sendHuman(ctx, text) {
  const clean = String(text || '').replace(/\*\*/g, '').replace(/^#+\s*/gm, '').replace(/^[-•]\s+/gm, '').trim();
  if (!clean) return;
  let parts = clean.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  if (parts.length > 3) parts = [parts[0], parts[1], parts.slice(2).join('\n')];
  for (const p of parts) {
    if (S.get('typing_delay') !== false) { await ctx.out.typing(); await sleep(Math.min(2500, 500 + p.length * 22)); }
    await sendRaw(ctx, p);
  }
}

// ---------- media (photo / voice) ----------
async function processMedia(ctx, input, c) {
  const parts = [];
  let voice = false;
  for (const u of (input.images || []).slice(0, 3)) {
    try {
      const open = await col('orders').findOne({ psid: c.psid, status: { $in: ['awaiting_payment', 'payment_review'] } }, { sort: { id: -1 } });
      const { buf, mime } = await M.download(u);
      let desc = '';
      if (S.get('vision_on')) { try { desc = await AI.describeImage(buf, mime); } catch (e) { L.warn('agent', 'Chobi bujha jayni: ' + e.message); } }
      const isPay = /payment screenshot/i.test(desc) || (!desc && open);
      if (isPay && open) {
        const path = await M.saveTemp(buf, mime);
        await col('orders').updateOne({ id: open.id }, { $push: { screenshots: path } });
        parts.push(`[Customer sent a payment screenshot for order #${open.id}. It is saved for the admin. It is NOT proof: you still need TrxID, sender number and amount typed by the customer.]`);
      } else if (desc) parts.push(`[Customer sent a photo. It looks like: ${desc}. Search the catalog for it.]`);
      else { parts.push('[Customer sent a photo you could not analyse. Ask what they want in words.]'); await attention(c, 'Customer chobi pathiyeche, AI bujhte parenni'); }
    } catch (e) { L.warn('agent', 'Chobi download fail: ' + e.message); parts.push('[Customer sent a photo that could not be opened. Ask them to type what they want.]'); }
  }
  if (input.audio) {
    if (!S.get('voice_on')) parts.push('[Customer sent a voice message. Voice is switched off; politely ask them to type.]');
    else {
      try {
        const { buf, mime } = await M.download(input.audio, Math.max(1, S.num('voice_max_mb')) * 1048576);
        const t = await AI.transcribe(buf, mime || 'audio/mp4');
        voice = true;
        parts.push(`[Voice message transcript]: ${t}`);
        L.ok('voice', 'Voice bujhlam: ' + t.slice(0, 80));
      } catch (e) {
        L.error('voice', 'Voice bujha jayni: ' + e.message);
        parts.push('[Customer sent a voice message that could not be understood. Politely ask them to type it.]');
        await attention(c, 'Voice message bujha jayni');
      }
    }
  }
  if ((input.other || []).length) parts.push('[Customer sent a video/file/location you cannot open.]');
  return { text: [input.text, ...parts].filter(Boolean).join('\n'), voice };
}

// ---------- tools ----------
const fn = (name, description, properties, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
const str = { type: 'string' };
const itemsSchema = { type: 'array', items: { type: 'object', properties: { code: str, qty: { type: 'integer' }, options: { type: 'object', additionalProperties: str } }, required: ['code'] } };
const CORE_TOOLS = [
  fn('search_products', 'Search the catalog by name, keyword or code. ALWAYS use before talking about any product, price or stock.', { query: str }, ['query']),
  fn('show_products', 'Send product photos to the customer (with a Pick button when several). Use when they ask for a photo, or when several products match and they must choose.', { codes: { type: 'array', items: str } }, ['codes']),
  fn('update_customer', 'Save customer details as soon as they are given.', { name: str, phone: str, address: str }),
  fn('calc_order', 'Calculate totals and send the order preview to the customer. Needs product code, qty and every required option.', { items: itemsSchema, inside_dhaka: { type: 'boolean' }, coupon: str, extra_discount_pct: { type: 'number' } }, ['items', 'inside_dhaka']),
  fn('place_order', 'Create the order ONLY after the customer explicitly confirmed the preview.', { payment_mode: { type: 'string', enum: ['cod', 'delivery_advance', 'full_advance'] }, customer_confirmed: { type: 'boolean' } }, ['payment_mode', 'customer_confirmed']),
  fn('submit_payment', 'Record the payment details the customer typed. Never say the payment is confirmed.', { order_id: { type: 'integer' }, trx_id: str, sender_number: str, amount: { type: 'number' } }, ['order_id', 'trx_id', 'sender_number', 'amount']),
  fn('order_status', 'Get the customer\'s order status.', { order_id: { type: 'integer' } }),
  fn('cancel_order', 'Cancel an order at the customer\'s request.', { order_id: { type: 'integer' }, reason: str }, ['order_id']),
  fn('change_order_items', 'Change products/qty/size of an order that has not shipped.', { order_id: { type: 'integer' }, items: itemsSchema }, ['order_id', 'items']),
  fn('request_human', 'Escalate to the admin (complaint, return, angry customer, anything you cannot handle).', { reason: str }, ['reason']),
  fn('log_unknown_question', 'Save a question you could not answer from the catalog or knowledge base.', { question: str }, ['question']),
];
const allTools = () => [...CORE_TOOLS, ...[...modTools.values()].map((t) => t.def)];

async function ownOrder(c, id) {
  const o = await col('orders').findOne({ id: Number(id), psid: c.psid });
  return o || null;
}

async function showProducts(ctx, codes) {
  const ps = [];
  for (const code of (codes || []).slice(0, 4)) { const p = await P.get(code); if (p && p.active) ps.push(p); }
  if (!ps.length) return { error: 'no_valid_products' };
  const url = (p) => { const u = M.abs((p.images || [])[0]); return u && !u.startsWith('/') ? u : ''; };
  let sent = 0;
  if (ps.length > 1) {
    const els = ps.map((p) => ({ title: `${p.name}${p.variant ? ' - ' + p.variant : ''}`.slice(0, 80), subtitle: `${O.money(p.price)} | ${p.code}`, image_url: url(p) || undefined, buttons: [{ type: 'postback', title: 'Eta nibo', payload: 'PICK:' + p.code }] }));
    await ctx.out.carousel(els); sent = els.length;
  } else {
    for (const im of (ps[0].images || []).slice(0, 3)) { const u = M.abs(im); if (u && !u.startsWith('/')) { await ctx.out.image(u); sent++; } }
  }
  return { photos_sent: sent, products: ps.map(P.brief), note: sent ? undefined : 'No photo available for this product' };
}

async function exec(ctx, name, a, c) {
  switch (name) {
    case 'search_products': return (await P.search(a.query)).map(P.brief);
    case 'show_products': return showProducts(ctx, a.codes);
    case 'update_customer': {
      const set = {};
      if (a.name) set.name = String(a.name).trim().slice(0, 60);
      if (a.phone) { const ph = O.normPhone(a.phone); if (!ph) return { error: 'invalid_phone', hint: 'Needs a Bangladeshi mobile number like 01XXXXXXXXX' }; set.phone = ph; }
      if (a.address) set.address = String(a.address).trim().slice(0, 250);
      if (!Object.keys(set).length) return { error: 'nothing_to_save' };
      await col('customers').updateOne({ psid: c.psid }, { $set: set });
      Object.assign(c, set);
      return { saved: set };
    }
    case 'calc_order': {
      const items = (a.items || []).map((i) => ({ code: i.code, qty: i.qty || 1, options: i.options || {} }));
      const opts = { inside_dhaka: !!a.inside_dhaka, coupon: a.coupon || '', extra_discount_pct: a.extra_discount_pct || 0 };
      const r = await O.calc(c, items, opts);
      if (r.error) return r;
      c.draft = { items, opts, at: Date.now() };
      await col('customers').updateOne({ psid: c.psid }, { $set: { draft: c.draft } });
      await sendRaw(ctx, O.previewText(r, c));
      const hint = S.get('upsell_on') && r.free_delivery_gap > 0 && r.free_delivery_gap <= 600 ? `Customer needs only ${r.free_delivery_gap} tk more for free delivery; you may mention it once.` : undefined;
      return { preview_sent: true, total: r.total, delivery: r.delivery, discount: r.discount, payment_options: r.modes, hint };
    }
    case 'place_order': {
      if (!a.customer_confirmed) return { error: 'customer_has_not_confirmed' };
      if (!c.draft) return { error: 'no_preview_yet', fix: 'call calc_order first' };
      const last = await col('messages').findOne({ psid: c.psid, role: 'user' }, { sort: { t: -1 } });
      if (!last || last.t <= c.draft.at) return { error: 'customer_has_not_replied_after_preview' };
      const r = await O.createOrder(c, a.payment_mode, { test: ctx.channel === 'test' });
      if (r.error) return r;
      const o = r.order;
      if (o.status === 'confirmed') await sendRaw(ctx, O.summaryText(o));
      else if (o.status === 'pending') await sendRaw(ctx, `Order #${o.id} peyechi. Admin confirm korle apnake janiye dibo.`);
      else await sendRaw(ctx, O.paymentInstructions(o));
      return { order_id: o.id, status: o.status, pay_now: o.required_now, messages_already_sent: true };
    }
    case 'submit_payment': {
      const o = await ownOrder(c, a.order_id);
      if (!o) return { error: 'order_not_found' };
      const r = await O.submitPayment(o, { trx: a.trx_id, sender: a.sender_number, amount: a.amount });
      return r.ok ? { ok: true, note: 'Tell the customer the admin will verify the payment and the order confirms after that.' } : r;
    }
    case 'order_status': {
      const q = { psid: c.psid };
      if (a.order_id) q.id = Number(a.order_id);
      const os = await col('orders').find(q).sort({ id: -1 }).limit(a.order_id ? 1 : 4).toArray();
      if (!os.length) return { orders: [] };
      return { orders: os.map((o) => ({ id: o.id, status: o.status, total: o.total, paid: o.paid || 0, due_on_delivery: Math.max(0, o.total - (o.paid || 0)), mode: O.MODE_NAME[o.mode], pay_now_needed: o.status === 'awaiting_payment' ? o.required_now : undefined, tracking: o.tracking || undefined, items: o.lines.map((l) => `${l.name} x${l.qty}`) })) };
    }
    case 'cancel_order': {
      const o = await ownOrder(c, a.order_id);
      if (!o) return { error: 'order_not_found' };
      if (['shipped', 'delivered', 'returned', 'cancelled'].includes(o.status)) { if (o.status === 'shipped') await attention(c, `Order #${o.id} shipped, customer cancel chay`); return { error: 'cannot_cancel_now', status: o.status }; }
      await O.setStatus(o.id, 'cancelled', 'customer', a.reason || '');
      return { cancelled: true, refund_pending: (o.paid || 0) > 0 };
    }
    case 'change_order_items': {
      const o = await ownOrder(c, a.order_id);
      if (!o) return { error: 'order_not_found' };
      return O.updateItems(o, (a.items || []).map((i) => ({ code: i.code, qty: i.qty || 1, options: i.options || {} })));
    }
    case 'request_human': await attention(c, a.reason || 'Customer admin er shathe kotha bolte chay'); return { ok: true, note: 'Tell the customer the admin will reply soon.' };
    case 'log_unknown_question':
      await col('unknown').insertOne({ q: String(a.question || '').slice(0, 300), psid: c.psid, name: c.name || c.fbname, createdAt: new Date(), answered: false });
      return { ok: true, note: 'Tell the customer you will confirm with the admin; do not guess.' };
    default: {
      const t = modTools.get(name);
      if (t) return t.handler(ctx, a, c);
      return { error: 'unknown_tool' };
    }
  }
}

// ---------- prompt ----------
async function buildSystem(c, isFirst, voice) {
  const kb = await col('kb').find({ active: { $ne: false } }).toArray();
  const kbText = kb.map((k) => `- ${k.title}: ${k.content}`).join('\n').slice(0, 6000) || '(empty)';
  const open = await col('orders').find({ psid: c.psid, status: { $in: O.OPEN } }).sort({ id: -1 }).limit(3).toArray();
  const emoji = S.get('emoji_level') === 'none' ? 'Never use emoji.' : 'Almost never use emoji (at most one, rarely).';
  const greet = { auto: 'Greet like the customer does', salam: 'Greet with Salam', hello: 'Greet with Hello', none: 'Do not add any greeting' }[S.get('greeting_style')] || 'Greet like the customer does';
  return `You are ${S.get('persona_name')}, chatting for the Facebook page "${S.get('page_name') || 'our shop'}", an online shop in Bangladesh. Write exactly like a real, polite shopkeeper on Messenger. Tone: ${S.get('tone')}.

STYLE
- Very short messages: 1-2 lines each. Separate up to 3 short messages with a blank line. No lists, no bold, no headings, no "Dear customer", no "Thank you for contacting us".
- Reply in the customer's language and style (Bangla script, Banglish or English). ${emoji}
- Ask only ONE question at a time. Never ask for anything listed under KNOWN. Never repeat what was already said.
- GREETING: ${greet}. ${isFirst ? 'This is the first message of this customer: if they greeted with salam answer "Walaikum assalam"; if they did not greet and style allows, start with "Assalamu alaikum" plus one short welcome line.' : 'Not the first message: do not greet again.'}
- If the customer sincerely asks whether you are a bot or AI, say you are the page's virtual assistant. Never claim to be human.

TRUTH
- Never invent products, prices, stock, policies or delivery times. Use search_products and the KNOWLEDGE below. If unsure, call log_unknown_question and say you will confirm with the admin.
- Same product name may exist in several variants/codes. If more than one product matches, do NOT guess: call show_products with the matching codes and ask which one. Mention only the detail that differs.
- Ask for size/color/etc. ONLY if the product has options. Use exactly the option values from the catalog.

ORDER FLOW
1. Find product -> collect missing options and quantity -> collect missing phone and address (name too only if none is known) -> call update_customer when you get them.
2. Decide inside_dhaka from the address (ask only if truly unclear). Delivery: inside Dhaka ${S.get('delivery_inside')} tk, outside ${S.get('delivery_outside')} tk${S.num('free_delivery_min') ? `, free delivery above ${S.get('free_delivery_min')} tk` : ''}. Delivery time: ${S.get('delivery_time')}.
3. Call calc_order. The server sends the exact preview itself; do not retype it. Then tell the customer the payment options returned in payment_options (cod = pay on delivery, delivery_advance = pay only the delivery charge now, full_advance = pay everything now) and ask which one. If COD is not offered, say it is not available for now.
4. When the customer confirms (and chose a payment option), call place_order. The server sends the confirmation/payment instructions itself. Add at most one short line.
5. Payment: you can never confirm a payment. Collect TrxID, sender number and amount, call submit_payment, then say the admin will verify and the order confirms after that. A screenshot alone is not proof.
6. Discount: only if the customer bargains, and only up to ${S.num('max_discount_pct')}% via extra_discount_pct. Otherwise say the price is fixed or ask the admin.
7. Cancel or change: use cancel_order / change_order_items. If already shipped, call request_human.
8. For "where is my order" use order_status. Statuses: pending = waiting admin approval, awaiting_payment = waiting for customer's payment, payment_review = admin is verifying payment, confirmed = being prepared, shipped, delivered, cancelled.
9. Complaints, returns, anger, anything unclear: request_human and stay calm.
${voice ? '10. The last message came from a voice message: repeat any phone number or address back and ask the customer to confirm before saving.' : ''}

KNOWN ABOUT THIS CUSTOMER
name: ${c.name || '(unknown)'} | facebook name: ${c.fbname || '(unknown)'} | phone: ${c.phone || '(unknown)'} | address: ${c.address || '(unknown)'} | delivered orders: ${c.orders_done || 0}
${c.draft ? `An order preview was already sent and is waiting for confirmation: ${JSON.stringify(c.draft.items)}` : ''}
OPEN ORDERS: ${open.length ? open.map((o) => `#${o.id} ${o.status} total ${o.total} (${O.MODE_NAME[o.mode]})`).join('; ') : 'none'}

KNOWLEDGE (from the shop owner)
${kbText}

Now (Dhaka): ${dhakaNow().toISOString().slice(0, 16).replace('T', ' ')}`;
}

// ---------- main ----------
async function handle(ctx, input) {
  const c = (ctx.customer = await getCustomer(ctx));
  const test = ctx.channel === 'test';
  if (c.blocked && !test) return L.info('agent', 'Blocked customer, ignore: ' + c.psid);

  const save = (text) => col('messages').insertOne({ psid: c.psid, role: 'user', text, t: Date.now() });
  const once = async (field, minutes, msg) => {
    if (!c[field] || Date.now() - c[field] > minutes * 60000) {
      c[field] = Date.now();
      await col('customers').updateOne({ psid: c.psid }, { $set: { [field]: c[field] } });
      await sendRaw(ctx, msg);
    }
  };
  if (!test) {
    if (!S.get('bot_on') || !S.get('messenger_on')) { await save(input.text || '[media]'); L.info('agent', 'Bot off, reply deini'); return once('offMsgAt', 360, S.get('bot_off_message')); }
    if (c.human_until && c.human_until > Date.now()) { await save(input.text || '[media]'); return L.info('agent', `AI paused for ${c.name || c.fbname || c.psid}`); }
    if (!inHours()) { await save(input.text || '[media]'); return once('hoursMsgAt', 180, S.get('outside_hours_message')); }
  }

  const m = await processMedia(ctx, input, c);
  if (!m.text) return;
  await save(m.text);
  await col('customers').updateOne({ psid: c.psid }, { $set: { lastMsgAt: new Date() } });
  const isFirst = (await col('messages').countDocuments({ psid: c.psid })) <= 1;

  try {
    const hist = (await col('messages').find({ psid: c.psid }).sort({ t: -1 }).limit(12).toArray()).reverse().map((x) => ({ role: x.role, content: x.text }));
    while (hist.length && hist[0].role !== 'user') hist.shift();
    const msgs = [{ role: 'system', content: await buildSystem(c, isFirst, m.voice) }, ...hist];
    const tools = allTools();
    let finalText = '';
    for (let i = 0; i < 7; i++) {
      const r = await AI.chat('text', msgs, tools);
      const msg = r.message;
      if (msg.tool_calls && msg.tool_calls.length) {
        msgs.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
        for (const tc of msg.tool_calls) {
          let args = {}, res;
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
          try { res = await exec(ctx, tc.function.name, args, c); } catch (e) { L.error('tool', `${tc.function.name} fail: ${e.message}`, e); res = { error: 'tool_failed', detail: e.message }; }
          L.info('tool', `${tc.function.name} -> ${res && res.error ? 'error: ' + res.error : 'ok'}`);
          msgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(res).slice(0, 3000) });
        }
        continue;
      }
      finalText = String(msg.content || '').trim();
      break;
    }
    await sendHuman(ctx, finalText);
    L.ok('reply', `${c.name || c.fbname || c.psid}: reply pathano hoyeche`);
  } catch (e) {
    L.error('agent', 'Reply dite parini: ' + e.message, e);
    let sent = false;
    if (e instanceof AI.AllFailed && m.text && !/^\[/.test(m.text)) {
      const b = await AI.backup(m.text);
      if (b) { await sendHuman(ctx, b); sent = true; }
    }
    if (!sent && (!c.failMsgAt || Date.now() - c.failMsgAt > 300000)) {
      c.failMsgAt = Date.now();
      await col('customers').updateOne({ psid: c.psid }, { $set: { failMsgAt: c.failMsgAt } });
      await sendRaw(ctx, S.get('ai_fail_message')).catch(() => {});
    }
    await attention(c, 'AI reply dite parenni: ' + e.message.slice(0, 120));
  }
}

async function testChat(sessionId, text) {
  const buf = [];
  await handle({ psid: 'TEST-' + String(sessionId || 'admin').slice(0, 20), channel: 'test', out: testOut(buf) }, { text });
  return buf;
}
const forFb = (psid) => ({ psid, channel: 'fb', out: fbOut(psid) });

module.exports = { handle, testChat, forFb, registerTool, attention, getCustomer };
