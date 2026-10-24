const { col } = require('./db');
const S = require('./settings');
const L = require('./logger');
const fb = require('./facebook');

async function tg(t) {
  if (!S.get('tg_on') || !S.get('tg_token') || !S.get('tg_chat')) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${S.get('tg_token')}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: S.get('tg_chat'), text: String(t).slice(0, 3900) }), signal: AbortSignal.timeout(15000),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.description || 'Telegram error');
    return true;
  } catch (e) { L.warn('telegram', 'Telegram send fail: ' + e.message); return false; }
}

// event: order_new | order_approval | payment_review | order_cancel | attention | system | low_stock | daily_report
async function admin(event, title, body = '', ref = null) {
  await col('notifications').insertOne({ event, title, body, ref, read: false, createdAt: new Date() }).catch(() => {});
  L.info('notify', `${event}: ${title}`);
  const ev = String(S.get('tg_events') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!ev.length || ev.includes(event)) await tg(body ? `${title}\n${body}` : title);
}

async function customer(psid, t, { test = false } = {}) {
  if (test || String(psid).startsWith('TEST')) return false;
  try { await fb.text(psid, t); return true; } catch (e) {
    L.warn('notify', `Customer ke message jayni (24 ghonta niyom hote pare): ${e.message}`);
    return false;
  }
}

module.exports = { admin, customer, tg };
