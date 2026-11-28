import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { z } from "zod";
import {
  installRecordedDrawProbe,
  readRecordedDraw,
} from "#replay-e2e/recorded-draw-probe.ts";
import {
  contentPath,
  readRecordedReplay,
  replayPath,
  sha256,
} from "#replay-e2e/recorded-replay-data.ts";
import {
  observeRecordedReplayRequests,
  seek,
} from "#replay-e2e/recorded-replay-fixture.ts";
import {
  readFooterScores,
  verifyFooterRoster,
} from "./recorded-footer-score.ts";
import {
  observeMayhemFlowMap,
  verifyMayhemFlowMap,
} from "./recorded-mayhem-flowmap.ts";

const mayhemReplaySha256 =
  "4bb0f94d3ceb19df374c0937a9e59dcc866a5b92e4727b81c6c7d5b3aca970b7";

const worldImpact = z.object({
  texture: z.string(),
  paths: z.array(z.unknown()),
});

async function verifyMayhemImpacts(
  page: Page,
  fixture: Awaited<ReturnType<typeof readRecordedReplay>>,
) {
  const leaves = new Set(fixture.paths.values());
  if (!leaves.has("recorded-particles.json")) return;
  expect(fixture.particlePreview).toBeUndefined();
  const track = z
    .object({
      worldImpact,
      additionalWorldImpacts: z.array(worldImpact).optional(),
      families: z.array(z.object({ id: z.string() })),
      effects: z.array(z.object({ family: z.string() })),
    })
    .parse(
      await Bun.file(path.join(fixture.root, "recorded-particles.json")).json(),
    );
  const flashPlacements = [
    track.worldImpact,
    ...(track.additionalWorldImpacts ?? []),
  ]
    .filter(({ texture }) => texture === track.worldImpact.texture)
    .reduce((count, { paths }) => count + paths.length, 0);
  expect([2, 28]).toContain(flashPlacements);
  const flash =
    flashPlacements === 28
      ? ([
          [83.2, 0],
          [83.4, 2],
          [84.7, 2],
          [84.8, 2],
          [85.1, 0],
        ] as const)
      : ([
          [84.7, 0],
          [84.8, 2],
          [85, 0],
        ] as const);
  const maokai = leaves.has(
    "recorded-particles/ed32f9d687e5b8932f4dd361d4bb8e0966ada34195d2c3cb7846f1867660b1ae.png",
  )
    ? ([
        [81.1, 0],
        [81.3, 1],
        [82.4, 0],
      ] as const)
    : [];
  const heimer = track.families.some(({ id }) => id === "heimerdinger-w-impact")
    ? ([
        [75.2, 0],
        [75.4, 10],
        [75.7, 0],
      ] as const)
    : [];
  const hasAmmo = track.families.some(
    ({ id }) => id === "heimerdinger-q-ammo-spend",
  );
  const ammo = hasAmmo
    ? ([
        [81.7, maokai.length === 0 ? 0 : 1],
        [82, maokai.length === 0 ? 1 : 2],
        [82.4, 0],
      ] as const)
    : [];
  expect(
    track.effects.filter(({ family }) => family === "heimerdinger-w-impact"),
  ).toHaveLength(heimer.length === 0 ? 0 : 210);
  expect(
    track.effects.filter(
      ({ family }) => family === "heimerdinger-q-ammo-spend",
    ),
  ).toHaveLength(hasAmmo ? 84 : 0);
  expect(track.effects).toHaveLength(
    (heimer.length === 0 ? 0 : 210) + (hasAmmo ? 84 : 0),
  );
  for (const [time, draws] of [...flash, ...maokai, ...heimer, ...ammo]) {
    await seek(page, time);
    const frame = await readRecordedDraw(page);
    expect(frame.recordedParticleDraws).toBe(draws);
    expect(frame.recordedDepthDisabledParticleDraws).toBe(0);
  }
}

