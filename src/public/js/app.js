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
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { logout(); throw new Error('Unauthorized'); }
  return data;
}

function login() {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  fetch(API + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  }).then(r => r.json()).then(data => {
    if (data.success) {
      token = data.token;
      localStorage.setItem('token', token);
      showMain();
    } else {
      document.getElementById('login-error').textContent = data.error || 'Login failed';
    }
  }).catch(e => {
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

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('overlay').classList.toggle('show');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
}

document.querySelectorAll('.sidebar nav a[data-page]').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    document.querySelectorAll('.sidebar nav a').forEach(x => x.classList.remove('active'));
    a.classList.add('active');
    closeSidebar();
    loadPage(a.dataset.page);
  });
});

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function modal(html, center = true) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-bg ${center ? 'center' : ''}" onclick="if(event.target===this)closeModal()"><div class="modal">${html}</div></div>`;
}
function closeModal() { document.getElementById('modal-root').innerHTML = ''; }

async function loadPage(name) {
  const titles = {
    dashboard: 'Dashboard', orders: 'Orders', products: 'Products',
    connections: 'Connections', 'ai-providers': 'AI Providers',
    knowledge: 'Knowledge Base', payments: 'Payments',
    settings: 'Settings', logs: 'Live Logs'
  };
  document.getElementById('page-title').textContent = titles[name] || name;
  const el = document.getElementById('page-content');
  el.innerHTML = '<p style="color:var(--muted)">Loading...</p>';
  try {
    if (name === 'dashboard') await renderDashboard(el);
    else if (name === 'orders') await renderOrders(el);
    else if (name === 'products') await renderProducts(el);
    else if (name === 'connections') await renderConnections(el);
    else if (name === 'ai-providers') await renderAiProviders(el);
    else if (name === 'knowledge') await renderKnowledge(el);
    else if (name === 'payments') await renderPayments(el);
    else if (name === 'settings') await renderSettings(el);
    else if (name === 'logs') await renderLogs(el);
  } catch (err) {
    el.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  }
}

/* ===== Dashboard ===== */
async function renderDashboard(el) {
  const res = await api('/admin/dashboard');
  const d = res.data || {};
  el.innerHTML = `
    <div class="cards">
      <div class="card"><div class="label">Today Orders</div><div class="value">${d.todayOrders || 0}</div></div>
      <div class="card"><div class="label">Pending</div><div class="value">${d.pendingOrders || 0}</div></div>
      <div class="card"><div class="label">Needs Attention</div><div class="value">${d.needsAttention || 0}</div></div>
      <div class="card"><div class="label">Products</div><div class="value">${d.totalProducts || 0}</div></div>
      <div class="card"><div class="label">Low Stock</div><div class="value">${d.lowStock || 0}</div></div>
      <div class="card"><div class="label">Sales Today</div><div class="value">${d.salesToday || 0} ৳</div></div>
    </div>
    <div class="section-card">
      <h3>Recent Activity</h3>
      <div id="recent-logs"></div>
    </div>`;
  const logEl = document.getElementById('recent-logs');
  (d.recentLogs || []).forEach(l => {
    const cls = l.success === false ? 'log-err' : 'log-ok';
    logEl.innerHTML += `<div class="log-line"><span class="log-time">${new Date(l.createdAt).toLocaleTimeString()}</span><span class="${cls}">${l.type}</span><span>${escapeHtml(l.content || '')}</span></div>`;
  });
}

/* ===== Orders ===== */
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
        ${(o.paymentStatus === 'verify_requested' || o.paymentStatus === 'pending') && o.status === 'pending'
          ? `<button class="btn btn-success btn-sm" onclick="markPaid('${o.orderId}')">Paid</button>` : ''}
        <button class="btn btn-outline btn-sm" onclick="changeStatus('${o.orderId}','${o.status}')">Status</button>
      </td>
    </tr>`).join('');
  el.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-outline" onclick="loadPage('orders')">Refresh</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Order</th><th>Name</th><th>Phone</th><th>Total</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6">No orders</td></tr>'}</tbody>
    </table></div>`;
}

async function markPaid(orderId) {
  if (!confirm('Mark payment received & confirm?')) return;
  await api(`/orders/${orderId}/payment-received`, { method: 'POST' });
  loadPage('orders');
}

