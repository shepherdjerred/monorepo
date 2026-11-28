import { expect, type Page, type TestInfo } from "@playwright/test";
import { readRecordedDraw } from "./recorded-draw-probe.ts";
import { seek } from "./recorded-replay-fixture.ts";

async function paletteAt(page: Page, seconds: number, indexCount: number) {
  await seek(page, seconds);
  const draw = await readRecordedDraw(page);
  return draw.animationPaletteDraws.find(
    (part) => part.indexCount === indexCount,
  )?.hash;
}

async function verifyLaterCue(
  page: Page,
  testInfo: TestInfo,
  cue: Readonly<{
    actor: string;
    indexCount: number;
    clocks: readonly [number, number];
    absentAt?: readonly [number, number];
    screenshot: string;
  }>,
) {
  await page
    .getByRole("combobox", { name: "Camera" })
    .selectOption(`player:${cue.actor}`);
  if (cue.absentAt !== undefined)
    expect(
      await paletteAt(page, cue.absentAt[0], cue.indexCount),
    ).toBeUndefined();
  const first = await paletteAt(page, cue.clocks[0], cue.indexCount);
  const later = await paletteAt(page, cue.clocks[1], cue.indexCount);
  expect(first).toBeDefined();
  expect(later).toBeDefined();
  expect(later).not.toBe(first);
  expect(await paletteAt(page, cue.clocks[0], cue.indexCount)).toBe(first);
  await page
    .getByLabel("League of Legends replay scene")
    .screenshot({ path: testInfo.outputPath(cue.screenshot) });
  if (cue.absentAt !== undefined)
    expect(
      await paletteAt(page, cue.absentAt[1], cue.indexCount),
    ).toBeUndefined();
}

async function verifyWukongPathFacing(page: Page) {
  async function wukongAt(seconds: number) {
    await seek(page, seconds);
    const draw = await readRecordedDraw(page);
    const index = draw.actorIndexCounts.indexOf(16_995);
    const [x, , z] = draw.actorOrigins[index] ?? [];
    const forwardX = draw.actorBases[index]?.[6];
    const forwardZ = draw.actorBases[index]?.[8];
    if (
      x === undefined ||
      z === undefined ||
      forwardX === undefined ||
      forwardZ === undefined
    )
      throw new Error("The browser did not draw Wukong's placement.");
    return { x, z, forwardX, forwardZ };
  }
  const first = await wukongAt(57.2);
  const next = await wukongAt(57.3);
  const dx = next.x - first.x;
  const dz = next.z - first.z;
  const distance = Math.hypot(dx, dz);
  expect(distance).toBeGreaterThan(1);
  expect(first.forwardX).toBeCloseTo(dx / distance, 3);
  expect(first.forwardZ).toBeCloseTo(dz / distance, 3);
  expect(await wukongAt(57.2)).toEqual(first);
}

export async function verifyRecordedChampionAnimation(
  page: Page,
  fixture: { current: boolean; long: boolean; cueCount: number },
  testInfo: TestInfo,
) {
  if (fixture.current) {
    expect([502, 1020]).toContain(fixture.cueCount);
    await verifyLaterCue(page, testInfo, {
      actor: "1073742167",
      indexCount: 16_995,
      clocks: [57.2, 57.8],
      screenshot: "recorded-current-wukong-action.png",
    });
    expect(await paletteAt(page, 58.3, 16_995)).toBeUndefined();
    if (fixture.cueCount === 1020) await verifyWukongPathFacing(page);
    await verifyLaterCue(page, testInfo, {
      actor: "1073742164",
      indexCount: 20_190,
      clocks: [864.1, 864.8],
      // The pinned native Reload window is 863.8930903320313–865.7300903320313.
      absentAt: [863.8, 865.8],
      screenshot: "recorded-current-jhin-reload.png",
    });
    if (fixture.cueCount === 1020) {
      await verifyLaterCue(page, testInfo, {
        actor: "1073742161",
        indexCount: 16_356,
        clocks: [1716.5, 1717],
        absentAt: [1716.3, 1717.8],
        screenshot: "recorded-current-heimer-winddown.png",
      });
      await verifyLaterCue(page, testInfo, {
        actor: "1073742162",
        indexCount: 40_497,
        clocks: [1718.1, 1718.4],
        absentAt: [1718, 1718.6],
        screenshot: "recorded-current-lee-cast.png",
      });
    }
    return;
  }
  const { long, cueCount } = fixture;
  const contexts = { wukong: "1073742167", jinx: "1073742169" };
  const target = long ? contexts.wukong : contexts.jinx;
  const indexCount = long ? 20_697 : 32_550;
  const [before, first, second, after] = long
    ? ([47.5, 47.8, 48.1, 48.6] as const)
    : ([1.4, 6.5, 9, 11.6] as const);
  const vision = page.getByRole("combobox", { name: "Unit visibility" });
  if (long) await vision.selectOption("all");
  await page
    .getByRole("combobox", { name: "Camera" })
    .selectOption(`player:${target}`);
  const canvas = page.getByLabel("League of Legends replay scene");
  await page.getByRole("button", { name: "Zoom in" }).click();

  expect(await paletteAt(page, before, indexCount)).toBeUndefined();
  const firstPose = await paletteAt(page, first, indexCount);
  expect(firstPose).toBeDefined();
  await canvas.screenshot({
    path: testInfo.outputPath("recorded-champion-animation-first.png"),
  });
  const secondPose = await paletteAt(page, second, indexCount);
  expect(secondPose).toBeDefined();
  expect(secondPose).not.toBe(firstPose);
  await canvas.screenshot({
    path: testInfo.outputPath("recorded-champion-animation-second.png"),
  });
  expect(await paletteAt(page, after, indexCount)).toBeUndefined();
  expect(await paletteAt(page, first, indexCount)).toBe(firstPose);
  if (cueCount > 1) {
    expect(cueCount).toBeGreaterThanOrEqual(275);
    await verifyLaterCue(page, testInfo, {
      actor: "1073742162",
      indexCount: 29_775,
      clocks: [1033.5, 1033.7],
      screenshot: "recorded-batch-warwick.png",
    });
    await verifyLaterCue(page, testInfo, {
      actor: "1073742170",
      indexCount: 32_742,
      clocks: [1708.3, 1708.6],
      screenshot: "recorded-batch-galio.png",
    });
  }
}