test("signed-out Bloom replay plays the opening fight at 1× and restores a share", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  if (baseURL === undefined)
    throw new Error("A loopback base URL is required.");
  const fixture = await readRecordedReplay();
  const footer = await readFooterScores(fixture.roflPath);
  expect(fixture.descriptor).toMatchObject({
    mapId: 12,
    gameMode: "KIWI",
    sha256: mayhemReplaySha256,
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const traffic = await observeRecordedReplayRequests(page, baseURL);
  await installRecordedDrawProbe(page);
  const response = await page.goto(replayPath);
  expect(response?.ok()).toBe(true);

  const play = page.getByRole("button", { name: "Play", exact: true });
  const canvas = page.getByLabel("League of Legends replay scene");
  const slider = page.getByRole("slider", { name: "Replay time" });
  const camera = page.getByRole("combobox", { name: "Camera" });
  const score = page.getByRole("group", { name: "Replay team score" });
  const laneModels = [...fixture.paths.values()].filter((asset) =>
    asset.startsWith("world-unit-models/"),
  );
  const laneMinions = page.locator("[data-map-actor=minion]");
  await expect(play).toBeEnabled();
  await expect(page.getByRole("combobox", { name: "Speed" })).toHaveValue("1");
  expect(laneModels).toHaveLength(8);
  await seek(page, 49);
  await expect(laneMinions).toHaveCount(0);
  await seek(page, 60);
  await expect(camera.getByRole("option")).toHaveCount(11);
  await expect(score).toContainText(/Red team\s*0\s*kills/);
  const opening = await readRecordedDraw(page);
  expect(opening.texturedIndices).toBeGreaterThan(0);
  // The seven authored foliage materials cover 160 terrain submeshes.
  expect(opening.terrainBlendDraws).toHaveLength(160);
  expect(
    opening.terrainBlendDraws.reduce((sum, draw) => sum + draw.indexCount, 0),
  ).toBe(84_981);
  for (const draw of opening.terrainBlendDraws) {
    expect(draw).toMatchObject({
      depthWrites: false,
      factors: [770, 771, 770, 771],
    });
  }
  const scene = z
    .object({ bloomTurretCores: z.object({}).optional() })
    .parse(await Bun.file(path.join(fixture.root, "scene.json")).json());
  expect(
    new Set(opening.actorOrigins.map((origin) => origin.join(","))).size,
  ).toBe(scene.bloomTurretCores === undefined ? 22 : 30);
  await expect(laneMinions).toHaveCount(12);
  const openingPixels = sha256(
    await canvas.screenshot({
      path: testInfo.outputPath("bloom-opening-fight.png"),
    }),
  );
  await play.click();
  await expect
    .poll(async () => Number(await slider.inputValue()), {
      timeout: 45_000,
    })
    .toBeGreaterThanOrEqual(90);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  expect(
    sha256(
      await canvas.screenshot({
        path: testInfo.outputPath("bloom-after-fight.png"),
      }),
    ),
  ).not.toBe(openingPixels);
  await verifyMayhemImpacts(page, fixture);
  await seek(page, 60);
  expect(await readRecordedDraw(page)).toMatchObject({
    actorOrigins: opening.actorOrigins,
  });

  const jumps = page.getByRole("combobox", { name: "Jump to event" });
  const eliminations = jumps.locator('optgroup[label="Eliminations"] option');
  await expect(eliminations).toHaveCount(footer.blueKills + footer.redKills);
  const firstElimination = await eliminations.first().getAttribute("value");
  if (firstElimination === null)
    throw new Error("Missing first Mayhem elimination target.");
  await jumps.selectOption(firstElimination);
  await expect(slider).toHaveAttribute("aria-valuetext", "1:24");
  await expect(slider).toHaveAttribute("aria-busy", "false");
  await expect(score).toContainText(/Red team\s*1\s*kills/);
  await slider.press("End");
  await expect(score.getByText(footer.winner)).toBeVisible();
  await expect(slider).toHaveAttribute("aria-busy", "false");
  await verifyFooterRoster(page, footer.roster);
  await seek(page, 60);
  await expect(score).toContainText(/Red team\s*0\s*kills/);
  await expect(score).not.toContainText(footer.winner);
  expect(traffic.requested).toContain(contentPath);
  expect(traffic.requested).toContain(fixture.packageUrl);
  expect(traffic.credentialed.size).toBe(0);
  expect(errors).toEqual([]);

  const shared = await browser.newPage();
  try {
    const flowControl = [...fixture.paths.values()].includes(
      "flowmap-control/manifest.json",
    );
    if (flowControl) await observeMayhemFlowMap(shared);
    const share = new URL(replayPath, baseURL);
    share.search = new URLSearchParams({
      t: "65",
      follow: "1073741892",
    }).toString();
    const sharedResponse = await shared.goto(share.href);
    expect(sharedResponse?.ok()).toBe(true);
    await expect(
      shared.getByRole("button", { name: "Play", exact: true }),
    ).toBeEnabled();
    await expect(
      shared.getByRole("slider", { name: "Replay time" }),
    ).toHaveValue("65");
    await expect(shared.getByRole("combobox", { name: "Camera" })).toHaveValue(
      "player:1073741892",
    );
    const soraka = shared.getByRole("row").filter({
      has: shared.getByText("Soraka", { exact: true }),
    });
    await expect(soraka.getByRole("cell").nth(3)).toHaveText("3");
    const health = soraka.getByRole("meter", { name: / health$/ });
    await expect(health).toHaveAttribute("value", "673.7326049804688");
    await expect(health).toHaveAttribute("max", "799.505859375");
    if (fixture.championExperience) {
      const progress = soraka.getByRole("meter", { name: / experience$/ });
      await expect(progress).toHaveAttribute("value", "320.5");
      await expect(progress).toHaveAttribute("max", "478");
      await expect(soraka.getByText("982.5 total XP")).toBeVisible();
    }
    if (flowControl) await verifyMayhemFlowMap(shared);
    await shared.screenshot({ path: testInfo.outputPath("bloom-soraka.png") });
  } finally {
    await shared.close();
  }
});
