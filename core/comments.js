// Comment auto reply: short public reply + private inbox message
const { col } = require('./db');
const S = require('./settings');
const L = require('./logger');
const AI = require('./ai');
const fb = require('./facebook');
const P = require('./products');
const O = require('./orders');
const N = require('./notify');

let pageId = '';
const setPageId = (id) => { pageId = String(id || ''); };

function parseJson(t) {
  const m = String(t || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function handle(v, page) {
  if (!v || v.item !== 'comment' || v.verb !== 'add') { L.info('comment', `Skip: ${(v && v.item) || '?'} / ${(v && v.verb) || '?'} (shudhu notun comment e reply hoy)`); return; }
  fb.status.lastCommentAt = Date.now();
  if (!S.get('bot_on') || !S.get('comment_on') || (page && (page.bot_on === false || page.comment_on === false))) { L.warn('comment', 'Comment ashche kintu Bot ba Comment reply OFF ache (Home > Bot control / Pages), tai reply dei ni'); return; }
  const cid = v.comment_id, from = v.from || {}, text = String(v.message || '').trim();
  if (!cid) { L.warn('comment', 'Comment event e comment_id nai, skip'); return; }
  if (!text) { L.info('comment', 'Skip: comment e kono lekha nai (shudhu photo/sticker)'); return; }
  if (page && String(from.id) === String(page.pageId)) { L.info('comment', 'Skip: eta page er nijer comment'); return; }
  if (v.parent_id && v.post_id && v.parent_id !== v.post_id) { L.info('comment', 'Skip: eta kono comment er reply (shudhu mul comment e reply hoy)'); return; }
  const sp = await col('spam_users').findOne({ fbid: String(from.id) });
  if (sp && sp.n >= 2) { L.info('comment', 'Skip: spam list e thaka user'); return; }
  L.info('comment', `Notun comment: "${text.slice(0, 60)}"`);
  try { await col('comments').insertOne({ _id: cid, createdAt: new Date() }); } catch { L.info('comment', 'Skip: ei comment age handle kora hoyeche'); return; }
  const key = `${v.post_id}:${from.id}`;
  if (await col('comments').findOne({ key, replied: true, createdAt: { $gt: new Date(Date.now() - 2 * 3600e3) } })) { L.info('comment', 'Skip: ei user ke ei post e 2 ghontar moddhe reply deya hoyeche'); return; }

  const bn = /[ঀ-৿]/.test(text);
  let products = [];
  const link = await col('post_links').findOne({ post_id: String(v.post_id) });
  if (link) { const p = await P.get(link.product_code); if (p) products = [p]; }
  if (!products.length && S.get('comment_auto_link') !== false) products = await fromPost(v.post_id);
  if (!products.length) products = (await P.matchProducts(text, 3)).filter((p) => p.active !== false);
  const inStock = products.filter((p) => p.stock > 0);
  if (inStock.length) products = inStock;

  // 1) is it a real customer? (AI only decides spam/abuse; real words are never ignored)
  const hasWords = /[\p{L}\p{N}]{2,}/u.test(text);
  if (!hasWords) { L.info('comment', 'Skip: shudhu emoji/tag'); return; }
  let intent = /https?:\/\/|www\.|t\.me\/|wa\.me\/|\bearn\b.*\bmoney\b|click here/i.test(text) ? 'spam' : 'info';
  if (intent !== 'spam') {
    try {
      const r = await AI.chat('text', [{ role: 'system', content: 'Classify a Facebook comment on a shop post. Output ONLY JSON {"intent":"customer|spam|abusive"}. customer = any question, interest, price/order/size ask, or a normal short word. spam = ads, links, promotions. abusive = insults or swearing.' }, { role: 'user', content: text }]);
      const j = parseJson(r.message.content);
      if (j && ['spam', 'abusive'].includes(j.intent)) intent = j.intent;
    } catch (e) { L.warn('comment', 'Comment classify AI fail, customer dhore reply dichhi: ' + e.message); }
  }
  if (intent === 'abusive' && S.get('comment_hide_abusive')) { fb.hideComment(cid).then(() => L.ok('comment', 'Abusive comment hide kora hoyeche')).catch((e) => L.warn('comment', e.message)); return; }
  if (intent === 'spam') {
    await col('spam_users').updateOne({ fbid: String(from.id) }, { $inc: { n: 1 }, $set: { name: from.name || '', at: new Date() } }, { upsert: true }).catch(() => {});
    if (S.get('comment_hide_spam') !== false) fb.hideComment(cid).then(() => L.ok('comment', 'Spam comment hide kora hoyeche')).catch((e) => L.warn('comment', 'Spam hide hoyni: ' + e.message));
  }
  if (intent !== 'info') { L.info('comment', `Skip (${intent}): ${text.slice(0, 40)}`); return; }
  await col('comments').updateOne({ _id: cid }, { $set: { key, replied: true } });

  // 2) texts are built from the database, never invented by the AI
  const pText = privateText(products, bn);
  const min = Math.max(0, S.num('comment_delay_min')), max = Math.max(min, S.num('comment_delay_max'));
  const wait = (min + Math.random() * (max - min)) * 1000;
  L.info('comment', `Comment: "${text.slice(0, 50)}" (${products.length} product), ${Math.round(wait / 1000)}s por reply debo`);
  setTimeout(async () => {
    let sent = false;
    // private (inbox) message first, so the public line never claims something that did not happen
    if (S.get('comment_private_reply')) {
      try {
        const j = await fb.privateReply(cid, pText);
        sent = true;
        const psids = [...new Set([String(from.id), j && j.recipient_id ? String(j.recipient_id) : ''].filter(Boolean))];
        for (const id of psids) {
          await col('messages').insertOne({ psid: id, role: 'assistant', text: pText, t: Date.now() }).catch(() => {});
          await col('comment_ctx').insertOne({ psid: id, codes: products.map((p) => p.code), post_id: String(v.post_id || ''), at: Date.now(), used: false, text: text.slice(0, 200) }).catch(() => {});
        }
        L.ok('comment', 'Inbox e private reply gelo');
      } catch (e) {
        L.error('comment', 'Private reply fail (comment 7 diner purano ba permission nai?): ' + e.message + (e.hint ? ' | ' + e.hint : ''), e);
        N.admin('attention', 'Comment e inbox message jayni', `"${text.slice(0, 80)}" (${from.name || from.id})\n${String(e.message).slice(0, 120)}\nPost e giye nijer hate reply din.`);
      }
    }
    if (S.get('comment_public_reply')) {
      try { await fb.replyComment(cid, publicText(products, sent, bn)); L.ok('comment', 'Public reply gelo'); }
      catch (e) { L.error('comment', 'Public reply fail: ' + e.message + (e.hint ? ' | ' + e.hint : ''), e); }
    }
  }, wait);
}

// the post's own text names the product? (cached; links it automatically when exactly one product matches)
async function fromPost(postId) {
  if (!postId) return [];
  try {
    let pc = await col('post_cache').findOne({ _id: String(postId) });
    if (!pc) {
      const j = await fb.graph(`${postId}?fields=message`).catch(() => ({}));
      pc = { _id: String(postId), message: String(j.message || ''), at: new Date() };
      await col('post_cache').insertOne(pc).catch(() => {});
    }
    if (!pc.message) return [];
    const ms = (await P.matchProducts(pc.message, 3)).filter((p) => p.active !== false);
    if (ms.length === 1) {
      await col('post_links').updateOne({ post_id: String(postId) }, { $setOnInsert: { post_id: String(postId), product_code: ms[0].code, note: 'auto (post text)', auto: true } }, { upsert: true }).catch(() => {});
      L.ok('comment', `Post ${postId} auto link: ${ms[0].code}`);
    }
    return ms;
  } catch (e) { L.warn('comment', 'Post theke product khuja jayni: ' + e.message); return []; }
}

// ---------- reply texts ----------
const nameOf = (p) => `${p.name}${p.variant ? ' (' + p.variant + ')' : ''}`;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function privateText(products, bn) {
  const hi = bn ? 'আসসালামু আলাইকুম।' : 'Assalamu alaikum.';
  if (!products.length) return bn ? `${hi} কোন প্রোডাক্টটি লাগবে জি? নাম বা ছবি পাঠান।` : `${hi} Kon product ta lagbe ji? Naam ba chobi pathaben.`;
  if (products.length === 1) {
    const p = products[0];
    if (p.stock <= 0) return bn ? `${hi} ${nameOf(p)} এখন স্টকে নেই জি। অন্য ডিজাইন দেখাবো?` : `${hi} ${nameOf(p)} ekhon stock e nai ji. Onno design dekhabo?`;
    const o = p.options || [];
    const optTxt = o.length ? ' ' + o.map((x) => `${x.name}: ${x.values.join('/')}`).join(', ') + '.' : '';
    const ask = o.length ? (bn ? `কোন ${o[0].name} লাগবে জি?` : `Kon ${o[0].name} lagbe ji?`) : (bn ? 'কয়টা লাগবে জি?' : 'Koyta lagbe ji?');
    return bn ? `${hi} ${nameOf(p)} এর দাম ${Math.round(p.price)} টাকা।${optTxt} ${ask}` : `${hi} ${nameOf(p)} er dam ${O.money(p.price)}.${optTxt} ${ask}`;
  }
  const lines = products.slice(0, 3).map((p, i) => `${i + 1}) ${nameOf(p)} - ${O.money(p.price)}`).join('\n');
  return bn ? `${hi} এগুলো আছে জি:\n${lines}\nকোনটা নিবেন? নাম্বার লিখুন।` : `${hi} Ei gulo ache ji:\n${lines}\nKon ta nibo? Number likhun.`;
}
function publicText(products, sent, bn) {
  if (sent) {
    if (S.get('comment_price_public') && products.length === 1 && products[0].stock > 0) return bn ? `${nameOf(products[0])} ${Math.round(products[0].price)} টাকা। বিস্তারিত ইনবক্সে পাঠিয়েছি জি` : `${nameOf(products[0])} ${O.money(products[0].price)}. Details inbox e pathiyechi ji`;
    return pick(bn ? ['ইনবক্সে ডিটেইলস পাঠিয়েছি জি', 'জি, ইনবক্স চেক করুন, পাঠিয়ে দিয়েছি'] : ['Inbox e details pathiyechi ji', 'Ji, inbox check korun, pathiyechi', 'Details inbox e pathiyechi, dekhben ji']);
  }
  return pick(bn ? ['ডিটেইলস জানতে ইনবক্সে একটা মেসেজ দিন জি', 'ইনবক্সে মেসেজ করুন জি, জানিয়ে দিচ্ছি'] : ['Details jante inbox e ekta message din ji', 'Inbox e message korun ji, details diye dibo']);
}

module.exports = { handle, setPageId };
