// Common questions answered by the SERVER from the shop's own settings / knowledge (never invented):
// delivery time + charge, Cash on Delivery, payment methods, return, trust, shop address, size help.
const { col } = require('./db');
const S = require('./settings');
const I = require('./i18n');
const P = require('./products');

I.add({
  'f.time': { bl: ['Delivery te {time} lage.', 'Order confirm hole {time} er moddhe pabenn.'], bn: ['ডেলিভারিতে {time} লাগে।', 'অর্ডার কনফার্ম হলে {time} এর মধ্যে পাবেন।'], en: ['Delivery takes {time}.', 'You will get it within {time} after confirmation.'] },
  'f.charge': { bl: 'Delivery charge Dhaka-r bhitore {in}, Dhaka-r baire {out}.{free}', bn: 'ডেলিভারি চার্জ ঢাকার ভিতরে {in}, ঢাকার বাইরে {out}।{free}', en: 'Delivery charge is {in} inside Dhaka and {out} outside Dhaka.{free}' },
  'f.free': { bl: ' {min} er upore delivery free.', bn: ' {min} এর উপরে ডেলিভারি ফ্রি।', en: ' Delivery is free above {min}.' },
  'f.cod_yes': { bl: 'Ji, Cash on Delivery ache. Product haate peye taka dite parben.', bn: 'ক্যাশ অন ডেলিভারি আছে। প্রোডাক্ট হাতে পেয়ে টাকা দিতে পারবেন।', en: 'Yes, Cash on Delivery is available. You pay when you receive the product.' },
  'f.cod_adv': { bl: 'Prothom order e shudhu delivery charge advance dite hobe, baki taka product haate peye dibena. Ekbar nile pore Cash on Delivery o paben.', bn: 'প্রথম অর্ডারে শুধু ডেলিভারি চার্জ অগ্রিম দিতে হবে, বাকি টাকা প্রোডাক্ট হাতে পেয়ে দিবেন।', en: 'For a first order only the delivery charge is paid in advance; the rest you pay when you receive the product.' },
  'f.cod_full': { bl: 'Order confirm korte advance dite hoy, details order er shomoy bole dibo.', bn: 'অর্ডার কনফার্ম করতে অগ্রিম দিতে হয়, বিস্তারিত অর্ডারের সময় বলে দিবো।', en: 'An advance is needed to confirm the order; I will share the details when you order.' },
  'f.pay': { bl: 'Payment {methods} e korte paren.', bn: 'পেমেন্ট {methods} এ করতে পারেন।', en: 'You can pay via {methods}.' },
  'f.size_ask': { bl: ['Apnar height ar weight ta bolun, size ta thik kore bole dibo.', 'Height (feet/cm) ar weight (kg) bolun, apnar size ta bole dichhi.'], bn: ['আপনার হাইট আর ওজনটা বলুন, সাইজটা ঠিক করে বলে দিবো।'], en: ['Tell me your height and weight and I will suggest the right size.'] },
  'f.size_is': { bl: 'Apnar jonno {size} size ta perfect hobe.', bn: 'আপনার জন্য {size} সাইজটা পারফেক্ট হবে।', en: '{size} should fit you perfectly.' },
  'f.size_na': { bl: 'Apnar size {size}, kintu eta {size} te nai. Ache: {values}.', bn: 'আপনার সাইজ {size}, কিন্তু এটা {size} এ নেই। আছে: {values}।', en: 'Your size would be {size}, but it is not available in this product. Available: {values}.' },
});

