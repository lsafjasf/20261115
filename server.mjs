import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";

const port = Number(process.env.PORT || 4173);
const root = import.meta.dirname;
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

createServer((request, response) => {
  const requested = decodeURIComponent(request.url.split("?")[0]);
  const safePath = normalize(requested).replace(/^\/+/, "");
  const file = join(root, safePath || "index.html");

  if (file !== root && !file.startsWith(`${root}${sep}`)) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  if (!existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": types[extname(file)] || "application/octet-stream",
  });
  createReadStream(file).pipe(response);
}).listen(port, () => {
  console.log(`Suspended Studio running at http://localhost:${port}`);
});
