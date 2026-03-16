const express        = require('express');
const router         = express.Router();
const multer         = require('multer');
const path           = require('path');
const fs             = require('fs');
const authMiddleware = require('../middleware/auth');

const TEMPLATES_FILE = path.join(__dirname, '../data/templates.json');
const UPLOADS_DIR    = path.join(__dirname, '../uploads');

function readTemplates() {
  return JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf-8'));
}
function writeTemplates(list) {
  fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(list, null, 2));
}

// multer 配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const name = Date.now() + '-' + Math.random().toString(36).slice(2) + ext;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.pdf', '.ai', '.psd'];
    const ext     = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('不支持的文件格式，仅限 PNG/JPG/PDF/AI/PSD'));
  }
});

// POST /api/templates/upload（最多同时上传 10 个文件）
router.post('/upload', authMiddleware, upload.array('files', 10), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ message: '��收到任何文件' });
  }

  const templates = readTemplates();
  const uploaded  = req.files.map(file => ({
    id:         Date.now() + Math.floor(Math.random() * 10000),
    name:       file.originalname,
    filename:   file.filename,
    size:       file.size,
    mimetype:   file.mimetype,
    uploader:   req.user.username,
    uploadedAt: new Date().toISOString(),
    url:        `${req.protocol}://${req.get('host')}/uploads/${file.filename}`
  }));

  templates.push(...uploaded);
  writeTemplates(templates);

  res.json({ message: '上传成功', files: uploaded });
});

// GET /api/templates — 获取当前用户上传的模板
router.get('/', authMiddleware, (req, res) => {
  const templates     = readTemplates();
  const userTemplates = templates.filter(t => t.uploader === req.user.username);
  res.json(userTemplates);
});

// GET /api/templates/by-link/:token — AI 链接页面专用（无需 JWT，用 ai-link token 换取模板列表）
// 注意：此接口不做时间过期检查，模板列表始终与 templates.html 保持同步。
// 对话权限（是否允许继续聊天）由 /api/ai-link/verify/:token 单独控制。
router.get('/by-link/:token', (req, res) => {
  const TOKENS_FILE = path.join(__dirname, '../data/ai-tokens.json');
  let tokens = [];
  try { tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8')); } catch {}

  const entry = tokens.find(t => t.token === req.params.token);
  if (!entry) return res.status(404).json({ message: '链接无效' });

  // 不检查 expiresAt：模板列表属于静态展示内容，与对话有效期无关
  const templates     = readTemplates();
  const userTemplates = templates.filter(t => t.uploader === entry.userId);
  res.json(userTemplates);
});

// PUT /api/templates/:id/overwrite — 用 base64 PNG 覆盖原文件（批量染色专用）
router.put('/:id/overwrite', authMiddleware, (req, res) => {
  const templates = readTemplates();
  const id        = Number(req.params.id);
  const item      = templates.find(t => t.id === id && t.uploader === req.user.username);
  if (!item) return res.status(404).json({ message: '模板不存在或无权限' });

  const { dataUrl } = req.body;
  if (!dataUrl || !dataUrl.startsWith('data:image/png;base64,')) {
    return res.status(400).json({ message: '需要 PNG base64 dataUrl' });
  }

  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  const buf    = Buffer.from(base64, 'base64');
  const filePath = path.join(UPLOADS_DIR, item.filename);
  fs.writeFileSync(filePath, buf);

  // 同步更新文件大小
  item.size = buf.length;
  writeTemplates(templates);

  res.json({ message: '覆盖成功', size: buf.length });
});

// DELETE /api/templates/:id — 删除指定模板
router.delete('/:id', authMiddleware, (req, res) => {
  let templates = readTemplates();
  const id      = Number(req.params.id);
  const item    = templates.find(t => t.id === id && t.uploader === req.user.username);

  if (!item) {
    return res.status(404).json({ message: '模板不存在或无权限删除' });
  }

  const filePath = path.join(UPLOADS_DIR, item.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  templates = templates.filter(t => t.id !== id);
  writeTemplates(templates);

  res.json({ message: '删除成功' });
});

// 错误处理（multer 文件类型/大小错误）
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ message: '文件超过 50MB 限制' });
  }
  if (err) return res.status(400).json({ message: err.message });
  next();
});

module.exports = router;