function changeStatus(orderId, current) {
  modal(`
    <button class="modal-close" onclick="closeModal()">×</button>
    <h3>Update Status — ${orderId}</h3>
    <div class="form-group"><label>Status</label>
      <select id="st-status">
        ${['pending','confirmed','shipped','delivered','cancelled','returned'].map(s =>
          `<option value="${s}" ${s===current?'selected':''}>${s}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>Tracking Number</label><input id="st-track" placeholder="Optional" /></div>
    <div class="form-group"><label>Note</label><input id="st-note" /></div>
    <div class="form-actions">
      <button class="btn btn-primary" onclick="saveStatus('${orderId}')">Save</button>
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    </div>`);
}

async function saveStatus(orderId) {
  await api(`/orders/${orderId}/status`, {
    method: 'POST',
    body: JSON.stringify({
      status: document.getElementById('st-status').value,
      trackingNumber: document.getElementById('st-track').value || undefined,
      note: document.getElementById('st-note').value || undefined,
      notifyCustomer: true
    })
  });
  closeModal();
  loadPage('orders');
}

/* ===== Products ===== */
async function renderProducts(el) {
  const res = await api('/products');
  const products = res.data || [];
  const rows = products.map(p => `
    <tr>
      <td>${p.code}</td>
      <td>${escapeHtml(p.name)}${p.variantLabel ? ' <small style="color:var(--muted)">('+escapeHtml(p.variantLabel)+')</small>' : ''}</td>
      <td>${p.price} ৳</td>
      <td>${p.stock}${p.stock <= 5 ? ' <span class="badge badge-err">low</span>' : ''}</td>
      <td>${p.isActive ? '✅' : '❌'}</td>
      <td><button class="btn btn-outline btn-sm" onclick='editProduct(${JSON.stringify(p).replace(/'/g,"&#39;")})'>Edit</button></td>
    </tr>`).join('');
  el.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-primary" onclick="showProductForm()">+ Add Product</button>
      <button class="btn btn-outline" onclick="loadPage('products')">Refresh</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Code</th><th>Name</th><th>Price</th><th>Stock</th><th>Active</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6">No products</td></tr>'}</tbody>
    </table></div>`;
}

function showProductForm(p = null) {
  const isEdit = !!p;
  modal(`
    <button class="modal-close" onclick="closeModal()">×</button>
    <h3>${isEdit ? 'Edit' : 'Add'} Product</h3>
    <div class="form-grid">
      <div class="form-group"><label>Name *</label><input id="pf-name" value="${escapeHtml(p?.name || '')}" /></div>
      <div class="form-group"><label>Price *</label><input id="pf-price" type="number" value="${p?.price ?? ''}" /></div>
      <div class="form-group"><label>Stock *</label><input id="pf-stock" type="number" value="${p?.stock ?? 10}" /></div>
      <div class="form-group"><label>Variant Label</label><input id="pf-variant" value="${escapeHtml(p?.variantLabel || '')}" placeholder="Black / Premium" /></div>
      <div class="form-group"><label>Sizes (comma)</label><input id="pf-sizes" value="${(p?.sizes || []).join(',')}" placeholder="M,L,XL" /></div>
      <div class="form-group"><label>Colors (comma)</label><input id="pf-colors" value="${(p?.colors || []).join(',')}" placeholder="Black,White" /></div>
      <div class="form-group"><label>Brand</label><input id="pf-brand" value="${escapeHtml(p?.brand || '')}" /></div>
      <div class="form-group"><label>Discount %</label><input id="pf-discount" type="number" value="${p?.discount ?? 0}" /></div>
      <div class="form-group"><label>Category</label><input id="pf-category" value="${escapeHtml(p?.category || '')}" /></div>
      <div class="form-group"><label>Delivery Time</label><input id="pf-delivery" value="${escapeHtml(p?.deliveryTime || '')}" placeholder="2-3 days" /></div>
      <div class="form-group"><label>Warranty</label><input id="pf-warranty" value="${escapeHtml(p?.warranty || '')}" /></div>
      <div class="form-group"><label>Aliases (comma)</label><input id="pf-aliases" value="${(p?.aliases || []).join(',')}" placeholder="polo, পোলো" /></div>
    </div>
    <div class="form-group"><label>Description</label><textarea id="pf-desc">${escapeHtml(p?.description || '')}</textarea></div>
    <div class="form-group"><label>Image URL (or upload below)</label><input id="pf-image" value="${(p?.images && p.images[0]) || ''}" placeholder="https://..." /></div>
    <div class="form-group"><label>Upload Image</label><input type="file" id="pf-file" accept="image/*" onchange="uploadProductImage(this)" />
      <div class="img-preview" id="pf-preview">${(p?.images || []).map(u => `<img src="${u}" />`).join('')}</div>
    </div>
    <div class="form-group"><label><input type="checkbox" id="pf-active" ${p?.isActive !== false ? 'checked' : ''}/> Active</label></div>
    <div class="form-actions">
      <button class="btn btn-primary" onclick="saveProduct('${p?._id || ''}')">Save</button>
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    </div>`, true);
}

