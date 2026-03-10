const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

// ── 加载 .env 文件（无需 dotenv，已有 fs / path）──────────────────────
// 规则：.env 中的值不覆盖已存在的环境变量（命令行 > .env）
(function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;   // 跳过空行和注释
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) return;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  });
})();

const authRoutes      = require('./routes/auth');
const statsRoutes     = require('./routes/stats');
const templatesRoutes = require('./routes/templates');
const designsRoutes   = require('./routes/designs');
const aiLinkRoutes    = require('./routes/aiLink');
const imageGenRoutes  = require('./routes/imageGen');

const app  = express();
const PORT = 5000;

// 确保数据目录存在
const dataDir    = path.join(__dirname, 'data');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(dataDir))    fs.mkdirSync(dataDir,    { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// 初始化数据文件
const usersFile     = path.join(dataDir, 'users.json');
const templatesFile = path.join(dataDir, 'templates.json');
const designsFile    = path.join(dataDir, 'designs.json');
const aiTokensFile   = path.join(dataDir, 'ai-tokens.json');
if (!fs.existsSync(usersFile))     fs.writeFileSync(usersFile,     '[]');
if (!fs.existsSync(templatesFile)) fs.writeFileSync(templatesFile, '[]');
if (!fs.existsSync(designsFile))   fs.writeFileSync(designsFile,   '[]');
if (!fs.existsSync(aiTokensFile))  fs.writeFileSync(aiTokensFile,  '[]');

app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',  // Vite 开发服务器
    'http://127.0.0.1:5173',
  ],
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// 静态文件（上传的模板）
app.use('/uploads', express.static(uploadsDir));

// 路由
app.use('/api/auth',      authRoutes);
app.use('/api/stats',     statsRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/designs',   designsRoutes);
app.use('/api/ai-link',   aiLinkRoutes);
app.use('/api/image',     imageGenRoutes);

// 健康检查
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`后端服务已启动：http://localhost:${PORT}`);
});
