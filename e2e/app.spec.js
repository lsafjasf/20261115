import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

test("terrain updates, flag stays fixed, exports and comparison work", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");
  await expect(page.locator("#peak-value")).not.toHaveText("—");
  await expect(page.locator("#land-value")).not.toHaveText("—");
  await expect(page.locator("#flag-count")).toHaveText("0");
  const initialPeak = await page.locator("#peak-value").innerText();
  const initialLand = await page.locator("#land-value").innerText();
  await page.screenshot({ path: "artifacts/ui-home.png" });

  await page.click("#open-compare");
  await expect(page.locator("#compare-dialog")).toBeVisible();
  await expect(page.locator("#compare-summary")).toContainText("Seed B");
  const seedAPeak = await page.locator("#compare-peak-a").innerText();
  const seedBPeak = await page.locator("#compare-peak-b").innerText();
  expect(seedAPeak).not.toBe(seedBPeak);
  await page.screenshot({ path: "artifacts/seed-comparison.png" });
  await page.click(".dialog-close");
  await expect(page.locator("#compare-dialog")).not.toBeVisible();

  await page.mouse.click(790, 430, { button: "right" });
  await expect(page.locator("#flag-count")).toHaveText("1");
  await expect(page.locator(".flag-item")).toHaveCount(1);
  const fixedCoordinate = await page.locator(".flag-copy small").innerText();
  const fixedStatus = await page.locator(".flag-status").innerText();
  expect(fixedStatus).toBe("陆地");
  await page.screenshot({ path: "artifacts/ui-flag-before-water.png" });

  await setRange(page, "#sea-level", 0.7);
  await expect(page.locator("#water-value")).toHaveText("630");
  await expect(page.locator(".flag-copy small")).toHaveText(fixedCoordinate);
  await expect(page.locator(".flag-status")).toHaveText("水下");
  const floodedLand = await page.locator("#land-value").innerText();
  expect(Number(floodedLand)).toBeLessThan(Number(initialLand));

  await setRange(page, "#frequency", 3.7);
  await expect(page.locator("#frequency-value")).toHaveText("3.70");
  await page.waitForTimeout(250);
  expect(await page.locator("#peak-value").innerText()).not.toBe(initialPeak);
  await expect(page.locator(".flag-copy small")).toHaveText(fixedCoordinate);
  await page.screenshot({ path: "artifacts/ui-flag-water.png" });

  const jsonDownloadPromise = page.waitForEvent("download");
  await page.click("#export-json");
  const jsonDownload = await jsonDownloadPromise;
  const jsonPath = await jsonDownload.path();
  await jsonDownload.saveAs("artifacts/exported-params.json");
  const payload = JSON.parse(await readFile(jsonPath, "utf8"));
  expect(payload.flags).toHaveLength(1);
  const exportedCoordinate = payload.flags[0].world;
  expect(fixedCoordinate).toContain(`X ${Math.round(exportedCoordinate.x) >= 0 ? "+" : ""}${Math.round(exportedCoordinate.x)}`);
  expect(fixedCoordinate).toContain(`Y ${Math.round(exportedCoordinate.y)}`);
  expect(fixedCoordinate).toContain(`Z ${Math.round(exportedCoordinate.z) >= 0 ? "+" : ""}${Math.round(exportedCoordinate.z)}`);
  expect(payload.params.frequency).toBe(3.7);
  expect(payload.params.seaLevel).toBe(0.7);
  expect(payload.world.gridSize).toBe(160);
  expect(payload.world.waterSurface).toBe("flat");

  const pngDownloadPromise = page.waitForEvent("download");
  await page.click("#export-png");
  const pngDownload = await pngDownloadPromise;
  const pngPath = await pngDownload.path();
  await pngDownload.saveAs("artifacts/exported-map.png");
  const png = await readFile(pngPath);
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.length).toBeGreaterThan(100_000);

  await page.click("#open-compare");
  await expect(page.locator("#compare-dialog")).toBeVisible();
  await expect(page.locator("#compare-summary")).toContainText("Seed B");
  const mapIsDrawn = await page.locator("#compare-canvas-a").evaluate((canvas) => {
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0;
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] > 0) colored += 1;
    }
    return colored > 1000;
  });
  expect(mapIsDrawn).toBe(true);
  await page.screenshot({ path: "artifacts/ui-compare.png" });

  expect(Number(initialPeak)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
