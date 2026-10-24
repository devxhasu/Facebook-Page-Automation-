const express = require('express');
const router = express.Router();
const { authMiddleware } = require('./auth');
const { Product } = require('../models');
const { generateProductCode } = require('../utils/helpers');

router.use(authMiddleware);

router.get('/', async (req, res) => {
  const products = await Product.find().sort({ createdAt: -1 });
  res.json({ success: true, data: products });
});

router.post('/', async (req, res) => {
  try {
    const data = req.body;
    if (!data.code) data.code = generateProductCode();
    
    // Check duplicate name warning is handled on frontend
    const product = await Product.create(data);
    res.json({ success: true, data: product });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: new Date() },
      { new: true }
    );
    res.json({ success: true, data: product });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  await Product.findByIdAndUpdate(req.params.id, { isActive: false });
  res.json({ success: true });
});

module.exports = router;
