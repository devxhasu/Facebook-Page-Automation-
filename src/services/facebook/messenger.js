/**
 * Facebook Messenger & Comment API wrapper
 * Uses official Graph API only (no appstate/cookies)
 */

const axios = require('axios');
const { Page } = require('../../models');
const { decrypt } = require('../../utils/helpers');
const logger = require('../log/logger');

const GRAPH = 'https://graph.facebook.com/v21.0';

async function getPageToken(pageId) {
  const page = await Page.findOne({ pageId, isActive: true });
  if (!page || !page.accessToken) throw new Error('Page not connected or token missing');
  return decrypt(page.accessToken);
}

async function sendText(pageId, psid, text) {
  const token = await getPageToken(pageId);
  try {
    await axios.post(
      `${GRAPH}/me/messages`,
      {
        recipient: { id: psid },
        message: { text: text.slice(0, 2000) },
        messaging_type: 'RESPONSE'
      },
      { params: { access_token: token } }
    );
    return true;
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    await logger.log({
      type: 'error',
      content: `FB send failed: ${msg}`,
      success: false,
      meta: { pageId, psid }
    });
    throw new Error(msg);
  }
}

async function sendTypingOn(pageId, psid) {
  try {
    const token = await getPageToken(pageId);
    await axios.post(
      `${GRAPH}/me/messages`,
      {
        recipient: { id: psid },
        sender_action: 'typing_on'
      },
      { params: { access_token: token } }
    );
  } catch (e) {}
}

async function replyToComment(pageId, commentId, message) {
  const token = await getPageToken(pageId);
  await axios.post(
    `${GRAPH}/${commentId}/comments`,
    { message },
    { params: { access_token: token } }
  );
}

async function privateReplyToComment(pageId, commentId, message) {
  // Private reply to comment (inbox)
  const token = await getPageToken(pageId);
  await axios.post(
    `${GRAPH}/${commentId}/private_replies`,
    { message },
    { params: { access_token: token } }
  );
}

async function getPageInfo(accessToken) {
  const res = await axios.get(`${GRAPH}/me`, {
    params: {
      fields: 'id,name,picture,category,access_token',
      access_token: accessToken
    }
  });
  return res.data;
}

async function subscribeWebhook(pageId, accessToken) {
  // Subscribe page to webhook fields
  await axios.post(
    `${GRAPH}/${pageId}/subscribed_apps`,
    null,
    {
      params: {
        subscribed_fields: 'messages,messaging_postbacks,message_deliveries,message_reads,feed',
        access_token: accessToken
      }
    }
  );
}

module.exports = {
  sendText,
  sendTypingOn,
  replyToComment,
  privateReplyToComment,
  getPageInfo,
  subscribeWebhook,
  getPageToken
};
