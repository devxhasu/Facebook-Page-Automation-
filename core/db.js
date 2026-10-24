const { MongoClient } = require('mongodb');
const L = require('./logger');
let db;

async function connect(uri) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 12000, maxPoolSize: 10 });
  await client.connect();
  db = client.db(process.env.DB_NAME || undefined);
  const ix = (c, k, o) => db.collection(c).createIndex(k, o).catch((e) => L.warn('db', `index ${c}: ${e.message}`));
  await Promise.all([
    ix('customers', { psid: 1 }, { unique: true }),
    ix('pages', { pageId: 1 }, { unique: true }),
    ix('users', { username: 1 }, { unique: true }),
    ix('tickets', { id: 1 }, { unique: true }),
    ix('products', { code: 1 }, { unique: true }),
    ix('orders', { id: 1 }, { unique: true }),
    ix('orders', { psid: 1 }),
    ix('payments', { trx: 1 }, { unique: true }),
    ix('messages', { psid: 1, t: -1 }),
    ix('logs', { createdAt: 1 }, { expireAfterSeconds: 14 * 86400 }),
    ix('mids', { createdAt: 1 }, { expireAfterSeconds: 86400 }),
    ix('comments', { createdAt: 1 }, { expireAfterSeconds: 30 * 86400 }),
    ix('media', { exp: 1 }, { expireAfterSeconds: 0 }),
    ix('notifications', { createdAt: 1 }, { expireAfterSeconds: 60 * 86400 }),
  ]);
  L.setSink(db.collection('logs'));
  L.ok('db', 'MongoDB connected: ' + db.databaseName);
}

const col = (n) => db.collection(n);
async function nextId(n) {
  const r = await col('counters').findOneAndUpdate({ _id: n }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
  const d = r && r.value !== undefined ? r.value : r;
  return d.seq;
}
const ping = async () => { await db.command({ ping: 1 }); return true; };

module.exports = { connect, col, nextId, ping };
