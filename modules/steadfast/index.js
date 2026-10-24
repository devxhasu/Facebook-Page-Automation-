// Optional courier module. Works only after you add the Steadfast keys in Settings.
// API endpoints below follow Steadfast's merchant API; check their docs if anything changes.
module.exports = {
  title: 'Steadfast Courier',
  version: '1.0',
  fields: [
    { key: 'steadfast_key', label: 'Steadfast Api-Key', type: 'secret', secret: true, default: '' },
    { key: 'steadfast_secret', label: 'Steadfast Secret-Key', type: 'secret', secret: true, default: '' },
  ],
  init({ router, S, col, O, L }) {
    const BASE = 'https://portal.packzy.com/api/v1';
    const headers = () => ({ 'Api-Key': S.get('steadfast_key'), 'Secret-Key': S.get('steadfast_secret'), 'Content-Type': 'application/json' });
    const ready = () => S.get('steadfast_key') && S.get('steadfast_secret');

    router.post('/ship/:id', async (req, res) => {
      try {
        if (!ready()) return res.status(400).json({ error: 'Steadfast key set kora nai (Settings > Steadfast)' });
        const o = await col('orders').findOne({ id: Number(req.params.id) });
        if (!o) return res.status(404).json({ error: 'Order paoa jayni' });
        if (o.status !== 'confirmed') return res.status(400).json({ error: 'Age order confirm korun' });
        const r = await fetch(BASE + '/create_order', {
          method: 'POST', headers: headers(), signal: AbortSignal.timeout(25000),
          body: JSON.stringify({ invoice: String(o.id), recipient_name: o.name, recipient_phone: o.phone, recipient_address: o.address, cod_amount: Math.max(0, o.total - (o.paid || 0)), note: '' }),
        });
        const j = await r.json().catch(() => ({}));
        const c = j.consignment;
        if (!r.ok || !c) throw new Error('Steadfast: ' + (j.message || JSON.stringify(j).slice(0, 200) || 'HTTP ' + r.status));
        const tracking = { courier: 'Steadfast', code: c.tracking_code, consignment_id: c.consignment_id };
        await col('orders').updateOne({ id: o.id }, { $set: { tracking } });
        await O.setStatus(o.id, 'shipped', 'admin', 'Steadfast');
        L.ok('steadfast', `Order #${o.id} Steadfast e dewa hoyeche (${c.tracking_code})`);
        res.json({ ok: true, tracking });
      } catch (e) { L.error('steadfast', e.message, e); res.status(500).json({ error: e.message }); }
    });

    router.get('/track/:id', async (req, res) => {
      try {
        const o = await col('orders').findOne({ id: Number(req.params.id) });
        if (!o || !o.tracking || !o.tracking.code) return res.status(404).json({ error: 'Tracking code nai' });
        const r = await fetch(`${BASE}/status_by_trackingcode/${encodeURIComponent(o.tracking.code)}`, { headers: headers(), signal: AbortSignal.timeout(20000) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error('Steadfast: ' + (j.message || 'HTTP ' + r.status));
        if (j.delivery_status === 'delivered' && o.status === 'shipped') await O.setStatus(o.id, 'delivered', 'system', 'Steadfast');
        res.json({ status: j.delivery_status });
      } catch (e) { L.error('steadfast', e.message, e); res.status(500).json({ error: e.message }); }
    });
  },
};
