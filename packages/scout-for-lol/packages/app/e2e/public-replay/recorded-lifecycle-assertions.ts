import { expect, type Page, type TestInfo } from "@playwright/test";
import { readRecordedDraw } from "./recorded-draw-probe.ts";
import { seek } from "./recorded-replay-fixture.ts";
import { verifyChampionOverhead } from "./proof/champion-overhead.ts";
import {
  createCurrentInventoryVerifier,
  currentInventoryReplaySha256,
} from "./proof/current-inventory.ts";

export async function verifyRecordedRoster(
  page: Page,
  capabilities: {
    championHealth: boolean;
    championResources: boolean;
    championInventory: boolean;
    championExperience: boolean;
    descriptor: { durationSeconds: number; sha256: string };
    root: string;
    manifestPath: string;
    roflPath: string;
  },
  testInfo: TestInfo,
) {
  for (const team of ["Blue team roster", "Red team roster"]) {
    const table = page.getByRole("table", { name: team });
    await expect(table.getByRole("row")).toHaveCount(6);
    await expect(table.getByRole("meter", { name: / health$/ })).toHaveCount(
      capabilities.championHealth ? 5 : 0,
    );
    await expect(
      table.getByRole("columnheader", { name: "Gold held" }),
    ).toHaveCount(capabilities.championResources ? 1 : 0);
    await expect(table.getByRole("meter", { name: / resource$/ })).toHaveCount(
      capabilities.championResources ? 5 : 0,
    );
    await expect(table.getByRole("list", { name: / items$/ })).toHaveCount(
      capabilities.championInventory ? 5 : 0,
    );
    const experienceCount = Number(capabilities.championExperience) * 5;
    await expect(
      table.getByRole("meter", { name: / experience$/ }),
    ).toHaveCount(experienceCount);
    await expect(
      table.getByRole("group", { name: / total experience$/ }),
    ).toHaveCount(experienceCount);
  }
  if (capabilities.championExperience)
    await verifyRecordedExperience(
      page,
      capabilities.descriptor.sha256,
      testInfo,
    );
  if (capabilities.championInventory)
    await verifyFixtureInventory(page, capabilities, testInfo);
  if (
    capabilities.descriptor.sha256 ===
    "a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1"
  ) {
    if (capabilities.championHealth || capabilities.championResources)
      await verifyCurrentChampionStats(page, capabilities, testInfo);
  } else if (capabilities.championResources)
    await verifyRecordedRosterResources(page, testInfo);
}

async function verifyFixtureInventory(
  page: Page,
  fixture: {
    descriptor: { durationSeconds: number; sha256: string };
    root: string;
    manifestPath: string;
    roflPath: string;
  },
  testInfo: TestInfo,
) {
  if (fixture.descriptor.sha256 !== currentInventoryReplaySha256) {
    await verifyRecordedInventory(
      page,
      testInfo,
      fixture.descriptor.durationSeconds > 100,
    );
    return;
  }
  const verifier = await createCurrentInventoryVerifier(fixture);
  await verifier.verifySamples(page, seek, testInfo);
  const slider = page.getByRole("slider", { name: "Replay time" });
  await slider.press("End");
  await expect(slider).toHaveAttribute("aria-busy", "false");
  await verifier.verifyEnd(page);
  await seek(page, 0);
}

async function verifyCurrentChampionStats(
  page: Page,
  capabilities: { championHealth: boolean; championResources: boolean },
  testInfo: TestInfo,
) {
  const roster = page.getByRole("table", { name: "Blue team roster" });
  const row = roster.getByRole("row").filter({
    has: page.getByRole("rowheader", { name: /LeeSin/ }),
  });
  const health = row.getByRole("meter", { name: "LeeSin health" });
  const resource = row.getByRole("meter", { name: "LeeSin resource" });
  const gold = row.getByRole("cell").last();
  const camera = page.getByRole("combobox", { name: "Camera" });
  await camera.selectOption("player:1073742162");
  // Sample the original replication tracks before and after gains and losses.
  for (const [time, current, max, energy, held] of [
    [0, "645", "645", "200", "500"],
    [120, "409.4465026855469", "742.760009765625", "165", "353"],
    [0, "645", "645", "200", "500"],
  ] as const) {
    await seek(page, time);
    if (capabilities.championHealth) {
      await expect(health).toHaveAttribute("value", current);
      await expect(health).toHaveAttribute("max", max);
    }
    if (capabilities.championResources) {
      await expect(resource).toHaveAttribute("value", energy);
      await expect(resource).toHaveAttribute("max", "200");
      await expect(gold).toHaveText(held);
    }
    await verifyChampionOverhead(page, time, energy, testInfo);
    if (time === 120) {
      await roster.screenshot({
        path: testInfo.outputPath("recorded-current-champion-stats.png"),
      });
      if (capabilities.championHealth) {
        const screenshot = await page
          .getByLabel("League of Legends replay scene")
          .screenshot({
            path: testInfo.outputPath("recorded-current-overhead-health.png"),
          });
        expect(await centerChampionHealthFill(page, screenshot)).toBe(29);
      }
    }
  }
  await page.getByRole("button", { name: "Map overview" }).click();
}

