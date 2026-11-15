import { expect, test } from "@playwright/test";

function trackCard(page, id) {
  return page.locator(`.track-card[data-track-id="${id}"]`);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("shows an eight-second scene with four independent track readouts", async ({ page }) => {
  await expect(page.locator("#totalDuration")).toHaveText("8.000s");
  await expect(page.locator(".track-card")).toHaveCount(4);

  const snapshot = await page.evaluate(() => window.sceneApp.getSnapshot());
  expect(snapshot.totalDurationMs).toBe(8000);
  expect(snapshot.tracks.map((track) => track.actualOffsetMs)).toEqual([0, 600, 1200, 1800]);
  expect(snapshot.tracks.map((track) => track.durationMs)).toEqual([6400, 5800, 4800, 3800]);

  await expect(trackCard(page, "air").locator("[data-role='offset']")).toContainText("0.600s");
  await expect(trackCard(page, "tide").locator("[data-role='peak']")).toContainText("dB");
});

test("moves one track by 120 ms and keeps audio, visual, and other tracks locked", async ({ page }) => {
  const before = await page.evaluate(() => window.sceneApp.getSnapshot());

  await trackCard(page, "air").locator("[data-action='delay-add']").click();
  const after = await page.evaluate(() => window.sceneApp.getSnapshot());
  const air = after.tracks.find((track) => track.id === "air");

  expect(air.delayMs).toBe(120);
  expect(air.actualOffsetMs).toBe(720);
  expect(air.firstAudioEventMs).toBe(720);
  expect(air.visualOffsetMs).toBe(720);
  expect(air.soundVisualAligned).toBe(true);
  await expect(trackCard(page, "air").locator("[data-role='offset']")).toContainText("0.720s");

  for (const id of ["ember", "tide", "prism"]) {
    const prior = before.tracks.find((track) => track.id === id);
    const current = after.tracks.find((track) => track.id === id);
    expect(current.actualOffsetMs).toBe(prior.actualOffsetMs);
    expect(current.firstAudioEventMs).toBe(prior.firstAudioEventMs);
    expect(current.visualOffsetMs).toBe(prior.visualOffsetMs);
  }

  await page.evaluate(() => window.sceneApp.seek(0.7));
  let frame = await page.evaluate(() => window.sceneApp.getSnapshot());
  expect(frame.tracks.find((track) => track.id === "air").visualEntered).toBe(false);

  await page.evaluate(() => window.sceneApp.seek(0.73));
  frame = await page.evaluate(() => window.sceneApp.getSnapshot());
  expect(frame.tracks.find((track) => track.id === "air").visualEntered).toBe(true);

  await page.evaluate(() => window.sceneApp.setDelay("air", 0));
  await page.getByRole("button", { name: "运行 +120ms 验证" }).click();
  await expect(page.locator("#verifyBadge")).toHaveText("PASS 3/3");
  await expect(page.locator("#verifyResults .verify-result-row")).toHaveCount(3);
  await expect(page.locator("#verifyResults")).toContainText("首音 720ms = 入场 720ms");
});

test("schedules the delayed audio onset at the same 720 ms offset", async ({ page }) => {
  await page.evaluate(() => window.sceneApp.setDelay("air", 120));
  await page.getByRole("button", { name: "播放" }).click();

  await expect.poll(async () => page.evaluate(() => window.sceneApp.getSnapshot().isPlaying)).toBe(true);
  const snapshot = await page.evaluate(() => window.sceneApp.getSnapshot());
  const air = snapshot.tracks.find((track) => track.id === "air");
  expect(snapshot.audioContextState).toBe("running");
  expect(snapshot.playbackAnchor.startPositionMs).toBe(0);
  expect(air.scheduledContextOffsetMs).toBe(720);
  expect(air.scheduledFirstEventMs).toBe(720);
  expect(air.actualOffsetMs).toBe(720);

  for (const id of ["ember", "tide", "prism"]) {
    const track = snapshot.tracks.find((item) => item.id === id);
    expect(track.scheduledFirstEventMs).toBe(track.actualOffsetMs);
  }
});

test("muting one track leaves the transport and every visual running", async ({ page }) => {
  await page.getByRole("button", { name: "播放" }).click();
  await page.waitForTimeout(2300);
  const before = await page.evaluate(() => window.sceneApp.getSnapshot());
  expect(before.isPlaying).toBe(true);

  const tideMute = trackCard(page, "tide").locator(".mute-button");
  await tideMute.click();
  await expect(tideMute).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(760);
  const after = await page.evaluate(() => window.sceneApp.getSnapshot());

  expect(after.isPlaying).toBe(true);
  expect(after.positionMs).toBeGreaterThan(before.positionMs + 500);
  expect(after.settings.muted.tide).toBe(true);
  for (const track of after.tracks) {
    const previous = before.tracks.find((item) => item.id === track.id);
    expect(track.visualLocalTimeMs).toBeGreaterThan(previous.visualLocalTimeMs);
  }
  expect(after.tracks.every((track) => track.visualEntered)).toBe(true);
  await expect(page.locator("#mutedCount")).toHaveText("1 / 4");
});

test("saves, restores, and reloads the project after a page refresh", async ({ page }) => {
  await trackCard(page, "air").locator("[data-action='delay-add']").click();
  await trackCard(page, "prism").locator(".mute-button").click();
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.locator("#projectState")).toContainText("已保存");

  await page.evaluate(() => window.sceneApp.setDelay("air", 40));
  await trackCard(page, "prism").locator(".mute-button").click();
  await page.getByRole("button", { name: "重新载入" }).click();
  let state = await page.evaluate(() => window.sceneApp.getSnapshot().settings);
  expect(state.delaysMs.air).toBe(120);
  expect(state.muted.prism).toBe(true);

  await page.reload();
  await expect(page.locator("#reloadButton")).toBeEnabled();
  await expect(page.locator("#projectState")).toContainText("上次保存");
  await page.locator("#reloadButton").click();
  state = await page.evaluate(() => window.sceneApp.getSnapshot().settings);
  expect(state.delaysMs.air).toBe(120);
  expect(state.muted.prism).toBe(true);
});
