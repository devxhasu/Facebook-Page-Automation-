const express = require('express');
const router = express.Router();
const { authMiddleware } = require('./auth');
const { Order, Customer } = require('../models');
const facebook = require('../services/facebook/messenger');
const logger = require('../services/log/logger');
const notify = require('../services/notification');

router.use(authMiddleware);

router.get('/', async (req, res) => {
  const { status, limit = 50 } = req.query;
  const q = {};
  if (status) q.status = status;
  const orders = await Order.find(q).sort({ createdAt: -1 }).limit(Number(limit));
  res.json({ success: true, data: orders });
});

router.get('/:id', async (req, res) => {
  const order = await Order.findOne({ orderId: req.params.id });
  if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
  res.json({ success: true, data: order });
});

// Mark payment received
router.post('/:id/payment-received', async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.id });
    if (!order) return res.status(404).json({ success: false, error: 'Not found' });

    order.paymentStatus = 'paid';
    order.status = 'confirmed';
    order.confirmedAt = new Date();
    order.paymentDetails = order.paymentDetails || {};
    order.paymentDetails.verifiedAt = new Date();
    order.paymentDetails.verifiedBy = req.user.username;
    order.statusHistory = order.statusHistory || [];
    order.statusHistory.push({ status: 'confirmed', at: new Date(), by: req.user.username, note: 'Payment verified' });
    await order.save();

    // Update customer success count
    await Customer.findOneAndUpdate(
      { psid: order.customerPsid, pageId: order.pageId },
      { $inc: { successfulOrders: 1, totalSpent: order.totalAmount }, lastOrderAt: new Date() }
    );

    // Notify customer
    const summary = buildConfirmSummary(order);
    try {
      await facebook.sendText(order.pageId, order.customerPsid, summary);
    } catch (e) {
      await logger.log({ type: 'error', content: `Notify customer failed: ${e.message}`, success: false });
    }

    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update status
router.post('/:id/status', async (req, res) => {
  const { status, trackingNumber, note, notifyCustomer } = req.body;
  const order = await Order.findOne({ orderId: req.params.id });
  if (!order) return res.status(404).json({ success: false, error: 'Not found' });

  const oldStatus = order.status;
  order.status = status;
  if (trackingNumber) order.trackingNumber = trackingNumber;
  order.statusHistory = order.statusHistory || [];
  order.statusHistory.push({ status, at: new Date(), by: req.user.username, note });
  if (status === 'shipped') order.shippedAt = new Date();
  if (status === 'delivered') order.deliveredAt = new Date();
  await order.save();

  await notify.notifyStatusChange(order, oldStatus, status);

  // Notify customer on important status changes
  if (notifyCustomer !== false && ['confirmed', 'shipped', 'delivered', 'cancelled'].includes(status)) {
    try {
      let msg = '';
      if (status === 'shipped') {
        msg = `🚚 আপনার অর্ডার ${order.orderId} কুরিয়ারে উঠেছে।`;
        if (order.trackingNumber) msg += `\nTracking: ${order.trackingNumber}${order.courier ? ' (' + order.courier + ')' : ''}`;
      } else if (status === 'delivered') {
        msg = `📦 আপনার অর্ডার ${order.orderId} ডেলিভারি হয়েছে। ধন্যবাদ!`;
      } else if (status === 'cancelled') {
        msg = `❌ আপনার অর্ডার ${order.orderId} ক্যানসেল করা হয়েছে।${note ? ' কারণ: ' + note : ''}`;
      } else if (status === 'confirmed') {
        msg = `✅ আপনার অর্ডার ${order.orderId} কনফার্ম হয়েছে।`;
      }
      if (msg) await facebook.sendText(order.pageId, order.customerPsid, msg);
    } catch (e) {
      await logger.log({ type: 'error', content: `Status notify fail: ${e.message}`, success: false });
    }
  }

  res.json({ success: true, data: order });
});

function buildConfirmSummary(order) {
  const items = order.items.map(i => `📦 ${i.productName}${i.variantLabel ? ' (' + i.variantLabel + ')' : ''} x ${i.quantity}`).join('\n');
  return `✅ Order Confirmed! ${order.orderId}

${items}
💰 Product: ${order.productTotal} tk
🚚 Delivery: ${order.deliveryCharge} tk
🧾 Total: ${order.totalAmount} tk
💳 Paid: ${order.paymentMethod === 'full_advance' ? 'Full' : (order.paymentMethod === 'delivery_advance' ? 'Delivery advance' : 'COD')}
💵 Delivery te dite hobe: ${order.paymentMethod === 'cod' ? order.totalAmount : (order.paymentMethod === 'delivery_advance' ? order.productTotal : 0)} tk

👤 ${order.customerName} | 📞 ${order.customerPhone}
📍 ${order.customerAddress}
🕒 Delivery: 2-3 din

Order status jante likhun: "amar order koi?"`;
}

module.exports = router;
