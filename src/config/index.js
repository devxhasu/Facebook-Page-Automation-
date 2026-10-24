require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  databaseUrl: process.env.DATABASE_URL || 'mongodb://localhost:27017/ai-sales-agent',
  secretKey: process.env.SECRET_KEY || 'change_me_in_production_32chars_min',
  
  // Default values (overridden by Panel settings stored in DB)
  defaults: {
    greetingStyle: 'auto', // salam | hello | auto
    aiName: 'Rafi',
    tone: 'friendly', // friendly | formal
    maxEmoji: 1,
    maxMessageLength: 180,
    typingDelayMin: 800,
    typingDelayMax: 2200,
    orderConfirmTimeoutHours: 12,
    newCustomerRequireAdvance: true,
    successfulOrdersForCOD: 2,
    dailyOrderLimitPerPhone: 5,
  }
};
