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
const materialsRoutes = require('./routes/materials');
const settingsRoutes  = require('./routes/settings');

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
const materialsFile  = path.join(dataDir, 'materials.json');
const settingsFile   = path.join(dataDir, 'settings.json');
if (!fs.existsSync(usersFile))     fs.writeFileSync(usersFile,     '[]');
if (!fs.existsSync(templatesFile)) fs.writeFileSync(templatesFile, '[]');
if (!fs.existsSync(designsFile))   fs.writeFileSync(designsFile,   '[]');
if (!fs.existsSync(aiTokensFile))  fs.writeFileSync(aiTokensFile,  '[]');
if (!fs.existsSync(materialsFile)) fs.writeFileSync(materialsFile, '[]');
if (!fs.existsSync(settingsFile))  fs.writeFileSync(settingsFile,  '{}');

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '50mb' }));

// 静态文件（上传的模板 + 素材仓库）— 明确设置 CORS 头，让 canvas crossOrigin 请求能读取像素
app.use(express.static(path.join(__dirname, '../frontend')));

app.use('/uploads', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  // no-transform 告知 nginx gzip 模块不压缩此响应，避免 Content-Length 不匹配导致图片丢失
  res.setHeader('Cache-Control', 'no-store, no-transform');
  next();
}, express.static(uploadsDir));

// 背景去除模型数据（供前端客户端抠图使用）
app.use('/bg-removal-data', express.static(
  path.join(__dirname, 'node_modules/@imgly/background-removal-data/dist')
));

// 路由
app.use('/api/auth',      authRoutes);
app.use('/api/stats',     statsRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/designs',   designsRoutes);
app.use('/api/ai-link',   aiLinkRoutes);
app.use('/api/image',     imageGenRoutes);
app.use('/api/materials', materialsRoutes);
app.use('/api/settings',  settingsRoutes);

// 健康检查
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`后端服务已启动：http://localhost:${PORT}`);
});
