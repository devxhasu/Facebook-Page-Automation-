/**
 * Core AI Sales Agent
 * Handles conversation, order flow, mid-conversation questions, product matching
 * Designed to be modular – new intents can be added easily
 */

const providerManager = require('./providerManager');
const { Product, Customer, Conversation, Knowledge, Order, NeedsAttention, Setting } = require('../../models');
const { generateOrderId, isValidBDPhone, normalizePhone, isValidTrxId, randomDelay, sleep, detectLanguage } = require('../../utils/helpers');
const logger = require('../log/logger');
const facebook = require('../facebook/messenger');

class SalesAgent {
  constructor() {
    this.systemPromptBase = `
তুমি একজন বাংলাদেশি Facebook Page এর ভার্চুয়াল সেলস অ্যাসিস্ট্যান্ট।
নাম: {aiName}
টোন: স্বাভাবিক দোকানদারের মতো, বন্ধুত্বপূর্ণ কিন্তু রোবটিক না।

নিয়ম:
- প্রতি উত্তর ১-২ লাইনের ছোট রাখো। অপ্রয়োজনে লম্বা লিখো না।
- ইমোজি খুব কম ব্যবহার করো (প্রয়োজন হলে ১টা)।
- গ্রাহক যে ভাষায় লিখবে (বাংলা/Banglish/English) সেই ভাষায় উত্তর দাও।
- জানা তথ্য আর দ্বিতীয়বার জিজ্ঞাসা কোরো না।
- একবারে শুধু একটা প্রশ্ন করো।
- অর্ডারের মাঝে অন্য প্রশ্ন এলে আগে উত্তর দিয়ে তারপর আগের ধাপে ফিরে যাও।
- কখনো নিজে থেকে প্রোডাক্ট বেছে নিও না যদি একাধিক মিল থাকে।
- ভুয়া তথ্য বানিও না। না জানলে বলো জানো না।
- "তুমি কি রোবট?" জিজ্ঞাসা করলে সত্যি বলো: "আমি পেজের ভার্চুয়াল অ্যাসিস্ট্যান্ট, কিন্তু আপনার অর্ডারটা আমিই দেখব।"
- গ্রাহক "amar order koi?" / status জিজ্ঞাসা করলে সিস্টেম নিজেই বলে দেবে।
- ঠিকানা অসম্পূর্ণ মনে হলে (শুধু এলাকার নাম) আবার বিস্তারিত চাইবে, অনুমান করবে না।
- অর্ডার প্রায় কনফার্ম হওয়ার সময় একবারই soft upsell করতে পারো (যেমন ফ্রি ডেলিভারির জন্য আরও একটা জিনিস), জ্বালাময়ী করবে না।
- নতুন বা রিস্কি কাস্টমার হলে COD না দিয়ে advance সাজেস্ট করো।
- স্টক সত্যি কম হলেই "কয়টা বাকি" বলবে, মিথ্যা urgency দিবে না।
`;
  }

