import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { readRecordedDraw } from "./recorded-draw-probe.ts";
import { replayPath } from "./recorded-replay-data.ts";
import { seek } from "./recorded-replay-fixture.ts";

export async function drawsNear(
  page: Page,
  indexCount: number,
  target: readonly [number, number],
) {
  return (
    actorOriginAt(await readRecordedDraw(page), indexCount, target) !==
    undefined
  );
}

function actorOriginAt(
  {
    actorOrigins,
    actorIndexCounts,
  }: Awaited<ReturnType<typeof readRecordedDraw>>,
  indexCount: number,
  [targetX, targetZ]: readonly [number, number],
) {
  return actorOrigins.find(
    ([drawX = Infinity, , drawZ = Infinity], index) =>
      actorIndexCounts[index] === indexCount &&
      Math.hypot(drawX - targetX, drawZ - targetZ) < 0.5,
  );
}

export async function centerMinimapOn(
  minimap: Locator,
  [x, worldZ]: readonly [number, number],
) {
  const bounds = await minimap.boundingBox();
  if (bounds === null) throw new Error("The recorded minimap is not visible.");
  // Bounds from the verified Map11 terrain, with north at the minimap top.
  const xFraction = (x + 1.104897) / 14_719.505287;
  const yFraction = (14_792.210938 - worldZ) / 14_759.455139;
  await minimap.click({
    position: { x: bounds.width * xFraction, y: bounds.height * yFraction },
  });
}

function projectToViewport(
  point: readonly number[],
  matrix: readonly number[],
) {
  expect(point).toHaveLength(3);
  expect(matrix).toHaveLength(16);
  const homogeneous = [...point, 1];
  const project = (row: number) =>
    homogeneous.reduce(
      (total, component, column) =>
        total + component * (matrix[row + column * 4] ?? NaN),
      0,
    );
  const w = project(3);
  return [project(0) / w, project(1) / w];
}

