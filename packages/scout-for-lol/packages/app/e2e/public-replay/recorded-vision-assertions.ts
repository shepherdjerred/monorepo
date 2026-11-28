import { expect, type Page, type TestInfo } from "@playwright/test";
import {
  expectChampionOverhead,
  verifyOverheadTeamVision,
} from "./proof/champion-overhead.ts";
import { readRecordedDraw } from "./recorded-draw-probe.ts";
import { replayPath, type readRecordedReplay } from "./recorded-replay-data.ts";
import { seek } from "./recorded-replay-fixture.ts";
import { centerMinimapOn, drawsNear } from "./recorded-world-assertions.ts";

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

async function verifyCurrentTeamVision(
  page: Page,
  testInfo: TestInfo,
  replayFile: string,
) {
  const vision = page.getByRole("combobox", { name: "Unit visibility" });
  const heimerdinger = [1_073_742_161, 16_356] as const;
  const illaoi = [1_073_742_166, 43_938] as const;
  await page.getByRole("combobox", { name: "Camera" }).selectOption("free");
  await seek(page, 32.8);
  await vision.selectOption("red");
  await expect(vision).toHaveValue("red");
  await expectActor(page, heimerdinger, false);
  await expectActor(page, illaoi, true);
  if (expectChampionOverhead) await verifyOverheadTeamVision(page, replayFile);
  await seek(page, 33);
  await expectActor(page, heimerdinger, true);
  await seek(page, 32.8);
  await expectActor(page, heimerdinger, false);
  await seek(page, 0);
  await expectActor(page, heimerdinger, false);
  await expectActor(page, illaoi, true);
  await vision.selectOption("blue");
  await expectActor(page, heimerdinger, true);
  await expectActor(page, illaoi, false);
  await seek(page, 33);
  await expectActor(page, illaoi, true);
  await seek(page, 33.1);
  await expectActor(page, illaoi, false);
  await page.getByLabel("League of Legends replay scene").screenshot({
    path: testInfo.outputPath("recorded-current-blue-unit-visibility.png"),
  });
  await vision.selectOption("all");
  await expectActor(page, heimerdinger, true);
  await expectActor(page, illaoi, true);
}

async function verifyCurrentLaneVision(page: Page, testInfo: TestInfo) {
  const minimap = page.getByRole("button", { name: "Replay minimap" });
  const minion = minimap.locator('[data-map-actor-id="1073841830"]');
  const vision = page.getByRole("combobox", { name: "Unit visibility" });
  const before = [7576.406, 7577.933] as const;
  const after = [7543.13, 7548.69] as const;
  await seek(page, 2089.2);
  await centerMinimapOn(minimap, before);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  for (const [side, time, position, visible, evidence] of [
    ["red", 2089.2, before, true, "red-before"],
    ["blue", 2089.2, before, false, "blue-before"],
    ["blue", 2089.3, after, true, "blue-after"],
    ["blue", 2089.2, before, false, "blue-rewound"],
  ] as const) {
    await vision.selectOption(side);
    await seek(page, time);
    await expect(minion).toHaveCount(visible ? 1 : 0);
    await expect.poll(() => drawsNear(page, 3669, position)).toBe(visible);
    await page.getByLabel("League of Legends replay scene").screenshot({
      path: testInfo.outputPath(`recorded-lane-vision-${evidence}.png`),
    });
  }
  await vision.selectOption("all");
}

export async function verifyRecordedTeamVision(
  page: Page,
  testInfo: TestInfo,
  fixture: Awaited<ReturnType<typeof readRecordedReplay>>,
) {
  if (fixture.descriptor.gameBuild === "16.23.841.8428") {
    await verifyCurrentTeamVision(page, testInfo, fixture.roflPath);
    if (fixture.directLaneModels !== undefined)
      await verifyCurrentLaneVision(page, testInfo);
    return;
  }
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