function editProduct(p) { showProductForm(p); }

async function uploadProductImage(input) {
  if (!input.files?.[0]) return;
  const fd = new FormData();
  fd.append('image', input.files[0]);
  try {
    const res = await fetch(API + '/products/upload-image', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: fd
    });
    const data = await res.json();
    if (data.success && data.url) {
      document.getElementById('pf-image').value = data.url;
      document.getElementById('pf-preview').innerHTML = `<img src="${data.url}" />`;
    } else {
      alert(data.error || 'Upload failed');
    }
  } catch (e) {
    alert('Upload error: ' + e.message);
  }
}

async function saveProduct(id) {
  const body = {
    name: document.getElementById('pf-name').value,
    price: Number(document.getElementById('pf-price').value),
    stock: Number(document.getElementById('pf-stock').value),
    variantLabel: document.getElementById('pf-variant').value || undefined,
    sizes: document.getElementById('pf-sizes').value.split(',').map(s => s.trim()).filter(Boolean),
    colors: document.getElementById('pf-colors').value.split(',').map(s => s.trim()).filter(Boolean),
    brand: document.getElementById('pf-brand').value || undefined,
    discount: Number(document.getElementById('pf-discount').value) || 0,
    category: document.getElementById('pf-category').value || undefined,
    deliveryTime: document.getElementById('pf-delivery').value || undefined,
    warranty: document.getElementById('pf-warranty').value || undefined,
    aliases: document.getElementById('pf-aliases').value.split(',').map(s => s.trim()).filter(Boolean),
    description: document.getElementById('pf-desc').value || undefined,
    images: document.getElementById('pf-image').value ? [document.getElementById('pf-image').value] : [],
    isActive: document.getElementById('pf-active').checked
  };
  if (!body.name || !body.price) return alert('Name & Price required');
  if (id) {
    await api('/products/' + id, { method: 'PUT', body: JSON.stringify(body) });
  } else {
    await api('/products', { method: 'POST', body: JSON.stringify(body) });
  }
  closeModal();
  loadPage('products');
}

/* ===== Connections ===== */
async function renderConnections(el) {
  const res = await api('/pages');
  const pages = res.data || [];
  el.innerHTML = `
    <div class="section-card">
      <h3>Connect Facebook Page</h3>
      <div class="form-group"><label>Page Access Token</label>
        <input id="page-token" placeholder="Paste token here" />
      </div>
      <button class="btn btn-primary" onclick="connectPage()">Connect</button>
      <p style="margin-top:0.8rem;color:var(--muted);font-size:0.82rem">
        Webhook URL: <code>${location.origin}/api/webhook</code><br>
        Verify Token: <code>ai_sales_agent_verify_token_2024</code>
      </p>
    </div>
    <h3 style="margin-bottom:0.8rem">Connected Pages</h3>
    <div id="pages-list"></div>`;
  const list = document.getElementById('pages-list');
  if (!pages.length) list.innerHTML = '<p style="color:var(--muted)">No page connected</p>';
  else pages.forEach(p => {
    list.innerHTML += `
      <div class="section-card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem">
        <div>
          <strong>${escapeHtml(p.name || p.pageId)}</strong>
          <div style="color:var(--muted);font-size:0.82rem">${p.pageId} · Webhook ${p.webhookSubscribed ? '✅' : '❌'}</div>
        </div>
        <span class="badge ${p.botEnabled ? 'badge-ok' : 'badge-err'}">${p.botEnabled ? 'Bot ON' : 'Bot OFF'}</span>
      </div>`;
  });
}