export async function verifyRecordedWorldActors(
  page: Page,
  paths: Iterable<string>,
  requested: Set<string>,
  testInfo: TestInfo,
) {
  const canvas = page.getByLabel("League of Legends replay scene");
  const minimap = page.getByRole("button", { name: "Replay minimap" });
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  const overview = page.getByRole("button", { name: "Map overview" });
  const worldAssets = [...paths];
  const dragonAsset = worldAssets.find((url) =>
    url.endsWith(
      "/world-unit-models/bc30c9bfd1f8ea056feb5e70f0ef4787cc848ae4a737c236575064d41011eee0.glb",
    ),
  );
  const earthAsset = worldAssets.find((url) =>
    url.endsWith(
      "/world-unit-models/cd9a2d4082bd804a88d09669d8bc86c826d7132e93a19f96fdd61d9121f2c65d.glb",
    ),
  );
  const orderMinionAsset = worldAssets.find((url) =>
    url.endsWith(
      "/world-unit-models/a62e28f01a167db19e6efc15799c38542d14e2ea23eeb7932902db2836a988e3.glb",
    ),
  );
  const chaosMinionAsset = worldAssets.find((url) =>
    url.endsWith(
      "/world-unit-models/9f919ca105c766fcfd80847a0c0dc174f91a2672ec9deb9debe3a06427a75657.glb",
    ),
  );
  if (orderMinionAsset !== undefined || chaosMinionAsset !== undefined) {
    const orderIndices = 3189;
    const chaosIndices = 3669;
    const firstOrderPosition = [3453.746, 1501.309] as const;
    expect(requested).toContain(orderMinionAsset);
    expect(requested).toContain(chaosMinionAsset);
    await seek(page, 29.9);
    const laneMarkers = minimap.locator('[data-map-actor="minion"]');
    await expect(laneMarkers).toHaveCount(0);
    const beforeWave = await readRecordedDraw(page);
    expect(beforeWave.actorIndexCounts).not.toContain(orderIndices);
    expect(beforeWave.actorIndexCounts).not.toContain(chaosIndices);
    await seek(page, 34.2);
    const firstOrderMarker = laneMarkers.and(
      minimap.locator('[data-map-actor-id="1073742625"]'),
    );
    await expect(firstOrderMarker).toHaveAttribute(
      "data-map-actor-team",
      "100",
    );
    expect(
      await laneMarkers
        .and(minimap.locator('[data-map-actor-team="200"]'))
        .count(),
    ).toBeGreaterThan(0);
    const markerPosition = await firstOrderMarker.evaluate((element) => [
      Number.parseFloat(element.style.left),
      Number.parseFloat(element.style.top),
    ]);
    expect(markerPosition[0]).toBeCloseTo(
      ((3453.746 + 1.104897) * 100) / 14_719.505287,
      2,
    );
    expect(markerPosition[1]).toBeCloseTo(
      ((14_792.210938 - 1501.309) * 100) / 14_759.455139,
      2,
    );
    expect(await drawsNear(page, orderIndices, firstOrderPosition)).toBe(true);
    expect(await drawsNear(page, chaosIndices, [11_894.787, 11_602.582])).toBe(
      true,
    );
    await centerMinimapOn(minimap, firstOrderPosition);
    await zoomIn.click();
    await zoomIn.click();
    const centeredWave = await readRecordedDraw(page);
    const minionOrigin = actorOriginAt(
      centeredWave,
      orderIndices,
      firstOrderPosition,
    );
    if (minionOrigin === undefined)
      throw new Error("The recorded Order minion did not draw.");
    for (const component of projectToViewport(
      minionOrigin,
      centeredWave.viewProjection,
    )) {
      expect(Math.abs(component)).toBeLessThan(0.22);
    }
    await canvas.screenshot({
      path: testInfo.outputPath("recorded-first-lane-wave-closeup.png"),
    });
    await overview.click();
    await seek(page, 35.2);
    await expect(firstOrderMarker).toHaveAttribute(
      "data-map-actor-team",
      "100",
    );
    expect(
      await firstOrderMarker.evaluate((element) =>
        Number.parseFloat(element.style.left),
      ),
    ).toBeGreaterThan(markerPosition[0] ?? Infinity);
    expect(await drawsNear(page, orderIndices, [3803.058, 1493.624])).toBe(
      true,
    );
    expect(await drawsNear(page, chaosIndices, [11_648.5, 11_356.443])).toBe(
      true,
    );
  }
  if (dragonAsset !== undefined) {
    // Map11 opcode 96 paths at recorded speed 330 for actor 1073787778.
    const first = [9931.477, 4505.95] as const;
    const second = [10_015.964, 4601.964] as const;
    const fireDragonFirstRangeIndices = 26_085;
    expect(requested).toContain(dragonAsset);
    await seek(page, 1060);
    const gapDraw = await readRecordedDraw(page);
    expect(gapDraw.actorIndexCounts).not.toContain(fireDragonFirstRangeIndices);
    await seek(page, 1064.1);
    expect(await drawsNear(page, fireDragonFirstRangeIndices, first)).toBe(
      true,
    );
    await centerMinimapOn(minimap, first);
    await zoomIn.click();
    await zoomIn.click();
    const centered = await readRecordedDraw(page);
    const dragonOrigin = actorOriginAt(
      centered,
      fireDragonFirstRangeIndices,
      first,
    );
    if (dragonOrigin === undefined)
      throw new Error("The recorded Fire Dragon did not draw.");
    for (const component of projectToViewport(
      dragonOrigin,
      centered.viewProjection,
    )) {
      expect(Math.abs(component)).toBeLessThan(0.22);
    }
    await canvas.screenshot({
      path: testInfo.outputPath("recorded-fire-dragon-closeup.png"),
    });
    await overview.click();
    await seek(page, 1064.5);
    expect(await drawsNear(page, fireDragonFirstRangeIndices, first)).toBe(
      false,
    );
    expect(await drawsNear(page, fireDragonFirstRangeIndices, second)).toBe(
      true,
    );
    await seek(page, 1086.7);
    const afterKillDraw = await readRecordedDraw(page);
    expect(afterKillDraw.actorIndexCounts).not.toContain(
      fireDragonFirstRangeIndices,
    );
    await seek(page, 1064.1);
    expect(await drawsNear(page, fireDragonFirstRangeIndices, first)).toBe(
      true,
    );
  }
  if (earthAsset !== undefined) {
    const earthFirstRangeIndices = 26_085;
    expect(requested).toContain(earthAsset);
    await seek(page, 408.6);
    expect(
      await drawsNear(page, earthFirstRangeIndices, [9848.97, 4411.61]),
    ).toBe(true);
    await canvas.screenshot({
      path: testInfo.outputPath("recorded-earth-dragon.png"),
    });
    await seek(page, 409.1);
    expect(
      await drawsNear(page, earthFirstRangeIndices, [9956.692, 4519.223]),
    ).toBe(true);
    await seek(page, 431.3);
    const afterEarthKill = await readRecordedDraw(page);
    expect(afterEarthKill.actorIndexCounts).not.toContain(
      earthFirstRangeIndices,
    );
  }
}

export async function verifyLaterRecordedLaneWaves(
  page: Page,
  paths: Iterable<string>,
  requested: Set<string>,
  testInfo: TestInfo,
) {
  const superMinionAsset = [...paths].find((url) =>
    url.endsWith(
      "/world-unit-models/c5f51dfe9ce9bc4cb0dc894b32c4dbce4493bce8ffd3f9ab29ae48386babd939.glb",
    ),
  );
  if (superMinionAsset === undefined) return;
  expect(requested).toContain(superMinionAsset);
  await seek(page, 120);
  expect(await drawsNear(page, 3189, [1231.891, 11_140.272])).toBe(true);
  expect(await drawsNear(page, 3669, [1236.067, 11_358.696])).toBe(true);
  await seek(page, 1200);
  expect(await drawsNear(page, 3462, [13_622.953, 4261.558])).toBe(true);
  expect(await drawsNear(page, 4815, [13_693.553, 6182.826])).toBe(true);
  await seek(page, 1500);
  const superMinionPosition = [5831.008, 1308.293] as const;
  expect(await drawsNear(page, 9966, superMinionPosition)).toBe(true);
  await centerMinimapOn(
    page.getByRole("button", { name: "Replay minimap" }),
    superMinionPosition,
  );
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  await zoomIn.click();
  await zoomIn.click();
  await page.getByLabel("League of Legends replay scene").screenshot({
    path: testInfo.outputPath("recorded-late-super-minion.png"),
  });
  await page.getByRole("button", { name: "Map overview" }).click();
  await seek(page, 120);
  expect(await drawsNear(page, 9966, superMinionPosition)).toBe(false);
}

