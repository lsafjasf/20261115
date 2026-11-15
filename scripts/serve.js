// 零依赖静态服务器：node scripts/serve.js 后访问 http://localhost:8123/web/
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 8123;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.wav': 'audio/wav',
};

http.createServer((request, response) => {
  const urlPath = decodeURIComponent(new URL(request.url, `http://localhost`).pathname);
  const filePath = path.normalize(path.join(ROOT, urlPath === '/' ? 'web/index.html' : urlPath));
  if (!filePath.startsWith(ROOT)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  fs.stat(filePath, (statError, stats) => {
    if (statError) {
      response.writeHead(404);
      response.end('Not Found');
      return;
    }
    const resolved = stats.isDirectory() ? path.join(filePath, 'index.html') : filePath;
    fs.readFile(resolved, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end('Not Found');
      return;
    }
    response.writeHead(200, { 'Content-Type': MIME[path.extname(resolved)] || 'application/octet-stream' });
    response.end(data);
    });
  });
}).listen(PORT, () => {
  console.log(`字幕工作台已启动: http://localhost:${PORT}/web/`);
});
