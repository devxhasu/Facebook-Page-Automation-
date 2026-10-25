// Guided selling handled by the server (no AI guessing). The AI only talks when this module returns false.
// greeting -> FAQ / size help -> product picker -> options -> combo offer -> details -> bargaining -> preview.
const { col } = require('./db');
const S = require('./settings');
const P = require('./products');
const O = require('./orders');
const I = require('./i18n');
const Faq = require('./faq');
const Out = require('./outreach');

const HOUR = 3600e3;
const norm = P.norm;
const SALAM = /(assalam|asalam|salam|slm|সালাম|আসসালা)/i;
const GREET = new Set(['assalamualaikum', 'assalamu', 'alaikum', 'asslamualaikum', 'assalamualaikam', 'salam', 'slm', 'hlw', 'hlo', 'helo', 'hello', 'hey', 'kemon', 'achen', 'aso', 'acho', 'ki', 'khobor', 'bhai', 'vai', 'bro', 'sir', 'madam', 'ji', 'jii', 'valo', 'bhalo', 'ase', 'apnar', 'apni', 'good', 'morning', 'evening', 'afternoon', 'there', 'how', 'are', 'you', 'হ্যালো', 'হাই', 'সালাম', 'আসসালামু', 'আলাইকুম', 'আসসালামুয়ালাইকুম', 'কেমন', 'আছেন', 'ভাই', 'জি']);
const isGreetingWord = (w) => GREET.has(w) || /^(hi+|hii+|hel+o+|hey+)$/.test(w);
const WEAK = ['ki', 'ji', 'jii', 'bhai', 'vai', 'bro', 'sir', 'madam', 'apni', 'apnar', 'ase', 'valo', 'bhalo', 'achen', 'aso', 'acho', 'kemon', 'khobor', 'how', 'are', 'you', 'there', 'good', 'ভাই', 'জি', 'কেমন', 'আছেন'];
function isPureGreeting(text) {
  const t = norm(text);
  if (!t || t.length > 45) return false;
  const ws = t.split(' ');
  return ws.every(isGreetingWord) && ws.some((w) => isGreetingWord(w) && !WEAK.includes(w));
}

const DHAKA = /\bdhaka\b|ঢাকা|mirpur|uttara|dhanmondi|mohammadpur|gulshan|banani|badda|rampura|motijheel|jatrabari|khilgaon|malibagh|farmgate|tejgaon|bashundhara|shyamoli|kalabagan|lalbagh|old dhaka|puran dhaka|chowkbazar|chawkbazar|azimpur|kamrangirchar|demra|mugda|basabo|khilkhet|kafrul|pallabi|shahbag|paltan|wari|sutrapur|gendaria|hazaribagh|adabor|bhola chowk/i;
const WORD_NUM = { ek: 1, dui: 2, du: 2, tin: 3, char: 4, pach: 5, choy: 6, chhoy: 6, sat: 7, at: 8, noy: 9, dosh: 10 };