async function connectPage() {
  const accessToken = document.getElementById('page-token').value.trim();
  if (!accessToken) return alert('Token required');
  const res = await api('/pages/connect', { method: 'POST', body: JSON.stringify({ accessToken }) });
  if (res.success) { alert('Connected: ' + res.data.name); loadPage('connections'); }
  else alert(res.error || 'Failed');
}

/* ===== AI Providers ===== */
async function renderAiProviders(el) {
  const res = await api('/settings/ai-providers');
  const items = res.data || [];
  el.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-primary" onclick="showProviderForm()">+ Add Provider</button>
      <button class="btn btn-outline" onclick="testAI()">Test AI</button>
      <button class="btn btn-outline" onclick="loadPage('ai-providers')">Refresh</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Type</th><th>Name</th><th>Model</th><th>Keys</th><th>Active</th><th></th></tr></thead>
      <tbody>
        ${items.map(p => `<tr>
          <td>${p.type}</td><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.model || '-')}</td>
          <td>${(p.apiKeys || []).length}</td>
          <td>${p.isActive ? '✅' : '❌'}</td>
          <td><button class="btn btn-outline btn-sm" onclick='editProvider(${JSON.stringify(p).replace(/'/g,"&#39;")})'>Edit</button></td>
        </tr>`).join('') || '<tr><td colspan="6">No providers. Add OpenRouter / Gemini / Grok</td></tr>'}
      </tbody>
    </table></div>`;
}

function showProviderForm(p = null) {
  modal(`
    <button class="modal-close" onclick="closeModal()">×</button>
    <h3>${p ? 'Edit' : 'Add'} AI Provider</h3>
    <div class="form-group"><label>Type</label>
      <select id="ap-type">
        <option value="text" ${p?.type==='text'?'selected':''}>Text</option>
        <option value="vision" ${p?.type==='vision'?'selected':''}>Vision (Image)</option>
        <option value="voice" ${p?.type==='voice'?'selected':''}>Voice</option>
      </select>
    </div>
    <div class="form-group"><label>Name</label>
      <select id="ap-name">
        <option value="OpenRouter">OpenRouter</option>
        <option value="Gemini">Gemini</option>
        <option value="Grok">Grok</option>
        <option value="Backup">Backup Custom</option>
      </select>
    </div>
    <div class="form-group"><label>Model</label><input id="ap-model" value="${escapeHtml(p?.model || 'openai/gpt-4o-mini')}" placeholder="openai/gpt-4o-mini" /></div>
    <div class="form-group"><label>API Key</label><input id="ap-key" type="password" placeholder="sk-..." /></div>
    <div class="form-group"><label>Base URL (for Backup)</label><input id="ap-url" value="${escapeHtml(p?.baseUrl || '')}" placeholder="https://.../api/chat?message={message}" /></div>
    <div class="form-group"><label>Sort Order</label><input id="ap-sort" type="number" value="${p?.sortOrder ?? 1}" /></div>
    <div class="form-group"><label><input type="checkbox" id="ap-active" ${p?.isActive !== false ? 'checked' : ''}/> Active</label></div>
    <div class="form-actions">
      <button class="btn btn-primary" onclick="saveProvider('${p?._id || ''}')">Save</button>
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    </div>`);
  if (p?.name) document.getElementById('ap-name').value = p.name;
}

function editProvider(p) { showProviderForm(p); }

async function saveProvider(id) {
  const key = document.getElementById('ap-key').value.trim();
  const body = {
    type: document.getElementById('ap-type').value,
    name: document.getElementById('ap-name').value,
    model: document.getElementById('ap-model').value,
    baseUrl: document.getElementById('ap-url').value || undefined,
    sortOrder: Number(document.getElementById('ap-sort').value) || 1,
    isActive: document.getElementById('ap-active').checked,
    isBackup: document.getElementById('ap-name').value === 'Backup',
    timeoutMs: 15000
  };
  if (key) {
    body.apiKeys = [{ key, label: 'main', isActive: true }];
  }
  if (id) {
    await api('/settings/ai-providers/' + id, { method: 'PUT', body: JSON.stringify(body) });
  } else {
    if (!key && body.name !== 'Backup') return alert('API Key required');
    await api('/settings/ai-providers', { method: 'POST', body: JSON.stringify(body) });
  }
  closeModal();
  loadPage('ai-providers');
}

async function testAI() {
  const res = await api('/ai/test', { method: 'POST', body: JSON.stringify({ message: 'এক লাইনে সালাম দাও' }) });
  if (res.success) alert(`Provider: ${res.data.provider}\n${res.data.text}\n(${res.data.ms}ms)`);
  else alert('Error: ' + (res.error || 'Failed'));
}

/* ===== Knowledge ===== */
async function renderKnowledge(el) {
  const res = await api('/settings/knowledge');
  const items = res.data || [];
  el.innerHTML = `
    <div class="toolbar"><button class="btn btn-primary" onclick="addKnowledge()">+ Add Info</button></div>
    ${items.map(k => `
      <div class="section-card">
        <strong>${escapeHtml(k.title)}</strong>
        <p style="margin-top:0.4rem;color:var(--muted);font-size:0.9rem">${escapeHtml(k.content).slice(0, 300)}</p>
        <button class="btn btn-danger btn-sm" style="margin-top:0.5rem" onclick="deleteKnowledge('${k._id}')">Delete</button>
      </div>`).join('') || '<p style="color:var(--muted)">No knowledge yet</p>'}`;
}

async function addKnowledge() {
  const title = prompt('Title (e.g. Delivery Policy)');
  if (!title) return;
  const content = prompt('Details');
  if (!content) return;
  await api('/settings/knowledge', { method: 'POST', body: JSON.stringify({ title, content }) });
  loadPage('knowledge');
}

async function deleteKnowledge(id) {
  if (!confirm('Delete?')) return;
  await api('/settings/knowledge/' + id, { method: 'DELETE' });
  loadPage('knowledge');
}

/* ===== Payments ===== */
async function renderPayments(el) {
  const res = await api('/settings/payments');
  const items = res.data || [];
  el.innerHTML = `
    <div class="toolbar"><button class="btn btn-primary" onclick="addPayment()">+ Add Number</button></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Type</th><th>Number</th><th>Name</th><th>Active</th></tr></thead>
      <tbody>
        ${items.map(p => `<tr><td>${p.type}</td><td>${p.number}</td><td>${escapeHtml(p.accountName || '')}</td><td>${p.isActive ? '✅' : '❌'}</td></tr>`).join('') || '<tr><td colspan="4">None</td></tr>'}
      </tbody>
    </table></div>`;
}

async function addPayment() {
  const type = prompt('Type (bkash/nagad/rocket/bank)', 'bkash');
  const number = prompt('Number');
  if (!number) return;
  const accountName = prompt('Account Name') || '';
  await api('/settings/payments', { method: 'POST', body: JSON.stringify({ type, number, accountName, isActive: true }) });
  loadPage('payments');
}

/* ===== Settings ===== */
async function renderSettings(el) {
  const res = await api('/settings');
  const s = res.data || {};
  el.innerHTML = `
    <div class="section-card">
      <h3>AI Behavior</h3>
      <div class="form-grid">
        <div class="form-group"><label>AI Name</label><input id="s-aiName" value="${escapeHtml(s.aiName || 'Rafi')}" /></div>
        <div class="form-group"><label>Tone</label>
          <select id="s-tone"><option value="friendly" ${s.tone==='friendly'?'selected':''}>Friendly</option><option value="formal" ${s.tone==='formal'?'selected':''}>Formal</option></select>
        </div>
        <div class="form-group"><label>Greeting Style</label>
          <select id="s-greet"><option value="auto">Auto</option><option value="salam">Salam</option><option value="hello">Hello</option></select>
        </div>
      </div>
    </div>
    <div class="section-card">
      <h3>Delivery Charge</h3>
      <div class="form-grid">
        <div class="form-group"><label>Inside Dhaka (tk)</label><input id="s-dhaka" type="number" value="${s.deliveryInsideDhaka ?? 60}" /></div>
        <div class="form-group"><label>Outside Dhaka (tk)</label><input id="s-outside" type="number" value="${s.deliveryOutsideDhaka ?? 120}" /></div>
        <div class="form-group"><label>Free Delivery Min (tk)</label><input id="s-free" type="number" value="${s.freeDeliveryMin ?? 2000}" /></div>
      </div>
    </div>
    <div class="section-card">
      <h3>Payment Methods</h3>
      <div class="form-grid">
        <div class="form-group"><label>COD</label><label class="toggle"><input type="checkbox" id="s-cod" ${s.paymentCod !== false ? 'checked' : ''}/><span class="slider"></span></label></div>
        <div class="form-group"><label>Delivery Advance</label><label class="toggle"><input type="checkbox" id="s-deladv" ${s.paymentDeliveryAdvance !== false ? 'checked' : ''}/><span class="slider"></span></label></div>
        <div class="form-group"><label>Full Advance</label><label class="toggle"><input type="checkbox" id="s-fulladv" ${s.paymentFullAdvance !== false ? 'checked' : ''}/><span class="slider"></span></label></div>
        <div class="form-group"><label>New Customer = Advance only</label><label class="toggle"><input type="checkbox" id="s-newadv" ${s.newCustomerRequireAdvance !== false ? 'checked' : ''}/><span class="slider"></span></label></div>
      </div>
    </div>
    <div class="section-card">
      <h3>Telegram Notification (Optional)</h3>
      <div class="form-grid">
        <div class="form-group"><label>Bot Token</label><input id="s-tg-token" value="${escapeHtml(s.telegramBotToken || '')}" placeholder="123456:ABC..." /></div>
        <div class="form-group"><label>Chat ID</label><input id="s-tg-chat" value="${escapeHtml(s.telegramChatId || '')}" /></div>
        <div class="form-group"><label>Enabled</label><label class="toggle"><input type="checkbox" id="s-tg-on" ${s.telegramEnabled ? 'checked' : ''}/><span class="slider"></span></label></div>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" onclick="saveSettings()">Save All Settings</button>
    </div>`;
}

async function saveSettings() {
  const pairs = [
    ['aiName', document.getElementById('s-aiName').value],
    ['tone', document.getElementById('s-tone').value],
    ['greetingStyle', document.getElementById('s-greet').value],
    ['deliveryInsideDhaka', Number(document.getElementById('s-dhaka').value)],
    ['deliveryOutsideDhaka', Number(document.getElementById('s-outside').value)],
    ['freeDeliveryMin', Number(document.getElementById('s-free').value)],
    ['paymentCod', document.getElementById('s-cod').checked],
    ['paymentDeliveryAdvance', document.getElementById('s-deladv').checked],
    ['paymentFullAdvance', document.getElementById('s-fulladv').checked],
    ['newCustomerRequireAdvance', document.getElementById('s-newadv').checked],
    ['telegramBotToken', document.getElementById('s-tg-token').value],
    ['telegramChatId', document.getElementById('s-tg-chat').value],
    ['telegramEnabled', document.getElementById('s-tg-on').checked]
  ];
  for (const [key, value] of pairs) {
    await api('/settings', { method: 'POST', body: JSON.stringify({ key, value }) });
  }
  alert('Settings saved');
}

/* ===== Logs ===== */
async function renderLogs(el) {
  const res = await api('/logs?limit=100');
  const logs = res.data || [];
  el.innerHTML = `
    <div class="toolbar"><button class="btn btn-outline" onclick="loadPage('logs')">Refresh</button></div>
    <div class="section-card" style="padding:0.75rem 1rem">
      ${logs.map(l => {
        const cls = l.success === false ? 'log-err' : 'log-ok';
        return `<div class="log-line"><span class="log-time">${new Date(l.createdAt).toLocaleTimeString()}</span><span class="${cls}">${l.type}</span><span>${l.provider ? '['+l.provider+'] ' : ''}${escapeHtml(l.content || l.error || '')}</span></div>`;
      }).join('') || '<p style="color:var(--muted)">No logs</p>'}
    </div>`;
}

/* Init */
if (token) showMain();
else document.getElementById('login-screen').classList.remove('hidden');
document.getElementById('password')?.addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
