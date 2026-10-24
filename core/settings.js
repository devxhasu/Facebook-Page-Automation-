// All configuration lives in MongoDB (editable from the panel). Secrets are AES-encrypted.
const crypto = require('crypto');
const { col } = require('./db');
const { enc, dec } = require('./crypto');

const DEFAULTS = {
  bot_on: true, messenger_on: true, comment_on: true,
  bot_off_message: 'Ektu pore uttor debo, opekkha korun.',
  hours_on: false, hours_start: '09:00', hours_end: '23:00',
  outside_hours_message: 'Ekhon amra off, shokal e uttor debo.',
  human_pause_min: 60, typing_delay: true,
  persona_name: 'Rafi', page_name: '', greeting_style: 'auto', tone: 'friendly', emoji_level: 'low', delivery_time: '2-3 din',
  fb_page_token: '', fb_app_id: '', fb_app_secret: '', fb_verify_token: '', public_url: '',
  ai_text_order: 'openrouter,gemini,grok,custom', ai_vision_order: 'openrouter,gemini,grok', ai_voice_order: 'gemini',
  openrouter_on: true, openrouter_keys: '', openrouter_model: 'openai/gpt-4o-mini',
  gemini_on: true, gemini_keys: '', gemini_model: 'gemini-2.5-flash',
  grok_on: true, grok_keys: '', grok_model: 'grok-3-mini',
  custom_on: false, custom_url: '', custom_path: 'text',
  ai_daily_token_limit: 0, ai_fail_message: 'Ektu opekkha korun, amra shigroi uttor debo.',
  vision_on: true, voice_on: true, voice_max_mb: 3,
  pay_cod: true, pay_delivery_adv: true, pay_full_adv: true,
  pay_numbers: 'bKash: 01XXXXXXXXX (Personal)', pay_note: 'Send Money kore TrxID ar je number theke pathalen ta likhe din.',
  new_customer_cod: false, trusted_after: 1, auto_cancel_hours: 6, max_orders_per_day: 3,
  delivery_inside: 60, delivery_outside: 120, free_delivery_min: 0, max_discount_pct: 0, upsell_on: true, low_stock: 3,
  comment_public_reply: true, comment_private_reply: true, comment_price_public: false,
  comment_delay_min: 8, comment_delay_max: 25, comment_hide_abusive: false,
  tg_on: false, tg_token: '', tg_chat: '', tg_events: '', daily_report: true,
  imgbb_key: '',
  follow_up_on: true, follow_up_hours: 20, image_match_on: true,
};
const SECRETS = new Set(['fb_page_token', 'fb_app_secret', 'openrouter_keys', 'gemini_keys', 'grok_keys', 'custom_url', 'tg_token', 'imgbb_key']);
let cache = { ...DEFAULTS };

function extend(fields) {
  for (const f of fields || []) {
    if (!(f.key in DEFAULTS)) DEFAULTS[f.key] = f.default !== undefined ? f.default : '';
    if (f.secret) SECRETS.add(f.key);
    if (!(f.key in cache)) cache[f.key] = DEFAULTS[f.key];
  }
}

async function load() {
  const d = await col('settings').findOne({ _id: 'main' });
  cache = { ...DEFAULTS };
  for (const [k, v] of Object.entries((d && d.data) || {})) cache[k] = SECRETS.has(k) && v ? dec(v) : v;
}

async function save(patch) {
  const d = await col('settings').findOne({ _id: 'main' });
  const cur = (d && d.data) || {};
  for (const [k, v0] of Object.entries(patch || {})) {
    if (!(k in DEFAULTS)) continue;
    let v = v0;
    if (SECRETS.has(k)) {
      if (typeof v === 'string' && v.startsWith('••••')) continue; // unchanged
      cur[k] = v ? enc(v) : '';
    } else {
      const t = typeof DEFAULTS[k];
      if (t === 'boolean') v = v === true || v === 'true';
      else if (t === 'number') v = Number(v) || 0;
      else v = String(v == null ? '' : v);
      cur[k] = v;
    }
    cache[k] = v;
  }
  await col('settings').updateOne({ _id: 'main' }, { $set: { data: cur } }, { upsert: true });
}

const get = (k) => cache[k];
const num = (k) => Number(cache[k]) || 0;
const masked = () => {
  const o = {};
  for (const k of Object.keys(DEFAULTS)) o[k] = SECRETS.has(k) ? (cache[k] ? '••••' + String(cache[k]).slice(-4) : '') : cache[k];
  return o;
};
const randomToken = () => crypto.randomBytes(12).toString('hex');

module.exports = { load, save, get, num, masked, extend, randomToken };
