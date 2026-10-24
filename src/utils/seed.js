/**
 * Optional seed – run once after first start
 * node src/utils/seed.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../config');
const { AiProvider, Setting, Knowledge } = require('../models');

async function seed() {
  await mongoose.connect(config.databaseUrl);
  console.log('Connected');

  // Default settings
  const defaults = [
    { key: 'aiName', value: 'Rafi' },
    { key: 'tone', value: 'friendly' },
    { key: 'greetingStyle', value: 'auto' },
    { key: 'maxEmoji', value: 1 },
    { key: 'deliveryInsideDhaka', value: 60 },
    { key: 'deliveryOutsideDhaka', value: 120 },
    { key: 'freeDeliveryMin', value: 2000 },
    { key: 'paymentCod', value: true },
    { key: 'paymentDeliveryAdvance', value: true },
    { key: 'paymentFullAdvance', value: true },
    { key: 'newCustomerRequireAdvance', value: true }
  ];

  for (const s of defaults) {
    await Setting.findOneAndUpdate({ key: s.key }, s, { upsert: true });
  }
  console.log('Settings seeded');

  // Sample knowledge
  await Knowledge.findOneAndUpdate(
    { title: 'Delivery Policy' },
    {
      title: 'Delivery Policy',
      content: 'ঢাকার ভিতরে ১-২ দিন, ঢাকার বাইরে ২-৪ দিন। ২০০০ টাকার উপরে ফ্রি ডেলিভারি।',
      isActive: true
    },
    { upsert: true }
  );

  // Placeholder AI provider (user must add real keys from panel or here)
  const existing = await AiProvider.findOne({ name: 'OpenRouter' });
  if (!existing) {
    await AiProvider.create({
      type: 'text',
      name: 'OpenRouter',
      model: 'openai/gpt-4o-mini',
      apiKeys: [],
      isActive: true,
      sortOrder: 1,
      timeoutMs: 15000
    });
    await AiProvider.create({
      type: 'text',
      name: 'Gemini',
      model: 'gemini-1.5-flash',
      apiKeys: [],
      isActive: true,
      sortOrder: 2,
      timeoutMs: 15000
    });
    console.log('AI Provider placeholders created (add keys from panel)');
  }

  console.log('Seed done');
  process.exit(0);
}

seed().catch(e => {
  console.error(e);
  process.exit(1);
});
