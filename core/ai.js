// AI provider chain with key rotation. Text, vision and voice have separate chains.
const S = require('./settings');
const L = require('./logger');
const { col } = require('./db');

const EP = {
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  grok: 'https://api.x.ai/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
};
const keyState = {}; // "openrouter#1" -> {ok, err, at, ms}
class AllFailed extends Error {}

const keysOf = (p) => String(S.get(p + '_keys') || '').split(/[\n,\s]+/).map((s) => s.trim()).filter(Boolean);
const orderOf = (k) => String(S.get(k) || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const today = () => new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);

async function track(usage, ok) {
  const inc = { calls: 1 };
  if (ok) { inc.tokens = usage.total_tokens || 0; inc.cost = usage.cost || 0; } else inc.fails = 1;
  await col('usage').updateOne({ _id: today() }, { $inc: inc }, { upsert: true }).catch(() => {});
}
async function usageToday() { return (await col('usage').findOne({ _id: today() })) || { tokens: 0, cost: 0, calls: 0, fails: 0 }; }
async function overLimit() {
  const lim = S.num('ai_daily_token_limit');
  return lim > 0 && (await usageToday()).tokens >= lim;
}

async function oai(p, key, model, messages, tools) {
  const body = { model, messages };
  if (tools && tools.length) body.tools = tools;
  const headers = { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  if (p === 'openrouter') { headers['HTTP-Referer'] = 'https://render.com'; headers['X-Title'] = 'FB Shop Agent'; }
  const r = await fetch(EP[p], { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(40000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (j.error && (j.error.message || JSON.stringify(j.error))) || (Array.isArray(j) && j[0] && j[0].error && j[0].error.message) || 'HTTP ' + r.status;
    const e = new Error(`HTTP ${r.status}: ${String(msg).slice(0, 200)}`);
    e.status = r.status;
    throw e;
  }
  const m = j.choices && j.choices[0] && j.choices[0].message;
  if (!m) throw new Error('AI theke khali response ashche');
  if (m.tool_calls) m.tool_calls.forEach((t, i) => { t.id = t.id || 'call_' + Date.now() + '_' + i; t.type = 'function'; });
  return { message: m, usage: j.usage || {} };
}

// kind: 'text' | 'vision'
async function chat(kind, messages, tools) {
  if (await overLimit()) throw new AllFailed('Ajker AI token limit shesh');
  const list = orderOf(kind === 'vision' ? 'ai_vision_order' : 'ai_text_order').filter((p) => EP[p] && S.get(p + '_on') && keysOf(p).length);
  if (!list.length) throw new AllFailed('Kono AI provider/key set kora nai (Settings > AI)');
  const errs = [];
  for (const p of list) {
    const model = S.get(p + '_model');
    const ks = keysOf(p);
    for (let i = 0; i < ks.length; i++) {
      const id = p + '#' + (i + 1), t0 = Date.now();
      try {
        const r = await oai(p, ks[i], model, messages, tools);
        keyState[id] = { ok: true, at: Date.now(), ms: Date.now() - t0 };
        track(r.usage, true);
        L.ok('ai', `${p} (${model}) ${Date.now() - t0}ms`, { tokens: r.usage.total_tokens });
        return { ...r, provider: p, model };
      } catch (e) {
        keyState[id] = { ok: false, err: e.message, at: Date.now() };
        track({}, false);
        errs.push(`${id}: ${e.message}`);
        L.warn('ai', `${id} fail, porer ta try korchi: ${e.message}`);
      }
    }
  }
  throw new AllFailed(errs.join(' | '));
}

async function describeImage(buf, mime) {
  const url = `data:${mime || 'image/jpeg'};base64,${buf.toString('base64')}`;
  const r = await chat('vision', [{ role: 'user', content: [
    { type: 'text', text: 'Describe the main product/object in this image in ONE short line (type, color, style, visible text). If it is a screenshot of a mobile payment or chat, answer exactly: payment screenshot.' },
    { type: 'image_url', image_url: { url } },
  ] }]);
  return String(r.message.content || '').trim();
}

// Does the customer's photo show one of these catalog products? cands: [{code,name,variant,url}]
async function matchImage(buf, mime, cands) {
  const content = [
    { type: 'text', text: 'The first image is a customer photo. Then come candidate catalog products, each with its code. Decide which candidate is the SAME product as in the customer photo. Answer ONLY JSON: {"match":"<code or null>","confidence":<0 to 1>}. Be strict; if unsure use null.' },
    { type: 'image_url', image_url: { url: `data:${mime || 'image/jpeg'};base64,${buf.toString('base64')}` } },
  ];
  for (const c of cands) {
    content.push({ type: 'text', text: `Candidate ${c.code}: ${c.name}${c.variant ? ' (' + c.variant + ')' : ''}` });
    content.push({ type: 'image_url', image_url: { url: c.url } });
  }
  const r = await chat('vision', [{ role: 'user', content }]);
  const m = String(r.message.content || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { const j = JSON.parse(m[0]); return j.match && Number(j.confidence) >= 0.6 ? { code: String(j.match).toUpperCase(), confidence: Number(j.confidence) } : null; } catch { return null; }
}

// Voice -> text using Gemini native API (supports audio)
async function transcribe(buf, mime) {
  const ks = keysOf('gemini');
  if (!ks.length) throw new Error('Voice er jonno Gemini key lagbe (Settings > AI)');
  const model = S.get('gemini_model');
  const errs = [];
  for (let i = 0; i < ks.length; i++) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': ks[i] },
        body: JSON.stringify({ contents: [{ parts: [
          { text: 'Transcribe this voice message exactly as spoken (Bangla or English). Output only the transcript, nothing else.' },
          { inline_data: { mime_type: mime || 'audio/mp4', data: buf.toString('base64') } },
        ] }] }),
        signal: AbortSignal.timeout(40000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(j.error && j.error.message) || ''}`.slice(0, 220));
      const t = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts && j.candidates[0].content.parts.map((x) => x.text || '').join('').trim();
      if (!t) throw new Error('Transcript khali');
      track(j.usageMetadata ? { total_tokens: j.usageMetadata.totalTokenCount } : {}, true);
      return t;
    } catch (e) { errs.push(`gemini#${i + 1}: ${e.message}`); L.warn('ai', 'Voice fail: ' + e.message); }
  }
  throw new AllFailed(errs.join(' | '));
}

// Text-only backup API (no tools, no images, no personal data)
async function backup(text) {
  if (!S.get('custom_on') || !S.get('custom_url')) return null;
  let cat = '';
  try { cat = (await require('./products').all()).filter((p) => p.active).slice(0, 12).map((p) => `${p.name}${p.variant ? ' ' + p.variant : ''} ${p.price}tk`).join(', '); } catch {}
  const guide = `Tumi "${S.get('page_name') || 'amader shop'}" er Bangladeshi online shop assistant. Customer er moto Banglish ba Bangla e, 1-2 chhoto line e, namro bhabe uttor dao. Onno website/shop er nam bolo na, Hindi/English e jabe na. ${cat ? 'Amader product: ' + cat + '. ' : ''}Product, size, address, phone chaile ekta ekta kore jiggesh koro. Customer: `;
  const clean = (guide + String(text || '').replace(/\d{8,}/g, '[number]')).slice(0, 1200);
  try {
    const url = S.get('custom_url').replace('{message}', encodeURIComponent(clean));
    const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) throw new Error('HTTP ' + r.status);
    const v = String(S.get('custom_path') || 'text').split('.').reduce((a, k) => (a == null ? a : a[k]), j);
    if (!v) throw new Error('Response e "' + S.get('custom_path') + '" field nai');
    keyState['custom#1'] = { ok: true, at: Date.now() };
    L.ok('ai', 'Backup API reply dilo');
    return String(v);
  } catch (e) { keyState['custom#1'] = { ok: false, err: e.message, at: Date.now() }; L.warn('ai', 'Backup API fail: ' + e.message); return null; }
}

async function status() {
  const u = await usageToday();
  const providers = ['openrouter', 'gemini', 'grok'].map((p) => ({
    name: p, on: !!S.get(p + '_on'), model: S.get(p + '_model'),
    keys: keysOf(p).map((k, i) => ({ id: p + '#' + (i + 1), last4: k.slice(-4), ...(keyState[p + '#' + (i + 1)] || {}) })),
  }));
  providers.push({ name: 'custom (backup)', on: !!S.get('custom_on'), model: 'text only', keys: S.get('custom_url') ? [{ id: 'custom#1', last4: '----', ...(keyState['custom#1'] || {}) }] : [] });
  return { providers, usage: u, limit: S.num('ai_daily_token_limit') };
}

async function test(p) {
  const out = [];
  if (p === 'custom') { const t = await backup('Hello'); return [{ id: 'custom#1', ok: !!t, text: t, err: t ? '' : 'Reply paoa jayni, log dekhun' }]; }
  const ks = keysOf(p);
  if (!ks.length) return [{ id: p, ok: false, err: 'Key set kora nai' }];
  for (let i = 0; i < ks.length; i++) {
    const id = p + '#' + (i + 1), t0 = Date.now();
    try {
      const r = await oai(p, ks[i], S.get(p + '_model'), [{ role: 'user', content: 'Reply with: OK' }]);
      keyState[id] = { ok: true, at: Date.now(), ms: Date.now() - t0 };
      out.push({ id, ok: true, ms: Date.now() - t0, text: String(r.message.content || '').slice(0, 40) });
    } catch (e) { keyState[id] = { ok: false, err: e.message, at: Date.now() }; out.push({ id, ok: false, err: e.message }); }
  }
  return out;
}

module.exports = { chat, describeImage, matchImage, transcribe, backup, status, test, overLimit, usageToday, AllFailed };
