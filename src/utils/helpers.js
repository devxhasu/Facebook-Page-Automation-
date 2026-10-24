const crypto = require('crypto');
const config = require('../config');

function generateOrderId() {
  const num = Date.now().toString().slice(-6) + Math.floor(Math.random() * 90 + 10);
  return `#${num}`;
}

function generateProductCode(prefix = 'P') {
  const num = Math.floor(100 + Math.random() * 900);
  return `${prefix}-${num}`;
}

function isValidBDPhone(phone) {
  if (!phone) return false;
  const cleaned = phone.replace(/[\s\-\+]/g, '');
  return /^(01)[3-9]\d{8}$/.test(cleaned) || /^(8801)[3-9]\d{8}$/.test(cleaned);
}

function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/[\s\-\+]/g, '');
  if (cleaned.startsWith('880')) cleaned = '0' + cleaned.slice(3);
  return cleaned;
}

function isValidTrxId(trxId, type = 'bkash') {
  if (!trxId) return false;
  const cleaned = trxId.trim().toUpperCase();
  // bKash typically 10 alphanumeric
  if (type === 'bkash') return /^[A-Z0-9]{8,12}$/.test(cleaned);
  if (type === 'nagad') return /^[A-Z0-9]{8,12}$/.test(cleaned);
  return cleaned.length >= 6 && cleaned.length <= 20;
}

function encrypt(text) {
  try {
    const key = crypto.scryptSync(config.secretKey, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  } catch (e) {
    return text;
  }
}

function decrypt(text) {
  try {
    const key = crypto.scryptSync(config.secretKey, 'salt', 32);
    const [ivHex, encrypted] = text.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    return text;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(min = 800, max = 2200) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function maskKey(key) {
  if (!key || key.length < 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

function detectLanguage(text) {
  if (!text) return 'bn';
  const banglaChars = (text.match(/[\u0980-\u09FF]/g) || []).length;
  const total = text.replace(/\s/g, '').length || 1;
  if (banglaChars / total > 0.3) return 'bn';
  if (/[a-zA-Z]/.test(text) && banglaChars === 0) return 'en';
  return 'banglish';
}

function truncate(str, max = 180) {
  if (!str || str.length <= max) return str;
  return str.slice(0, max - 3) + '...';
}

module.exports = {
  generateOrderId,
  generateProductCode,
  isValidBDPhone,
  normalizePhone,
  isValidTrxId,
  encrypt,
  decrypt,
  sleep,
  randomDelay,
  maskKey,
  detectLanguage,
  truncate
};
