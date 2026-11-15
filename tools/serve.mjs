import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = process.cwd();
const port = Number(process.env.PORT || 8137);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webm': 'video/webm',
  '.json': 'application/json',
};

createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
    const filePath = join(root, safe === '/' ? 'index.html' : safe);
    const data = await readFile(filePath);
    res.writeHead(200, {
      'content-type': types[extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-store, max-age=0',
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`serving ${root} at http://127.0.0.1:${port}`);
});
