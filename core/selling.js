// Guided selling steps handled by the server (no AI guessing):
// greeting -> product discovery / picker -> options -> details -> preview.
// The AI only talks when this module returns false.
const { col } = require('./db');
const S = require('./settings');
const P = require('./products');
const O = require('./orders');

const HOUR = 3600e3;
const norm = P.norm;
const SALAM = /(assalam|asalam|salam|slm|সালাম|আসসালা)/i;
const GREET = new Set(['assalamualaikum', 'assalamu', 'alaikum', 'asslamualaikum', 'assalamualaikam', 'salam', 'slm', 'hlw', 'hlo', 'helo', 'hello', 'hey', 'kemon', 'achen', 'aso', 'acho', 'ki', 'khobor', 'bhai', 'vai', 'bro', 'sir', 'madam', 'ji', 'jii', 'valo', 'bhalo', 'ase', 'apnar', 'apni', 'হ্যালো', 'হাই', 'সালাম', 'আসসালামু', 'আলাইকুম', 'আসসালামুয়ালাইকুম', 'কেমন', 'আছেন', 'ভাই', 'জি']);
const isGreetingWord = (w) => GREET.has(w) || /^(hi+|hii+|hel+o+|hey+)$/.test(w);
function isPureGreeting(text) {
  const t = norm(text);
  if (!t || t.length > 45) return false;
  const ws = t.split(' ');
  return ws.every(isGreetingWord) && ws.some((w) => isGreetingWord(w) && !['ki', 'ji', 'jii', 'bhai', 'vai', 'bro', 'sir', 'madam', 'apni', 'apnar', 'ase', 'valo', 'bhalo', 'achen', 'aso', 'acho', 'kemon', 'khobor', 'ভাই', 'জি', 'কেমন', 'আছেন'].includes(w));
}

const DHAKA = /\bdhaka\b|ঢাকা|mirpur|uttara|dhanmondi|mohammadpur|gulshan|banani|badda|rampura|motijheel|jatrabari|khilgaon|malibagh|farmgate|tejgaon|bashundhara|shyamoli|kalabagan|lalbagh|old dhaka|puran dhaka|chowkbazar|chawkbazar|azimpur|kamrangirchar|demra|mugda|basabo|khilkhet|kafrul|pallabi|shahbag|paltan|wari|sutrapur|gendaria|hazaribagh|adabor|bhola chowk/i;
const WORD_NUM = { ek: 1, dui: 2, du: 2, tin: 3, char: 4, pach: 5, choy: 6, chhoy: 6, sat: 7, at: 8, noy: 9, dosh: 10 };

const pageName = (ctx) => (ctx.page && ctx.page.name) || S.get('page_name') || 'amader shop';
const optLine = (p) => (p.options || []).map((o) => `${o.name}: ${o.values.join('/')}`).join(', ');
const optsStr = (opts) => Object.values(opts || {}).filter(Boolean).join(', ');
const titleOf = (p) => `${p.name}${p.variant ? ' (' + p.variant + ')' : ''}`;
const setCust = async (c, set) => { Object.assign(c, set); await col('customers').updateOne({ psid: c.psid }, { $set: set }); };

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
  if (style === 'hello') head = 'Hello ji';
  else if (style === 'salam' || (style === 'auto' && salam)) head = salam ? 'Walaikum assalam ji' : 'Assalamu alaikum';
  else if (style === 'auto') head = 'Hello ji';
  const how = /kemon|কেমন/i.test(text) ? ', alhamdulillah bhalo' : '';
  const body = recent ? 'Bolun ji, ki lagbe?' : (c.orders_done > 0 ? `Abar ${pageName(ctx)} e shagotom!` : `${pageName(ctx)} e shagotom!`) + ' Ki khujchhen, bolun ji.';
  await setCust(c, { greetAt: Date.now() });
  const msg = `${head ? head + how + (recent ? '. ' : ', ') : ''}${body}`;
  return H.say(ctx, msg, await quickCats());
}

// ---------- picking ----------
const ORD = [[/(prothom|pratham|1st|first|ekta)/, 0], [/(dwitiyo|ditiyo|2nd|second|dutiyo)/, 1], [/(tritiyo|tritio|3rd|third)/, 2]];
async function detectPick(c, text) {
  const t = String(text || '').trim();
  // product code mentioned ("Ami P-101 code er product ta nibo")
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
  // by variant / name words ("black ta", "white")
  const tw = new Set(norm(t).split(' ').filter(Boolean));
  const hit = items.filter((p) => { const v = norm(p.variant).split(' ').filter(Boolean); return v.length && v.every((w) => tw.has(w)); });
  if (hit.length === 1) return hit[0];
  return null;
}

