const express = require('express');
const router = express.Router();
const { authMiddleware } = require('./auth');
const providerManager = require('../services/ai/providerManager');

router.use(authMiddleware);

// Test a provider
router.post('/test', async (req, res) => {
  try {
    const { message = 'Say hello in one short Bangla sentence.' } = req.body;
    const result = await providerManager.callText([
      { role: 'user', content: message }
    ]);
    res.json({
      success: true,
      data: {
        text: result.text,
        provider: result.provider,
        model: result.model,
        ms: result.ms,
        usage: result.usage
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
