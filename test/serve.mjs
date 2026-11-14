import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
};

createServer(async (req, res) => {
  const rel = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  try {
    const data = await readFile(path.join(root, rel));
    res.writeHead(200, { 'Content-Type': mime[path.extname(rel)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(5173, '127.0.0.1', () => {
  console.log('预览地址: http://127.0.0.1:5173/');
});