export async function verifyRecordedInhibitors(
  page: Page,
  paths: Iterable<string>,
  requested: Set<string>,
  { expectedLosses, testInfo }: { expectedLosses: boolean; testInfo: TestInfo },
) {
  const assets = [...paths].filter((url) =>
    /\/inhibitor-models\/[^/]+\.glb$/.test(url),
  );
  if (assets.length === 0) return;
  expect(assets).toHaveLength(2);
  for (const asset of assets) expect(requested).toContain(asset);
  const blue = [
    [1172.702, 3583.286],
    [3210.616, 3217.527],
    [3468.068, 1230.955],
  ] as const;
  const red = [
    [13_599.171, 11_319.917],
    [11_593.575, 11_669.565],
    [11_275.23, 13_657.173],
  ] as const;
  const blueIndices = 6675;
  const redIndices = 4452;
  await seek(page, 15);
  const opening = await readRecordedDraw(page);
  for (const position of blue)
    expect(actorOriginAt(opening, blueIndices, position)).toBeDefined();
  for (const position of red)
    expect(actorOriginAt(opening, redIndices, position)).toBeDefined();

  const objectives = page.getByRole("combobox", { name: "Jump to event" });
  const firstLoss = objectives.getByRole("option", {
    name: "24:50 · Red inhibitor destroyed",
    exact: true,
  });
  await expect(firstLoss).toHaveCount(expectedLosses ? 1 : 0);
  if (!expectedLosses) return;
  const option = await firstLoss.getAttribute("value");
  if (option === null)
    throw new Error("The recorded inhibitor loss has no jump target.");
  await objectives.selectOption(option);
  const clock = page.getByRole("slider", { name: "Replay time" });
  await expect(clock).toHaveAttribute("aria-valuetext", "24:50");
  await expect(clock).toHaveAttribute("aria-busy", "false");
  expect(await drawsNear(page, redIndices, red[0])).toBe(false);
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  await zoomIn.click();
  await zoomIn.click();
  const canvas = page.getByLabel("League of Legends replay scene");
  await canvas.screenshot({
    path: testInfo.outputPath("recorded-inhibitor-after-loss.png"),
  });
  await seek(page, 1490.1);
  const before = await readRecordedDraw(page);
  const beforeOrigin = actorOriginAt(before, redIndices, red[0]);
  if (beforeOrigin === undefined)
    throw new Error("The rewound inhibitor did not draw.");
  for (const coordinate of projectToViewport(
    beforeOrigin,
    before.viewProjection,
  ))
    expect(Math.abs(coordinate)).toBeLessThan(0.22);
  await canvas.screenshot({
    path: testInfo.outputPath("recorded-inhibitor-before-loss.png"),
  });
  for (const [beforeLoss, position] of [
    [1581.2, red[1]],
    [1586, red[2]],
  ] as const) {
    await seek(page, beforeLoss);
    expect(await drawsNear(page, redIndices, position)).toBe(true);
    await seek(page, beforeLoss + 0.1);
    expect(await drawsNear(page, redIndices, position)).toBe(false);
  }
  await seek(page, 1490.1);
  expect(await drawsNear(page, redIndices, red[0])).toBe(true);
  await page.getByRole("button", { name: "Map overview" }).click();
}

export async function verifyRecordedChemtechAnchor(
  page: Page,
  paths: Iterable<string>,
  requested: Set<string>,
  testInfo: TestInfo,
) {
  const chemtechAsset = [...paths].find((url) =>
    url.endsWith(
      "/world-unit-models/5065cfe9b9605bda0529f4e60a81c16943583812f38c4f5cefcfb82472d46925.glb",
    ),
  );
  if (chemtechAsset !== undefined) {
    const chemtechFirstRangeIndices = 57_942;
    expect(requested).toContain(chemtechAsset);
    // This actor has recorded anchors and no corroborated extending path.
    await page.goto(`${replayPath}?t=724.8251254882813`);
    await expect(
      page.getByRole("button", { name: "Play", exact: true }),
    ).toBeVisible();
    expect(await drawsNear(page, chemtechFirstRangeIndices, [9836, 4398])).toBe(
      true,
    );
    await page.getByLabel("League of Legends replay scene").screenshot({
      path: testInfo.outputPath("recorded-chemtech-dragon.png"),
    });
    await seek(page, 724.9);
    const afterAnchor = await readRecordedDraw(page);
    expect(afterAnchor.actorIndexCounts).not.toContain(
      chemtechFirstRangeIndices,
    );
  }
}
