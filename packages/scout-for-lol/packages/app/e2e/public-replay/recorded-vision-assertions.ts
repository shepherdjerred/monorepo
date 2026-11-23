import { expect, type Page, type TestInfo } from "@playwright/test";
import { readRecordedDraw } from "./recorded-draw-probe.ts";
import { replayPath } from "./recorded-replay-data.ts";
import { seek } from "./recorded-replay-fixture.ts";

async function expectActor(
  page: Page,
  [context, indexCount]: readonly [number, number],
  visible: boolean,
) {
  const minimap = page.getByRole("button", { name: "Replay minimap" });
  await expect(
    minimap.locator(`[data-map-actor-id="${String(context)}"]`),
  ).toHaveCount(visible ? 1 : 0);
  const draw = await readRecordedDraw(page);
  expect(draw.actorIndexCounts.includes(indexCount)).toBe(visible);
}

export async function verifyRecordedTeamVision(page: Page, testInfo: TestInfo) {
  const vision = page.getByRole("combobox", { name: "Unit visibility" });
  await page.goto(`${replayPath}?t=33&perspective=red`);
  await expect(vision).toHaveValue("red");
  const camera = page.getByRole("combobox", { name: "Camera" });
  const sion = [1_073_742_164, 29_280] as const;
  const galio = [1_073_742_170, 32_742] as const;
  await expectActor(page, sion, false);
  await expectActor(page, galio, true);
  const overview = await readRecordedDraw(page);
  await camera.selectOption(`player:${String(sion[0])}`);
  const hidden = await readRecordedDraw(page);
  expect(hidden.viewProjection).toEqual(overview.viewProjection);
  await seek(page, 33.1);
  await expectActor(page, sion, true);
  const followed = await readRecordedDraw(page);
  expect(followed.viewProjection).not.toEqual(overview.viewProjection);
  await seek(page, 37.8);
  await expectActor(page, sion, false);
  const lost = await readRecordedDraw(page);
  expect(lost.viewProjection).toEqual(overview.viewProjection);
  await seek(page, 33.1);
  await expectActor(page, sion, true);

  await camera.selectOption("free");
  await vision.selectOption("blue");
  await seek(page, 34.5);
  await expectActor(page, galio, false);
  await expectActor(page, sion, true);
  await seek(page, 34.6);
  await expectActor(page, galio, true);
  await seek(page, 35.8);
  await expectActor(page, galio, false);
  await page.getByLabel("League of Legends replay scene").screenshot({
    path: testInfo.outputPath("recorded-blue-unit-visibility.png"),
  });

  await vision.selectOption("all");
  await expectActor(page, sion, true);
  await expectActor(page, galio, true);
  await page.getByLabel("League of Legends replay scene").screenshot({
    path: testInfo.outputPath("recorded-all-unit-visibility.png"),
  });
}
