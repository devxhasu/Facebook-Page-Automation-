const express = require('express');
const router = express.Router();
const salesAgent = require('../services/ai/salesAgent');
const { Page } = require('../models');
const logger = require('../services/log/logger');

// Facebook Webhook Verification
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Verify token is stored in settings or env for simplicity
  const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || 'ai_sales_agent_verify_token_2024';

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Incoming events
router.post('/', async (req, res) => {
  // Always respond 200 quickly
  res.sendStatus(200);

  try {
    const body = req.body;
    if (body.object !== 'page') return;

    for (const entry of body.entry || []) {
      const pageId = entry.id;

      // Messaging
      for (const event of entry.messaging || []) {
        if (event.message && !event.message.is_echo) {
          const psid = event.sender.id;
          const text = event.message.text || '';
          const attachments = event.message.attachments || [];

          // Process async
          salesAgent.handleMessage({ pageId, psid, text, attachments }).catch(err => {
            console.error('Message handle error:', err);
          });
        }
      }

      // Feed (comments)
      for (const change of entry.changes || []) {
        if (change.field === 'feed' && change.value?.item === 'comment' && change.value?.verb === 'add') {
          const val = change.value;
          const commentId = val.comment_id;
          const postId = val.post_id;
          const message = val.message || '';
          const from = val.from || {};
          const psid = from.id;

          // Skip page's own comments
          if (psid === pageId) continue;

          salesAgent.handleComment({
            pageId,
            commentId,
            postId,
            psid,
            message,
            from
          }).catch(err => console.error('Comment error:', err));
        }
      }
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
    await logger.log({ type: 'error', content: `Webhook: ${err.message}`, success: false });
  }
});

module.exports = router;