I.add({
  's.oos_alt': { bl: '{name} ekhon stock e nai. Ei gulo ache, kon ta nibo? Chaile stock e ashle janabo.', bn: '{name} এখন স্টকে নেই। এগুলো আছে, কোনটা নিবেন? চাইলে স্টকে এলে জানাবো।', en: '{name} is out of stock right now. These are available, which one would you like? I can also tell you when it is back.' },
  's.oos_wait': { bl: '{name} ekhon stock e nai. Stock e ashle janiye debo?', bn: '{name} এখন স্টকে নেই। স্টকে এলে জানিয়ে দিবো?', en: '{name} is out of stock right now. Shall I tell you when it is back?' },
  's.opt_out': { bl: '{val} {opt} ta ekhon nai. Ache: {values}. Kon ta nibo? Chaile {val} ashle janabo.', bn: '{val} {opt} টা এখন নেই। আছে: {values}। কোনটা নিবেন? চাইলে {val} এলে জানাবো।', en: '{opt} {val} is out of stock. Available: {values}. Which one would you like? I can tell you when {val} is back.' },
  'qr.wait_yes': { bl: 'Hya janaben', bn: 'হ্যাঁ জানাবেন', en: 'Notify me' },
  'qr.wait_no': { bl: 'Dorkar nai', bn: 'দরকার নেই', en: 'No thanks' },
  's.wait_ok': { bl: 'Thik ache, stock e ashle apnake janiye debo.', bn: 'ঠিক আছে, স্টকে এলে আপনাকে জানিয়ে দিবো।', en: 'Sure, I will let you know when it is back.' },
  's.combo': { bl: '{other} o ache. Duita ekshathe nile matro {price} (apni {save} bachaben). Combo nibo?', bn: '{other} ও আছে। দুটো একসাথে নিলে মাত্র {price} (আপনি {save} বাঁচাবেন)। কম্বো নিবেন?', en: '{other} is also available. Take both for just {price} (you save {save}). Want the combo?' },
  'qr.combo_yes': { bl: 'Combo nibo', bn: 'কম্বো নিবো', en: 'Yes, combo' },
  'qr.combo_no': { bl: 'Shudhu eta', bn: 'শুধু এটা', en: 'Just this' },
  's.add_more': { bl: 'Thik ache, ar kon product ta nibo?', bn: 'ঠিক আছে, আর কোন প্রোডাক্টটা নিবেন?', en: 'Sure, which other product would you like?' },
  's.change_q': { bl: 'Ki change korbo?', bn: 'কী পরিবর্তন করবো?', en: 'What would you like to change?' },
  'qr.product': { bl: 'Product', bn: 'প্রোডাক্ট', en: 'Product' },
  'qr.address': { bl: 'Address', bn: 'ঠিকানা', en: 'Address' },
  's.change_addr': { bl: 'Thik ache, notun address ta likhun.', bn: 'ঠিক আছে, নতুন ঠিকানাটা লিখুন।', en: 'Sure, please type the new address.' },
  's.change_prod': { bl: 'Thik ache, kon product ta nibo?', bn: 'ঠিক আছে, কোন প্রোডাক্টটা নিবেন?', en: 'Sure, which product would you like instead?' },
  's.pic_ask': { bl: 'Eta ki {name} ({price})?', bn: 'এটা কি {name} ({price})?', en: 'Is this {name} ({price})?' },
  'qr.pic_yes': { bl: 'Hya, eta', bn: 'হ্যাঁ, এটা', en: 'Yes' },
  'qr.pic_no': { bl: 'Na, onno', bn: 'না, অন্য', en: 'No, other' },
  's.pic_no': { bl: 'Thik ache, kon product ta bolun ba onno chobi pathan.', bn: 'ঠিক আছে, কোন প্রোডাক্টটা বলুন বা অন্য ছবি পাঠান।', en: 'No problem. Tell me which product, or send another photo.' },
  'b.hold': { bl: ['Dam ta amra already onek kom rakhi, quality ta bhalo.{extra}', 'Ei dam e quality ta ekdom thik thakbe.{extra}'], bn: ['দামটা আমরা আগেই অনেক কম রেখেছি, কোয়ালিটি ভালো।{extra}', 'এই দামেই কোয়ালিটি একদম ঠিক থাকবে।{extra}'], en: ['We already keep the price low and the quality is good.{extra}', 'This price already includes great quality.{extra}'] },
  'b.free': { bl: ' {min} er upore delivery free.', bn: ' {min} এর উপরে ডেলিভারি ফ্রি।', en: ' Delivery is free above {min}.' },
  'b.combo': { bl: ' Duita nile combo offer ache.', bn: ' দুটো নিলে কম্বো অফার আছে।', en: ' There is a combo offer if you take two.' },
  'b.offer': { bl: 'Thik ache, apnar jonno {pct}% discount dilam.', bn: 'ঠিক আছে, আপনার জন্য {pct}% ডিসকাউন্ট দিলাম।', en: 'Alright, I have given you a {pct}% discount.' },
  'b.last': { bl: 'Ei amar shorbosho kom dam, {pct}% discount dilam. Ar kom hobe na.', bn: 'এটাই আমার সর্বনিম্ন দাম, {pct}% ডিসকাউন্ট দিলাম। আর কমবে না।', en: 'This is my best price, {pct}% off. I cannot go lower.' },
  'b.firm': { bl: 'Dam ta fixed, ar kom kora jabe na. Bujhben ashakori.', bn: 'দামটা ফিক্সড, আর কমানো যাবে না। বুঝবেন আশা করি।', en: 'The price is fixed, I cannot reduce it further. I hope you understand.' },
  's.r_opt': { bl: '{opt} ki nibo?', bn: 'কোন {opt} নিবেন?', en: 'Which {opt} would you like?' },
  's.r_details': { bl: 'Nite apnar {need} ek sathe din.', bn: 'নিতে আপনার {need} একসাথে দিন।', en: 'To order, please send your {need} together.' },
  's.r_pick': { bl: 'Kon ta nibo?', bn: 'কোনটা নিবেন?', en: 'Which one would you like?' },
  's.r_confirm': { bl: 'Order ta confirm korbo?', bn: 'অর্ডারটা কনফার্ম করবো?', en: 'Shall I confirm the order?' },
  's.qty_oos': { bl: 'Dukkhito, {name} ekhon matro {n} ta ache. Koyta nibo?', bn: 'দুঃখিত, {name} এখন মাত্র {n}টা আছে। কয়টা নিবেন?', en: 'Sorry, only {n} of {name} left. How many would you like?' },
});

