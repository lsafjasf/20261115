// 本地静态服务器：ES 模块需通过 http(s) 加载，不能直接用 file:// 打开。
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};

const PORT = process.env.PORT || 8123;
const root = process.cwd();

createServer(async (req, res) => {
  const urlPath = req.url.split("?")[0];
  const rel = normalize(urlPath === "/" ? "/index.html" : urlPath).replace(/^(\.\.[/\\])+/, "");
  try {
    const data = await readFile(join(root, rel));
    res.writeHead(200, { "Content-Type": MIME[extname(rel)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 Not Found");
  }
}).listen(PORT, () => {
  console.log(`草原邮航已启动: http://127.0.0.1:${PORT}/`);
});
