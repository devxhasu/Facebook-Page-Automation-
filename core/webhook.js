const express = require('express');
const crypto = require('crypto');
const { col } = require('./db');
const S = require('./settings');
const L = require('./logger');
const fb = require('./facebook');
const agent = require('./agent');
const comments = require('./comments');

const router = express.Router();
const queues = new Map();
function queue(key, fn) {
  const p = (queues.get(key) || Promise.resolve()).then(fn).catch((e) => L.error('webhook', 'Handler error: ' + e.message, e));
  queues.set(key, p);
  p.finally(() => { if (queues.get(key) === p) queues.delete(key); });
}

router.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': tok, 'hub.challenge': ch } = req.query;
  if (mode === 'subscribe' && tok && tok === S.get('fb_verify_token')) { L.ok('webhook', 'Facebook webhook verify hoyeche'); return res.status(200).send(ch); }
  L.warn('webhook', 'Webhook verify fail: Verify Token mile nai (Settings > Facebook er token ar Facebook e deya token ek hote hobe)');
  res.sendStatus(403);
});

router.post('/webhook', (req, res) => {
  const secret = S.get('fb_app_secret');
  if (secret) {
    const sig = req.get('x-hub-signature-256') || '';
    const exp = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody || '').digest('hex');
    let ok = false;
    try { ok = sig.length === exp.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp)); } catch {}
    if (!ok) { L.warn('webhook', 'Signature mile nai: App Secret thik ache kina dekhun'); return res.sendStatus(403); }
  }
  res.sendStatus(200);
  const b = req.body || {};
  if (b.object !== 'page') return;
  fb.status.lastEventAt = Date.now();
  for (const en of b.entry || []) {
    for (const ev of en.messaging || []) onMessaging(ev);
    for (const ch of en.changes || []) if (ch.field === 'feed') comments.handle(ch.value).catch((e) => L.error('comment', e.message, e));
  }
});

function onMessaging(ev) {
  const psid = ev.sender && ev.sender.id;
  if (!psid || (ev.message && ev.message.is_echo)) return;
  queue(psid, async () => {
    const mid = (ev.message && ev.message.mid) || (ev.postback && ev.postback.mid);
    if (mid) { try { await col('mids').insertOne({ _id: mid, createdAt: new Date() }); } catch { return; } }
    const input = { text: '', images: [], audio: null, other: [] };
    if (ev.postback) {
      const p = ev.postback.payload || '';
      input.text = p.startsWith('PICK:') ? `Ami ${p.slice(5)} code er product ta nibo.` : (ev.postback.title || 'hi');
    } else if (ev.message) {
      const m = ev.message;
      input.text = m.text || (m.quick_reply && m.quick_reply.payload) || '';
      for (const a of m.attachments || []) {
        const url = a.payload && a.payload.url;
        if (a.type === 'image' && url && !(a.payload && a.payload.sticker_id)) input.images.push(url);
        else if (a.type === 'audio' && url) input.audio = url;
        else if (!(a.payload && a.payload.sticker_id) && a.type !== 'image') input.other.push(a.type);
      }
    } else return;
    if (!input.text && !input.images.length && !input.audio && !input.other.length) return;
    L.info('message', `Inbox: ${psid.slice(-6)} > "${(input.text || (input.audio ? 'voice' : input.images.length ? 'photo' : 'file')).slice(0, 60)}"`);
    fb.seen(psid).catch(() => {});
    await agent.handle(agent.forFb(psid), input);
  });
}

module.exports = { router };
