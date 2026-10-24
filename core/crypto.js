const c = require('crypto');
const key = () => c.createHash('sha256').update(String(process.env.SECRET_KEY || '')).digest();
exports.enc = (t) => {
  const iv = c.randomBytes(12);
  const k = c.createCipheriv('aes-256-gcm', key(), iv);
  const d = Buffer.concat([k.update(String(t), 'utf8'), k.final()]);
  return 'enc:' + [iv, k.getAuthTag(), d].map((b) => b.toString('base64')).join('.');
};
exports.dec = (t) => {
  if (!String(t).startsWith('enc:')) return t;
  try {
    const [iv, tag, d] = t.slice(4).split('.').map((x) => Buffer.from(x, 'base64'));
    const k = c.createDecipheriv('aes-256-gcm', key(), iv);
    k.setAuthTag(tag);
    return Buffer.concat([k.update(d), k.final()]).toString('utf8');
  } catch { return ''; }
};
