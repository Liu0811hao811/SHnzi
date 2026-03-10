const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const BASE_DIR = __dirname;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'text/javascript',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
};

const routes = {
  '/ai': 'ai-chat.html',
};

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const mapped = routes[urlPath];
  let filePath = path.join(BASE_DIR, mapped || (urlPath === '/' ? 'index.html' : urlPath));
  const ext = path.extname(filePath);
  const contentType = mimeTypes[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`服务器已启动：http://localhost:${PORT}`);
});
