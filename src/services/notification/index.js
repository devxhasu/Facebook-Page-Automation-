/**
 * Notification Service (Modular)
 * Panel bell + optional Telegram
 * Easy to extend later
 */

const { Setting, Product, Order, NeedsAttention } = require('../../models');
const logger = require('../log/logger');
const axios = require('axios');

async function getTelegramConfig() {
  const docs = await Setting.find({ key: { $in: ['telegramBotToken', 'telegramChatId', 'telegramEnabled'] } });
  const map = {};
  docs.forEach(d => { map[d.key] = d.value; });
  return map;
}

async function sendTelegram(text) {
  try {
    const cfg = await getTelegramConfig();
    if (!cfg.telegramEnabled || !cfg.telegramBotToken || !cfg.telegramChatId) return false;

    await axios.post(`https://api.telegram.org/bot${cfg.telegramBotToken}/sendMessage`, {
      chat_id: cfg.telegramChatId,
      text: text.slice(0, 4000),
      parse_mode: 'HTML'
    }, { timeout: 8000 });
    return true;
  } catch (err) {
    await logger.log({ type: 'error', content: `Telegram fail: ${err.message}`, success: false });
    return false;
  }
}

async function notifyNewOrder(order) {
  const msg = `🛒 New Order ${order.orderId}\n${order.customerName || ''} | ${order.customerPhone || ''}\nTotal: ${order.totalAmount} tk\nStatus: ${order.status}`;
  await sendTelegram(msg);
  await logger.log({ type: 'order', content: `New order notify: ${order.orderId}`, success: true });
}

async function notifyPaymentVerify(order) {
  const msg = `💳 Payment Verify Request\n${order.orderId}\nExpected: ${order.deliveryCharge || order.totalAmount} tk\nTrxID: ${order.paymentDetails?.trxId || '-'}`;
  await sendTelegram(msg);
}

async function notifyNeedsAttention(item) {
  const msg = `⚠️ Needs Attention\n${item.type}\n${item.customerName || item.psid}\n${(item.content || '').slice(0, 200)}`;
  await sendTelegram(msg);
}

async function notifyLowStock() {
  const low = await Product.find({ isActive: true, stock: { $lte: 5 } }).select('code name stock').lean();
  if (!low.length) return;
  const lines = low.map(p => `• ${p.code} ${p.name}: ${p.stock} left`).join('\n');
  await sendTelegram(`📉 Low Stock Alert\n${lines}`);
}

async function notifyStatusChange(order, oldStatus, newStatus) {
  // Optional: can also message customer here
  await logger.log({
    type: 'order',
    content: `Status ${order.orderId}: ${oldStatus} → ${newStatus}`,
    success: true
  });
}

async function dailyReport() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [orders, sales, cancelled, openAttention] = await Promise.all([
    Order.countDocuments({ createdAt: { $gte: today } }),
    Order.aggregate([
      { $match: { createdAt: { $gte: today }, status: { $in: ['confirmed', 'shipped', 'delivered'] } } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]),
    Order.countDocuments({ createdAt: { $gte: today }, status: 'cancelled' }),
    NeedsAttention.countDocuments({ status: 'open' })
  ]);

  const msg = `📊 Daily Report\nOrders: ${orders}\nSales: ${sales[0]?.total || 0} tk\nCancelled: ${cancelled}\nOpen Attention: ${openAttention}`;
  await sendTelegram(msg);
  return msg;
}

module.exports = {
  sendTelegram,
  notifyNewOrder,
  notifyPaymentVerify,
  notifyNeedsAttention,
  notifyLowStock,
  notifyStatusChange,
  dailyReport
};