async function verifyRecordedRosterResources(page: Page, testInfo: TestInfo) {
  const table = page.getByRole("table", { name: "Blue team roster" });
  const firstChampionGold = table
    .getByRole("row")
    .nth(1)
    .getByRole("cell")
    .last();
  const warwick = table.getByRole("meter", { name: "Warwick resource" });
  await expect(firstChampionGold).toHaveText("500");
  await expect(warwick).toHaveAttribute("value", "280");
  await seek(page, 4);
  await expect(firstChampionGold).toHaveText("0");
  await seek(page, 60);
  await expect(warwick).toHaveAttribute("value", "215.78097534179688");
  await expect(warwick).toHaveAttribute("max", "280");
  await page.getByRole("group", { name: "Replay roster scores" }).screenshot({
    path: testInfo.outputPath("recorded-roster-resources.png"),
  });
  await seek(page, 0);
  await expect(firstChampionGold).toHaveText("500");
  await expect(warwick).toHaveAttribute("value", "280");
}

const longReplaySha256 =
  "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668";
const experienceSamples = {
  a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1: {
    participantId: 1_073_742_161,
    samples: [
      { time: 66.6, total: 0, level: 1, current: 0, max: 280 },
      { time: 66.7, total: 62, level: 1, current: 62, max: 280 },
      { time: 110.3, total: 558, level: 2, current: 278, max: 380 },
      {
        time: 1900.2,
        total: 20_403.13671875,
        level: 19,
        current: 63.13671875,
        max: 2080,
      },
    ],
  },
  [longReplaySha256]: {
    participantId: 1_073_742_161,
    samples: [
      { time: 110.3, total: 0, level: 1, current: 0, max: 280 },
      { time: 110.4, total: 62, level: 1, current: 62, max: 280 },
      { time: 120.2, total: 310, level: 2, current: 30, max: 380 },
    ],
  },
  d7cabb0b7ba965f317863d128238847a0b9b0e4cc0cdbcfa3077c537b10fdf2b: {
    participantId: 1_073_742_163,
    samples: [
      { time: 58.1, total: 0, level: 1, current: 0, max: 280 },
      { time: 58.2, total: 62, level: 1, current: 62, max: 280 },
      { time: 60.3, total: 124, level: 1, current: 124, max: 280 },
    ],
  },
} as const;

async function verifyRecordedExperience(
  page: Page,
  replaySha256: string,
  testInfo: TestInfo,
) {
  const fixture = Object.entries(experienceSamples).find(
    ([sha256]) => sha256 === replaySha256,
  )?.[1];
  if (fixture === undefined)
    throw new Error("Expected an independently decoded replay XP fixture.");
  const sample = await recordedExperienceParticipant(
    page,
    fixture.participantId,
  );
  for (const state of fixture.samples) await sample(state);
  await screenshotExperienceRoster(
    page,
    testInfo,
    "recorded-roster-experience.png",
  );
  await sample(fixture.samples[0]);
  if (replaySha256 === longReplaySha256) {
    const urgot = await recordedExperienceParticipant(page, 1_073_742_166);
    await urgot({
      time: 1705,
      total: 18_498.203125,
      level: 18,
      current: 138.203125,
      max: 1980,
    });
    await screenshotExperienceRoster(
      page,
      testInfo,
      "recorded-roster-experience-late.png",
    );
  }
  await sample({ time: 0, total: 0, level: 1, current: 0, max: 280 });
}

