const S = require('./settings');
const L = require('./logger');
const { AsyncLocalStorage } = require('async_hooks');
const als = new AsyncLocalStorage();
// run code with a specific page's token (multi page support)
const runWith = (page, fn) => als.run(page || null, fn);
const curToken = () => { const p = als.getStore(); return String((p && p.token) || S.get('fb_page_token') || '').trim(); };
const GV = 'v21.0';
const status = { lastOkAt: 0, lastError: '', lastEventAt: 0, tokenInvalid: false, lastHitAt: 0, sigFailAt: 0, standbyAt: 0, lastSendError: '', lastSendErrorAt: 0, lastSendOkAt: 0 };
const hooks = { onTokenError: null };

// plain-language reason for the common Facebook send/permission errors (shown in logs + panel)
function hintFor(code, sub, msg) {
  const m = String(msg || '');
  if (code === 190) return 'Page Token vul/meyad shesh. Notun Page Access Token boshan.';
  if (code === 2018278 || sub === 2018278 || /outside of allowed window|24.?hour/i.test(m)) return 'Facebook er 24 ghonta niyom: customer er last message er 24 ghonta pore reply deya jay na.';
  if (code === 10 || code === 200 || /permission/i.test(m)) return 'pages_messaging permission nai. Facebook App e Messenger product + pages_messaging (Advanced Access/App Review) lagbe, ar App Live mode e thakte hobe.';
  if (code === 100 && /No matching user|does not exist|cannot be loaded/i.test(m)) return 'App ekhono Development mode e: shudhu App er Admin/Developer/Tester role er account theke message dile reply jabe. Shobar jonno App ke Live korun.';
  if (code === 551 || sub === 1545041) return 'Ei user ekhon message pabe na (block korechhe ba available na).';
  if (code === 613 || code === 4 || code === 17 || code === 32) return 'Facebook rate limit. Kichukkhon pore abar try hobe.';
  return '';
}

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
    e.hint = hintFor(er.code, er.error_subcode, er.message);
    status.lastError = e.message;
    if (er.code === 190) { status.tokenInvalid = true; if (hooks.onTokenError) hooks.onTokenError(e); }
    throw e;
  }
  status.lastOkAt = Date.now(); status.lastError = ''; status.tokenInvalid = false;
  return j;
}

const send = async (psid, message) => {
  try {
    const j = await graph('me/messages', { method: 'POST', body: { recipient: { id: psid }, messaging_type: 'RESPONSE', message } });
    status.lastSendOkAt = Date.now(); status.lastSendError = '';
    return j;
  } catch (e) {
    status.lastSendError = e.message + (e.hint ? ' => ' + e.hint : ''); status.lastSendErrorAt = Date.now();
    L.error('facebook', 'Message pathano jayni: ' + e.message + (e.hint ? ' | ' + e.hint : ''));
    throw e;
  }
};
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
// make sure the page is subscribed to this app's webhook (idempotent); never throws
async function ensureSubscribed(page, label) {
  try {
    const run = (f) => (page ? als.run(page, f) : f());
    const cur = ((await run(() => subscribed())).data || []).length;
    if (cur) return true;
    await run(() => subscribe());
    L.ok('facebook', `${label || 'Page'} webhook e auto subscribe kora holo`);
    return true;
  } catch (e) { L.warn('facebook', `${label || 'Page'} auto subscribe hoyni: ${e.message}${e.hint ? ' | ' + e.hint : ''}`); return false; }
}

async function debugToken() {
  const id = S.get('fb_app_id'), sec = S.get('fb_app_secret'), tok = S.get('fb_page_token');
  if (!id || !sec || !tok) return null;
  const r = await fetch(`https://graph.facebook.com/${GV}/debug_token?input_token=${encodeURIComponent(tok)}`, { headers: { Authorization: `Bearer ${id}|${sec}` }, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  return j.data || null;
}

module.exports = { ensureSubscribed, runWith, status, hooks, graph, text, image, carousel, typing, seen, privateReply, replyComment, hideComment, pageInfo, userName, subscribe, subscribed, debugToken };
