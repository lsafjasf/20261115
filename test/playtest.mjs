import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexUrl = "file://" + path.resolve(__dirname, "..", "index.html");

async function launch() {
  const browser = await chromium.launch({
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.on("pageerror", (err) => console.error("[pageerror]", err.message));
  await page.goto(indexUrl);
  await page.waitForFunction(() => window.GAME);
  return { browser, page };
}

const snap = (page) => page.evaluate(() => window.GAME.snapshot());

async function testTopple() {
  console.log("== 测试1：高速急转导致行李倒塌 ==");
  const { browser, page } = await launch();
  await page.evaluate(() => {
    GAME.setTimeScale(4);
    GAME.start();
    GAME.teleport(450, 320, 0);
    GAME.debugLoad(3);
  });
  // 全速前进
  await page.evaluate(() => GAME.setInput({ up: true }));
  await page.waitForFunction(
    () => window.GAME.snapshot().cart.speed > 150,
    undefined,
    { timeout: 15000 }
  );
  const before = await snap(page);
  console.log(`  急转前: 速度=${before.cart.speed.toFixed(0)} 车载=${before.cart.load}`);
  // 急转
  await page.evaluate(() => GAME.setInput({ left: true }));
  await page.waitForFunction(
    () => window.GAME.snapshot().events.includes("topple"),
    undefined,
    { timeout: 10000 }
  );
  const after = await snap(page);
  console.log(`  倒塌后: 车载=${after.cart.load} 事件=${after.events.join(",")}`);
  console.log(`  音频日志: ${after.audioLog.join(",")}`);
  if (after.cart.load >= before.cart.load) throw new Error("行李未掉落");
  if (!after.audioLog.includes("topple")) throw new Error("缺少倒塌音效");
  console.log("  ✅ 急转导致行李倒塌，掉落音效已触发");
  await browser.close();
}

// 注入页面内的自动驾驶：每个物理步执行，无控制延迟
function installAutopilot() {
  const DOOR_Y = [130, 330, 530];
  const norm = (a) => {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  };
  window.GAME_HOOK = () => {
    const s = GAME.state;
    const c = s.cart;
    const input = GAME.input;
    input.up = input.down = input.left = input.right = false;
    if (s.phase !== "playing") return;
    const alive = (id) => !s.trains[id].departed;
    const onCart = s.luggage.filter((l) => l.status === "cart" && alive(l.train));
    let target = null;
    if (onCart.length > 0) {
      if (onCart.length < 2) {
        const extra = s.luggage.find(
          (l) => l.status === "ground" && alive(l.train) && l.train === onCart[0].train
        );
        if (extra) target = { x: extra.x, y: extra.y };
      }
      if (!target) {
        const t = onCart
          .map((l) => l.train)
          .sort((a, b) => s.trains[a].departAt - s.trains[b].departAt)[0];
        target = { x: 835, y: DOOR_Y[t] };
      }
    } else {
      const ground = s.luggage.filter((l) => l.status === "ground" && alive(l.train));
      if (ground.length === 0) return;
      ground.sort(
        (a, b) =>
          s.trains[a.train].departAt - s.trains[b.train].departAt ||
          Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y)
      );
      target = { x: ground[0].x, y: ground[0].y };
    }
    let dx = target.x - c.x;
    let dy = target.y - c.y;
    const dist = Math.hypot(dx, dy);
    let repel = 0;
    for (const p of s.passengers) {
      const fx = p.x + p.vx * 1.5 - c.x;
      const fy = p.y + p.vy * 1.5 - c.y;
      const pd = Math.hypot(fx, fy);
      if (pd > 190) continue;
      const w = ((190 - pd) / 190) * 420;
      dx -= (fx / (pd || 1)) * w;
      dy -= (fy / (pd || 1)) * w;
      repel = Math.max(repel, (190 - pd) / 190);
    }
    if (c.x < 90) dx += (90 - c.x) * 5;
    if (c.y < 90) dy += (90 - c.y) * 5;
    if (c.y > 550) dy -= (c.y - 550) * 5;
    const diff = norm(Math.atan2(dy, dx) - c.angle);
    let limit = c.load.length >= 3 ? 90 : c.load.length === 2 ? 120 : 110;
    if (repel > 0.3) limit = Math.min(limit, 80);
    const nearCorridor =
      Math.abs(c.y - 230) < 45 || Math.abs(c.y - 430) < 45 ||
      (Math.abs(c.x - 420) < 45 && c.y > 60 && c.y < 600) ||
      (Math.abs(c.x - 620) < 45 && c.y > 60 && c.y < 600);
    if (nearCorridor) limit = Math.min(limit, 65);
    if (Math.abs(diff) > 2.0) limit = Math.min(limit, 25);
    if (dist < 80) limit = Math.min(limit, 55);
    if (c.speed > limit && c.speed > 5) input.down = true;
    else input.up = true;
    if (diff > 0.12) input.right = true;
    else if (diff < -0.12) input.left = true;
  };
}

async function testFullRound(seed) {
  console.log(`== 测试2：自动驾驶完成一整局 (seed=${seed}) ==`);
  const { browser, page } = await launch();
  await page.evaluate(installAutopilot);
  await page.evaluate((s) => {
    GAME.setTimeScale(3);
    GAME.start(s);
  }, seed);
  await page.waitForFunction(
    () => window.GAME.snapshot().phase !== "playing",
    undefined,
    { timeout: 120000, polling: 200 }
  );
  const s = await snap(page);
  console.log(`  终局: phase=${s.phase} 送达=${s.delivered}/5 错过=${s.missed} 撞人=${s.hits} 用时=${s.time.toFixed(1)}s`);
  console.log(`  音频日志: ${[...new Set(s.audioLog)].join(",")}`);
  await page.screenshot({ path: path.resolve(__dirname, "final-round.png") });
  if (s.phase !== "won") throw new Error(`未获胜: ${s.phase} (${s.delivered}/5)`);
  if (s.delivered !== 5) throw new Error("未送完全部 5 件行李");
  if (s.hits >= 3) throw new Error("撞人过多");
  if (!s.audioLog.includes("announce")) throw new Error("缺少广播提示音");
  if (!s.audioLog.includes("deliver")) throw new Error("缺少交付音效");
  console.log("  ✅ 完整一局：5 件行李全部准点送达，广播与音效正常");
  await browser.close();
}

const [, , testName] = process.argv;
try {
  if (!testName || testName === "topple") await testTopple();
  if (!testName || testName === "round") await testFullRound(Number(process.argv[3] ?? 2));
  if (testName === "sweep") {
    for (const seed of [1, 2, 3, 4, 5]) await testFullRound(seed);
  }
} catch (err) {
  console.error("❌ 测试失败:", err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
}
