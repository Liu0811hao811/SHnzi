const express        = require('express');
const path           = require('path');
const fs             = require('fs');
const authMiddleware = require('../middleware/auth');

const router    = express.Router();
const DATA_FILE = path.join(__dirname, '../data/settings.json');

const DEFAULT_TAGLINE = '扇艺广告专属 AI 助手\n为您提供定制咨询服务';

function readSettings() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); } catch { return {}; }
}
function writeSettings(obj) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2));
}

// GET /api/settings/ai-tagline — 公开，ai-chat.html 加载时读取
router.get('/ai-tagline', (req, res) => {
  const s = readSettings();
  res.json({ tagline: s.aiTagline || DEFAULT_TAGLINE });
});

// POST /api/settings/ai-tagline — 需登录
router.post('/ai-tagline', authMiddleware, (req, res) => {
  const { tagline } = req.body || {};
  if (typeof tagline !== 'string' || !tagline.trim()) {
    return res.status(400).json({ message: '内容不能为空' });
  }
  const s = readSettings();
  s.aiTagline = tagline.trim();
  writeSettings(s);
  res.json({ message: '保存成功', tagline: s.aiTagline });
});

module.exports = router;
