// Backup for Facebook's comment webhook: every minute read recent comments of the Page's latest posts
// and hand new ones to the normal comment handler (it de-duplicates by comment id).
const S = require('./settings');
const L = require('./logger');
const fb = require('./facebook');
const Pages = require('./pages');
const comments = require('./comments');

const state = { lastRunAt: 0, lastError: '', found: 0, since: Date.now() };
const seen = new Set();
const pageIds = new Map();
let lastErr = '';

async function pollPage(page, label) {
  let pid = page.pageId || pageIds.get(label);
  if (!pid) { const me = await fb.runWith(page, () => fb.graph('me?fields=id')); pid = String(me.id); pageIds.set(label, pid); }
  const p = { ...page, pageId: pid };
  const q = `${pid}/posts?limit=6&fields=id,comments.limit(25).order(reverse_chronological){id,message,created_time,from{id,name}}`;
  const j = await fb.runWith(p, () => fb.graph(q));
  const cutoff = Math.max(state.since - 60000, Date.now() - 30 * 60000); // never answer old comments
  for (const post of j.data || []) {
    for (const c of (post.comments && post.comments.data) || []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      if (+new Date(c.created_time) < cutoff) continue;
      state.found++;
      L.info('comment', `Polling e notun comment paoa gelo (${label})`);
      const from = c.from && c.from.id ? c.from : { id: 'c' + c.id, name: '' };
      fb.runWith(p, () => comments.handle({ item: 'comment', verb: 'add', comment_id: c.id, post_id: post.id, parent_id: post.id, from, message: c.message || '' }, p)).catch((e) => L.error('comment', e.message, e));
    }
  }
  if (seen.size > 5000) seen.clear();
}

async function run() {
  if (!S.get('comment_poll_on') || !S.get('bot_on') || !S.get('comment_on')) return;
  const jobs = [];
  if (S.get('fb_page_token')) jobs.push(['main', await Pages.byId('')]);
  for (const x of await Pages.list().catch(() => [])) if (x.active) jobs.push([x.pageId, await Pages.byFbId(x.pageId)]);
  for (const [label, page] of jobs) {
    if (!page || page.bot_on === false || page.comment_on === false) continue;
    try { await pollPage(page, label); state.lastError = ''; lastErr = ''; }
    catch (e) {
      state.lastError = e.message + (e.hint ? ' | ' + e.hint : '');
      if (state.lastError !== lastErr) { lastErr = state.lastError; L.warn('comment', `Comment polling hoyni: ${state.lastError}`); }
    }
  }
  state.lastRunAt = Date.now();
}

function start() {
  let busy = false;
  setInterval(async () => { if (busy) return; busy = true; try { await run(); } catch (e) { L.warn('comment', 'Polling error: ' + e.message); } busy = false; }, 60000);
}
module.exports = { start, run, state };
