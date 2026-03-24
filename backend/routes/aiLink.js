const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const jwt     = require('jsonwebtoken');

const SECRET      = process.env.JWT_SECRET || 'shanzi_jwt_secret_2026';
const TOKENS_FILE = path.join(__dirname, '../data/ai-tokens.json');
const EXTEND_COUNT = 10;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

function readTokens() {
  if (!fs.existsSync(TOKENS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8')); }
  catch { return []; }
}

function writeTokens(list) {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(list, null, 2));
}

function cleanExpired(list) {
  // 只清理时间模式下已过期的条目；次数模式不受时间过期影响
  return list.filter(t => {
    if (t.limitType === 'count') return true;
    return new Date(t.expiresAt).getTime() > Date.now();
  });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ message: '未登录' });
  try {
    req.user = jwt.verify(header.replace('Bearer ', ''), SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'token 已失效，请重新登录' });
  }
}

// ─── GET /api/ai-link/list ────────────────────────────────────────────
router.get('/list', authMiddleware, (req, res) => {
  const list = readTokens();
  const now  = Date.now();
  const records = list
    .filter(t => t.userId === req.user.username)
    .map(t => {
      const isCount = t.limitType === 'count';
      return {
        token:            t.token,
        username:         t.username || t.userId,
        createdAt:        t.createdAt,
        expiresAt:        t.expiresAt,
        limitType:        t.limitType || 'time',
        limitValue:       t.limitValue,
        remainingCount:   isCount ? (t.remainingCount ?? 0) : undefined,
        remainingSeconds: isCount ? undefined
          : Math.max(0, Math.round((new Date(t.expiresAt).getTime() - now) / 1000)),
        link: `${FRONTEND_URL}/ai?token=${t.token}`,
      };
    });
  res.json(records);
});

// ─── POST /api/ai-link/generate ──────────────────────────────────────
router.post('/generate', authMiddleware, (req, res) => {
  const { username, limitType, limitValue } = req.body;
  const type  = limitType === 'count' ? 'count' : 'time';
  const value = parseInt(limitValue, 10);
  if (!value || value <= 0) {
    return res.status(400).json({ message: '请选择有效的限制值' });
  }

  let list = cleanExpired(readTokens());

  const token = crypto.randomBytes(24).toString('hex');
  const now   = new Date();
  // 时间模式：expiresAt = now + value 分钟
  // 次数模式：expiresAt = 1 年后（不依赖时间过期）
  const expiresAt = type === 'time'
    ? new Date(now.getTime() + value * 60 * 1000)
    : new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  const entry = {
    token,
    userId:    req.user.username,
    username:  username || req.user.username,
    limitType:  type,
    limitValue: value,
    createdAt:  now.toISOString(),
    expiresAt:  expiresAt.toISOString(),
  };
  if (type === 'count') entry.remainingCount = value;

  list.push(entry);
  writeTokens(list);

  res.json({
    token,
    expiresAt:        expiresAt.toISOString(),
    limitType:        type,
    limitValue:       value,
    remainingSeconds: type === 'time' ? value * 60 : undefined,
    remainingCount:   type === 'count' ? value : undefined,
    link:             `${FRONTEND_URL}/ai?token=${token}`,
  });
});

// ─── GET /api/ai-link/verify/:token ──────────────────────────────────
router.get('/verify/:token', (req, res) => {
  const list  = readTokens();
  const entry = list.find(t => t.token === req.params.token);

  if (!entry) {
    return res.status(404).json({ valid: false, message: '链接不存在或已失效' });
  }

  const isCount = entry.limitType === 'count';

  if (!isCount) {
    const remaining = Math.round((new Date(entry.expiresAt).getTime() - Date.now()) / 1000);
    if (remaining <= 0) {
      return res.status(410).json({ valid: false, message: '链接已过期' });
    }
    return res.json({
      valid:            true,
      userId:           entry.userId,
      expiresAt:        entry.expiresAt,
      limitType:        'time',
      limitValue:       entry.limitValue,
      remainingSeconds: remaining,
    });
  }

  // 次数模式
  return res.json({
    valid:          true,
    userId:         entry.userId,
    expiresAt:      entry.expiresAt,
    limitType:      'count',
    limitValue:     entry.limitValue,
    remainingCount: entry.remainingCount ?? 0,
  });
});

// ─── POST /api/ai-link/:token/consume ────────────────────────────────
// 消耗一次对话次数（次数模式，无需登录）
router.post('/:token/consume', (req, res) => {
  let list = readTokens();
  const idx = list.findIndex(t => t.token === req.params.token);
  if (idx === -1) {
    return res.status(404).json({ message: '链接不存在' });
  }
  const entry = list[idx];
  if (entry.limitType !== 'count') {
    return res.status(400).json({ message: '该链接不是次数限制类型' });
  }
  if ((entry.remainingCount ?? 0) <= 0) {
    return res.json({ remainingCount: 0, exhausted: true, allowed: false });
  }
  const newCount = entry.remainingCount - 1;
  list[idx] = { ...entry, remainingCount: newCount };
  writeTokens(list);
  return res.json({ remainingCount: newCount, exhausted: newCount === 0, allowed: true });
});

// ─── PATCH /api/ai-link/:token/extend ────────────────────────────────
// 时间模式：延长时间；次数模式：增加次数
router.patch('/:token/extend', authMiddleware, (req, res) => {
  let list = readTokens();
  const idx = list.findIndex(
    t => t.token === req.params.token && t.userId === req.user.username
  );
  if (idx === -1) {
    return res.status(404).json({ message: '链接不存在或无权限操作' });
  }

  const { extendType, extendValue } = req.body;
  const type  = extendType === 'count' ? 'count' : 'time';
  const value = parseInt(extendValue, 10);
  if (!value || value <= 0) {
    return res.status(400).json({ message: '请选择有效的充值数量' });
  }

  const entry = list[idx];

  if (type === 'count') {
    const newCount = (entry.remainingCount ?? 0) + value;
    list[idx] = { ...entry, remainingCount: newCount };
    writeTokens(list);
    return res.json({ limitType: 'count', remainingCount: newCount });
  }

  const base         = Math.max(Date.now(), new Date(entry.expiresAt).getTime());
  const newExpiresAt = new Date(base + value * 60 * 1000);
  list[idx] = { ...entry, expiresAt: newExpiresAt.toISOString() };
  writeTokens(list);
  return res.json({
    limitType:        'time',
    expiresAt:        newExpiresAt.toISOString(),
    remainingSeconds: Math.round((newExpiresAt.getTime() - Date.now()) / 1000),
  });
});

// ─── DELETE /api/ai-link/:token ───────────────────────────────────────
router.delete('/:token', authMiddleware, (req, res) => {
  let list = readTokens();
  const idx = list.findIndex(
    t => t.token === req.params.token && t.userId === req.user.username
  );
  if (idx === -1) {
    return res.status(404).json({ message: '链接不存在或无权限删除' });
  }
  list.splice(idx, 1);
  writeTokens(list);
  res.json({ message: '链接已删除' });
});

module.exports = router;
