// Module loader: every folder in /modules with an index.js is a feature plug-in.
const fs = require('fs');
const path = require('path');
const express = require('express');
const S = require('./settings');
const L = require('./logger');

const loaded = [];
function loadAll() {
  const dir = path.join(__dirname, '..', 'modules');
  if (!fs.existsSync(dir)) return;
  for (const n of fs.readdirSync(dir)) {
    const f = path.join(dir, n, 'index.js');
    if (!fs.existsSync(f)) continue;
    try {
      const mod = require(f);
      S.extend([{ key: `mod_${n}_on`, default: true }, ...(mod.fields || [])]);
      loaded.push({ name: n, mod });
    } catch (e) { L.error('module', `${n} load hoyni: ${e.message}`, e); }
  }
}
function initAll(app, auth, base) {
  for (const { name, mod } of loaded) {
    try {
      const router = express.Router();
      const ctx = { ...base, router, name };
      if (mod.init) mod.init(ctx);
      const gate = (req, res, next) => (S.get(`mod_${name}_on`) !== false ? next() : res.status(400).json({ error: 'Module off ache' }));
      app.use(`/api/mod/${name}`, auth, gate, router);
      L.ok('module', `${name} v${mod.version || '1'} chalu`);
    } catch (e) { L.error('module', `${name} init fail: ${e.message}`, e); }
  }
}
const list = () => loaded.map(({ name, mod }) => ({ name, title: mod.title || name, version: mod.version || '1', enabled: S.get(`mod_${name}_on`) !== false, fields: mod.fields || [] }));
module.exports = { loadAll, initAll, list };
