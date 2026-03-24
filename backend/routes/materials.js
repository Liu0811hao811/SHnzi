/**
 * materials.js — 材料仓库路由
 *
 * POST   /api/materials/upload   上传素材（支持多文件）
 * GET    /api/materials           获取当前用户所有素材
 * PATCH  /api/materials/:id       修改素材名称 / 分类
 * DELETE /api/materials/:id       删除素材
 */

const express        = require('express');
const router         = express.Router();
const multer         = require('multer');
const path           = require('path');
const fs             = require('fs');
const authMiddleware = require('../middleware/auth');

const MATERIALS_FILE  = path.join(__dirname, '../data/materials.json');
const MATERIALS_DIR   = path.join(__dirname, '../uploads/materials');

if (!fs.existsSync(MATERIALS_DIR)) fs.mkdirSync(MATERIALS_DIR, { recursive: true });

function readMaterials() {
  if (!fs.existsSync(MATERIALS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(MATERIALS_FILE, 'utf-8')); } catch { return []; }
}
function writeMaterials(list) {
  fs.writeFileSync(MATERIALS_FILE, JSON.stringify(list, null, 2));
}

// multer：按用户名分子目录，保留原始扩展名
const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = path.join(MATERIALS_DIR, req.user.username);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `mat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`;
    cb(null, name);
  },
});

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },  // 单文件 20 MB
  fileFilter(req, file, cb) {
    if (ALLOWED_MIME.includes(file.mimetype)) return cb(null, true);
    cb(new Error(`不支持的文件类型：${file.mimetype}`));
  },
});

const CATEGORIES = ['logo品牌', '产品图', '背景', '其他'];

// ─── POST /api/materials/upload ─────────────────────────────────────────────
router.post('/upload', authMiddleware, upload.array('files', 20), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ message: '未收到文件' });
  }

  const category = CATEGORIES.includes(req.body.category) ? req.body.category : '其他';
  const list     = readMaterials();
  const host     = req.get('host');
  const added    = [];

  req.files.forEach(f => {
    const item = {
      id:           Date.now() + Math.random(),
      filename:     f.filename,
      originalName: Buffer.from(f.originalname, 'latin1').toString('utf-8'),
      url:          `http://${host}/uploads/materials/${req.user.username}/${f.filename}`,
      category,
      size:         f.size,
      mimeType:     f.mimetype,
      creator:      req.user.username,
      createdAt:    new Date().toISOString(),
    };
    list.push(item);
    added.push(item);
  });

  writeMaterials(list);
  res.status(201).json({ message: `上传成功 ${added.length} 个文件`, items: added });
});

// ─── GET /api/materials ──────────────────────────────────────────────────────
router.get('/', authMiddleware, (req, res) => {
  const list     = readMaterials();
  const category = req.query.category;
  let   result   = list.filter(m => m.creator === req.user.username);
  if (category && category !== '全部') {
    result = result.filter(m => m.category === category);
  }
  result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(result);
});

// ─── PATCH /api/materials/:id ────────────────────────────────────────────────
router.patch('/:id', authMiddleware, (req, res) => {
  const list = readMaterials();
  const item = list.find(m => String(m.id) === req.params.id && m.creator === req.user.username);
  if (!item) return res.status(404).json({ message: '素材不存在' });

  const { originalName, category } = req.body;
  if (originalName) item.originalName = originalName.trim();
  if (category && CATEGORIES.includes(category)) item.category = category;

  writeMaterials(list);
  res.json({ message: '更新成功', item });
});

// ─── DELETE /api/materials/:id ───────────────────────────────────────────────
router.delete('/:id', authMiddleware, (req, res) => {
  let list = readMaterials();
  const item = list.find(m => String(m.id) === req.params.id && m.creator === req.user.username);
  if (!item) return res.status(404).json({ message: '素材不存在' });

  // 删除物理文件
  const filePath = path.join(MATERIALS_DIR, item.creator, item.filename);
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch (e) { console.warn('删除文件失败:', e.message); }
  }

  list = list.filter(m => String(m.id) !== req.params.id);
  writeMaterials(list);
  res.json({ message: '删除成功' });
});

// ─── POST /api/materials/order-submit ───────────────────────────────────────
// 从 AI 咨询页提交图片到材料仓库（使用 urlToken 鉴权，无需 JWT）
router.post('/order-submit', async (req, res) => {
  const { urlToken, imageUrl, cdrUrl, specs, quantity, orderNumber } = req.body || {};

  if (!imageUrl || !specs || !quantity || !orderNumber) {
    return res.status(400).json({ message: '请填写完整信息（规格、数量、淘宝订单编号）' });
  }
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0 || qty % 500 !== 0) {
    return res.status(400).json({ message: '数量必须是 500 的整数倍（如 500、1000、2000…）' });
  }
  if (!urlToken) return res.status(401).json({ message: '无效的访问令牌' });

  // 验证 AI 咨询 token
  const AI_TOKENS_FILE = path.join(__dirname, '../data/ai-tokens.json');
  let tokens = [];
  try { tokens = JSON.parse(fs.readFileSync(AI_TOKENS_FILE, 'utf-8')); } catch { /* 文件不存在 */ }
  const tokenRecord = tokens.find(t => t.token === urlToken);
  if (!tokenRecord) return res.status(401).json({ message: '访问令牌无效或已删除' });
  if (tokenRecord.limitType === 'time' && new Date(tokenRecord.expiresAt) < new Date()) {
    return res.status(401).json({ message: '访问令牌已过期' });
  }
  if (tokenRecord.limitType === 'count' && (tokenRecord.remainingCount ?? 0) <= 0) {
    return res.status(401).json({ message: '访问次数已用完' });
  }

  const list = readMaterials();
  const item = {
    id:           Date.now() + Math.random(),
    originalName: `${specs}_${qty}把_${orderNumber}`,
    url:          imageUrl,
    cdrUrl:       cdrUrl || null,
    category:     '订单提交',
    size:         0,
    mimeType:     'image/png',
    creator:      tokenRecord.username || 'customer',
    createdAt:    new Date().toISOString(),
    orderInfo: {
      specs,
      quantity: qty,
      orderNumber: String(orderNumber).trim(),
      submittedBy: tokenRecord.username || '',
    },
  };
  list.push(item);
  writeMaterials(list);

  res.status(201).json({ message: '提交成功', item });
});

module.exports = router;
