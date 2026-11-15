import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = join(new URL('..', import.meta.url).pathname);
const port = Number(process.env.PORT) || 4321;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const filePath = normalize(join(root, urlPath === '/' ? 'index.html' : urlPath));
  if (!filePath.startsWith(root)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': types[extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => {
  console.log(`star canvas served at http://localhost:${port}`);
});
