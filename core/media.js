const crypto = require('crypto');
const { col } = require('./db');
const S = require('./settings');
const L = require('./logger');

let host = process.env.RENDER_EXTERNAL_URL || '';
const setHost = (h) => { if (!process.env.RENDER_EXTERNAL_URL && h) host = h; };
const base = () => String(S.get('public_url') || host || '').replace(/\/$/, '');
const abs = (u) => (u && u.startsWith('/') ? base() + u : u);

async function saveLocal(buf, mime, temp) {
  const id = crypto.randomBytes(9).toString('hex');
  await col('media').insertOne({ _id: id, mime, data: buf, t: new Date(), ...(temp ? { exp: new Date(Date.now() + 60 * 86400e3) } : {}) });
  return '/media/' + id;
}

// Product pictures: ImgBB (free) if key set, otherwise MongoDB
async function hostImage(buf, mime) {
  const key = S.get('imgbb_key');
  if (key) {
    try {
      const fd = new FormData();
      fd.append('image', buf.toString('base64'));
      const r = await fetch('https://api.imgbb.com/1/upload?key=' + encodeURIComponent(key), { method: 'POST', body: fd, signal: AbortSignal.timeout(30000) });
      const j = await r.json().catch(() => ({}));
      if (j && j.data && j.data.url) { L.ok('upload', 'Image ImgBB te upload hoyeche'); return j.data.url; }
      throw new Error((j && j.error && j.error.message) || 'ImgBB response bujha jayni');
    } catch (e) { L.warn('upload', 'ImgBB fail, MongoDB te save korchi: ' + e.message); }
  }
  return saveLocal(buf, mime, false);
}
const saveTemp = (buf, mime) => saveLocal(buf, mime, true);

async function serve(id) {
  const d = await col('media').findOne({ _id: id });
  if (!d) return null;
  return { mime: d.mime, buf: Buffer.from(d.data.buffer || d.data) };
}

async function download(url, maxBytes = 5 * 1024 * 1024) {
  const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error('Download fail: HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > maxBytes) throw new Error('File onek boro (' + Math.round(buf.length / 1024) + ' KB)');
  return { buf, mime: (r.headers.get('content-type') || '').split(';')[0] };
}

module.exports = { setHost, base, abs, hostImage, saveTemp, serve, download };
