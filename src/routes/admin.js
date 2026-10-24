const express = require('express');
const router = express.Router();
const { authMiddleware } = require('./auth');
const { Order, Customer, Product, NeedsAttention, MessageLog, Page } = require('../models');

router.use(authMiddleware);

// Dashboard summary
router.get('/dashboard', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      todayOrders,
      pendingOrders,
      needsAttention,
      totalProducts,
      lowStock,
      recentLogs
    ] = await Promise.all([
      Order.countDocuments({ createdAt: { $gte: today } }),
      Order.countDocuments({ status: 'pending' }),
      NeedsAttention.countDocuments({ status: 'open' }),
      Product.countDocuments({ isActive: true }),
      Product.countDocuments({ stock: { $lte: 5 }, isActive: true }),
      MessageLog.find().sort({ createdAt: -1 }).limit(15).lean()
    ]);

    const salesToday = await Order.aggregate([
      { $match: { createdAt: { $gte: today }, status: { $in: ['confirmed', 'shipped', 'delivered'] } } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);

    res.json({
      success: true,
      data: {
        todayOrders,
        pendingOrders,
        needsAttention,
        totalProducts,
        lowStock,
        salesToday: salesToday[0]?.total || 0,
        recentLogs
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Needs Attention list
router.get('/needs-attention', async (req, res) => {
  const list = await NeedsAttention.find({ status: 'open' }).sort({ createdAt: -1 }).limit(50);
  res.json({ success: true, data: list });
});

router.post('/needs-attention/:id/resolve', async (req, res) => {
  await NeedsAttention.findByIdAndUpdate(req.params.id, {
    status: 'resolved',
    resolvedBy: req.user.username,
    resolvedAt: new Date()
  });
  res.json({ success: true });
});

module.exports = router;
