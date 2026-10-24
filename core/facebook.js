const S = require('./settings');
const L = require('./logger');
const { AsyncLocalStorage } = require('async_hooks');
const als = new AsyncLocalStorage();
// run code with a specific page's token (multi page support)
const runWith = (page, fn) => als.run(page || null, fn);
const curToken = () => { const p = als.getStore(); return (p && p.token) || S.get('fb_page_token'); };
const GV = 'v21.0';
const status = { lastOkAt: 0, lastError: '', lastEventAt: 0, tokenInvalid: false };
const hooks = { onTokenError: null };

async function graph(path, { method = 'GET', body } = {}) {
  const token = curToken();
  if (!token) throw new Error('Facebook Page Token set kora nai (Settings > Facebook)');
  const headers = { Authorization: 'Bearer ' + token };
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(`https://graph.facebook.com/${GV}/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const er = j.error || {};
    const e = new Error(`Facebook: ${er.message || 'HTTP ' + r.status}${er.code ? ' (code ' + er.code + (er.error_subcode ? '/' + er.error_subcode : '') + ')' : ''}`);
    e.code = er.code; e.sub = er.error_subcode;
    status.lastError = e.message;
    if (er.code === 190) { status.tokenInvalid = true; if (hooks.onTokenError) hooks.onTokenError(e); }
    throw e;
  }
  status.lastOkAt = Date.now(); status.lastError = ''; status.tokenInvalid = false;
  return j;
}

const send = (psid, message) => graph('me/messages', { method: 'POST', body: { recipient: { id: psid }, messaging_type: 'RESPONSE', message } });
const text = (psid, t) => send(psid, { text: String(t).slice(0, 1900) });
const image = (psid, url) => send(psid, { attachment: { type: 'image', payload: { url, is_reusable: false } } });
const carousel = (psid, elements) => send(psid, { attachment: { type: 'template', payload: { template_type: 'generic', elements: elements.slice(0, 10) } } });
const typing = (psid, on = true) => graph('me/messages', { method: 'POST', body: { recipient: { id: psid }, sender_action: on ? 'typing_on' : 'typing_off' } });
const seen = (psid) => graph('me/messages', { method: 'POST', body: { recipient: { id: psid }, sender_action: 'mark_seen' } });
const privateReply = (commentId, t) => graph(`${commentId}/private_replies`, { method: 'POST', body: { message: String(t).slice(0, 1900) } });
const replyComment = (commentId, t) => graph(`${commentId}/comments`, { method: 'POST', body: { message: String(t).slice(0, 7000) } });
const hideComment = (commentId) => graph(commentId, { method: 'POST', body: { is_hidden: true } });
const pageInfo = () => graph('me?fields=id,name,category,fan_count,picture.type(large){url}');
const userName = async (psid) => { const j = await graph(`${psid}?fields=first_name,last_name`); return [j.first_name, j.last_name].filter(Boolean).join(' '); };
const subscribe = () => graph('me/subscribed_apps', { method: 'POST', body: { subscribed_fields: ['messages', 'messaging_postbacks', 'feed'] } });
const subscribed = () => graph('me/subscribed_apps');

async function debugToken() {
  const id = S.get('fb_app_id'), sec = S.get('fb_app_secret'), tok = S.get('fb_page_token');
  if (!id || !sec || !tok) return null;
  const r = await fetch(`https://graph.facebook.com/${GV}/debug_token?input_token=${encodeURIComponent(tok)}`, { headers: { Authorization: `Bearer ${id}|${sec}` }, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  return j.data || null;
}

module.exports = { runWith, status, hooks, graph, text, image, carousel, typing, seen, privateReply, replyComment, hideComment, pageInfo, userName, subscribe, subscribed, debugToken };
