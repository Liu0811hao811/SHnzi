const express  = require('express');
const router   = express.Router();
const fs       = require('fs');
const path     = require('path');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');

const SECRET       = process.env.JWT_SECRET || 'shanzi_jwt_secret_2026';
const USERS_FILE   = path.join(__dirname, '../data/users.json');

function readUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: '请填写账号和密码' });
  }
  if (!/^[\w]{3,20}$/.test(username)) {
    return res.status(400).json({ message: '账号须为 3~20 个字符，仅限字母、数字或下划线' });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: '密码至少需要 6 个字符' });
  }

  const users = readUsers();
  if (users.find(u => u.username === username)) {
    return res.status(409).json({ message: '该账号已被注册，请换一个' });
  }

  const hashed = await bcrypt.hash(password, 10);
  users.push({
    id:        Date.now(),
    username,
    password:  hashed,
    createdAt: new Date().toISOString()
  });
  writeUsers(users);

  res.json({ message: '注册成功' });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: '请填写账号和密码' });
  }

  const users = readUsers();
  const user  = users.find(u => u.username === username);

  if (!user) {
    return res.status(401).json({ message: '账号或密码错误' });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return res.status(401).json({ message: '账号或密码错误' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username },
    SECRET,
    { expiresIn: '7d' }
  );

  res.json({ token, username: user.username, message: '登录成功' });
});

module.exports = router;