  async handleMessage({ pageId, psid, text, attachments = [] }) {
    try {
      // Load or create conversation
      let conv = await Conversation.findOne({ psid, pageId });
      if (!conv) {
        conv = await Conversation.create({ psid, pageId, state: 'idle' });
      }

      // Human takeover?
      if (conv.humanTakeover) {
        await logger.log({ type: 'message', direction: 'in', pageId, psid, content: text, success: true });
        return; // admin is handling
      }

      // Load customer
      let customer = await Customer.findOne({ psid, pageId });
      if (!customer) {
        customer = await Customer.create({ psid, pageId });
      }

      // Log incoming
      await logger.log({ type: 'message', direction: 'in', pageId, psid, content: text || '[attachment]', success: true });

      // Handle image attachment
      if (attachments?.length) {
        return this._handleAttachment({ pageId, psid, conv, customer, attachments, text });
      }

      // ===== Fast path intents (no AI call needed) =====
      const fast = await this._handleFastIntents({ pageId, psid, text, conv, customer });
      if (fast) {
        conv.lastMessageAt = new Date();
        await conv.save();
        return;
      }

      // Build context for AI
      const context = await this._buildContext(pageId, conv, customer);
      const aiResponse = await this._askAI(text, context, conv);

      // Process AI decision (order actions, state changes)
      const actions = this._parseActions(aiResponse);
      await this._executeActions(actions, { pageId, psid, conv, customer, text });

      // Send reply (with human-like delay)
      const replies = this._splitReplies(aiResponse.reply || aiResponse.text || '');
      for (const reply of replies) {
        await sleep(randomDelay(600, 1800));
        await facebook.sendText(pageId, psid, reply);
        await logger.log({
          type: 'message',
          direction: 'out',
          pageId,
          psid,
          content: reply,
          provider: aiResponse.provider,
          responseTimeMs: aiResponse.ms,
          success: true
        });
      }

      conv.lastMessageAt = new Date();
      conv.messageCount += 1;
      await conv.save();
      customer.updatedAt = new Date();
      await customer.save();

    } catch (err) {
      console.error('SalesAgent error:', err);
      await logger.log({ type: 'error', content: err.message, success: false, error: err.stack });
      try {
        await facebook.sendText(pageId, psid, 'একটু অপেক্ষা করুন, আমরা শিগগির উত্তর দিব 🙏');
      } catch (e) {}
    }
  }

  async _buildContext(pageId, conv, customer) {
    const products = await Product.find({ isActive: true }).limit(50).lean();
    const knowledge = await Knowledge.find({ isActive: true }).lean();
    const settings = await this._getSettings();

    // Risk: new customer or previous issues
    const isNew = !customer.successfulOrders || customer.successfulOrders < 1;
    const isRisky = customer.isBlacklisted || (customer.riskScore || 0) >= 3;

    return {
      customer: {
        name: customer.name || conv.collected?.name,
        phone: customer.phone || conv.collected?.phone,
        address: customer.address || conv.collected?.address,
        successfulOrders: customer.successfulOrders || 0,
        isBlacklisted: customer.isBlacklisted,
        isNew,
        isRisky,
        preferredSize: customer.preferredSize,
        preferredColor: customer.preferredColor
      },
      state: conv.state,
      draft: conv.currentOrderDraft,
      collected: conv.collected,
      products: products.map(p => ({
        code: p.code,
        name: p.name,
        variant: p.variantLabel,
        price: p.price,
        stock: p.stock,
        sizes: p.sizes,
        colors: p.colors,
        aliases: p.aliases
      })),
      knowledge: knowledge.map(k => `${k.title}: ${k.content}`).join('\n'),
      settings,
      hints: {
        requireAdvance: isNew || isRisky,
        canUpsell: true,
        lowStockThreshold: 5
      }
    };
  }

  async _askAI(userText, context, conv) {
    const settings = context.settings || {};
    const system = this.systemPromptBase
      .replace('{aiName}', settings.aiName || 'Rafi');

    const contextBlock = `
বর্তমান কাস্টমার তথ্য:
${JSON.stringify(context.customer, null, 0)}

বর্তমান স্টেট: ${context.state}
অর্ডার ড্রাফট: ${JSON.stringify(context.draft || {}, null, 0)}
সংগৃহীত তথ্য: ${JSON.stringify(context.collected || {}, null, 0)}

প্রোডাক্ট লিস্ট (কোড দিয়ে রেফার করো):
${context.products.map(p => `${p.code} | ${p.name}${p.variant ? ' (' + p.variant + ')' : ''} | ${p.price}টাকা | স্টক:${p.stock} | সাইজ:${(p.sizes||[]).join(',')}`).join('\n')}

পেজ নলেজ:
${context.knowledge || 'কিছু নেই'}

যদি অর্ডার সংক্রান্ত অ্যাকশন করতে হয় তাহলে উত্তরের শেষে JSON ব্লক দাও:
\`\`\`action
{"type":"set_field","field":"phone","value":"01..."}
{"type":"create_order", ...}
{"type":"needs_attention","reason":"..."}
\`\`\`
শুধু প্রয়োজন হলেই action দাও। সাধারণ কথায় action লাগবে না।
`;

    const messages = [
      { role: 'system', content: system + '\n\n' + contextBlock },
      { role: 'user', content: userText }
    ];

    try {
      const result = await providerManager.callText(messages);
      return {
        reply: this._cleanReply(result.text),
        text: result.text,
        provider: result.provider,
        ms: result.ms,
        raw: result.text
      };
    } catch (err) {
      // All providers failed
      await NeedsAttention.create({
        type: 'other',
        pageId: conv.pageId,
        psid: conv.psid,
        content: `AI providers failed: ${err.message}`,
        context: { userText }
      });
      return {
        reply: 'একটু অপেক্ষা করুন, আমরা শিগগির উত্তর দিব 🙏',
        provider: 'none',
        ms: 0
      };
    }
  }

