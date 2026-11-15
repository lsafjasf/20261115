import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = 8791;

const server = spawn("python3", ["-m", "http.server", String(port)], {
  cwd: root,
  stdio: "ignore",
});

for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 120));
  try {
    const res = await fetch(`http://127.0.0.1:${port}/app/index.html`);
    if (res.ok) break;
  } catch {}
}

process.env.TEST_BASE = `http://127.0.0.1:${port}`;

try {
  await import("./debug-data.mjs");
  await import("./smoke.mjs");
  await import("./e2e.mjs");
  await import("./export-check.mjs");
  console.log("\n🎉 全部测试通过");
} finally {
  server.kill();
}
