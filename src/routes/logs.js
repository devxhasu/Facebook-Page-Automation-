const express = require('express');
const router = express.Router();
const { authMiddleware } = require('./auth');
const logger = require('../services/log/logger');

router.use(authMiddleware);

router.get('/', async (req, res) => {
  const { type, search, limit = 100 } = req.query;
  const logs = await logger.getRecent(Number(limit), { type, search });
  res.json({ success: true, data: logs });
});

module.exports = router;
