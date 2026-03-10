const express        = require('express');
const router         = express.Router();
const fs             = require('fs');
const path           = require('path');
const authMiddleware = require('../middleware/auth');

const DESIGNS_FILE = path.join(__dirname, '../data/designs.json');

function readDesigns() {
  if (!fs.existsSync(DESIGNS_FILE)) return [];
  return JSON.parse(fs.readFileSync(DESIGNS_FILE, 'utf-8'));
}
function writeDesigns(list) {
  fs.writeFileSync(DESIGNS_FILE, JSON.stringify(list, null, 2));
}

// POST /api/designs — 保存新设计
router.post('/', authMiddleware, (req, res) => {
  const { name, params, thumbnail } = req.body;
  if (!params || !params.shape) {
    return res.status(400).json({ message: '缺少必要的设计参数' });
  }

  const designs = readDesigns();
  const design = {
    id:        Date.now(),
    name:      name || `${params.shape}-${params.style}-设计`,
    creator:   req.user.username,
    createdAt: new Date().toISOString(),
    params,
    thumbnail: thumbnail || ''
  };
  designs.push(design);
  writeDesigns(designs);

  res.status(201).json({ message: '保存成功', design });
});

// GET /api/designs — 获取当前用户的所有设计
router.get('/', authMiddleware, (req, res) => {
  const designs = readDesigns();
  const list = designs
    .filter(d => d.creator === req.user.username)
    .sort((a, b) => b.id - a.id);
  res.json(list);
});

// GET /api/designs/:id — 获取单个设计
router.get('/:id', authMiddleware, (req, res) => {
  const designs = readDesigns();
  const design  = designs.find(d => d.id === Number(req.params.id) && d.creator === req.user.username);
  if (!design) return res.status(404).json({ message: '设计不存在' });
  res.json(design);
});

// PUT /api/designs/:id — 更新设计
router.put('/:id', authMiddleware, (req, res) => {
  let designs   = readDesigns();
  const idx     = designs.findIndex(d => d.id === Number(req.params.id) && d.creator === req.user.username);
  if (idx === -1) return res.status(404).json({ message: '设计不存在' });

  const { name, params, thumbnail } = req.body;
  if (name)      designs[idx].name      = name;
  if (params)    designs[idx].params    = params;
  if (thumbnail) designs[idx].thumbnail = thumbnail;
  designs[idx].updatedAt = new Date().toISOString();

  writeDesigns(designs);
  res.json({ message: '更新成功', design: designs[idx] });
});

// DELETE /api/designs/:id — 删除设计
router.delete('/:id', authMiddleware, (req, res) => {
  let designs = readDesigns();
  const item  = designs.find(d => d.id === Number(req.params.id) && d.creator === req.user.username);
  if (!item) return res.status(404).json({ message: '设计不存在' });

  designs = designs.filter(d => d.id !== Number(req.params.id));
  writeDesigns(designs);
  res.json({ message: '删除成功' });
});

module.exports = router;
