const { col, nextId } = require('./db');
const S = require('./settings');
let cache = null, at = 0;

const bust = () => { cache = null; };
async function all() {
  if (cache && Date.now() - at < 30000) return cache;
  cache = await col('products').find({}).sort({ createdAt: -1 }).toArray();
  at = Date.now();
  return cache;
}
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim();

// "Size: S,M,L" per line -> [{name, values, out}]. A value ending with "!" is sold out (XL!) : kept in out, not offered.
function parseOptions(txt) {
  return String(txt || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf(':');
    if (i < 1) return null;
    const all = l.slice(i + 1).split(',').map((s) => s.trim()).filter(Boolean);
    return { name: l.slice(0, i).trim(), values: all.filter((v) => !v.endsWith('!')), out: all.filter((v) => v.endsWith('!')).map((v) => v.slice(0, -1).trim()).filter(Boolean) };
  }).filter((o) => o && (o.values.length || o.out.length));
}
function parseExtra(txt) {
  const o = {};
  String(txt || '').split('\n').forEach((l) => {
    const i = l.indexOf(':');
    if (i > 0) o[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  });
  return o;
}

async function get(code) {
  const c = String(code || '').trim().toUpperCase();
  return (await all()).find((p) => p.code.toUpperCase() === c) || null;
}

async function save(b) {
  const now = new Date();
  const doc = {
    name: String(b.name || '').trim(),
    variant: String(b.variant || '').trim(),
    price: Number(b.price) || 0,
    stock: Math.max(0, parseInt(b.stock) || 0),
    category: String(b.category || '').trim(),
    description: String(b.description || '').trim(),
    aliases: String(b.aliases || '').split(',').map((s) => s.trim()).filter(Boolean),
    optionsText: String(b.optionsText || ''),
    options: parseOptions(b.optionsText),
    extraText: String(b.extraText || ''),
    extra: parseExtra(b.extraText),
    images: Array.isArray(b.images) ? b.images.filter(Boolean).slice(0, 8) : [],
    active: b.active !== false && b.active !== 'false',
    updatedAt: now,
  };
  if (!doc.name) throw new Error('Product er naam lagbe');
  if (doc.price <= 0) throw new Error('Price 0 er beshi hote hobe');
  const list = await all();
  let code = String(b.code || '').trim().toUpperCase();
  if (!code) code = 'P-' + (100 + (await nextId('product')));
  const dup = list.filter((p) => p.code !== code && norm(p.name) === norm(doc.name) && norm(p.variant) === norm(doc.variant)).map((p) => p.code);
  const prev = list.find((p) => p.code === code);
  await col('products').updateOne({ code }, { $set: doc, $setOnInsert: { code, createdAt: now } }, { upsert: true });
  bust();
  if (prev) {
    try {
      const O = require('./outreach');
      if ((prev.stock || 0) <= 0 && doc.stock > 0 && doc.active) O.restocked(code, null).catch(() => {});
      for (const po of prev.options || []) {
        const no = doc.options.find((x) => x.name === po.name);
        if (!no) continue;
        for (const v of po.out || []) if (!(no.out || []).includes(v) && doc.stock > 0) O.restocked(code, { option: po.name, value: v }).catch(() => {});
      }
    } catch {}
  }
  return { code, duplicate: dup, sameName: list.filter((p) => p.code !== code && norm(p.name) === norm(doc.name)).map((p) => p.code) };
}
async function remove(code) { await col('products').deleteOne({ code }); bust(); }

async function adjustStock(code, delta) {
  await col('products').updateOne({ code }, { $inc: { stock: delta } });
  bust();
  return get(code);
}

async function searchScored(q, limit = 6, o = {}) {
  const nq = norm(q);
  const tokens = nq.split(' ').filter((t) => t.length > 1);
  const out = [];
  for (const p of await all()) {
    if (!p.active) continue;
    if (o.maxPrice && p.price > o.maxPrice) continue;
    if (o.minPrice && p.price < o.minPrice) continue;
    if (!nq) { if (p.stock > 0) out.push({ p, s: p.price }); continue; } // budget / gift browsing: closest to budget first
    const hay = norm([p.name, p.variant, p.category, p.code, ...(p.aliases || [])].join(' '));
    let s = 0;
    if (nq.includes(norm(p.code))) s += 100;
    if (nq.includes(norm(p.name))) s += 3;
    for (const t of tokens) if (hay.includes(t)) s++;
    if (s > 0) out.push({ p, s });
  }
  return out.sort((a, b) => b.s - a.s).slice(0, limit);
}
const search = async (q, limit = 6, o = {}) => (await searchScored(q, limit, o)).map((x) => x.p);

// words that are only chatter, never a product name
const CHATTER = new Set('lagbe laagbe lagche chai chay chaichi den dao dite dekhan dekhao dekhaben ache ase achhe ki kro koro korun kore er ta ti ke ki ei eta oi ota ami amar amr apni apnar dam daam price koto kot rate available stock product products item items sell bikri kothay kobe nibo nite nilam pabo pawa jabe hobe hoy hobe jonno jonne please pls plz hi hello hey salam assalamualaikum assalamu alaikum bhai vai apu apa sir madam admin inbox details detail info order korbo korte korechi'.split(' '));
const cleanQuery = (t) => norm(t).split(' ').filter((w) => w.length > 1 && !CHATTER.has(w) && !/^\d+$/.test(w)).join(' ');
// products a customer text clearly points to; ties (same name, many variants) are all returned
async function matchProducts(text, max = 10) {
  const q = cleanQuery(text);
  if (!q) return [];
  const sc = await searchScored(q, 30);
  if (!sc.length) return [];
  const top = sc[0].s;
  const strong = sc.filter((x) => x.s >= top);
  return strong.slice(0, max).map((x) => x.p);
}

// similar in-stock products: other variants of the same name first, then the same category
async function alternatives(p, n = 4) {
  const live = (await all()).filter((x) => x.active && x.stock > 0 && x.code !== p.code);
  const same = live.filter((x) => norm(x.name) === norm(p.name));
  const cat = p.category ? live.filter((x) => x.category === p.category && !same.includes(x)) : [];
  return [...same, ...cat].slice(0, n);
}
const brief = (p) => ({
  code: p.code, name: p.name, variant: p.variant || undefined, price: p.price, stock: p.stock, low_stock: p.stock <= S.num('low_stock'),
  options: (p.options || []).map((o) => ({ name: o.name, values: o.values, sold_out_values: (o.out || []).length ? o.out : undefined })),
  details: p.extra && Object.keys(p.extra).length ? p.extra : undefined,
  description: p.description ? p.description.slice(0, 240) : undefined,
  has_photo: (p.images || []).length > 0,
});

module.exports = { alternatives, matchProducts, cleanQuery, searchScored, all, get, save, remove, search, brief, adjustStock, bust, parseOptions, norm };
