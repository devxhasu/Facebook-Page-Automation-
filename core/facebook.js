const S = require('./settings');
const L = require('./logger');
const { AsyncLocalStorage } = require('async_hooks');
const als = new AsyncLocalStorage();
// run code with a specific page's token (multi page support)
const runWith = (page, fn) => als.run(page || null, fn);
const curToken = () => { const p = als.getStore(); return String((p && p.token) || S.get('fb_page_token') || '').trim(); };
const GV = 'v21.0';
const status = { lastOkAt: 0, lastError: '', lastEventAt: 0, tokenInvalid: false, lastHitAt: 0, sigFailAt: 0, standbyAt: 0, lastSendError: '', lastSendErrorAt: 0, lastSendOkAt: 0, subFields: [], subAt: 0, lastFeedAt: 0, lastCommentAt: 0 };
const hooks = { onTokenError: null };

// plain-language reason for the common Facebook send/permission errors (shown in logs + panel)
function hintFor(code, sub, msg) {
  const m = String(msg || '');
  if (code === 190) return 'Page Token vul/meyad shesh. Notun Page Access Token boshan.';
  if (code === 2018278 || sub === 2018278 || /outside of allowed window|24.?hour/i.test(m)) return 'Facebook er 24 ghonta niyom: customer er last message er 24 ghonta pore reply deya jay na.';
  if (code === 100 && sub === 33) return 'Comment/object e likhar permission nai ba object paoa jachhe na. Notun Page token baniye pages_manage_engagement + pages_messaging + pages_read_user_content shoho din (ar token User na, Page token hote hobe). Private reply 7 din-er purano ba onno user-er comment e jay na.';
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
    if (j && j.message_id) require('./db').col('mids').insertOne({ _id: 'out_' + j.message_id, createdAt: new Date() }).catch(() => {});
    return j;
  } catch (e) {
    status.lastSendError = e.message + (e.hint ? ' => ' + e.hint : ''); status.lastSendErrorAt = Date.now();
    L.error('facebook', 'Message pathano jayni: ' + e.message + (e.hint ? ' | ' + e.hint : ''));
    throw e;
  }
};
const text = (psid, t) => send(psid, { text: String(t).slice(0, 1900) });
// replies: 'Title' or ['Title', 'CODE'] (CODE is language independent, see webhook CANON)
const textQR = (psid, t, replies) => send(psid, { text: String(t).slice(0, 1900), quick_replies: replies.slice(0, 13).map((r) => { const [title, code] = Array.isArray(r) ? r : [r, '']; return { content_type: 'text', title: String(title).slice(0, 20), payload: 'QR:' + String(code || title).slice(0, 60) }; }) });
const image = (psid, url) => send(psid, { attachment: { type: 'image', payload: { url, is_reusable: false } } });
const carousel = (psid, elements) => send(psid, { attachment: { type: 'template', payload: { template_type: 'generic', elements: elements.slice(0, 10) } } });
const typing = (psid, on = true) => graph('me/messages', { method: 'POST', body: { recipient: { id: psid }, sender_action: on ? 'typing_on' : 'typing_off' } });
const seen = (psid) => graph('me/messages', { method: 'POST', body: { recipient: { id: psid }, sender_action: 'mark_seen' } });
const privateReply = async (commentId, t) => {
  const text = String(t).slice(0, 1900);
  try { return await graph(`${commentId}/private_replies`, { method: 'POST', body: { message: text } }); }
  catch (e1) {
    // fallback: Send API with recipient.comment_id (current official way)
    try { return await graph('me/messages', { method: 'POST', body: { recipient: { comment_id: commentId }, message: { text } } }); }
    catch (e2) { e2.message = e1.message + ' || Send API: ' + e2.message; throw e2; }
  }
};
const replyComment = (commentId, t) => graph(`${commentId}/comments`, { method: 'POST', body: { message: String(t).slice(0, 7000) } });
const hideComment = (commentId) => graph(commentId, { method: 'POST', body: { is_hidden: true } });
const pageInfo = () => graph('me?fields=id,name,category,fan_count,picture.type(large){url}');
const userName = async (psid) => { const j = await graph(`${psid}?fields=first_name,last_name`); return [j.first_name, j.last_name].filter(Boolean).join(' '); };
const subscribe = () => graph('me/subscribed_apps', { method: 'POST', body: { subscribed_fields: ['messages', 'messaging_postbacks', 'feed'] } });
const subscribed = () => graph('me/subscribed_apps');
// If the pasted token is a USER token (not a Page token), find the page token(s) it can manage.
// Returns [] when the token is already a Page token.
async function pagesFromUserToken(token) {
  const tk = String(token || '').trim();
  const r = await fetch(`https://graph.facebook.com/${GV}/me/accounts?fields=id,name,access_token&limit=50`, { headers: { Authorization: 'Bearer ' + tk }, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) return [];
  return (j.data || []).filter((p) => p.access_token);
}

// short-lived User token (1-2h) -> long-lived (60 days). Page tokens made from a long-lived token never expire.
async function longLived(token, appId, secret) {
  if (!token || !appId || !secret) return '';
  const u = `https://graph.facebook.com/${GV}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(secret)}&fb_exchange_token=${encodeURIComponent(token)}`;
  const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error((j.error && j.error.message) || 'Token extend hoyni');
  return j.access_token;
}

// make sure the page is subscribed to ALL fields we need (messages + postbacks + comments feed); idempotent, never throws
const NEED = ['messages', 'messaging_postbacks', 'feed'];
async function ensureSubscribed(page, label) {
  try {
    const run = (f) => (page ? als.run(page, f) : f());
    const have = new Set(((await run(() => subscribed())).data || []).flatMap((a) => a.subscribed_fields || []));
    if (NEED.every((f) => have.has(f))) { status.subFields = [...have]; status.subAt = Date.now(); return true; }
    await run(() => subscribe());
    status.subFields = NEED.slice(); status.subAt = Date.now();
    L.ok('facebook', `${label || 'Page'} webhook e auto subscribe kora holo (${NEED.join(', ')})`);
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

module.exports = { textQR, longLived, pagesFromUserToken, ensureSubscribed, runWith, status, hooks, graph, text, image, carousel, typing, seen, privateReply, replyComment, hideComment, pageInfo, userName, subscribe, subscribed, debugToken };
