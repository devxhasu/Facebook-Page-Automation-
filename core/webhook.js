const express = require('express');
const crypto = require('crypto');
const { col } = require('./db');
const S = require('./settings');
const L = require('./logger');
const fb = require('./facebook');
const agent = require('./agent');
const comments = require('./comments');
const Pages = require('./pages');

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
  const secret = String(S.get('fb_app_secret') || '').trim();
  fb.status.lastHitAt = Date.now();
  L.info('webhook', 'Facebook theke webhook request ashlo');
  if (secret) {
    const sig = req.get('x-hub-signature-256') || '';
    const exp = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody || '').digest('hex');
    let ok = false;
    try { ok = sig.length === exp.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp)); } catch {}
    if (!ok) {
      fb.status.sigFailAt = Date.now();
      L.error('webhook', 'Signature mile nai, message ignore kora holo. Settings > Facebook > App Secret ta ei Facebook App er Settings > Basic > App Secret er shathe mile ki na dekhun (ba App Secret khali rakhun)');
      return res.sendStatus(403);
    }
  }
  res.sendStatus(200);
  const b = req.body || {};
  if (b.object !== 'page') { L.warn('webhook', `Webhook object "${b.object}" ignore (page na)`); return; }
  fb.status.lastEventAt = Date.now();
  for (const en of b.entry || []) {
    Pages.byFbId(en.id).then((page) => {
      if (!page) return L.warn('webhook', `Page ${en.id} er token nai (Settings > Facebook ba Pages e add korun)`);
      if ((en.standby || []).length) { fb.status.standbyAt = Date.now(); L.warn('webhook', 'Message "standby" hoye ashche: onno app (ba Page Inbox) primary receiver. Facebook App > Messenger > Advanced Messaging > Handover Protocol e ei app ke Primary Receiver korun'); }
      if (!(en.messaging || []).length && !(en.changes || []).length && !(en.standby || []).length) L.info('webhook', 'Event ashlo kintu message/comment na (delivery/read hote pare)');
      for (const ev of en.messaging || []) onMessaging(ev, page);
      for (const ch of en.changes || []) {
        if (ch.field === 'feed') fb.runWith(page, () => comments.handle(ch.value, page)).catch((e) => L.error('comment', e.message, e));
      }
    }).catch((e) => L.error('webhook', e.message, e));
  }
});

function onMessaging(ev, page) {
  const psid = ev.sender && ev.sender.id;
  if (!psid || (ev.message && ev.message.is_echo)) return;
  queue(psid, () => fb.runWith(page, async () => {
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
    L.info('message', `${page.name || 'Page'}: ${psid.slice(-6)} > "${(input.text || (input.audio ? 'voice' : input.images.length ? 'photo' : 'file')).slice(0, 60)}"`);
    fb.seen(psid).catch(() => {});
    await agent.handle(agent.forFb(psid, page), input);
  }));
}

module.exports = { router };
