const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const { authMiddleware } = require('./auth');
const { Product } = require('../models');
const { generateProductCode } = require('../utils/helpers');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(authMiddleware);

router.get('/', async (req, res) => {
  const products = await Product.find().sort({ createdAt: -1 });
  res.json({ success: true, data: products });
});

router.post('/', async (req, res) => {
  try {
    const data = req.body;
    if (!data.code) data.code = generateProductCode();
    const product = await Product.create(data);
    res.json({ success: true, data: product });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: new Date() },
      { new: true }
    );
    res.json({ success: true, data: product });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  await Product.findByIdAndUpdate(req.params.id, { isActive: false });
  res.json({ success: true });
});

// Free image upload via catbox.moe (no API key needed)
router.post('/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file' });

    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', req.file.buffer, {
      filename: req.file.originalname || 'image.jpg',
      contentType: req.file.mimetype
    });

    const response = await axios.post('https://catbox.moe/user/api.php', form, {
      headers: form.getHeaders(),
      timeout: 30000,
      maxContentLength: 10 * 1024 * 1024
    });

    const url = (response.data || '').toString().trim();
    if (!url.startsWith('http')) {
      return res.status(500).json({ success: false, error: 'Upload failed: ' + url });
    }

    res.json({ success: true, url });
  } catch (err) {
    console.error('Image upload error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
