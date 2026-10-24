const express = require('express');
const router = express.Router();
const { authMiddleware } = require('./auth');
const { Setting, Knowledge, PaymentMethod, AiProvider } = require('../models');

router.use(authMiddleware);

// Generic key-value settings
router.get('/', async (req, res) => {
  const settings = await Setting.find();
  const map = {};
  settings.forEach(s => { map[s.key] = s.value; });
  res.json({ success: true, data: map });
});

router.post('/', async (req, res) => {
  const { key, value } = req.body;
  await Setting.findOneAndUpdate(
    { key },
    { value, updatedAt: new Date() },
    { upsert: true }
  );
  res.json({ success: true });
});

// Knowledge base
router.get('/knowledge', async (req, res) => {
  const list = await Knowledge.find().sort({ createdAt: -1 });
  res.json({ success: true, data: list });
});

router.post('/knowledge', async (req, res) => {
  const item = await Knowledge.create(req.body);
  res.json({ success: true, data: item });
});

router.put('/knowledge/:id', async (req, res) => {
  const item = await Knowledge.findByIdAndUpdate(req.params.id, { ...req.body, updatedAt: new Date() }, { new: true });
  res.json({ success: true, data: item });
});

router.delete('/knowledge/:id', async (req, res) => {
  await Knowledge.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// Payment methods
router.get('/payments', async (req, res) => {
  const list = await PaymentMethod.find().sort({ sortOrder: 1 });
  res.json({ success: true, data: list });
});

router.post('/payments', async (req, res) => {
  const item = await PaymentMethod.create(req.body);
  res.json({ success: true, data: item });
});

router.put('/payments/:id', async (req, res) => {
  const item = await PaymentMethod.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json({ success: true, data: item });
});

router.delete('/payments/:id', async (req, res) => {
  await PaymentMethod.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// AI Providers
router.get('/ai-providers', async (req, res) => {
  const list = await AiProvider.find().sort({ type: 1, sortOrder: 1 });
  // mask keys
  const safe = list.map(p => {
    const obj = p.toObject();
    obj.apiKeys = (obj.apiKeys || []).map(k => ({
      ...k,
      key: k.key ? k.key.slice(0, 6) + '****' + k.key.slice(-4) : ''
    }));
    return obj;
  });
  res.json({ success: true, data: safe });
});

router.post('/ai-providers', async (req, res) => {
  const item = await AiProvider.create(req.body);
  res.json({ success: true, data: item });
});

router.put('/ai-providers/:id', async (req, res) => {
  const item = await AiProvider.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json({ success: true, data: item });
});

module.exports = router;