// ----- size guide: setting size_guide, one line per size:  M: 55-65 kg, 160-168 cm -----
function parseGuide() {
  return String(S.get('size_guide') || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf(':'); if (i < 1) return null;
    const w = l.slice(i + 1).match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(?:kg|kilo|কেজি)/i);
    const h = l.slice(i + 1).match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*cm/i);
    if (!w && !h) return null;
    return { size: l.slice(0, i).trim(), w: w && [+w[1], +w[2]], h: h && [+h[1], +h[2]] };
  }).filter(Boolean);
}
// height in cm and weight in kg out of free text. "5'6", "5 feet 6", "165cm", "60 kg", or two bare numbers when we just asked
function parseBody(text, asked) {
  const t = String(text || '').toLowerCase();
  let h = 0, w = 0;
  let m = t.match(/(\d{3})\s*(?:cm|centimeter|সেমি)/);
  if (m) h = +m[1];
  if (!h) { m = t.match(/(\d)\s*(?:'|’|ft|feet|foot|fit|ফুট)\s*(\d{1,2})?/); if (m) h = Math.round((+m[1] * 12 + (+m[2] || 0)) * 2.54); }
  m = t.match(/(\d{2,3})\s*(?:kg|kgs|kilo|কেজি|কে জি)/);
  if (m) w = +m[1];
  if (asked && (!h || !w)) {
    const nums = (t.match(/\d+(?:\.\d+)?/g) || []).map(Number);
    for (const n of nums) { if (!h && n >= 130 && n <= 210) h = n; else if (!w && n >= 30 && n <= 150) w = n; }
  }
  return { h, w };
}
function sizeFor({ h, w }) {
  const g = parseGuide();
  if (!g.length || (!h && !w)) return null;
  const score = (r, v) => (r && v ? (v >= r[0] && v <= r[1] ? 0 : Math.min(Math.abs(v - r[0]), Math.abs(v - r[1]))) : null);
  let best = null;
  for (const e of g) {
    const a = score(e.w, w), b = score(e.h, h);
    const parts = [a, b].filter((x) => x != null);
    if (!parts.length) continue;
    const d = parts.reduce((x, y) => x + y, 0) + (a != null && b != null ? 0 : 0.5);
    if (!best || d < best.d) best = { size: e.size, d };
  }
  return best ? best.size : null;
}

const RX = {
  time: /(kobe|kotodin|koto din|koyto din|kotodine|koto dine|কবে|কতদিন|কত দিন|how long|how many days|delivery time|kobe pabo|kobe paba)/i,
  charge: /((delivery|ডেলিভারি|shipping).{0,14}(charge|fee|cost|koto|kot|কত|চার্জ))|(charge|charger).{0,6}(koto|kot|কত)/i,
  cod: /(\bcod\b|cash on delivery|haate peye|hate peye|haat e peye|হাতে পেয়ে|পণ্য হাতে|product dekhe taka|dekhe taka)/i,
  pay: /((payment|pay|taka).{0,14}(kivabe|kibhabe|kemone|method|ki ki|how)|(bkash|nagad|rocket|বিকাশ|নগদ).{0,10}(ache|nai|achhe|ase|নাম্বার|number)|পেমেন্ট (কিভাবে|কীভাবে))/i,
  ret: /(return|exchange|ferot|ফেরত|বদল|bodle|refund|রিফান্ড)/i,
  trust: /(original|asol|asli|আসল|fake|নকল|real product|quality (kemon|ki|bhalo)|ঠকাবে|scam|vorsha|bishshash|বিশ্বাস)/i,
  shop: /((shop|dokan|office|showroom|store|দোকান).{0,12}(kothay|koi|address|location|কোথায়)|kothay (apnader|shop|dokan)|physical shop|offline shop)/i,
  size: /(size.{0,14}(konta|kon ta|hobe|guide|chart|bujhte|fit|ki nibo|dibo|ki hobe)|(konta|kon ta|kon) size|ki size|সাইজ (কোনটা|কত)|which size)/i,
};

// returns { text, replies? } or null
async function handle(c, text, ctx = {}) {
  if (S.get('faq_on') === false) return null;
  const t = String(text || '').trim();
  if (!t || t.length > 140) return null;
  const low = t.toLowerCase();
  // 1) owner-written Knowledge entries with keywords win
  for (const k of await col('kb').find({ active: { $ne: false } }).toArray()) {
    const kws = String(k.keywords || '').split(',').map((x) => x.trim().toLowerCase()).filter((x) => x.length >= 3);
    if (kws.some((x) => low.includes(x)) && k.content) return { text: String(k.content).slice(0, 600) };
  }
  // 2) size help (height / weight -> size)
  const asked = !!(c && c.size_q && Date.now() - c.size_q < 30 * 60000);
  const body = parseBody(t, asked);
  if ((body.h && body.w) || ((body.w || body.h) && asked)) {
    const size = sizeFor(body);
    if (size) {
      let vals = [];
      if (c.sel) { const p = await P.get(c.sel.code); const o = p && (p.options || []).find((x) => /size|সাইজ/i.test(x.name)); vals = o ? o.values : []; }
      if (vals.length && !vals.some((v) => v.toLowerCase() === size.toLowerCase())) return { text: I.t('f.size_na', c, { size, values: vals.join(', ') }), replies: vals, clear: 'size_q' };
      return { text: I.t('f.size_is', c, { size }), replies: vals.length ? [size, ...vals.filter((v) => v.toLowerCase() !== size.toLowerCase())] : undefined, clear: 'size_q' };
    }
  }
  if (RX.size.test(t) && parseGuide().length) return { text: I.t('f.size_ask', c), set: 'size_q' };
  // 3) shop questions
  if (RX.charge.test(t)) {
    const fm = S.num('free_delivery_min');
    return { text: I.t('f.charge', c, { in: I.money(S.num('delivery_inside'), c), out: I.money(S.num('delivery_outside'), c), free: fm ? I.t('f.free', c, { min: I.money(fm, c) }) : '' }) };
  }
  if (RX.time.test(t) && !/delivery charge|charge/i.test(t)) return { text: I.t('f.time', c, { time: S.get('delivery_time') }) };
  if (RX.cod.test(t)) {
    const O = require('./orders');
    if (S.get('pay_cod') && (O.isTrusted(c || {}) || S.get('new_customer_cod'))) return { text: I.t('f.cod_yes', c) };
    if (S.get('pay_delivery_adv')) return { text: I.t('f.cod_adv', c) };
    return { text: I.t('f.cod_full', c) };
  }
  if (RX.pay.test(t)) {
    const ms = await col('pay_methods').find({ active: { $ne: false } }).toArray();
    const names = ms.length ? ms.map((m) => m.name) : String(S.get('pay_numbers') || '').split('\n').map((l) => l.split(':')[0].trim()).filter(Boolean);
    if (names.length) return { text: I.t('f.pay', c, { methods: I.list(names, c) }) };
  }
  if (RX.ret.test(t) && S.get('return_policy')) return { text: String(S.get('return_policy')).slice(0, 600) };
  if (RX.trust.test(t) && S.get('trust_text')) return { text: String(S.get('trust_text')).slice(0, 600) };
  if (RX.shop.test(t) && S.get('shop_address')) return { text: String(S.get('shop_address')).slice(0, 400) };
  return null;
}

module.exports = { handle, parseBody, sizeFor, parseGuide };