const pageName = (ctx) => (ctx.page && ctx.page.name) || S.get('page_name') || 'amader shop';
const optsStr = (opts) => Object.values(opts || {}).filter(Boolean).join(', ');
const titleOf = (p) => `${p.name}${p.variant ? ' (' + p.variant + ')' : ''}`;
const setCust = async (c, set) => { Object.assign(c, set); await col('customers').updateOne({ psid: c.psid }, { $set: set }); };
const R = (c, key, code) => [I.t(key, c), code]; // quick reply with language independent code
const itemsOf = (c) => [...(c.cart || []), ...(c.sel ? [{ code: c.sel.code, qty: c.sel.qty || 1, options: c.sel.options }] : [])];

async function quickCats() {
  const ps = (await P.all()).filter((p) => p.active && p.stock > 0);
  const cats = [...new Set(ps.map((p) => p.category).filter(Boolean))];
  if (cats.length >= 2) return cats.slice(0, 8);
  const names = [...new Set(ps.map((p) => p.name))];
  return names.length >= 2 ? names.slice(0, 6) : [];
}

async function greet(ctx, c, text, H) {
  const recent = Date.now() - (c.greetAt || 0) < 6 * HOUR;
  const style = S.get('greeting_style') || 'auto';
  const salam = SALAM.test(text);
  let head = '';
  if (style === 'hello') head = I.t('g.hello', c);
  else if (style === 'salam' || (style === 'auto' && salam)) head = salam ? I.t('g.salam', c) : I.t('g.assalam', c);
  else if (style === 'auto') head = I.t('g.hello', c);
  const how = /kemon|কেমন|how are/i.test(text) ? I.t('g.fine', c) : '';
  const shop = pageName(ctx);
  const body = recent ? I.t('g.recent', c) : I.t(c.orders_done > 0 ? 'g.back' : 'g.new', c, { shop });
  await setCust(c, { greetAt: Date.now() });
  return H.say(ctx, `${head ? head + how + (I.langOf(c) === 'bn' ? '। ' : '. ') : ''}${body}`, await quickCats());
}