async function recordedExperienceParticipant(
  page: Page,
  participantId: number,
) {
  const cameraOption = page
    .getByRole("combobox", { name: "Camera" })
    .locator(`option[value="player:${participantId.toString()}"]`);
  const optionText = await cameraOption.textContent();
  const player = optionText?.split(" · ")[0]?.trim();
  if (player === undefined || player === "")
    throw new Error("Expected the recorded XP participant in the roster.");
  const meter = page.getByRole("meter", {
    name: `${player} experience`,
    exact: true,
  });
  const table = page.getByRole("table", { name: / team roster$/ }).filter({
    has: meter,
  });
  const row = table.getByRole("row").filter({ has: meter });
  const total = row.getByRole("group", { name: `${player} total experience` });
  const levelColumn = await table
    .getByRole("columnheader", { name: "Level", exact: true })
    .evaluate((header) =>
      header instanceof globalThis.HTMLTableCellElement
        ? header.cellIndex - 1
        : -1,
    );
  expect(levelColumn).toBeGreaterThanOrEqual(0);
  const formatter = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  });
  return async (sample: {
    time: number;
    total: number;
    level: number;
    current: number;
    max: number;
  }) => {
    await seek(page, sample.time);
    await expect(total).toHaveText(
      `${formatter.format(sample.total)} total XP`,
    );
    await expect(meter).toHaveAttribute("value", sample.current.toString());
    await expect(meter).toHaveAttribute("max", sample.max.toString());
    await expect(row.getByRole("cell").nth(levelColumn)).toHaveText(
      sample.level.toString(),
    );
  };
}

async function screenshotExperienceRoster(
  page: Page,
  testInfo: TestInfo,
  filename: string,
) {
  const roster = page.getByRole("group", { name: "Replay roster scores" });
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 1440, height: 1100 });
  try {
    await roster.evaluate((element) => {
      element.scrollIntoView({ block: "center" });
    });
    await roster.screenshot({ path: testInfo.outputPath(filename) });
  } finally {
    if (viewport !== null) await page.setViewportSize(viewport);
  }
}

async function verifyRecordedInventory(
  page: Page,
  testInfo: TestInfo,
  long: boolean,
) {
  const roster = page.getByRole("table", { name: "Blue team roster" });
  const first = roster.getByRole("list", { name: / items$/ }).first();
  const expectedStarter = long ? "Doran's Shield" : "Doran's Blade";
  const starter = first
    .locator('[data-replay-item-slot="0"]')
    .getByRole("img", { name: expectedStarter });
  await expect(starter).toHaveCount(0);
  await seek(page, 4);
  await expect(starter).toBeVisible();
  await expect(starter).toHaveAttribute("src", /^blob:/);
  await expect
    .poll(() =>
      starter.evaluate((img) =>
        img instanceof globalThis.HTMLImageElement ? img.naturalWidth : 0,
      ),
    )
    .toBeGreaterThan(0);
  const potion = first.getByRole("img", { name: "Health Potion" });
  await expect(potion).toBeVisible();
  if (long) {
    const caitlyn = page.getByRole("list", { name: "Caitlyn items" });
    await expect(caitlyn.locator('[data-replay-item-slot="1"]')).toHaveText(
      "2",
    );
    await seek(page, 6);
    await expect(
      caitlyn.locator('[data-replay-item-slot="1"] img'),
    ).toHaveCount(0);
    await expect(caitlyn.locator('[data-replay-item-slot="5"]')).toHaveText(
      "2",
    );
    await expect(
      caitlyn
        .locator('[data-replay-item-slot="5"]')
        .getByRole("img", { name: "Health Potion" }),
    ).toBeVisible();
    await seek(page, 164);
    await expect(potion).toHaveCount(0);
    await seek(page, 4);
    await expect(potion).toBeVisible();
    await expect(caitlyn.locator('[data-replay-item-slot="1"]')).toHaveText(
      "2",
    );
  }
  await page.getByRole("group", { name: "Replay roster scores" }).screenshot({
    path: testInfo.outputPath("recorded-roster-inventory.png"),
  });
  await seek(page, 0);
  await expect(starter).toHaveCount(0);
}

async function verifyFirstRecordedDeath(page: Page, testInfo: TestInfo) {
  const score = page.getByRole("group", { name: "Replay team score" });
  const roster = page.getByRole("table", { name: "Blue team roster" });
  const renekton = roster.getByRole("row", { name: /Renekton/ });
  const marker = page
    .getByRole("button", { name: "Replay minimap" })
    .locator('[data-map-actor-id="1073742161"]');
  const camera = page.getByRole("combobox", { name: "Camera" });

  await seek(page, 79.4);
  await expect(score).toContainText(/Red team\s*0\s*kills/);
  const overview = await readRecordedDraw(page);
  await camera.selectOption("player:1073742161");
  const followed = await readRecordedDraw(page);
  expect(followed.viewProjection).not.toEqual(overview.viewProjection);

  for (const [seconds, alive] of [
    [79.5, false],
    [89.4, false],
    [89.5, true],
    [79.4, true],
  ] as const) {
    await seek(page, seconds);
    await expect(marker).toHaveCount(alive ? 1 : 0);
    await expect(renekton.getByText("Dead", { exact: true })).toHaveCount(
      alive ? 0 : 1,
    );
    const draw = await readRecordedDraw(page);
    expect(draw.actorIndexCounts.includes(29_331)).toBe(alive);
    expect(
      JSON.stringify(draw.viewProjection) ===
        JSON.stringify(overview.viewProjection),
    ).toBe(!alive);
    if (seconds === 79.5) {
      await expect(score).toContainText(/Red team\s*1\s*kills/);
      await roster.screenshot({
        path: testInfo.outputPath("recorded-death-roster.png"),
      });
    }
  }
  await expect(score).toContainText(/Red team\s*0\s*kills/);
  await page.getByRole("button", { name: "Map overview" }).click();
}

