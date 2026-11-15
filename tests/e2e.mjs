import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const report = {
  startedAt: new Date().toISOString(),
  checks: [],
  screenshots: [],
};
const check = (name, detail = {}) => {
  report.checks.push({ name, passed: true, ...detail });
  console.log(`PASS  ${name}`);
};
const wait = (page, ms) => page.waitForTimeout(ms);
const stateOf = (page) => page.evaluate(() => window.__lumen.getState());
const uiOf = (page) => page.evaluate(() => window.__lumen.getUi());
const shot = async (page, name) => {
  const path = `artifacts/${name}.png`;
  await page.screenshot({ path, fullPage: true });
  report.screenshots.push(path);
};

const port = 5299;
const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${port}`;
let server = null;
if (!process.env.BASE_URL) {
  server = spawn(process.execPath, ["server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") pageErrors.push(message.text());
});

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await wait(page, 350);
  const initial = await stateOf(page);
  assert.equal(await page.locator(".console-card").count(), 3);
  assert.equal(initial.roles.key.connected && initial.roles.rim.connected && initial.roles.gel.connected, true);
  check("三块独立控制器与共享光场初始接入");

  const beforeDual = await stateOf(page);
  await Promise.all([
    page.keyboard.down("s"),
    page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyK", key: "k", bubbles: true }));
    }),
  ]);
  await wait(page, 650);
  const duringDual = await stateOf(page);
  await Promise.all([
    page.keyboard.up("s"),
    page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyK", key: "k", bubbles: true }));
    }),
  ]);
  await wait(page, 200);
  const afterDual = await stateOf(page);
  assert.ok(afterDual.roles.key.intensity < beforeDual.roles.key.intensity - 8);
  assert.ok(afterDual.roles.rim.intensity < beforeDual.roles.rim.intensity - 8);
  assert.ok(afterDual.events.some((event) => event.label.includes("主光强度")));
  assert.ok(afterDual.events.some((event) => event.label.includes("轮廓强度")));
  check("两套键盘并发输入同时改变主光与轮廓", {
    key: [beforeDual.roles.key.intensity, Number(afterDual.roles.key.intensity.toFixed(1))],
    rim: [beforeDual.roles.rim.intensity, Number(afterDual.roles.rim.intensity.toFixed(1))],
  });
  const audioState = await page.evaluate(() => window.__lumen.getAudio());
  assert.equal(audioState.started, true);
  assert.ok(audioState.frequency > 0);
  check("Web Audio 已启动并由灯架状态驱动", audioState);

  await page.keyboard.press("p");
  const paused = await stateOf(page);
  const pausedUi = await uiOf(page);
  assert.equal(paused.paused, true);
  assert.equal(pausedUi.pauseOverlay, true);
  await page.keyboard.down("i");
  await wait(page, 500);
  await page.keyboard.up("i");
  const pausedAfterInput = await stateOf(page);
  assert.equal(pausedAfterInput.roles.rim.intensity, paused.roles.rim.intensity);
  assert.ok(Math.abs(pausedAfterInput.elapsed - paused.elapsed) < 0.12);
  check("暂停冻结光场、输入和计时器", {
    rimIntensity: paused.roles.rim.intensity,
    elapsed: paused.elapsed,
  });
  await shot(page, "validation-01-paused");
  await page.keyboard.press("p");
  assert.equal((await stateOf(page)).paused, false);

  await page.evaluate(() => {
    window.__lumen.setControl("key", "intensity", 100);
    window.__lumen.setControl("rim", "intensity", 100);
    window.__lumen.setControl("gel", "density", 100);
  });
  await wait(page, 450);
  const exposed = await stateOf(page);
  const exposedUi = await uiOf(page);
  assert.ok(exposed.exposure > 0.78);
  assert.equal(exposed.overexposed, true);
  assert.equal(exposedUi.exposureAlert, true);
  assert.ok(exposed.overexposureCount >= 1);
  check("亮度叠加触发过曝区与警报", {
    exposure: exposed.exposure,
    count: exposed.overexposureCount,
  });

  const wearBefore = (await stateOf(page)).roles.gel.wear;
  for (const color of ["rose", "cyan", "gold"]) {
    await page.evaluate((nextColor) => window.__lumen.selectGel(nextColor), color);
    await wait(page, 130);
  }
  const wearAfter = (await stateOf(page)).roles.gel.wear;
  assert.ok(wearAfter >= wearBefore + 15);
  check("连续热切色片累积机械磨损", { before: wearBefore, after: wearAfter });
  await shot(page, "validation-02-overexposed");

  const disconnectCases = [
    { role: "key", field: "intensity", code: "KeyW" },
    { role: "rim", field: "intensity", code: "KeyI" },
    { role: "gel", field: "density", code: "KeyE" },
  ];
  for (const item of disconnectCases) {
    const beforeDisconnect = await stateOf(page);
    await page.click(`[data-disconnect="${item.role}"]`);
    await wait(page, 100);
    const disconnectedUi = await uiOf(page);
    assert.match(disconnectedUi.statuses[item.role], /已断开/);
    await page.keyboard.down(item.code);
    await wait(page, 220);
    await page.keyboard.up(item.code);
    const held = await stateOf(page);
    assert.equal(held.roles[item.role][item.field], beforeDisconnect.roles[item.role][item.field]);
    assert.equal(held.roles[item.role].connected, false);
    await page.click(`[data-disconnect="${item.role}"]`);
    await wait(page, 100);
    assert.equal((await stateOf(page)).roles[item.role].connected, true);
    check(`${item.role} 控制器断开后保持最后光位且拒绝输入`);
  }

  const goalInputs = [
    {
      color: "amber",
      values: [["key", "intensity", 54], ["key", "pan", -12], ["rim", "intensity", 30], ["rim", "height", 58], ["gel", "density", 62]],
    },
    {
      color: "steel",
      values: [["key", "intensity", 42], ["key", "pan", 0], ["rim", "intensity", 68], ["rim", "height", 82], ["gel", "density", 52]],
    },
    {
      color: "rose",
      values: [["key", "intensity", 84], ["key", "pan", 42], ["rim", "intensity", 57], ["rim", "height", 52], ["gel", "density", 73]],
    },
    {
      color: "cyan",
      values: [["key", "intensity", 30], ["key", "pan", 10], ["rim", "intensity", 50], ["rim", "height", 35], ["gel", "density", 42]],
    },
    {
      color: "gold",
      values: [["key", "intensity", 68], ["key", "pan", -42], ["rim", "intensity", 68], ["rim", "height", 62], ["gel", "density", 78]],
    },
  ];

  for (let index = 0; index < goalInputs.length; index += 1) {
    const goal = goalInputs[index];
    await page.evaluate(({ color, values }) => {
      window.__lumen.selectGel(color);
      values.forEach(([role, field, value]) => window.__lumen.setControl(role, field, value));
    }, goal);
    await page.waitForFunction(
      (expected) => window.__lumen.getState().completedGoals.length >= expected,
      index + 1,
      { timeout: 3500 },
    );
    await wait(page, 120);
    const progress = await stateOf(page);
    assert.equal(progress.goalIndex, index + 1);
    assert.ok(progress.completedGoals.includes(index));
    check(`第 ${index + 1} 帧构图完成`, {
      completed: progress.completedGoals.length,
      next: progress.completed ? "已完成全部构图" : progress.goal,
      exposure: progress.exposure,
    });
  }

  await wait(page, 850);
  const finished = await stateOf(page);
  const finishedUi = await uiOf(page);
  assert.equal(finished.completed, true);
  assert.equal(finishedUi.completionOpen, true);
  assert.equal(await page.locator("#replayBtn").isEnabled(), true);
  assert.ok(finished.events.length >= 30);
  check("五帧完成并封存完整操作序列", {
    duration: finished.replayDuration,
    events: finished.events.length,
  });
  await shot(page, "validation-03-complete");

  await page.click("#startReplayBtn");
  await wait(page, 700);
  const replayStart = await stateOf(page);
  const replayUi = await uiOf(page);
  assert.equal(replayStart.replaying, true);
  assert.equal(replayUi.replayHud, true);
  assert.ok(replayStart.replayPosition > 0.3);
  await page.keyboard.press("p");
  const pausedPosition = (await stateOf(page)).replayPosition;
  const pausedReplayUi = await uiOf(page);
  assert.equal(pausedReplayUi.pauseOverlay, true);
  await wait(page, 650);
  const heldPosition = (await stateOf(page)).replayPosition;
  assert.equal(heldPosition, pausedPosition);
  check("回放可暂停且时间轴保持不动", {
    position: pausedPosition,
    duration: replayStart.replayDuration,
  });
  await shot(page, "validation-04-replay-paused");
  await page.keyboard.press("p");
  await wait(page, 550);
  const resumedReplay = await stateOf(page);
  assert.ok(resumedReplay.replayPosition > pausedPosition);
  assert.equal(resumedReplay.replayPaused, false);
  check("回放继续后时间轴恢复推进");

  await page.keyboard.press("r");
  await wait(page, 150);
  const exitedReplay = await stateOf(page);
  const exitedUi = await uiOf(page);
  assert.equal(exitedReplay.replaying, false);
  assert.equal(exitedUi.completionOpen, true);
  check("回放可退出并返回完成页");

  assert.deepEqual(pageErrors, []);
  check("浏览器控制台无运行时错误");
  report.finishedAt = new Date().toISOString();
  report.passed = true;
  await writeFile("artifacts/validation-report.json", JSON.stringify(report, null, 2));
  console.log(`\n${report.checks.length} checks passed.`);
} catch (error) {
  report.passed = false;
  report.error = error.stack || error.message;
  await writeFile("artifacts/validation-report.json", JSON.stringify(report, null, 2));
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  server?.kill("SIGTERM");
}
