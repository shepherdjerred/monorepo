import { expect, test } from "@playwright/test";
import path from "node:path";
import { readReplayContainerIdentity } from "@scout-for-lol/replay/packets";
import { z } from "zod";
import {
  readFooterScores,
  verifyFooterRoster,
} from "./proof/recorded-footer-score.ts";
import { verifyRecordedChampionModels } from "./proof/champion-model-oracle.ts";
import { observeRecordedItemBlobs } from "./proof/current-inventory.ts";
import { verifyRecordedInhibitorReturns } from "./recorded-inhibitor-assertions.ts";
import { verifyDirectChampionStatsWorker } from "./proof/champion-stats-worker.ts";
import { observeDirectChampionStatsWorker } from "./proof/motion-worker-capture.ts";
import { verifyRecordedNeutralObjectives } from "./recorded-neutral-assertions.ts";
import {
  verifyRecordedChampionLifecycle,
  verifyRecordedRoster,
} from "./recorded-lifecycle-assertions.ts";
import { verifyRecordedChampionAnimation } from "./recorded-animation-assertions.ts";
import { verifyRecordedTeamVision } from "./recorded-vision-assertions.ts";
import {
  installRecordedDrawProbe,
  readRecordedDraw,
} from "./recorded-draw-probe.ts";
import {
  apiPath,
  contentPath,
  readRecordedReplay,
  replayPath,
  sha256,
} from "./recorded-replay-data.ts";
import {
  observeRecordedReplayRequests,
  seek,
  verifyRecordedParticlePreview,
} from "./recorded-replay-fixture.ts";
import {
  readRecordedTerrainRanges,
  verifyLateTerrain,
  verifyOpeningTerrain,
  verifyRecordedTerrainTransitions as verifyTerrainChanges,
} from "./recorded-terrain-assertions.ts";
import {
  verifyLaterRecordedLaneWaves,
  verifyRecordedChemtechAnchor,
  verifyRecordedStructures,
  verifyRecordedWorldActors,
} from "./recorded-world-assertions.ts";

async function sceneDerivesRoster(root: string) {
  const { participants } = z
    .object({ participants: z.array(z.unknown()).optional() })
    .parse(await Bun.file(path.join(root, "scene.json")).json());
  return (participants?.length ?? 0) === 0;
}

test("the build-scoped package rejects a same-build replay from the wrong map", async ({
  page,
}) => {
  const wrongMapPath = Bun.env["SCOUT_REPLAY_E2E_WRONG_MAP_ROFL"];
  test.skip(
    wrongMapPath === undefined,
    "Requires a genuine same-build replay from another map.",
  );
  if (wrongMapPath === undefined) return;
  const fixture = await readRecordedReplay();
  expect(fixture.buildScoped).toBe(true);
  const replay = await Bun.file(wrongMapPath).arrayBuffer();
  const identity = readReplayContainerIdentity(replay);
  expect(identity.build).toBe(fixture.descriptor.gameBuild);
  expect(identity.protocol).toBe(fixture.descriptor.protocol);
  expect(identity.participantCount).toBe(10);
  const replaySha256 = sha256(new Uint8Array(replay));
  expect(replaySha256).not.toBe(fixture.descriptor.sha256);
  await page.route(apiPath, (route) =>
    route.fulfill({
      json: {
        ...fixture.descriptor,
        sha256: replaySha256,
        bytes: replay.byteLength,
        durationSeconds: identity.durationMilliseconds / 1000,
      },
    }),
  );
  await page.route(contentPath, (route) =>
    route.fulfill({
      path: wrongMapPath,
      contentType: "application/vnd.riot.rofl",
    }),
  );
  await page.goto(replayPath);
  const player = page.getByRole("region", { name: "Replay player" });
  await expect(player.getByRole("alert")).toContainText(/Map11|turret|Nexus/u);
  await expect(
    player.getByRole("button", { name: "Play", exact: true }),
  ).toHaveCount(0);
});