// ---------- picking ----------
const ORD = [[/(prothom|pratham|1st|first|ekta)/, 0], [/(dwitiyo|ditiyo|2nd|second|dutiyo)/, 1], [/(tritiyo|tritio|3rd|third)/, 2]];
async function detectPick(c, text) {
  const t = String(text || '').trim();
  for (const tok of t.match(/[A-Za-z]{1,5}-?\d{1,6}/g) || []) { const p = await P.get(tok); if (p && p.active) return p; }
  const list = (c.pick_list || []).length && Date.now() - (c.pick_at || 0) < 2 * HOUR ? c.pick_list : null;
  if (!list) return null;
  const items = [];
  for (const code of list) { const p = await P.get(code); if (p && p.active) items.push(p); }
  const low = t.toLowerCase();
  const m = low.match(/^\s*(?:number|no\.?|nong|#)?\s*([1-9]|10)\s*(?:no|number|nong|ta|ti|tah)?\s*(?:ta|ti)?\s*(?:nibo|dibo|din|den|ta nibo)?\s*[.!]*$/);
  if (m && items[+m[1] - 1]) return items[+m[1] - 1];
  if (/^(shesh ta|last ta|last)$/.test(low) && items.length) return items[items.length - 1];
  if (low.length <= 25) for (const [re, i] of ORD) if (re.test(low) && items[i] && /(ta|nibo|1st|2nd|3rd|first|second|third)/.test(low)) return items[i];
  const tw = new Set(norm(t).split(' ').filter(Boolean));
  const hit = items.filter((p) => { const v = norm(p.variant).split(' ').filter(Boolean); return v.length && v.every((w) => tw.has(w)); });
  if (hit.length === 1) return hit[0];
  return null;
}

function parseQty(text) {
  const m = String(text || '').toLowerCase().match(/(\d{1,2})\s*(?:ta|ti|pis|pcs|piece|pic|টা|টি)\b/);
  if (m) return Math.min(10, Math.max(1, +m[1]));
  const w = String(text || '').toLowerCase().match(/\b(ek|dui|du|tin|char|pach|choy|chhoy|sat|at|noy|dosh)\s*(?:ta|ti)\b/);
  return w ? WORD_NUM[w[1]] : 0;
}

function applyOptions(p, sel, text) {
  const low = ` ${String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s+-]/gu, ' ')} `;
  const toks = new Set(low.split(/\s+/).filter(Boolean));
  let got = 0;
  for (const o of p.options || []) {
    if (sel.options[o.name]) continue;
    const v = o.values.find((x) => { const xl = x.toLowerCase(); return xl.includes(' ') ? low.includes(` ${xl} `) : toks.has(xl); });
    if (v) { sel.options[o.name] = v; got++; }
  }
  return got;
}
// the customer asked for a sold-out option value (XL!)
function soldOutMention(p, sel, text) {
  const low = ` ${String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s+-]/gu, ' ')} `;
  const toks = new Set(low.split(/\s+/).filter(Boolean));
  for (const o of p.options || []) {
    if (sel.options[o.name]) continue;
    const v = (o.out || []).find((x) => { const xl = x.toLowerCase(); return xl.includes(' ') ? low.includes(` ${xl} `) : toks.has(xl); });
    if (v) return { option: o.name, value: v, values: o.values };
  }
  return null;
}
const missingOpt = (p, sel) => (p.options || []).find((o) => !sel.options[o.name]);

// ---------- selecting a product ----------
async function oosFlow(ctx, c, p, H, opt) {
  if (opt) {
    await setCust(c, { wait_q: { code: p.code, option: opt.option, value: opt.value, at: Date.now() } });
    return H.say(ctx, I.t('s.opt_out', c, { val: opt.value, opt: opt.option, values: opt.values.join(', ') }), [...opt.values, R(c, 'qr.wait_yes', 'WAIT_YES')]);
  }
  const alts = await P.alternatives(p, 6);
  await setCust(c, { wait_q: { code: p.code, at: Date.now() }, ...(alts.length ? { pick_list: alts.map((x) => x.code), pick_at: Date.now() } : {}) });
  if (alts.length) {
    await H.showProducts(ctx, alts.map((x) => x.code));
    return H.say(ctx, I.t('s.oos_alt', c, { name: titleOf(p) }), [R(c, 'qr.wait_yes', 'WAIT_YES')]);
  }
  return H.say(ctx, I.t('s.oos_wait', c, { name: titleOf(p) }), [R(c, 'qr.wait_yes', 'WAIT_YES'), R(c, 'qr.wait_no', 'WAIT_NO')]);
}

async function selectProduct(ctx, c, p, H, { withPhoto = false, text = '' } = {}) {
  if (p.stock <= 0) return oosFlow(ctx, c, p, H);
  const sel = { code: p.code, options: {}, qty: parseQty(text) || 1, at: Date.now(), stage: 'options' };
  const so = soldOutMention(p, sel, text);
  applyOptions(p, sel, text);
  await setCust(c, { sel, pick_list: null, wait_q: null, interest: { codes: [p.code], at: Date.now() } });
  if (withPhoto) { const u = M_abs(p); if (u) await ctx.out.image(u).catch(() => {}); }
  if (so) return oosFlow(ctx, c, p, H, so);
  return nextAsk(ctx, c, p, H, true);
}
const M_abs = (p) => { try { const u = require('./media').abs((p.images || [])[0]); return u && !u.startsWith('/') ? u : ''; } catch { return ''; } };

async function summaryOf(c) {
  const parts = [];
  for (const it of itemsOf(c)) {
    const p = await P.get(it.code); if (!p) continue;
    parts.push(`${p.name}${p.variant ? ' ' + p.variant : ''}${optsStr(it.options) ? ', ' + optsStr(it.options) : ''}${it.qty > 1 ? ' x ' + it.qty : ''}`);
  }
  let total = 0;
  for (const it of itemsOf(c)) { const p = await P.get(it.code); if (p) total += p.price * (it.qty || 1); }
  return `${parts.join(' + ')} = ${I.money(total, c)}`;
}

// a bundle that contains the chosen product + exactly one more product the customer does not have yet
async function comboFor(c, p) {
  if (S.get('combo_offer_on') === false) return null;
  const have = new Set(itemsOf(c).map((i) => String(i.code).toUpperCase()));
  for (const b of await col('bundles').find({ active: { $ne: false } }).toArray()) {
    const codes = (b.codes || []).map((x) => String(x).trim().toUpperCase());
    if (codes.length < 2 || !codes.includes(p.code.toUpperCase())) continue;
    const missing = codes.filter((x) => !have.has(x));
    if (missing.length !== 1) continue;
    if ((c.combo_asked || []).includes(b.name)) continue;
    const other = await P.get(missing[0]);
    if (!other || !other.active || other.stock <= 0) continue;
    let sum = 0;
    for (const cd of codes) { const q = await P.get(cd); sum += q ? q.price : 0; }
    return { bundle: b, other, price: Number(b.price), save: Math.max(0, sum - Number(b.price)) };
  }
  return null;
}

async function nextAsk(ctx, c, p, H, first) {
  const sel = c.sel;
  const o = missingOpt(p, sel);
  const low = p.stock <= S.num('low_stock');
  if (o) {
    await setCust(c, { sel });
    if (first) return H.say(ctx, I.t('s.first', c, { name: titleOf(p), price: I.money(p.price, c), low: low ? I.t('s.low', c, { n: p.stock }) : '', opt: o.name }), o.values);
    return H.say(ctx, I.t('s.next', c, { opt: o.name }), o.values);
  }
  // all options chosen
  sel.stage = 'details';
  await setCust(c, { sel });
  const combo = await comboFor(c, p);
  if (combo) {
    await setCust(c, { combo_q: { bundle: combo.bundle.name, other: combo.other.code, at: Date.now() }, combo_asked: [...(c.combo_asked || []), combo.bundle.name] });
    return H.say(ctx, I.t('s.combo', c, { other: titleOf(combo.other), price: I.money(combo.price, c), save: I.money(combo.save, c) }), [R(c, 'qr.combo_yes', 'COMBO_YES'), R(c, 'qr.combo_no', 'COMBO_NO')]);
  }
  return askDetails(ctx, c, H);
}
async function askDetails(ctx, c, H) {
  const sel = c.sel;
  const summary = await summaryOf(c);
  const need = [!c.name && 'need.name', !c.phone && 'need.phone', !c.address && 'need.address'].filter(Boolean).map((k) => I.t(k, c));
  if (!need.length) {
    sel.stage = 'confirm_addr';
    await setCust(c, { sel });
    return H.say(ctx, I.t('s.same_addr', c, { summary, phone: c.phone, address: c.address }), [R(c, 'qr.addr_ok', 'ADDR_OK'), R(c, 'qr.addr_new', 'ADDR_NEW')]);
  }
  return H.say(ctx, I.t('s.details', c, { summary, need: need.join(', ') }));
}

// ---------- preview once everything is known ----------
const complete = async (c) => {
  if (!c.sel) return null;
  const p = await P.get(c.sel.code);
  return p && !missingOpt(p, c.sel) ? p : null;
};
async function maybePreview(ctx, c, H, zone) {
  const p = await complete(c);
  if (!p || c.draft || !c.phone || !c.address || !c.name) return false;
  let inside = zone;
  if (inside === undefined) inside = DHAKA.test(c.address) ? true : undefined;
  if (inside === undefined) {
    await setCust(c, { zone_q: true });
    return H.say(ctx, I.t('s.zone', c), [R(c, 'qr.zone_in', 'ZONE_IN'), R(c, 'qr.zone_out', 'ZONE_OUT')]);
  }
  await setCust(c, { zone_q: false });
  const pct = (c.bargain && c.bargain.pct) || 0;
  const r = await H.previewOrder(ctx, c, itemsOf(c), { inside_dhaka: inside, extra_discount_pct: pct });
  if (r.error) {
    if (r.error === 'out_of_stock') return H.say(ctx, I.t('s.qty_oos', c, { name: titleOf(p), n: r.stock }));
    if (r.error === 'option_sold_out') { delete c.sel.options[r.option]; await setCust(c, { sel: c.sel }); return oosFlow(ctx, c, p, H, { option: r.option, value: r.value, values: r.values }); }
    return false;
  }
  return true;
}

// ---------- bargaining (server decides, within max_discount_pct) ----------
const BARGAIN = /(dam|daam|price|rate|দাম).{0,16}(kom|koman|komao|komaben|komano|beshi|besi|boro|onek|কম|বেশি)|kom (hobe|korben|koren|den|dao|kora jay|nen)|komano|komate|discount|last dam|final dam|ektu kom|কমান|ডিসকাউন্ট|কম হবে|dam beshi|onek dam|too (much|expensive)|any discount|reduce the price|lower the price|best price/i;
async function bargain(ctx, c, H) {
  const b = c.bargain || { n: 0, pct: 0 };
  const max = S.num('max_discount_pct');
  const draft = c.draft;
  let text, pct = b.pct || 0;
  if (max > 0 && b.n === 1) { pct = Math.max(1, Math.ceil(max / 2)); text = I.t('b.offer', c, { pct }); }
  else if (max > 0 && b.n === 2) { pct = max; text = I.t('b.last', c, { pct }); }
  else if (b.n === 0) {
    let extra = '';
    const fm = S.num('free_delivery_min');
    if (fm) extra += I.t('b.free', c, { min: I.money(fm, c) });
    else if (c.sel && (await comboFor({ ...c, combo_asked: [] }, await P.get(c.sel.code) || { code: '' }))) extra += I.t('b.combo', c);
    text = I.t('b.hold', c, { extra });
  } else text = I.t('b.firm', c);
  await setCust(c, { bargain: { n: b.n + 1, pct, at: Date.now() } });
  // a new discount while the preview is open: build the preview again
  if (draft && pct !== (b.pct || 0)) {
    const zone = draft.opts && draft.opts.inside_dhaka;
    await setCust(c, { draft: null });
    await col('customers').updateOne({ psid: c.psid }, { $set: { draft: null } });
    await H.say(ctx, text);
    return maybePreview(ctx, c, H, zone);
  }
  const rs = await resume(c);
  return H.say(ctx, rs ? `${text} ${rs.text}` : text, rs && rs.replies);
}

// ---------- steer the customer back to where the flow stopped ----------
async function resume(c) {
  if (c.pay_stage === 'method') return null;
  if (c.draft) return { text: I.t('s.r_confirm', c), replies: [R(c, 'qr.confirm', 'CONFIRM'), R(c, 'qr.change', 'CHANGE')] };
  if (c.sel) {
    const p = await P.get(c.sel.code);
    const o = p && missingOpt(p, c.sel);
    if (o) return { text: I.t('s.r_opt', c, { opt: o.name }), replies: o.values };
    const need = [!c.name && 'need.name', !c.phone && 'need.phone', !c.address && 'need.address'].filter(Boolean).map((k) => I.t(k, c));
    if (need.length) return { text: I.t('s.r_details', c, { need: need.join(', ') }) };
    return null;
  }
  if ((c.pick_list || []).length) return { text: I.t('s.r_pick', c) };
  return null;
}

// ---------- the picture the customer sent matched a catalog product ----------
async function photoMatch(ctx, c, code, H) {
  const p = await P.get(code);
  if (!p || !p.active || c.draft) return false;
  await setCust(c, { pic_q: { code: p.code, at: Date.now() } });
  const u = M_abs(p); if (u) await ctx.out.image(u).catch(() => {});
  return H.say(ctx, I.t('s.pic_ask', c, { name: titleOf(p), price: I.money(p.price, c) }), [R(c, 'qr.pic_yes', 'PIC_YES'), R(c, 'qr.pic_no', 'PIC_NO')]);
}

const YES = /^(hya|hyan|ji|jii|yes|y|ok|okay|thik|ei ta|eta|haa|ha|hae|hoy|sure|হ্যাঁ|হ্যা|জি|ঠিক|ওকে)\b/i;
const NO = /(dorkar nai|lagbe na|na\b|no\b|nah|চাই না|না\b|দরকার নেই|shudhu eta|thak)/i;

// ---------- main entry ----------
async function step(ctx, c, text, H) {
  const t = String(text || '').trim();
  if (!t) return false;
  const low = t.toLowerCase();
  if (c.sel && Date.now() - (c.sel.at || 0) > 6 * HOUR) await setCust(c, { sel: null, cart: null });

  // dhaka / outside question
  if (c.zone_q && c.sel && !c.draft) {
    if (/baire|bahire|outside|বাইরে|\bna\b/.test(low)) return maybePreview(ctx, c, H, false);
    if (/moddhe|vitor|bhitore|inside|ভিতর|মধ্যে|\bhya\b|\bji\b|yes/.test(low)) return maybePreview(ctx, c, H, true);
    return false;
  }
  // previous address ok?
  if (c.sel && c.sel.stage === 'confirm_addr' && !c.draft) {
    if (/notun|new|onno|\bna\b|change|নতুন|না\b/.test(low)) { c.sel.stage = 'details'; await setCust(c, { sel: c.sel, address: '' }); return H.say(ctx, I.t('s.new_addr', c)); }
    if (YES.test(low)) return maybePreview(ctx, c, H);
  }
  // combo offer answer
  if (c.combo_q && c.sel && Date.now() - c.combo_q.at < 2 * HOUR) {
    if (/combo|hya|ji\b|yes|ok|nibo|কম্বো|হ্যাঁ/.test(low) && !/shudhu|only|na\b|না/.test(low)) {
      const other = await P.get(c.combo_q.other);
      const cart = [...(c.cart || []), { code: c.sel.code, qty: c.sel.qty || 1, options: c.sel.options }];
      await setCust(c, { combo_q: null, cart, sel: null });
      if (other) return selectProduct(ctx, c, other, H, { withPhoto: true });
    } else if (/shudhu|only|na\b|no\b|না|just/.test(low)) { await setCust(c, { combo_q: null }); return askDetails(ctx, c, H); }
  }
  // "stock e ashle janan"
  if (c.wait_q && Date.now() - c.wait_q.at < 2 * HOUR) {
    const yes = /janaben|janan|janiye|notify|ashle|asle|জানাবেন|জানান|হ্যাঁ janaben|^hya$|^ji$|^yes$/i.test(low);
    if (yes && !NO.test(low)) {
      const w = c.wait_q;
      await Out.addWait(c, ctx, w.code, w.option ? { option: w.option, value: w.value } : null);
      await setCust(c, { wait_q: null });
      return H.say(ctx, I.t('s.wait_ok', c));
    }
    if (/dorkar nai|lagbe na|no thanks|দরকার নেই|^na$/i.test(low)) { await setCust(c, { wait_q: null }); return H.say(ctx, I.t('s.cancel', c)); }
  }
  // the photo matched a product: is it this one?
  if (c.pic_q && Date.now() - c.pic_q.at < 2 * HOUR) {
    if (YES.test(low) || /hya|yes|হ্যাঁ/.test(low)) { const p = await P.get(c.pic_q.code); await setCust(c, { pic_q: null }); if (p) return selectProduct(ctx, c, p, H, { text: t }); }
    if (/^(na|no|nah|না)\b|onno/i.test(low)) { await setCust(c, { pic_q: null }); return H.say(ctx, I.t('s.pic_no', c)); }
  }
  // change request while the preview is open
  if (c.draft && /^(change|change korbo|bodlabo|bodlate|পরিবর্তন)/i.test(low)) {
    const opts = c.sel ? ((await P.get(c.sel.code)) || {}).options || [] : [];
    await setCust(c, { change_q: Date.now() });
    return H.say(ctx, I.t('s.change_q', c), [...opts.map((o) => o.name), R(c, 'qr.product', 'CHG_PRODUCT'), R(c, 'qr.address', 'CHG_ADDRESS')]);
  }
  if (c.draft && c.change_q && Date.now() - c.change_q < 30 * 60000) {
    await setCust(c, { change_q: 0 });
    const p = c.sel ? await P.get(c.sel.code) : null;
    const opt = p && (p.options || []).find((o) => low.includes(o.name.toLowerCase()));
    if (/address|thikana|ঠিকানা/.test(low)) { await setCust(c, { draft: null, address: '', sel: c.sel ? { ...c.sel, stage: 'details' } : null }); return H.say(ctx, I.t('s.change_addr', c)); }
    if (opt) { delete c.sel.options[opt.name]; c.sel.stage = 'options'; await setCust(c, { draft: null, sel: c.sel }); return nextAsk(ctx, c, p, H, false); }
    if (/product|প্রোডাক্ট|onno|other/.test(low)) { await setCust(c, { draft: null, sel: null, cart: null }); return H.say(ctx, I.t('s.change_prod', c), await quickCats()); }
  }
  // quantity change while the preview is open ("3 ta nibo")
  if (c.draft && c.sel && t.length < 30 && parseQty(t)) {
    const zone = c.draft.opts ? c.draft.opts.inside_dhaka : undefined;
    c.sel.qty = parseQty(t);
    await setCust(c, { draft: null, sel: c.sel });
    await maybePreview(ctx, c, H, zone);
    return true;
  }
  // cancel the selection
  if (c.sel && !c.draft && /(lagbe na|nibo na|nite chai na|cancel|thak|bad den|pore nibo|লাগবে না|নিবো না|দরকার নেই|dont want|don't want)/i.test(t) && t.length < 40) {
    await setCust(c, { sel: null, pick_list: null, cart: null });
    return H.say(ctx, I.t('s.cancel', c));
  }
  // greeting (only when no flow is running)
  if (!c.sel && !c.draft && isPureGreeting(t)) return greet(ctx, c, t, H);

  // add one more product to the same order
  if ((c.draft || (c.sel && c.sel.stage !== 'options')) && /^(ar ekta|aro ekta|aro kichu|ar kichu|add|another|আরেকটা|আরও|ar ekta product)/i.test(low) && !/lagbe na|nibo na/.test(low)) {
    const cart = [...(c.cart || []), ...(c.sel ? [{ code: c.sel.code, qty: c.sel.qty || 1, options: c.sel.options }] : [])];
    await setCust(c, { cart, sel: null, draft: null, combo_q: null });
    return H.say(ctx, I.t('s.add_more', c), await quickCats());
  }

  // shop questions + size help (answer, then steer back to the flow in the SAME message)
  const faq = await Faq.handle(c, t, ctx);
  if (faq) {
    if (faq.set) await setCust(c, { [faq.set]: Date.now() });
    if (faq.clear) await setCust(c, { [faq.clear]: 0 });
    const rs = faq.set === 'size_q' ? null : await resume(c);
    const replies = faq.replies || (rs && rs.replies);
    return H.say(ctx, rs && !faq.replies ? `${faq.text} ${rs.text}` : faq.text, replies);
  }

  // bargaining (only when there is a product in play)
  if (S.get('bargain_on') !== false && BARGAIN.test(t) && (c.sel || c.draft || (c.interest && Date.now() - (c.interest.at || 0) < 6 * HOUR))) return bargain(ctx, c, H);

  // picked from the list / by code
  if (!c.draft) {
    const picked = await detectPick(c, t);
    if (picked) { if (c.sel && c.sel.stage !== 'options') await setCust(c, { cart: [...(c.cart || []), { code: c.sel.code, qty: c.sel.qty || 1, options: c.sel.options }] }); return selectProduct(ctx, c, picked, H, { text: t }); }
  }
  // answering the option question
  if (c.sel && c.sel.stage === 'options' && !c.draft) {
    const p = await P.get(c.sel.code);
    if (p) {
      const q = parseQty(t);
      if (q) c.sel.qty = q;
      const so = soldOutMention(p, c.sel, t);
      if (so) return oosFlow(ctx, c, p, H, so);
      const got = applyOptions(p, c.sel, t);
      if (got) { c.sel.at = Date.now(); return nextAsk(ctx, c, p, H, false); }
      const other = (await P.matchProducts(t)).filter((x) => x.code !== p.code);
      if (!other.length) {
        const words = P.cleanQuery(t).split(' ').filter(Boolean);
        const o = missingOpt(p, c.sel);
        if (o && words.length && words.length <= 2 && !/\?/.test(t)) return H.say(ctx, I.t('s.bad_opt', c, { opt: o.name, values: o.values.join(', ') }), o.values);
        return false;
      }
      await setCust(c, { sel: null });
    }
  }
  // discovery of a new product
  if (!c.sel && !c.draft && t.length <= 80 && !/\d{8,}/.test(t)) {
    const ms = await P.matchProducts(t, 10);
    if (!ms.length) return false;
    const inStock = ms.filter((p) => p.stock > 0);
    if (!inStock.length) return oosFlow(ctx, c, ms[0], H);
    if (inStock.length === 1) return selectProduct(ctx, c, inStock[0], H, { withPhoto: true, text: t });
    await setCust(c, { pick_list: inStock.map((p) => p.code), pick_at: Date.now() });
    await H.showProducts(ctx, inStock.map((p) => p.code));
    return H.say(ctx, I.t('s.many', c, { n: inStock.length }));
  }
  return false;
}

module.exports = { step, maybePreview, complete, missingOpt, isPureGreeting, photoMatch, DHAKA, itemsOf };
