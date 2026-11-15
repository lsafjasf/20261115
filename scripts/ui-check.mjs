import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const errors = [];
await mkdir("artifacts", { recursive: true });

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
    });
  });
}

const port = Number(process.env.PORT || await freePort());
const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${port}`;
const server = process.env.BASE_URL ? null : spawn("node", ["scripts/serve.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"]
});

if (server) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Local server did not start")), 5000);
    server.stdout.once("data", () => {
      clearTimeout(timer);
      resolve();
    });
    server.once("error", reject);
  });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);

const fleetCount = await page.locator(".fleet-card").count();
const taskCount = await page.locator(".task-card").count();
if (fleetCount !== 5 || taskCount !== 3) {
  throw new Error(`Initial UI mismatch: fleet=${fleetCount}, tasks=${taskCount}`);
}

const firstTask = page.locator(".task-card").first();
const firstVehicle = page.locator(".fleet-card").first();
await firstTask.dragTo(firstVehicle);
await page.waitForTimeout(350);
const assignedTaskCount = await page.locator(".task-card").count();
const assignedVehicleState = await page.locator(".fleet-card").first().locator(".fleet-state").textContent();
if (assignedTaskCount !== 2 || !assignedVehicleState.includes("T-")) {
  throw new Error(`Drag assignment failed: tasks=${assignedTaskCount}, state=${assignedVehicleState}`);
}

const priorityCard = page.locator(".fleet-card").nth(3);
for (const kind of ["docking", "charging", "avoidance"]) {
  await priorityCard.locator(`[data-kind='${kind}'][data-value='2']`).click();
}
const activePriorities = await priorityCard.locator("[data-action='priority'].active").count();
if (activePriorities !== 3) throw new Error(`Priority controls did not all update: ${activePriorities}`);

await page.screenshot({ path: "artifacts/ui-gameplay.png", fullPage: true });

await page.locator("#successDemoBtn").click();
await page.evaluate(() => { window.__ringGame.state.speed = 32; });
await page.locator("#resultOverlay").waitFor({ state: "visible", timeout: 12000 });
const successTitle = await page.locator("#resultTitle").textContent();
const successReason = await page.locator("#resultReason").textContent();
const successResult = await page.evaluate(() => window.__ringGame.sim.result);
if (successTitle !== "任务成功") {
  throw new Error(`Success demo ended as ${successTitle}: ${successReason}`);
}
await page.screenshot({ path: "artifacts/success-result.png", fullPage: true });

await page.locator("#closeResultBtn").click();
await page.locator("#failureDemoBtn").click();
await page.evaluate(() => { window.__ringGame.state.speed = 32; });
await page.locator("#resultOverlay").waitFor({ state: "visible", timeout: 12000 });
const failureTitle = await page.locator("#resultTitle").textContent();
const failureReason = await page.locator("#resultReason").textContent();
const depletedText = await page.locator("#resultDepleted").textContent();
const failureResult = await page.evaluate(() => window.__ringGame.sim.result);
if (failureTitle !== "任务失败" || !failureReason.includes("电量耗尽")) {
  throw new Error(`Failure demo mismatch: ${failureTitle}, ${failureReason}`);
}
await page.screenshot({ path: "artifacts/battery-failure-result.png", fullPage: true });

if (errors.length) throw new Error(`Browser errors:\n${errors.join("\n")}`);

const summary = {
  fleetCount,
  taskCount,
  assignedTaskCount,
  assignedVehicleState: assignedVehicleState.trim(),
  activePriorities,
  success: { title: successTitle, result: successResult },
  failure: { title: failureTitle, result: failureResult, depletedLabel: depletedText },
  screenshots: [
    "artifacts/ui-gameplay.png",
    "artifacts/success-result.png",
    "artifacts/battery-failure-result.png"
  ]
};
await writeFile("artifacts/ui-verification.json", `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));

await browser.close();
if (server) server.kill();
