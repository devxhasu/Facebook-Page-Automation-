const express = require('express');
const router = express.Router();
const { authMiddleware } = require('./auth');
const { Page } = require('../models');
const facebook = require('../services/facebook/messenger');
const { encrypt } = require('../utils/helpers');

router.use(authMiddleware);

router.get('/', async (req, res) => {
  const pages = await Page.find().select('-accessToken');
  res.json({ success: true, data: pages });
});

router.post('/connect', async (req, res) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) return res.status(400).json({ success: false, error: 'Token required' });

    const info = await facebook.getPageInfo(accessToken);
    
    let page = await Page.findOne({ pageId: info.id });
    if (!page) {
      page = new Page({ pageId: info.id });
    }

    page.name = info.name;
    page.picture = info.picture?.data?.url || info.picture;
    page.category = info.category;
    page.accessToken = encrypt(accessToken);
    page.isActive = true;
    page.lastEventAt = new Date();

    try {
      await facebook.subscribeWebhook(info.id, accessToken);
      page.webhookSubscribed = true;
    } catch (e) {
      page.webhookSubscribed = false;
    }

    await page.save();

    res.json({
      success: true,
      data: {
        pageId: page.pageId,
        name: page.name,
        picture: page.picture,
        category: page.category,
        webhookSubscribed: page.webhookSubscribed
      }
    });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(400).json({ success: false, error: msg });
  }
});

router.post('/:pageId/toggle', async (req, res) => {
  const { field, value } = req.body; // botEnabled, messengerEnabled, commentEnabled...
  const page = await Page.findOneAndUpdate(
    { pageId: req.params.pageId },
    { [field]: value },
    { new: true }
  );
  res.json({ success: true, data: page });
});

router.delete('/:pageId', async (req, res) => {
  await Page.findOneAndUpdate({ pageId: req.params.pageId }, { isActive: false, accessToken: null });
  res.json({ success: true });
});

module.exports = router;
