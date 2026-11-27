import { expect, type Page, type TestInfo } from "@playwright/test";
import { replayPath, type readRecordedReplay } from "./recorded-replay-data.ts";
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

async function verifyCurrentNeutralObjectives(
  page: Page,
  testInfo: TestInfo,
  hasTeamVision: boolean,
) {
  const objectives = page.getByRole("combobox", { name: "Jump to event" });
  for (const [clock, name] of [
    ["7:04", "Chemtech Drake"],
    ["14:34", "Cloud Drake"],
    ["16:15", "Rift Herald"],
    ["21:13", "Mountain Drake"],
    ["22:37", "Baron Nashor"],
    ["26:53", "Mountain Drake"],
    ["29:57", "Baron Nashor"],
    ["32:43", "Mountain Drake"],
    ["38:24", "Mountain Drake"],
  ] as const) {
    await expect(
      objectives.getByRole("option", {
        name: new RegExp(`${clock} · .+ slays ${name}$`),
      }),
    ).toHaveCount(1);
  }
  const cloud = objectives.getByRole("option", {
    name: /14:34 · .+ slays Cloud Drake$/,
  });
  const cloudValue = await cloud.getAttribute("value");
  if (cloudValue === null) throw new Error("Missing Cloud Drake jump target.");
  await objectives.selectOption(cloudValue);
  await expect(
    page.getByRole("slider", { name: "Replay time" }),
  ).toHaveAttribute("aria-valuetext", "14:34");

  const herald = [4927.243, 10_366.336] as const;
  for (const [clock, visible] of [
    [954.6, true],
    [982, false],
    [954.6, true],
  ] as const) {
    await seek(page, clock);
    expect(await drawsNear(page, 43_119, herald)).toBe(visible);
  }
  await captureObjective(
    page,
    herald,
    testInfo.outputPath("current-herald-rewound.png"),
  );
  await seek(page, 1246);
  const mountain = [9842.164, 4400.52] as const;
  expect(await drawsNear(page, 26_085, mountain)).toBe(true);

  const play = page.getByRole("button", { name: "Play", exact: true });
  const perspective = hasTeamVision ? "&perspective=red" : "";
  await page.goto(`${replayPath}?t=389.72843701171877${perspective}`);
  await expect(play).toBeVisible();
  const chemtech = [9836, 4398] as const;
  if (hasTeamVision) {
    const vision = page.getByRole("combobox", { name: "Unit visibility" });
    await expect(vision).toHaveValue("red");
    expect(await drawsNear(page, 57_942, chemtech)).toBe(true);
    await vision.selectOption("blue");
    await expect.poll(() => drawsNear(page, 57_942, chemtech)).toBe(false);
    await vision.selectOption("red");
  }
  await expect.poll(() => drawsNear(page, 57_942, chemtech)).toBe(true);
  await captureObjective(
    page,
    chemtech,
    testInfo.outputPath("current-chemtech-drake.png"),
  );

  await page.goto(`${replayPath}?t=2137.4022734375`);
  await expect(play).toBeVisible();
  const baron = [5008, 10_470] as const;
  expect(await drawsNear(page, 65_598, baron)).toBe(true);
  await captureObjective(
    page,
    baron,
    testInfo.outputPath("current-surviving-baron.png"),
  );
}

async function verifyCurrentNeutralCamps(page: Page, testInfo: TestInfo) {
  const objectives = page.getByRole("combobox", { name: "Jump to event" });
  for (const clock of ["8:29", "8:44", "8:46"]) {
    await expect(
      objectives.getByRole("option", {
        name: new RegExp(`^${clock} · .+ slays Void Grub$`),
      }),
    ).toHaveCount(1);
  }

  await page.goto(`${replayPath}?t=232&perspective=red`);
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();
  const vision = page.getByRole("combobox", { name: "Unit visibility" });
  await expect(vision).toHaveValue("red");
  const scuttleIndexCount = 12_654;
  const opening = [10_943.7421, 5161.8778] as const;
  const shared = [11_203.9506, 4794.5776] as const;
  const beforeDeath = [10_913.2506, 4878.5549] as const;
  await expect
    .poll(() => drawsNear(page, scuttleIndexCount, opening))
    .toBe(true);
  await captureObjective(
    page,
    opening,
    testInfo.outputPath("current-scuttle-red.png"),
  );

  await vision.selectOption("blue");
  await expect
    .poll(() => drawsNear(page, scuttleIndexCount, opening))
    .toBe(false);
  await seek(page, 235);
  await expect
    .poll(() => drawsNear(page, scuttleIndexCount, shared))
    .toBe(true);
  await vision.selectOption("red");
  await expect
    .poll(() => drawsNear(page, scuttleIndexCount, shared))
    .toBe(true);
  await vision.selectOption("all");
  await seek(page, 235.9);
  await expect
    .poll(() => drawsNear(page, scuttleIndexCount, beforeDeath))
    .toBe(true);
  await seek(page, 236);
  await expect
    .poll(() => drawsNear(page, scuttleIndexCount, beforeDeath, 200))
    .toBe(false);

  await seek(page, 232);
  await vision.selectOption("red");
  await expect
    .poll(() => drawsNear(page, scuttleIndexCount, opening))
    .toBe(true);
  await captureObjective(
    page,
    opening,
    testInfo.outputPath("current-scuttle-rewound.png"),
    0,
  );
}

