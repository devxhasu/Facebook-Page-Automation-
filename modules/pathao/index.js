// Optional Pathao courier module. Works only after you add the Pathao keys in Settings.
// Endpoints follow Pathao's merchant API as I know it; check Pathao's docs if anything fails (see Logs).
module.exports = {
  title: 'Pathao Courier',
  version: '1.0',
  fields: [
    { key: 'pathao_client_id', label: 'Client ID', type: 'text', default: '' },
    { key: 'pathao_client_secret', label: 'Client Secret', type: 'secret', secret: true, default: '' },
    { key: 'pathao_username', label: 'Pathao email', type: 'text', default: '' },
    { key: 'pathao_password', label: 'Pathao password', type: 'secret', secret: true, default: '' },
    { key: 'pathao_store_id', label: 'Store ID', type: 'text', default: '' },
    { key: 'pathao_sandbox', label: 'Sandbox mode (test)', type: 'bool', default: false },
  ],
  init({ router, S, col, O, L }) {
    const base = () => (S.get('pathao_sandbox') ? 'https://courier-api-sandbox.pathao.com' : 'https://api-hermes.pathao.com');
    const ready = () => S.get('pathao_client_id') && S.get('pathao_client_secret') && S.get('pathao_username') && S.get('pathao_password') && S.get('pathao_store_id');
    let tok = { v: '', exp: 0 };

    async function token() {
      if (tok.v && tok.exp > Date.now() + 60000) return tok.v;
      const r = await fetch(base() + '/aladdin/api/v1/issue-token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ client_id: S.get('pathao_client_id'), client_secret: S.get('pathao_client_secret'), username: S.get('pathao_username'), password: S.get('pathao_password'), grant_type: 'password' }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.access_token) throw new Error('Pathao login fail: ' + (j.message || 'HTTP ' + r.status));
      tok = { v: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
      return tok.v;
    }
    const auth = async () => ({ Authorization: 'Bearer ' + (await token()), 'Content-Type': 'application/json', Accept: 'application/json' });

    router.post('/ship/:id', async (req, res) => {
      try {
        if (!ready()) return res.status(400).json({ error: 'Pathao key set kora nai (Settings > Pathao Courier)' });
        const o = await col('orders').findOne({ id: Number(req.params.id) });
        if (!o) return res.status(404).json({ error: 'Order paoa jayni' });
        if (o.status !== 'confirmed') return res.status(400).json({ error: 'Age order confirm korun' });
        const r = await fetch(base() + '/aladdin/api/v1/orders', {
          method: 'POST', headers: await auth(), signal: AbortSignal.timeout(25000),
          body: JSON.stringify({
            store_id: Number(S.get('pathao_store_id')), merchant_order_id: String(o.id), recipient_name: o.name, recipient_phone: o.phone, recipient_address: o.address,
            delivery_type: 48, item_type: 2, special_instruction: '', item_quantity: o.lines.reduce((a, l) => a + l.qty, 0), item_weight: 0.5,
            item_description: o.lines.map((l) => l.name).join(', ').slice(0, 200), amount_to_collect: Math.max(0, o.total - (o.paid || 0)),
          }),
        });
        const j = await r.json().catch(() => ({}));
        const d = j.data;
        if (!r.ok || !d || !d.consignment_id) throw new Error('Pathao: ' + (j.message || JSON.stringify(j.errors || j).slice(0, 220) || 'HTTP ' + r.status));
        const tracking = { courier: 'Pathao', code: d.consignment_id, consignment_id: d.consignment_id };
        await col('orders').updateOne({ id: o.id }, { $set: { tracking } });
        await O.setStatus(o.id, 'shipped', 'admin', 'Pathao');
        L.ok('pathao', `Order #${o.id} Pathao te dewa hoyeche (${d.consignment_id})`);
        res.json({ ok: true, tracking });
      } catch (e) { L.error('pathao', e.message, e); res.status(500).json({ error: e.message }); }
    });

    async function status(code) {
      const r = await fetch(`${base()}/aladdin/api/v1/orders/${encodeURIComponent(code)}/info`, { headers: await auth(), signal: AbortSignal.timeout(20000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error('Pathao: ' + (j.message || 'HTTP ' + r.status));
      return String((j.data && (j.data.order_status || j.data.order_status_slug)) || '');
    }
    router.get('/track/:id', async (req, res) => {
      try {
        const o = await col('orders').findOne({ id: Number(req.params.id) });
        if (!o || !o.tracking || !o.tracking.code) return res.status(404).json({ error: 'Tracking code nai' });
        const st = await status(o.tracking.code);
        if (/delivered/i.test(st) && o.status === 'shipped') await O.setStatus(o.id, 'delivered', 'system', 'Pathao');
        res.json({ status: st });
      } catch (e) { L.error('pathao', e.message, e); res.status(500).json({ error: e.message }); }
    });

    // every 30 min: shipped Pathao orders -> delivered when Pathao says so
    setInterval(async () => {
      if (!ready() || S.get('mod_pathao_on') === false) return;
      try {
        for (const o of await col('orders').find({ status: 'shipped', 'tracking.courier': 'Pathao' }).limit(20).toArray()) {
          const st = await status(o.tracking.code).catch(() => '');
          if (/delivered/i.test(st)) await O.setStatus(o.id, 'delivered', 'system', 'Pathao sync');
        }
      } catch (e) { L.warn('pathao', 'Sync fail: ' + e.message); }
    }, 30 * 60000).unref();
  },
};
