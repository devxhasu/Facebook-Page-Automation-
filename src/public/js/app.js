const API = '/api';
let token = localStorage.getItem('token') || '';

async function api(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : '',
      ...(options.headers || {})
    }
  });
  const data = await res.json();
  if (res.status === 401) {
    logout();
    throw new Error('Unauthorized');
  }
  return data;
}

function login() {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  fetch(API + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        token = data.token;
        localStorage.setItem('token', token);
        showMain();
      } else {
        document.getElementById('login-error').textContent = data.error || 'Login failed';
      }
    })
    .catch(e => {
      document.getElementById('login-error').textContent = e.message;
    });
}

function logout() {
  token = '';
  localStorage.removeItem('token');
  document.getElementById('main-screen').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
}

function showMain() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('main-screen').classList.remove('hidden');
  loadPage('dashboard');
}

// Nav
document.querySelectorAll('.sidebar nav a[data-page]').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    document.querySelectorAll('.sidebar nav a').forEach(x => x.classList.remove('active'));
    a.classList.add('active');
    loadPage(a.dataset.page);
  });
});

async function loadPage(name) {
  document.getElementById('page-title').textContent = name.charAt(0).toUpperCase() + name.slice(1).replace('-', ' ');
  const el = document.getElementById('page-content');
  el.innerHTML = '<p style="color:var(--muted)">Loading...</p>';

  try {
    if (name === 'dashboard') await renderDashboard(el);
    else if (name === 'orders') await renderOrders(el);
    else if (name === 'products') await renderProducts(el);
    else if (name === 'connections') await renderConnections(el);
    else if (name === 'knowledge') await renderKnowledge(el);
    else if (name === 'payments') await renderPayments(el);
    else if (name === 'ai-providers') await renderAiProviders(el);
    else if (name === 'logs') await renderLogs(el);
    else if (name === 'settings') await renderSettings(el);
  } catch (err) {
    el.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

async function renderDashboard(el) {
  const res = await api('/admin/dashboard');
  const d = res.data;
  el.innerHTML = `
    <div class="cards">
      <div class="card"><div class="label">Today Orders</div><div class="value">${d.todayOrders}</div></div>
      <div class="card"><div class="label">Pending</div><div class="value">${d.pendingOrders}</div></div>
      <div class="card"><div class="label">Needs Attention</div><div class="value">${d.needsAttention}</div></div>
      <div class="card"><div class="label">Products</div><div class="value">${d.totalProducts}</div></div>
      <div class="card"><div class="label">Low Stock</div><div class="value">${d.lowStock}</div></div>
      <div class="card"><div class="label">Sales Today</div><div class="value">${d.salesToday} ৳</div></div>
    </div>
    <h3 style="margin-bottom:0.8rem">Recent Activity</h3>
    <div id="recent-logs"></div>
  `;
  const logEl = document.getElementById('recent-logs');
  (d.recentLogs || []).forEach(l => {
    const cls = l.success === false ? 'log-err' : (l.type === 'provider' && !l.success ? 'log-warn' : 'log-ok');
    logEl.innerHTML += `<div class="log-line"><span class="log-time">${new Date(l.createdAt).toLocaleTimeString()}</span><span class="${cls}">${l.type}</span><span>${escapeHtml(l.content || '')}</span></div>`;
  });
}

async function renderOrders(el) {
  const res = await api('/orders?limit=50');
  const rows = (res.data || []).map(o => `
    <tr>
      <td>${o.orderId}</td>
      <td>${escapeHtml(o.customerName || '-')}</td>
      <td>${o.customerPhone || '-'}</td>
      <td>${o.totalAmount} ৳</td>
      <td><span class="badge badge-${o.status}">${o.status}</span></td>
      <td>
        ${o.paymentStatus === 'verify_requested' || o.paymentStatus === 'pending' ? `<button class="btn btn-success" onclick="markPaid('${o.orderId}')">Payment Received</button>` : ''}
      </td>
    </tr>
  `).join('');
  el.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-outline" onclick="loadPage('orders')">Refresh</button>
    </div>
    <table>
      <thead><tr><th>Order</th><th>Name</th><th>Phone</th><th>Total</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6">No orders yet</td></tr>'}</tbody>
    </table>
  `;
}

async function markPaid(orderId) {
  if (!confirm('Mark payment received & confirm order?')) return;
  await api(`/orders/${orderId}/payment-received`, { method: 'POST' });
  loadPage('orders');
}

async function renderProducts(el) {
  const res = await api('/products');
  const rows = (res.data || []).map(p => `
    <tr>
      <td>${p.code}</td>
      <td>${escapeHtml(p.name)}${p.variantLabel ? ' (' + escapeHtml(p.variantLabel) + ')' : ''}</td>
      <td>${p.price} ৳</td>
      <td>${p.stock}</td>
      <td>${p.isActive ? '✅' : '❌'}</td>
    </tr>
  `).join('');
  el.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-primary" onclick="showAddProduct()">+ Add Product</button>
      <button class="btn btn-outline" onclick="loadPage('products')">Refresh</button>
    </div>
    <div id="add-product-form" class="hidden card" style="margin-bottom:1rem;padding:1rem">
      <div class="form-group"><label>Name *</label><input id="p-name" /></div>
      <div class="form-group"><label>Price *</label><input id="p-price" type="number" /></div>
      <div class="form-group"><label>Stock *</label><input id="p-stock" type="number" value="10" /></div>
      <div class="form-group"><label>Variant Label</label><input id="p-variant" placeholder="Black / Premium" /></div>
      <div class="form-group"><label>Sizes (comma)</label><input id="p-sizes" placeholder="M,L,XL" /></div>
      <button class="btn btn-primary" onclick="saveProduct()">Save</button>
      <button class="btn btn-outline" onclick="document.getElementById('add-product-form').classList.add('hidden')">Cancel</button>
    </div>
    <table>
      <thead><tr><th>Code</th><th>Name</th><th>Price</th><th>Stock</th><th>Active</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">No products</td></tr>'}</tbody>
    </table>
  `;
}

function showAddProduct() {
  document.getElementById('add-product-form').classList.remove('hidden');
}

async function saveProduct() {
  const body = {
    name: document.getElementById('p-name').value,
    price: Number(document.getElementById('p-price').value),
    stock: Number(document.getElementById('p-stock').value),
    variantLabel: document.getElementById('p-variant').value || undefined,
    sizes: (document.getElementById('p-sizes').value || '').split(',').map(s => s.trim()).filter(Boolean)
  };
  await api('/products', { method: 'POST', body: JSON.stringify(body) });
  loadPage('products');
}

async function renderConnections(el) {
  const res = await api('/pages');
  const pages = res.data || [];
  el.innerHTML = `
    <div class="card" style="margin-bottom:1.5rem">
      <h3 style="margin-bottom:0.8rem">Connect Facebook Page</h3>
      <div class="form-group">
        <label>Page Access Token</label>
        <input id="page-token" placeholder="Paste Page Access Token here" />
      </div>
      <button class="btn btn-primary" onclick="connectPage()">Connect</button>
      <p style="margin-top:0.8rem;color:var(--muted);font-size:0.85rem">
        Facebook Developer App → Webhook URL: <code>${location.origin}/api/webhook</code><br>
        Verify Token: <code>ai_sales_agent_verify_token_2024</code>
      </p>
    </div>
    <h3>Connected Pages</h3>
    <div id="pages-list"></div>
  `;
  const list = document.getElementById('pages-list');
  if (!pages.length) list.innerHTML = '<p style="color:var(--muted)">No page connected yet</p>';
  else {
    pages.forEach(p => {
      list.innerHTML += `
        <div class="card" style="margin-top:0.8rem;display:flex;justify-content:space-between;align-items:center">
          <div>
            <strong>${escapeHtml(p.name || p.pageId)}</strong>
            <div style="color:var(--muted);font-size:0.85rem">${p.pageId} · ${p.webhookSubscribed ? 'Webhook ✅' : 'Webhook ❌'}</div>
          </div>
          <div>
            <span class="badge ${p.botEnabled ? 'badge-confirmed' : 'badge-cancelled'}">${p.botEnabled ? 'Bot ON' : 'Bot OFF'}</span>
          </div>
        </div>
      `;
    });
  }
}

async function connectPage() {
  const accessToken = document.getElementById('page-token').value.trim();
  if (!accessToken) return alert('Token required');
  const res = await api('/pages/connect', { method: 'POST', body: JSON.stringify({ accessToken }) });
  if (res.success) {
    alert('Page connected: ' + res.data.name);
    loadPage('connections');
  } else {
    alert(res.error || 'Failed');
  }
}

async function renderKnowledge(el) {
  const res = await api('/settings/knowledge');
  const items = res.data || [];
  el.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-primary" onclick="addKnowledge()">+ Add Info</button>
    </div>
    <div id="knowledge-list"></div>
  `;
  const list = document.getElementById('knowledge-list');
  items.forEach(k => {
    list.innerHTML += `
      <div class="card" style="margin-bottom:0.8rem">
        <strong>${escapeHtml(k.title)}</strong>
        <p style="margin-top:0.4rem;color:var(--muted);font-size:0.9rem">${escapeHtml(k.content).slice(0, 200)}</p>
      </div>
    `;
  });
}

async function addKnowledge() {
  const title = prompt('Title (e.g. Delivery Policy)');
  if (!title) return;
  const content = prompt('Details');
  if (!content) return;
  await api('/settings/knowledge', { method: 'POST', body: JSON.stringify({ title, content }) });
  loadPage('knowledge');
}

async function renderPayments(el) {
  const res = await api('/settings/payments');
  const items = res.data || [];
  el.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-primary" onclick="addPayment()">+ Add Number</button>
    </div>
    <table>
      <thead><tr><th>Type</th><th>Number</th><th>Name</th><th>Active</th></tr></thead>
      <tbody>
        ${items.map(p => `<tr><td>${p.type}</td><td>${p.number}</td><td>${escapeHtml(p.accountName || '')}</td><td>${p.isActive ? '✅' : '❌'}</td></tr>`).join('') || '<tr><td colspan="4">No payment methods</td></tr>'}
      </tbody>
    </table>
  `;
}

async function addPayment() {
  const type = prompt('Type (bkash/nagad/rocket/bank)', 'bkash');
  const number = prompt('Number');
  const accountName = prompt('Account Name');
  if (!number) return;
  await api('/settings/payments', {
    method: 'POST',
    body: JSON.stringify({ type, number, accountName, isActive: true })
  });
  loadPage('payments');
}

async function renderAiProviders(el) {
  const res = await api('/settings/ai-providers');
  const items = res.data || [];
  el.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-primary" onclick="testAI()">Test AI</button>
      <button class="btn btn-outline" onclick="loadPage('ai-providers')">Refresh</button>
    </div>
    <p style="color:var(--muted);margin-bottom:1rem;font-size:0.9rem">
      Priority: OpenRouter → Gemini → Grok → Backup. Add providers from code or extend panel later.
    </p>
    <table>
      <thead><tr><th>Type</th><th>Name</th><th>Model</th><th>Active</th><th>Keys</th></tr></thead>
      <tbody>
        ${items.map(p => `<tr><td>${p.type}</td><td>${p.name}</td><td>${p.model || '-'}</td><td>${p.isActive ? '✅' : '❌'}</td><td>${(p.apiKeys||[]).length}</td></tr>`).join('') || '<tr><td colspan="5">No providers yet. Add via DB or seed.</td></tr>'}
      </tbody>
    </table>
  `;
}

async function testAI() {
  const res = await api('/ai/test', { method: 'POST', body: JSON.stringify({ message: 'এক লাইনে সালাম দাও' }) });
  if (res.success) {
    alert(`Provider: ${res.data.provider}\n${res.data.text}\n(${res.data.ms}ms)`);
  } else {
    alert('Error: ' + res.error);
  }
}

async function renderLogs(el) {
  const res = await api('/logs?limit=80');
  const logs = res.data || [];
  el.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-outline" onclick="loadPage('logs')">Refresh</button>
    </div>
    <div id="log-list"></div>
  `;
  const list = document.getElementById('log-list');
  logs.forEach(l => {
    const cls = l.success === false ? 'log-err' : 'log-ok';
    list.innerHTML += `<div class="log-line">
      <span class="log-time">${new Date(l.createdAt).toLocaleTimeString()}</span>
      <span class="${cls}">${l.type}</span>
      <span>${l.provider ? '[' + l.provider + '] ' : ''}${escapeHtml(l.content || l.error || '')}</span>
    </div>`;
  });
}

async function renderSettings(el) {
  el.innerHTML = `
    <div class="card">
      <h3 style="margin-bottom:1rem">General Settings</h3>
      <p style="color:var(--muted);font-size:0.9rem">
        Most settings (AI name, tone, delivery charge, greeting, payment switches, schedule etc.) 
        are stored in the database and can be extended easily from the panel or API.
      </p>
      <p style="margin-top:1rem;color:var(--muted);font-size:0.9rem">
        Env only holds: ADMIN_PASSWORD, DATABASE_URL, SECRET_KEY
      </p>
    </div>
  `;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Auto login if token exists
if (token) {
  showMain();
} else {
  document.getElementById('login-screen').classList.remove('hidden');
}

// Enter key on login
document.getElementById('password')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') login();
});