function parseQty(text) {
  const m = String(text || '').toLowerCase().match(/(\d{1,2})\s*(?:ta|ti|pis|pcs|piece|pic)\b/);
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
const missingOpt = (p, sel) => (p.options || []).find((o) => !sel.options[o.name]);

// ---------- selecting a product ----------
async function selectProduct(ctx, c, p, H, { withPhoto = false, text = '' } = {}) {
  if (p.stock <= 0) { await H.say(ctx, `Ji, ${titleOf(p)} ekhon stock e nai. Onno design dekhabo?`); return true; }
  const sel = { code: p.code, options: {}, qty: parseQty(text) || 1, at: Date.now(), stage: 'options' };
  applyOptions(p, sel, text);
  await setCust(c, { sel, pick_list: null, interest: { codes: [p.code], at: Date.now() } });
  if (withPhoto) { const u = M_abs(p); if (u) await ctx.out.image(u).catch(() => {}); }
  return nextAsk(ctx, c, p, H, true);
}
const M_abs = (p) => { try { const u = require('./media').abs((p.images || [])[0]); return u && !u.startsWith('/') ? u : ''; } catch { return ''; } };

async function nextAsk(ctx, c, p, H, first) {
  const sel = c.sel;
  const o = missingOpt(p, sel);
  const low = p.low_stock !== undefined ? p.low_stock : p.stock <= S.num('low_stock');
  if (o) {
    const head = first ? `Ji, ${titleOf(p)}, ${O.money(p.price)}.${low ? ` Matro ${p.stock} ta baki ache.` : ''} ` : 'Darun. ';
    await setCust(c, { sel });
    return H.say(ctx, `${head}${o.name} ki nibo?`, o.values);
  }
  // all options chosen
  sel.stage = 'details';
  await setCust(c, { sel });
  const summary = `${p.name}${p.variant ? ' ' + p.variant : ''}${optsStr(sel.options) ? ', ' + optsStr(sel.options) : ''}${sel.qty > 1 ? ' x ' + sel.qty : ''} = ${O.money(p.price * sel.qty)}`;
  const need = [!c.name && 'naam', !c.phone && 'phone number', !c.address && 'puro address'].filter(Boolean);
  if (!need.length) {
    sel.stage = 'confirm_addr';
    await setCust(c, { sel });
    return H.say(ctx, `Darun ji! ${summary}. Ager moto ${c.phone}, ${c.address} e pathabo?`, ['Hya, ei ta', 'Notun address']);
  }
  return H.say(ctx, `Darun ji! ${summary}. Nite apnar ${need.join(', ')} ek sathe din ji.`);
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
    return H.say(ctx, 'Apnar address ki Dhaka shohorer moddhe?', ['Dhaka-r moddhe', 'Dhaka-r baire']);
  }
  await setCust(c, { zone_q: false });
  const r = await H.previewOrder(ctx, c, [{ code: p.code, qty: c.sel.qty || 1, options: c.sel.options }], { inside_dhaka: inside });
  if (r.error) {
    if (r.error === 'out_of_stock') return H.say(ctx, `Dukkhito ji, ${titleOf(p)} ekhon matro ${r.stock} ta ache. Koyta nibo?`);
    return false;
  }
  return true;
}

// ---------- main entry ----------
async function step(ctx, c, text, H) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (c.sel && Date.now() - (c.sel.at || 0) > 6 * HOUR) await setCust(c, { sel: null });

  // dhaka / outside question
  if (c.zone_q && c.sel && !c.draft) {
    const low = t.toLowerCase();
    if (/baire|bahire|outside|বাইরে|na\b/.test(low)) return maybePreview(ctx, c, H, false);
    if (/moddhe|vitor|bhitore|inside|ভিতর|মধ্যে|hya|ji|yes/.test(low)) return maybePreview(ctx, c, H, true);
    return false;
  }
  // previous address ok?
  if (c.sel && c.sel.stage === 'confirm_addr' && !c.draft) {
    const low = t.toLowerCase();
    if (/notun|new|onno|na\b|change/.test(low)) { c.sel.stage = 'details'; await setCust(c, { sel: c.sel, address: '' }); return H.say(ctx, 'Thik ache ji, notun address ta likhun.'); }
    if (/^(hya|hyan|ji|yes|ok|okay|thik|ei ta|eta|haa|ha)\b/.test(low)) return maybePreview(ctx, c, H);
  }
  // cancel the selection
  if (c.sel && !c.draft && /(lagbe na|nibo na|nite chai na|cancel|thak|bad den|pore nibo)/i.test(t) && t.length < 40) {
    await setCust(c, { sel: null, pick_list: null });
    return H.say(ctx, 'Thik ache ji, onno kichu lagle bolben.');
  }
  // greeting (only when no flow is running)
  if (!c.sel && !c.draft && isPureGreeting(t)) return greet(ctx, c, t, H);

  // picked from the list / by code
  if (!c.draft) {
    const picked = await detectPick(c, t);
    if (picked) return selectProduct(ctx, c, picked, H, { text: t });
  }
  // answering the option question
  if (c.sel && c.sel.stage === 'options' && !c.draft) {
    const p = await P.get(c.sel.code);
    if (p) {
      const q = parseQty(t);
      if (q) c.sel.qty = q;
      const got = applyOptions(p, c.sel, t);
      if (got) { c.sel.at = Date.now(); return nextAsk(ctx, c, p, H, false); }
      // maybe they switched to another product
      const other = (await P.matchProducts(t)).filter((x) => x.code !== p.code);
      if (!other.length) {
        const words = P.cleanQuery(t).split(' ').filter(Boolean);
        const o = missingOpt(p, c.sel);
        if (o && words.length && words.length <= 2 && !/\?/.test(t)) return H.say(ctx, `Ei ${o.name} ta nai ji. Ache: ${o.values.join(', ')}. Kon ta nibo?`, o.values);
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
    if (!inStock.length) { await H.say(ctx, `Ji, ${titleOf(ms[0])} ekhon stock e nai. Onno kichu dekhabo?`); return true; }
    if (inStock.length === 1) return selectProduct(ctx, c, inStock[0], H, { withPhoto: true, text: t });
    await setCust(c, { pick_list: inStock.map((p) => p.code), pick_at: Date.now() });
    await H.showProducts(ctx, inStock.map((p) => p.code));
    return H.say(ctx, `${inStock.length} ta ache ji. Kon ta nibo? "Eta nibo" chapun ba number likhun.`);
  }
  return false;
}

module.exports = { step, maybePreview, complete, missingOpt, isPureGreeting, DHAKA };
