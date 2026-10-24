// Comment auto reply: short public reply + private inbox message
const { col } = require('./db');
const S = require('./settings');
const L = require('./logger');
const AI = require('./ai');
const fb = require('./facebook');
const P = require('./products');
const O = require('./orders');

let pageId = '';
const setPageId = (id) => { pageId = String(id || ''); };

function parseJson(t) {
  const m = String(t || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function handle(v) {
  if (!v || v.item !== 'comment' || v.verb !== 'add') return;
  if (!S.get('bot_on') || !S.get('comment_on')) return;
  const cid = v.comment_id, from = v.from || {}, text = String(v.message || '').trim();
  if (!cid || !text) return;
  if (pageId && String(from.id) === pageId) return;               // our own comment
  if (v.parent_id && v.post_id && v.parent_id !== v.post_id) return; // reply inside a thread
  try { await col('comments').insertOne({ _id: cid, createdAt: new Date() }); } catch { return; } // duplicate event
  const key = `${v.post_id}:${from.id}`;
  if (await col('comments').findOne({ key })) { L.info('comment', 'Ei post e ager e reply deya hoyeche, skip'); return; }
  await col('comments').updateOne({ _id: cid }, { $set: { key } });

  let products = [];
  const link = await col('post_links').findOne({ post_id: String(v.post_id) });
  if (link) { const p = await P.get(link.product_code); if (p) products = [p]; }
  if (!products.length) products = await P.search(text, 3);

  const priceRule = S.get('comment_price_public') ? 'You may mention the price in the public reply.' : 'Do NOT mention any price in the public reply.';
  const sys = `You write replies to Facebook post comments for the shop "${S.get('page_name') || 'our shop'}" in Bangladesh. Output ONLY JSON: {"intent":"price|order|info|spam|abusive|other","public_reply":"","private_reply":""}.
intent "other" = only emoji, tag, like or unrelated: leave both replies empty. spam/abusive: leave both empty.
public_reply: one short human line (max 12 words), vary the wording, same language as the comment (Bangla, Banglish or English), say details are sent in inbox. ${priceRule} No hashtags.
private_reply: 2-3 short lines, same language, greeting like a real person, product name and price and available options taken ONLY from PRODUCT DATA, then ask what size/quantity they want. If PRODUCT DATA is empty, ask which product they mean. Never invent anything. Almost no emoji.`;
  let out;
  try {
    const r = await AI.chat('text', [{ role: 'system', content: sys }, { role: 'user', content: `COMMENT: ${text}\nPRODUCT DATA: ${JSON.stringify(products.map(P.brief))}` }]);
    out = parseJson(r.message.content);
  } catch (e) { L.error('comment', 'Comment reply AI fail: ' + e.message, e); return; }
  if (!out) { L.warn('comment', 'AI JSON dilo na, skip'); return; }
  if (out.intent === 'abusive' && S.get('comment_hide_abusive')) { fb.hideComment(cid).then(() => L.ok('comment', 'Abusive comment hide kora hoyeche')).catch((e) => L.warn('comment', e.message)); return; }
  if (['spam', 'abusive', 'other'].includes(out.intent) || (!out.public_reply && !out.private_reply)) { L.info('comment', `Skip (${out.intent})`); return; }

  const min = Math.max(0, S.num('comment_delay_min')), max = Math.max(min, S.num('comment_delay_max'));
  const wait = (min + Math.random() * (max - min)) * 1000;
  L.info('comment', `Comment: "${text.slice(0, 50)}" (${out.intent}), ${Math.round(wait / 1000)}s por reply debo`);
  setTimeout(async () => {
    if (S.get('comment_public_reply') && out.public_reply) {
      try { await fb.replyComment(cid, out.public_reply); L.ok('comment', 'Public reply gelo'); } catch (e) { L.error('comment', 'Public reply fail: ' + e.message, e); }
    }
    if (S.get('comment_private_reply') && out.private_reply) {
      try {
        await fb.privateReply(cid, out.private_reply);
        await col('messages').insertOne({ psid: String(from.id), role: 'assistant', text: out.private_reply, t: Date.now() });
        L.ok('comment', 'Inbox e private reply gelo');
      } catch (e) { L.error('comment', 'Private reply fail (comment 7 diner purano ba permission nai?): ' + e.message, e); }
    }
  }, wait);
}

module.exports = { handle, setPageId };
