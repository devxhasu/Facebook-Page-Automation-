const mongoose = require('mongoose');

// ======================
// SETTINGS (all panel configs live here)
// ======================
const SettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed },
  updatedAt: { type: Date, default: Date.now }
});

// ======================
// ADMIN USERS
// ======================
const AdminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  name: String,
  role: { type: String, enum: ['super', 'admin', 'viewer'], default: 'admin' },
  permissions: [String],
  lastLogin: Date,
  createdAt: { type: Date, default: Date.now }
});

// ======================
// FACEBOOK PAGES
// ======================
const PageSchema = new mongoose.Schema({
  pageId: { type: String, required: true, unique: true },
  name: String,
  picture: String,
  category: String,
  accessToken: String,          // encrypted in production
  tokenExpiresAt: Date,
  permissions: [String],
  webhookSubscribed: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  botEnabled: { type: Boolean, default: true },
  messengerEnabled: { type: Boolean, default: true },
  commentEnabled: { type: Boolean, default: true },
  paymentVerifyEnabled: { type: Boolean, default: true },
  schedule: {
    enabled: { type: Boolean, default: false },
    startHour: { type: Number, default: 9 },
    endHour: { type: Number, default: 23 },
    offMessage: { type: String, default: 'এখন আমরা অফলাইন। সকাল ৯টায় আবার আসব ইনশাআল্লাহ।' }
  },
  pauseUntil: Date,
  lastEventAt: Date,
  createdAt: { type: Date, default: Date.now }
});

// ======================
// PRODUCTS
// ======================
const ProductSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true }, // P-101
  name: { type: String, required: true },
  variantLabel: String,           // "Black", "Premium"
  aliases: [String],              // ["polo", "পোলো", "polo tshirt"]
  price: { type: Number, required: true },
  stock: { type: Number, default: 0 },
  images: [String],               // URLs from free image host
  description: String,
  sizes: [String],
  colors: [String],
  brand: String,
  discount: { type: Number, default: 0 },
  category: String,
  deliveryTime: String,
  warranty: String,
  customFields: mongoose.Schema.Types.Mixed,
  isActive: { type: Boolean, default: true },
  linkedPosts: [String],          // Facebook post IDs
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// ======================
// CUSTOMERS
// ======================
const CustomerSchema = new mongoose.Schema({
  psid: { type: String, required: true }, // Facebook Page-Scoped ID
  pageId: String,
  name: String,
  phone: String,
  address: String,
  preferredSize: String,
  preferredColor: String,
  successfulOrders: { type: Number, default: 0 },
  totalSpent: { type: Number, default: 0 },
  isBlacklisted: { type: Boolean, default: false },
  blacklistReason: String,
  riskScore: { type: Number, default: 0 },
  lastOrderAt: Date,
  notes: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
CustomerSchema.index({ psid: 1, pageId: 1 }, { unique: true });

// ======================
// ORDERS
// ======================
const OrderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true }, // #1042
  pageId: String,
  customerPsid: String,
  customerName: String,
  customerPhone: String,
  customerAddress: String,
  items: [{
    productCode: String,
    productName: String,
    variantLabel: String,
    quantity: Number,
    unitPrice: Number,
    image: String
  }],
  productTotal: Number,
  deliveryCharge: Number,
  discount: { type: Number, default: 0 },
  totalAmount: Number,
  paymentMethod: { type: String, enum: ['cod', 'delivery_advance', 'full_advance'] },
  paymentStatus: { type: String, enum: ['pending', 'verify_requested', 'paid', 'failed'], default: 'pending' },
  paymentDetails: {
    trxId: String,
    senderNumber: String,
    amount: Number,
    screenshot: String,
    verifiedAt: Date,
    verifiedBy: String
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'returned'],
    default: 'pending'
  },
  trackingNumber: String,
  courier: String,
  notes: String,
  needsApproval: { type: Boolean, default: false },
  cancelReason: String,
  statusHistory: [{
    status: String,
    at: Date,
    by: String,
    note: String
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  confirmedAt: Date,
  shippedAt: Date,
  deliveredAt: Date
});