async function verifyAdditionalCampModels(
  page: Page,
  testInfo: TestInfo,
  campSkins: [string, number][] | undefined,
) {
  await page.goto(`${replayPath}?t=85.6`);
  const play = page.getByRole("button", { name: "Play", exact: true });
  await expect(play).toBeVisible();
  const gromp = [12_659.8058, 6440.5835] as const;
  expect(await drawsNear(page, 17_172, gromp)).toBe(true);
  await captureObjective(page, gromp, testInfo.outputPath("current-gromp.png"));

  if (campSkins !== undefined) {
    const skins = new Map(campSkins);
    expect(skins.get("sru_blue")).toBe(4);
    expect(skins.get("sru_red")).toBe(3);
    expect(skins.has("sru_horde")).toBe(false);
    await verifyAuthoredCampSkins(page, testInfo);
    return;
  }

  await page.goto(`${replayPath}?t=473.2950651855469`);
  await expect(play).toBeVisible();
  for (const point of [
    [4842, 10_638],
    [4790, 10_182],
    [5210, 10_424],
  ] as const)
    expect(await drawsNear(page, 16_986, point)).toBe(true);
  await captureObjective(
    page,
    [4842, 10_638],
    testInfo.outputPath("current-void-grubs.png"),
  );
}

async function verifyAuthoredCampSkins(page: Page, testInfo: TestInfo) {
  const play = page.getByRole("button", { name: "Play", exact: true });
  const vision = page.getByRole("combobox", { name: "Unit visibility" });
  for (const { name, clock, position, indices, perspective } of [
    {
      name: "blue-sentinel",
      clock: 56.1,
      position: [11_052.37, 6945.0064],
      indices: 26_802,
      perspective: "red",
    },
    {
      name: "red-brambleback",
      clock: 77.6,
      position: [7746.4155, 4000.7678],
      indices: 26_439,
      perspective: "blue",
    },
    {
      name: "gromp-keyframe",
      clock: "180.06082153320312",
      position: [2112, 8450],
      indices: 17_172,
      perspective: "blue",
    },
  ] as const) {
    await page.goto(
      `${replayPath}?t=${String(clock)}&perspective=${perspective}`,
    );
    await expect(play).toBeVisible();
    await expect(vision).toHaveValue(perspective);
    await expect.poll(() => drawsNear(page, indices, position)).toBe(true);
    await captureObjective(
      page,
      position,
      testInfo.outputPath(`current-${name}.png`),
    );
    await vision.selectOption(perspective === "red" ? "blue" : "red");
    await expect.poll(() => drawsNear(page, indices, position)).toBe(false);
  }
}

export async function verifyRecordedNeutralObjectives(
  page: Page,
  fixture: Awaited<ReturnType<typeof readRecordedReplay>>,
  requested: Set<string>,
  testInfo: TestInfo,
) {
  if (fixture.directNeutralModels !== undefined) {
    await verifyCurrentNeutralObjectives(
      page,
      testInfo,
      fixture.unitVisibility,
    );
    if (fixture.directNeutralCamps) {
      await verifyCurrentNeutralCamps(page, testInfo);
      if (fixture.directNeutralModels.some(([name]) => name === "sru_gromp"))
        await verifyAdditionalCampModels(
          page,
          testInfo,
          fixture.directNeutralCampSkins,
        );
    }
    return;
  }
  const assets = [...fixture.paths.keys()].filter((url) =>
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
