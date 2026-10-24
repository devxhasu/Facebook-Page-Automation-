const { MessageLog } = require('../../models');

const MAX_LOGS = 5000; // auto clean older

async function log(entry) {
  try {
    await MessageLog.create({
      type: entry.type || 'system',
      direction: entry.direction || 'system',
      pageId: entry.pageId,
      psid: entry.psid,
      content: (entry.content || '').slice(0, 2000),
      provider: entry.provider,
      responseTimeMs: entry.responseTimeMs,
      tokens: entry.tokens,
      success: entry.success !== false,
      error: entry.error,
      meta: entry.meta,
      createdAt: new Date()
    });

    // occasional cleanup
    if (Math.random() < 0.01) {
      const count = await MessageLog.countDocuments();
      if (count > MAX_LOGS) {
        const oldest = await MessageLog.find().sort({ createdAt: 1 }).limit(count - MAX_LOGS).select('_id');
        const ids = oldest.map(o => o._id);
        await MessageLog.deleteMany({ _id: { $in: ids } });
      }
    }
  } catch (err) {
    console.error('Log write failed:', err.message);
  }
}

async function getRecent(limit = 100, filter = {}) {
  const q = {};
  if (filter.type) q.type = filter.type;
  if (filter.success === false) q.success = false;
  if (filter.search) {
    q.content = { $regex: filter.search, $options: 'i' };
  }
  return MessageLog.find(q).sort({ createdAt: -1 }).limit(limit).lean();
}

module.exports = { log, getRecent };