async function verifyRecordedChampionHealth(page: Page, testInfo: TestInfo) {
  const roster = page.getByRole("table", { name: "Blue team roster" });
  const health = roster.getByRole("meter", { name: "Renekton health" });
  const canvas = page.getByLabel("League of Legends replay scene");
  const camera = page.getByRole("combobox", { name: "Camera" });
  await camera.selectOption("player:1073742161");
  // Recovered from the original group 32 float fields. The death event arrives
  // before the zero-health packet, so sample the recorded packet boundaries.
  for (const [time, current, fill] of [
    [79.4, "9.705432891845703", 1],
    [79.5, "1.3535804748535156", 0],
    [79.6, "0", 0],
    [89.6, "780", 52],
    [79.4, "9.705432891845703", 1],
  ] as const) {
    await seek(page, time);
    await expect(health).toHaveAttribute("max", "780");
    await expect(health).toHaveAttribute("value", current);
    const screenshot = await canvas.screenshot({
      path: testInfo.outputPath(
        `recorded-overhead-health-${time.toString()}.png`,
      ),
    });
    expect(await centerChampionHealthFill(page, screenshot)).toBe(fill);
  }
  await roster.screenshot({
    path: testInfo.outputPath("recorded-champion-health.png"),
  });
  await page.getByRole("button", { name: "Map overview" }).click();
}

function centerChampionHealthFill(page: Page, screenshot: Buffer) {
  return page.evaluate(async (png) => {
    const frame = new globalThis.Image();
    frame.src = `data:image/png;base64,${png}`;
    await frame.decode();
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = frame.width;
    canvas.height = frame.height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Cannot inspect the replay frame.");
    context.drawImage(frame, 0, 0);

    // Following the champion centers its anchor horizontally. Read the blue
    // gauge fill from the captured WebGL frame, including the one-pixel case.
    const left = Math.round(frame.width / 2 - 27);
    const top = Math.floor(frame.height * 0.37);
    const height = Math.ceil(frame.height * 0.12);
    const { data } = context.getImageData(left, top, 54, height);
    const matches = (offset: number, r: number, g: number, b: number) =>
      data[offset] === r && data[offset + 1] === g && data[offset + 2] === b;
    for (let row = 0; row < height - 6; row += 1) {
      const start = row * 54 * 4;
      const inside = start + 55 * 4;
      if (
        !matches(start, 15, 23, 31) ||
        !matches(start + 53 * 4, 15, 23, 31) ||
        !matches(inside, 94, 173, 212)
      )
        continue;
      let width = 1;
      while (width < 52 && matches(inside + width * 4, 94, 173, 212))
        width += 1;
      return width;
    }
    return 0;
  }, screenshot.toString("base64"));
}

export async function verifyRecordedChampionLifecycle(
  page: Page,
  testInfo: TestInfo,
  championHealth: boolean,
) {
  await verifyFirstRecordedDeath(page, testInfo);
  if (championHealth) await verifyRecordedChampionHealth(page, testInfo);

  const score = page.getByRole("group", { name: "Replay team score" });
  const objectives = page.getByRole("combobox", { name: "Jump to event" });
  const eliminations = objectives.locator('optgroup[label="Eliminations"]');
  await expect(eliminations.locator("option")).toHaveCount(52);
  await objectives.selectOption({ label: "1:19 · Urgot eliminated Renekton" });
  const clock = page.getByRole("slider", { name: "Replay time" });
  await expect(clock).toHaveAttribute("aria-valuetext", "1:19");
  await expect(clock).toHaveAttribute("aria-busy", "false");
  await expect(score).toContainText(/Red team\s*1\s*kills/);

  const dragon = objectives.getByRole("option", {
    name: /^7:11 · .+ slays a dragon$/,
  });
  await expect(dragon).toHaveCount(1);
  const target = await dragon.getAttribute("value");
  if (target === null)
    throw new Error("The recorded dragon has no jump target.");
  await objectives.selectOption(target);
  await expect(clock).toHaveAttribute("aria-valuetext", "7:11");
  await expect(clock).toHaveAttribute("aria-busy", "false");
}
