import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.PORT) || 4391;
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webm": "video/webm",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host}`);
    const pathname = decodeURIComponent(requestUrl.pathname);
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const target = normalize(join(root, relative));
    if (!target.startsWith(`${root}/`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const info = await stat(target);
    if (!info.isFile()) throw new Error("Not a file");
    const data = await readFile(target);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(target)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(data);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Sync studio: http://127.0.0.1:${port}`);
});
