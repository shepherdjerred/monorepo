import { expect, type Page, type TestInfo } from "@playwright/test";
import { replayPath } from "./recorded-replay-data.ts";
import { seek } from "./recorded-replay-fixture.ts";
import { centerMinimapOn, drawsNear } from "./recorded-world-assertions.ts";

const neutralModels = [
  "a5d58c0e0d186cdc8844a83f2862702f6b8e0cdf43e2ceb176f9ffa809874b24",
  "b7bcf8406c20e8317923a1dec8f0be17abe38fec5893e9bf410632233c90e822",
];

async function captureObjective(
  page: Page,
  position: readonly [number, number],
  path: string,
  zoomSteps = 2,
) {
  await centerMinimapOn(
    page.getByRole("button", { name: "Replay minimap" }),
    position,
  );
  const zoom = page.getByRole("button", { name: "Zoom in" });
  for (let step = 0; step < zoomSteps; step += 1) await zoom.click();
  await page.getByLabel("League of Legends replay scene").screenshot({ path });
}

export async function verifyRecordedNeutralObjectives(
  page: Page,
  paths: Iterable<string>,
  requested: Set<string>,
  testInfo: TestInfo,
) {
  const assets = [...paths].filter((url) =>
    neutralModels.some((digest) =>
      url.endsWith(`/world-unit-models/${digest}.glb`),
    ),
  );
  if (assets.length === 0) return;
  expect(assets).toHaveLength(2);
  for (const asset of assets) expect(requested).toContain(asset);

  const objectives = page.getByRole("combobox", { name: "Jump to event" });
  for (const name of [
    /^15:22 · .+ slays Rift Herald$/,
    /^21:20 · .+ slays Baron Nashor$/,
    /^27:36 · .+ slays Baron Nashor$/,
  ])
    await expect(objectives.getByRole("option", { name })).toHaveCount(1);

  await seek(page, 903.5);
  const herald = [4807.904, 10_077.037] as const;
  expect(await drawsNear(page, 43_119, herald)).toBe(false);
  await seek(page, 903.6);
  expect(await drawsNear(page, 43_119, herald)).toBe(true);
  await captureObjective(
    page,
    herald,
    testInfo.outputPath("recorded-rift-herald.png"),
  );
  await seek(page, 903.7);
  expect(await drawsNear(page, 43_119, herald)).toBe(false);

  const baron = [5008, 10_470] as const;
  for (const [spawn, clock] of [
    [1, 1180.056970703125],
    [2, 1620.565181640625],
  ] as const) {
    await page.goto(`${replayPath}?t=${String(clock)}`);
    await expect(
      page.getByRole("button", { name: "Play", exact: true }),
    ).toBeVisible();
    expect(await drawsNear(page, 65_598, baron)).toBe(true);
    await captureObjective(
      page,
      baron,
      testInfo.outputPath(`recorded-baron-${String(spawn)}.png`),
      0,
    );
    const nextTenth = (Math.floor(clock * 10) + 1) / 10;
    await seek(page, nextTenth);
    expect(await drawsNear(page, 65_598, baron)).toBe(false);
  }
}