// ======================
// CONVERSATIONS (for memory)
// ======================
const ConversationSchema = new mongoose.Schema({
  psid: { type: String, required: true },
  pageId: String,
  state: {
    type: String,
    enum: ['idle', 'collecting_info', 'awaiting_payment', 'awaiting_confirm', 'human_takeover'],
    default: 'idle'
  },
  currentOrderDraft: mongoose.Schema.Types.Mixed,
  collected: {
    name: String,
    phone: String,
    address: String,
    products: [mongoose.Schema.Types.Mixed]
  },
  lastIntent: String,
  messageCount: { type: Number, default: 0 },
  humanTakeover: { type: Boolean, default: false },
  lastMessageAt: Date,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
ConversationSchema.index({ psid: 1, pageId: 1 }, { unique: true });

// ======================
// MESSAGES / LOGS
// ======================
const MessageLogSchema = new mongoose.Schema({
  type: { type: String, enum: ['message', 'comment', 'order', 'payment', 'provider', 'error', 'system'] },
  direction: { type: String, enum: ['in', 'out', 'system'] },
  pageId: String,
  psid: String,
  content: String,
  provider: String,
  responseTimeMs: Number,
  tokens: Number,
  success: Boolean,
  error: String,
  meta: mongoose.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now }
});
MessageLogSchema.index({ createdAt: -1 });
MessageLogSchema.index({ type: 1, createdAt: -1 });

// ======================
// KNOWLEDGE BASE (unlimited info)
// ======================
const KnowledgeSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  tags: [String],
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// ======================
// PAYMENT METHODS
// ======================
const PaymentMethodSchema = new mongoose.Schema({
  type: { type: String, enum: ['bkash', 'nagad', 'rocket', 'bank', 'other'] },
  number: String,
  accountName: String,
  instruction: String,
  isActive: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 }
});

// ======================
// AI PROVIDERS
// ======================
const AiProviderSchema = new mongoose.Schema({
  type: { type: String, enum: ['text', 'vision', 'voice'] },
  name: String, // OpenRouter, Gemini, Grok, Backup
  apiKeys: [{
    key: String,
    label: String,
    isActive: { type: Boolean, default: true },
    lastUsed: Date,
    failCount: { type: Number, default: 0 },
    status: { type: String, enum: ['ok', 'limit', 'error'], default: 'ok' }
  }],
  model: String,
  baseUrl: String,
  isActive: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
  timeoutMs: { type: Number, default: 15000 },
  isBackup: { type: Boolean, default: false },
  responseField: { type: String, default: 'text' } // for custom backup
});

// ======================
// COUPONS
// ======================
const CouponSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  type: { type: String, enum: ['percent', 'fixed'], default: 'percent' },
  value: Number,
  minOrder: { type: Number, default: 0 },
  maxUses: Number,
  usedCount: { type: Number, default: 0 },
  expiresAt: Date,
  isActive: { type: Boolean, default: true }
});

// ======================
// NEEDS ATTENTION
// ======================
const NeedsAttentionSchema = new mongoose.Schema({
  type: { type: String, enum: ['unknown_question', 'complaint', 'payment_issue', 'voice_fail', 'image_fail', 'other'] },
  pageId: String,
  psid: String,
  customerName: String,
  content: String,
  context: mongoose.Schema.Types.Mixed,
  status: { type: String, enum: ['open', 'resolved'], default: 'open' },
  resolvedBy: String,
  resolvedAt: Date,
  createdAt: { type: Date, default: Date.now }
});

module.exports = {
  Setting: mongoose.model('Setting', SettingSchema),
  Admin: mongoose.model('Admin', AdminSchema),
  Page: mongoose.model('Page', PageSchema),
  Product: mongoose.model('Product', ProductSchema),
  Customer: mongoose.model('Customer', CustomerSchema),
  Order: mongoose.model('Order', OrderSchema),
  Conversation: mongoose.model('Conversation', ConversationSchema),
  MessageLog: mongoose.model('MessageLog', MessageLogSchema),
  Knowledge: mongoose.model('Knowledge', KnowledgeSchema),
  PaymentMethod: mongoose.model('PaymentMethod', PaymentMethodSchema),
  AiProvider: mongoose.model('AiProvider', AiProviderSchema),
  Coupon: mongoose.model('Coupon', CouponSchema),
  NeedsAttention: mongoose.model('NeedsAttention', NeedsAttentionSchema)
};