function verifyCameraProjection(
  draw: Awaited<ReturnType<typeof readRecordedDraw>>,
  defaults: Awaited<
    ReturnType<typeof readRecordedReplay>
  >["followCameraDefaults"],
  zoom = 1,
  follow = true,
) {
  if (follow && Bun.env["SCOUT_REPLAY_E2E_EXPECT_CLASSIC_FAR"] === "1")
    expect(defaults?.farClipping).toEqual({
      base: 10_000,
      configuredDistance: 2250,
    });
  const { viewProjection, actorOrigins } = draw;
  const at = (index: number) => viewProjection.at(index) ?? Number.NaN;
  const projectionRowLength = (row: number) =>
    Math.hypot(at(row), at(row + 4), at(row + 8));
  const verticalFov = defaults?.verticalFovDegrees ?? 48;
  const nearClip = defaults?.nearClip ?? 100;
  const farClipping = defaults?.farClipping;
  const farClip =
    farClipping === undefined
      ? 100_000
      : farClipping.base + farClipping.configuredDistance / zoom;
  expect(projectionRowLength(1)).toBeCloseTo(
    1 / Math.tan((verticalFov * Math.PI) / 360),
    5,
  );
  const depthGain = projectionRowLength(2) / projectionRowLength(3);
  const depthBias = depthGain * at(15) - at(14);
  expect(depthBias / (depthGain + 1)).toBeCloseTo(nearClip, 1);
  expect(depthGain).toBeCloseTo((farClip + nearClip) / (farClip - nearClip), 6);
  if (defaults === undefined) return;
  const pitch = (defaults.pitchDegrees * Math.PI) / 180;
  expect(at(3)).toBeCloseTo(0, 5);
  expect(at(7)).toBeCloseTo(-Math.sin(pitch), 5);
  expect(at(11)).toBeCloseTo(Math.cos(pitch), 5);
  const centered = actorOrigins.find((point) =>
    [0, 1].every(
      (row) =>
        Math.abs(
          point.reduce(
            (sum, value, col) => sum + value * at(row + col * 4),
            at(row + 12),
          ),
        ) < 0.01,
    ),
  );
  if (centered === undefined)
    throw new Error("Follow target was not centered.");
  const distance = centered.reduce(
    (sum, value, col) => sum + value * at(3 + col * 4),
    at(15),
  );
  expect(distance).toBeCloseTo(defaults.eyeDistance / zoom, 2);
}

