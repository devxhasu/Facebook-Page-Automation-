// Dhaka time helpers + opening hours
const S = require('./settings');
const dhakaNow = () => new Date(Date.now() + 6 * 3600e3);
function inHours() {
  if (!S.get('hours_on')) return true;
  const d = dhakaNow(), m = d.getUTCHours() * 60 + d.getUTCMinutes();
  const [a, b] = [S.get('hours_start'), S.get('hours_end')].map((s) => { const [h, mm] = String(s).split(':'); return (+h || 0) * 60 + (+mm || 0); });
  return a <= b ? m >= a && m < b : m >= a || m < b;
}
module.exports = { dhakaNow, inHours };
