const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Admin } = require('../models');
const config = require('../config');

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // First time: create super admin if none exists
    let admin = await Admin.findOne({ username: username || 'admin' });
    
    if (!admin && (username === 'admin' || !username)) {
      // Bootstrap admin from env password
      const hash = await bcrypt.hash(config.adminPassword, 10);
      admin = await Admin.create({
        username: 'admin',
        passwordHash: hash,
        name: 'Super Admin',
        role: 'super',
        permissions: ['*']
      });
    }

    if (!admin) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, admin.passwordHash);
    if (!match) {
      // Also allow direct env password for first login convenience
      if (password !== config.adminPassword) {
        return res.status(401).json({ success: false, error: 'Invalid credentials' });
      }
    }

    admin.lastLogin = new Date();
    await admin.save();

    const token = jwt.sign(
      { id: admin._id, username: admin.username, role: admin.role },
      config.secretKey,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      user: {
        username: admin.username,
        name: admin.name,
        role: admin.role
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Middleware for protected routes
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, error: 'No token' });

  try {
    const decoded = jwt.verify(token, config.secretKey);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
}

module.exports = router;
module.exports.authMiddleware = authMiddleware;
