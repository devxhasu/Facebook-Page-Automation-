/**
 * AI Sales Agent - Main Server
 * Modular architecture for easy feature addition later
 */

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const config = require('./config');

const app = express();

// ======================
// Middleware
// ======================
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Static admin panel
app.use(express.static(path.join(__dirname, 'public')));

// ======================
// Database
// ======================
mongoose.connect(config.databaseUrl)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });

// ======================
// Routes
// ======================
app.use('/api/auth', require('./routes/auth'));
app.use('/api/webhook', require('./routes/webhook'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/products', require('./routes/products'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/pages', require('./routes/pages'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/logs', require('./routes/logs'));
app.use('/api/ai', require('./routes/ai'));

// Health check (for UptimeRobot / Render)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Admin panel SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ======================
// Error handler
// ======================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: err.message || 'Internal server error' });
});

// ======================
// Start
// ======================
const PORT = config.port;
app.listen(PORT, () => {
  console.log(`🚀 AI Sales Agent running on port ${PORT}`);
  console.log(`📊 Admin Panel: http://localhost:${PORT}`);
  console.log(`❤️  Health: http://localhost:${PORT}/health`);
});

module.exports = app;