  _cleanReply(text) {
    if (!text) return '';
    // Remove action blocks from visible reply
    return text
      .replace(/```action[\s\S]*?```/gi, '')
      .replace(/```json[\s\S]*?```/gi, '')
      .trim();
  }

  _parseActions(aiResponse) {
    const actions = [];
    const raw = aiResponse.raw || aiResponse.text || '';
    const match = raw.match(/```action\s*([\s\S]*?)```/i);
    if (!match) return actions;

    const lines = match[1].trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line.trim());
        if (obj.type) actions.push(obj);
      } catch (e) {}
    }
    return actions;
  }

  async _executeActions(actions, ctx) {
    const { pageId, psid, conv, customer } = ctx;
    for (const action of actions) {
      switch (action.type) {
        case 'set_field':
          if (['name', 'phone', 'address'].includes(action.field)) {
            conv.collected = conv.collected || {};
            conv.collected[action.field] = action.value;
            if (action.field === 'phone') {
              const phone = normalizePhone(action.value);
              if (isValidBDPhone(phone)) {
                customer.phone = phone;
                conv.collected.phone = phone;
              }
            }
            if (action.field === 'name') customer.name = action.value;
            if (action.field === 'address') customer.address = action.value;
          }
          break;

        case 'set_state':
          conv.state = action.state || conv.state;
          break;

        case 'create_order_draft':
          conv.currentOrderDraft = action.draft || action;
          conv.state = 'collecting_info';
          break;

        case 'needs_attention':
          await NeedsAttention.create({
            type: action.reasonType || 'unknown_question',
            pageId,
            psid,
            customerName: customer.name,
            content: action.reason || action.content || ctx.text,
            context: { draft: conv.currentOrderDraft }
          });
          break;

        case 'request_payment_verify':
          // handled in payment service later
          break;

        default:
          break;
      }
    }
    await conv.save();
    await customer.save();
  }

  _splitReplies(text) {
    if (!text) return [];
    // Split by double newline or very long text into 1-2 short messages
    const parts = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    if (parts.length <= 2) return parts;
    return [parts[0], parts.slice(1).join(' ')];
  }

  async _handleAttachment({ pageId, psid, conv, customer, attachments, text }) {
    const image = attachments.find(a => a.type === 'image');
    if (image) {
      // Try vision matching
      const vision = await providerManager.callVision(
        image.payload?.url || image.url,
        'এই ছবিটা কোন প্রোডাক্টের সাথে মিলে? শুধু প্রোডাক্টের নাম বা কোড বলো। না মিললে বলো "no match".'
      );

      if (vision.failed) {
        await facebook.sendText(pageId, psid, 'ছবিটা এখন বুঝতে পারছি না, লিখে পাঠান 🙏');
        await NeedsAttention.create({
          type: 'image_fail',
          pageId,
          psid,
          content: 'Vision providers failed',
          context: { imageUrl: image.payload?.url }
        });
        return;
      }

      // Simple reply for now – full matching can be extended
      await sleep(randomDelay());
      await facebook.sendText(pageId, psid, vision.text || 'এই রকম প্রোডাক্ট খুঁজে পাইনি। অন্য কিছু বলুন।');
    }
  }

  async _getSettings() {
    const docs = await Setting.find({ key: { $in: ['aiName', 'tone', 'maxEmoji', 'greetingStyle'] } });
    const map = {};
    docs.forEach(d => { map[d.key] = d.value; });
    return map;
  }

  // ===== Fast Intent Router =====
  async _handleFastIntents({ pageId, psid, text, conv, customer }) {
    if (!text) return false;
    const t = text.toLowerCase().trim();

    // 1. Thank you / closing
    if (this._isThankYou(t)) {
      await sleep(randomDelay(500, 1000));
      await facebook.sendText(pageId, psid, 'আপনাকেও ধন্যবাদ 😊 আর কিছু লাগলে বলবেন।');
      return true;
    }

    // 2. Order status (by keyword or order ID)
    const orderIdMatch = text.match(/#?\d{4,}/);
    if (this._isOrderStatusQuery(t) || orderIdMatch) {
      await this._replyOrderStatus(pageId, psid, customer, orderIdMatch ? orderIdMatch[0] : null);
      return true;
    }

    // 3. Budget mode ("1000 tk er moddhe", "৫০০ টাকার মধ্যে")
    const budget = this._extractBudget(t);
    if (budget) {
      await this._replyBudgetOptions(pageId, psid, budget);
      return true;
    }

    return false;
  }

  _isThankYou(t) {
    const keys = ['ধন্যবাদ', 'dhonnobad', 'thank', 'thanks', 'thnx', 'শুকরিয়া', 'শুকরিয়া'];
    return keys.some(k => t.includes(k)) && t.length < 40;
  }

  _isOrderStatusQuery(text) {
    if (!text) return false;
    const t = text.toLowerCase().trim();
    const keywords = [
      'amar order koi', 'amar order kothay', 'order koi', 'order kothay',
      'order status', 'status koi', 'status kothay', 'tracking',
      'অর্ডার কোথায়', 'অর্ডার কই', 'অর্ডার স্ট্যাটাস', 'স্ট্যাটাস',
      'amar order', 'my order', 'order ta koi', 'order ta kothay',
      'delivery koi', 'ডেলিভারি কোথায়', 'কুরিয়ার'
    ];
    return keywords.some(k => t.includes(k));
  }

  _extractBudget(t) {
    // e.g. "1000 tk er moddhe", "৫০০ টাকার মধ্যে", "under 800"
    const m = t.match(/(\d{3,5})\s*(tk|টাকা|taka)?\s*(er|এর)?\s*(moddhe|মধ্যে|under|niche|নিচে)/i)
      || t.match(/(moddhe|মধ্যে|under|niche|নিচে)\s*(\d{3,5})/i);
    if (m) {
      const num = parseInt(m[1] || m[2], 10);
      if (num >= 100 && num <= 50000) return num;
    }
    return null;
  }

  async _replyBudgetOptions(pageId, psid, budget) {
    const products = await Product.find({
      isActive: true,
      price: { $lte: budget },
      stock: { $gt: 0 }
    }).sort({ price: -1 }).limit(3).lean();

    await sleep(randomDelay(700, 1400));
    if (!products.length) {
      await facebook.sendText(pageId, psid, `${budget} টাকার মধ্যে এখন কোনো প্রোডাক্ট নেই। আরেকটু বাজেট বাড়াতে পারলে বলুন।`);
      return;
    }

    let msg = `${budget} টাকার মধ্যে কিছু অপশন:\n`;
    products.forEach((p, i) => {
      msg += `\n${i + 1}. ${p.name}${p.variantLabel ? ' (' + p.variantLabel + ')' : ''} — ${p.price} টাকা`;
    });
    msg += `\n\nকোনটা নিতে চান?`;
    await facebook.sendText(pageId, psid, msg);
  }

  async _replyOrderStatus(pageId, psid, customer, specificOrderId = null) {
    try {
      let orders = [];

      if (specificOrderId) {
        const cleanId = specificOrderId.startsWith('#') ? specificOrderId : `#${specificOrderId}`;
        const one = await Order.findOne({
          pageId,
          $or: [{ orderId: cleanId }, { orderId: specificOrderId }]
        }).lean();
        if (one) orders = [one];
      }

      if (!orders.length) {
        const query = { pageId };
        if (customer.phone) {
          query.$or = [{ customerPsid: psid }, { customerPhone: customer.phone }];
        } else {
          query.customerPsid = psid;
        }
        orders = await Order.find(query).sort({ createdAt: -1 }).limit(3).lean();
      }

      if (!orders.length) {
        await sleep(randomDelay(600, 1200));
        await facebook.sendText(pageId, psid, 'আপনার কোনো অর্ডার খুঁজে পাইনি। নতুন অর্ডার দিতে চাইলে বলুন।');
        return;
      }

      const statusMap = {
        pending: '⏳ Pending (পেমেন্ট/কনফার্মের অপেক্ষায়)',
        confirmed: '✅ Confirmed (প্রসেসিং হচ্ছে)',
        shipped: '🚚 Shipped (কুরিয়ারে উঠেছে)',
        delivered: '📦 Delivered (ডেলিভারি হয়েছে)',
        cancelled: '❌ Cancelled',
        returned: '↩️ Returned'
      };

      let msg = orders.length === 1
        ? this._formatSingleOrderStatus(orders[0], statusMap)
        : `আপনার শেষ ${orders.length}টা অর্ডার:\n\n` + orders.map(o => this._formatSingleOrderStatus(o, statusMap)).join('\n\n---\n\n');

      await sleep(randomDelay(700, 1500));
      await facebook.sendText(pageId, psid, msg);

      await logger.log({ type: 'message', direction: 'out', pageId, psid, content: '[Order Status Reply]', success: true });
    } catch (err) {
      console.error('Order status error:', err);
      await facebook.sendText(pageId, psid, 'স্ট্যাটাস এখন দেখাতে পারছি না, একটু পরে চেষ্টা করুন।');
    }
  }

  _formatSingleOrderStatus(o, statusMap) {
    const statusText = statusMap[o.status] || o.status;
    let line = `${o.orderId}\n${statusText}`;

    if (o.items && o.items.length) {
      const itemNames = o.items.map(i => `${i.productName}${i.variantLabel ? ' (' + i.variantLabel + ')' : ''} × ${i.quantity}`).join(', ');
      line += `\n📦 ${itemNames}`;
    }

    if (o.trackingNumber) {
      line += `\n🔗 Tracking: ${o.trackingNumber}`;
      if (o.courier) line += ` (${o.courier})`;
    }

    if (o.status === 'pending' && o.paymentStatus === 'verify_requested') {
      line += `\n💳 পেমেন্ট ভেরিফাইয়ের অপেক্ষায়`;
    }

    if (o.status === 'shipped' && !o.trackingNumber) {
      line += `\n🕒 ট্র্যাকিং নম্বর শিগগির আপডেট হবে`;
    }

    return line;
  }

  // Public method for comment handling
  async handleComment({ pageId, commentId, postId, psid, message, from }) {
    // Basic: public short reply + private inbox
    const shortReplies = [
      'ডিটেইলস ইনবক্সে পাঠিয়েছি 😊',
      'ইনবক্স চেক করুন 🙏',
      'বিস্তারিত মেসেজ করেছি'
    ];
    const reply = shortReplies[Math.floor(Math.random() * shortReplies.length)];

    try {
      await facebook.replyToComment(pageId, commentId, reply);
      // Send private details
      await sleep(1500);
      await facebook.sendText(pageId, psid, `আসসালামু আলাইকুম 😊\nআপনি যে প্রোডাক্টের কমেন্ট করেছেন, ডিটেইলস জানতে চাইলে বলুন।\nকী জানতে চান?`);
      
      await logger.log({
        type: 'comment',
        direction: 'out',
        pageId,
        psid,
        content: `Comment reply + inbox`,
        success: true,
        meta: { commentId, postId }
      });
    } catch (err) {
      await logger.log({ type: 'error', content: `Comment handle fail: ${err.message}`, success: false });
    }
  }
}

module.exports = new SalesAgent();
