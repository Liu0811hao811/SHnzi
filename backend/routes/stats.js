const express        = require('express');
const router         = express.Router();
const fs             = require('fs');
const path           = require('path');
const authMiddleware = require('../middleware/auth');

const TEMPLATES_FILE = path.join(__dirname, '../data/templates.json');

// GET /api/stats
router.get('/', authMiddleware, (req, res) => {
  let uploadCount = 0;
  try {
    const templates = JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf-8'));
    uploadCount = templates.filter(t => t.uploader === req.user.username).length;
  } catch {}

  res.json({
    customers:     12800,
    styles:        60,
    monthlyOrders: 3420,
    praiseRate:    98.6,
    myUploads:     uploadCount
  });
});

module.exports = router;