test("signed-out recorded replay draws textured terrain, seeks, rewinds and restores a share", async ({
  baseURL,
  browser,
  page,
}, testInfo) => {
  if (baseURL === undefined)
    throw new Error("A loopback base URL is required.");
  const fixture = await readRecordedReplay();
  const result = await readFooterScores(fixture.roflPath);
  const traffic = await observeRecordedReplayRequests(page, baseURL);
  await installRecordedDrawProbe(page);
  await observeRecordedItemBlobs(page);
  if (fixture.directReplayObservations)
    await observeDirectChampionStatsWorker(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText(text: string) {
          sessionStorage.setItem("recorded-replay-copied-link", text);
          return Promise.resolve();
        },
      },
    });
  });
  await page.goto(replayPath);
  const play = page.getByRole("button", { name: "Play", exact: true });
  const playbackError = page
    .getByRole("region", { name: "Replay player" })
    .getByRole("alert");
  const canvas = page.getByLabel("League of Legends replay scene");
  const score = page.getByRole("group", { name: "Replay team score" });
  await expect(play.or(playbackError)).toBeVisible();
  if (await playbackError.isVisible())
    throw new Error(
      `Recorded playback failed: ${await playbackError.innerText()}`,
    );
  await expect(play).toBeVisible();
  const vision = page.getByRole("combobox", {
    name: fixture.unitVisibility ? "Unit visibility" : "Vision",
  });
  if (fixture.unitVisibility) {
    await expect(vision).toBeEnabled();
    await expect(vision.getByRole("option")).toHaveText([
      "All vision",
      "Blue team",
      "Red team",
    ]);
  } else {
    await expect(vision).toBeDisabled();
    await expect(vision.getByRole("option")).toHaveText(["All vision"]);
  }
  const camera = page.getByRole("combobox", { name: "Camera" });
  await expect(
    camera.getByRole("option", { name: "Directed camera" }),
  ).toHaveCount(0);
  await expect(score).toContainText(/Blue team\s*0\s*kills/);
  await expect(score).toContainText(/Red team\s*0\s*kills/);
  await expect(score.getByText(result.winner)).toHaveCount(0);
  const { cueCount, terrainVisibility } = await verifyDirectChampionStatsWorker(
    page,
    { ...fixture, deriveParticipants: await sceneDerivesRoster(fixture.root) },
  );
  const terrain = { ...fixture, terrainVisibility };
  const terrainRanges = await readRecordedTerrainRanges(terrain);
  await verifyRecordedRoster(page, fixture, testInfo);
  const opening = await readRecordedDraw(page);
  await verifyRecordedChampionModels(page, fixture, traffic.requested, opening);
  verifyCameraProjection(opening, undefined, 1, false);
  verifyOpeningTerrain(
    opening,
    fixture.sourceAlphaBlendMaterials,
    terrainRanges,
  );
  expect(opening.firstActorState).toEqual({ blend: false, depthWrites: true });
  const openingPixels = await canvas.screenshot({
    path: testInfo.outputPath("opening-overview.png"),
  });
  await play.click();
  await expect
    .poll(async () => Number(await page.getByRole("slider").inputValue()))
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pause", exact: true }).click();

  await seek(page, 15);
  const earlier = await readRecordedDraw(page);
  expect(earlier.actorOrigins.length).toBeGreaterThan(0);
  const beforePan = sha256(await canvas.screenshot());
  const overview = page.getByRole("button", { name: "Map overview" });
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  const zoomOut = page.getByRole("button", { name: "Zoom out" });
  const minimap = page.getByRole("button", { name: "Replay minimap" });
  const championMarkers = minimap.locator('[data-map-actor="champion"]');
  for (const team of [100, 200]) {
    await expect(
      championMarkers.and(
        minimap.locator(`[data-map-actor-team="${String(team)}"]`),
      ),
    ).toHaveCount(5);
  }
  const minimapImage = minimap.locator("img");
  await expect(minimapImage).toHaveAttribute("src", /^blob:/);
  await expect
    .poll(() =>
      minimapImage.evaluate(
        (element) =>
          element instanceof HTMLImageElement &&
          element.complete &&
          element.naturalWidth > 0,
      ),
    )
    .toBe(true);
  const minimapPath = [...fixture.paths.keys()].find((url) =>
    url.endsWith("/minimap.png"),
  );
  expect(traffic.requested).toContain(minimapPath);
  await zoomIn.click();
  expect(sha256(await canvas.screenshot())).not.toBe(beforePan);
  await zoomOut.click();
  expect(sha256(await canvas.screenshot())).toBe(beforePan);
  const openingFollow = await camera
    .locator("option[value^='player:']")
    .first()
    .getAttribute("value");
  if (openingFollow === null)
    throw new Error("A recorded participant is required.");
  await camera.selectOption(openingFollow);
  verifyCameraProjection(
    await readRecordedDraw(page),
    fixture.followCameraDefaults,
  );
  const followView = sha256(
    await canvas.screenshot({
      path: testInfo.outputPath("follow-camera-projection.png"),
    }),
  );
  await zoomIn.click();
  verifyCameraProjection(
    await readRecordedDraw(page),
    fixture.followCameraDefaults,
    1.35,
  );
  expect(sha256(await canvas.screenshot())).not.toBe(followView);
  await minimap.click();
  await expect(camera).toHaveValue("free");
  const clickedView = sha256(await canvas.screenshot());
  expect(clickedView).not.toBe(beforePan);
  await minimap.press("ArrowRight");
  expect(sha256(await canvas.screenshot())).not.toBe(clickedView);
  await minimap.press("Home");
  const keyboardReset = await readRecordedDraw(page);
  expect(keyboardReset.viewProjection).toEqual(earlier.viewProjection);
  const bounds = await canvas.boundingBox();
  if (bounds === null)
    throw new Error("The free camera canvas is not visible.");
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 120, centerY + 55, { steps: 5 });
  await page.mouse.up();
  const panned = await canvas.screenshot({
    path: testInfo.outputPath("free-camera-pan.png"),
  });
  expect(sha256(panned)).not.toBe(beforePan);
  await overview.click();
  expect(sha256(await canvas.screenshot())).toBe(beforePan);
  await canvas.press("ArrowRight");
  expect(sha256(await canvas.screenshot())).not.toBe(beforePan);
  await canvas.press("Home");
  expect(sha256(await canvas.screenshot())).toBe(beforePan);
  await seek(page, 40);
  const later = await readRecordedDraw(page);
  expect(later.texturedIndices).toBe(opening.texturedIndices);
  expect(later.actorOrigins).not.toEqual(earlier.actorOrigins);
  const laterPixels = await canvas.screenshot({
    path: testInfo.outputPath("seek-40-overview.png"),
  });
  expect(sha256(laterPixels)).not.toBe(sha256(openingPixels));
  if (
    fixture.descriptor.sha256 ===
    "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668"
  ) {
    await verifyRecordedChampionLifecycle(
      page,
      testInfo,
      fixture.championHealth,
    );
  }
  await verifyRecordedWorldActors(page, fixture, traffic.requested, testInfo);
  await verifyLaterRecordedLaneWaves(
    page,
    fixture,
    traffic.requested,
    testInfo,
  );
  await verifyRecordedStructures(page, fixture, traffic.requested, {
    testInfo,
    expectedLosses: fixture.descriptor.durationSeconds > 1490.2,
  });
  await verifyRecordedInhibitorReturns(page, fixture, testInfo);
  const lateTime = Math.floor(fixture.descriptor.durationSeconds * 0.85);
  await seek(page, lateTime);
  const lateMatch = await readRecordedDraw(page);
  verifyLateTerrain(lateMatch, opening, lateTime, terrainRanges);
  expect(lateMatch.actorOrigins).not.toEqual(later.actorOrigins);
  await canvas.screenshot({
    path: testInfo.outputPath("late-match-overview.png"),
  });
  await verifyTerrainChanges(page, terrainRanges, terrain, testInfo);
  const slider = page.getByRole("slider", { name: "Replay time" });
  await slider.press("End");
  await expect(score.getByText(result.winner)).toBeVisible();
  await expect(score).toContainText(
    new RegExp(String.raw`Blue team\s*${result.blueKills.toString()}\s*kills`),
  );
  await expect(score).toContainText(
    new RegExp(String.raw`Red team\s*${result.redKills.toString()}\s*kills`),
  );
  await verifyFooterRoster(page, result.roster);
  await expect(slider).toHaveAttribute("aria-busy", "false");
  const end = Number(await slider.inputValue());
  // The range control steps in tenths while the ROFL records milliseconds.
  expect(Math.abs(fixture.descriptor.durationSeconds - end)).toBeLessThan(0.1);
  const endDraw = await readRecordedDraw(page);
  expect(endDraw.texturedIndices).toBeGreaterThan(0);
  await score.screenshot({
    path: testInfo.outputPath("terminal-team-score.png"),
  });
  await seek(page, 15);
  await expect(score.getByText(result.winner)).toHaveCount(0);
  await expect(score).toContainText(/Blue team\s*0\s*kills/);
  await expect(score).toContainText(/Red team\s*0\s*kills/);
  const rewound = await readRecordedDraw(page);
  expect(rewound.actorOrigins).toEqual(earlier.actorOrigins);
  await canvas.screenshot({
    path: testInfo.outputPath("rewind-15-overview.png"),
  });

  const followed = await camera
    .locator("option[value^='player:']")
    .first()
    .getAttribute("value");
  if (followed === null) throw new Error("A recorded participant is required.");
  await camera.selectOption(followed);
  await page.getByRole("button", { name: "Copy replay link" }).click();
  const copied = await page.evaluate(() =>
    globalThis.sessionStorage.getItem("recorded-replay-copied-link"),
  );
  expect(copied).toBe(
    `${baseURL}${replayPath}?t=15&follow=${followed.slice("player:".length)}`,
  );
  expect(traffic.requested).toContain(contentPath);
  expect(traffic.requested).toContain(fixture.packageUrl);
  expect(traffic.requested).toContain(fixture.entrypoint);
  expect(
    [...traffic.requested].some((url) => url.includes("/map-textures/")),
  ).toBe(true);
  expect(traffic.credentialed.size).toBe(0);
  if (copied === null)
    throw new Error("Copy replay link did not return a URL.");
  const viewer = await browser.newContext({
    serviceWorkers: "block",
    viewport: { width: 390, height: 844 },
  });
  try {
    const shared = await viewer.newPage();
    const restored = await observeRecordedReplayRequests(shared, baseURL);
    await installRecordedDrawProbe(shared);
    await shared.goto(copied);
    await expect(
      shared.getByRole("slider", { name: "Replay time" }),
    ).toHaveValue("15");
    await expect(shared.getByRole("combobox", { name: "Camera" })).toHaveValue(
      followed,
    );
    await expect
      .poll(async () => {
        const draw = await readRecordedDraw(shared);
        return draw.texturedIndices;
      })
      .toBeGreaterThan(0);
    expect(restored.requested).toContain(contentPath);
    expect(restored.requested).toContain(fixture.entrypoint);
    expect(restored.credentialed.size).toBe(0);
    await expect(
      shared.getByText("Blue team roster", { exact: true }),
    ).toBeVisible();
    await shared.screenshot({
      path: testInfo.outputPath("narrow-scoreboard.png"),
      fullPage: true,
    });
    await shared.getByLabel("League of Legends replay scene").screenshot({
      path: testInfo.outputPath("restored-share.png"),
    });
    if (fixture.directNeutralModels === undefined)
      await verifyRecordedChemtechAnchor(
        shared,
        fixture.paths.keys(),
        restored.requested,
        testInfo,
      );
  } finally {
    await viewer.close();
  }
  await verifyRecordedNeutralObjectives(
    page,
    fixture,
    traffic.requested,
    testInfo,
  );
  if (fixture.unitVisibility)
    await verifyRecordedTeamVision(page, testInfo, fixture);
  if (cueCount > 0)
    await verifyRecordedChampionAnimation(
      page,
      {
        current: fixture.descriptor.gameBuild === "16.23.841.8428",
        long: fixture.descriptor.durationSeconds > 100,
        cueCount,
      },
      testInfo,
    );
  await verifyRecordedParticlePreview(page, fixture, traffic.requested);
});
