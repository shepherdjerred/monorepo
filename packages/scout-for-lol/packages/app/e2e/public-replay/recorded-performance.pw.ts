import { expect, test, type Page } from "@playwright/test";
import {
  captureRecordedCompositor,
  summarizeFrameStarts,
} from "./proof/recorded-compositor-trace.ts";
import { recordedInhibitorReturnWitnesses } from "./recorded-inhibitor-assertions.ts";
import { readRecordedReplay, replayPath } from "./recorded-replay-data.ts";
import {
  observeRecordedReplayRequests,
  readRecordedParticleTrack,
  seek,
} from "./recorded-replay-fixture.ts";

const sceneLabel = "League of Legends replay scene";
const sampleMilliseconds = 5000;
const reviewedLongReplay =
  "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668";
const reviewedCurrentRift =
  "a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1";
type SamplingWindow = {
  label: string;
  timeSeconds: number;
  perspective?: "blue" | "red";
  follow?: number;
  verifyParticleDraws?: true;
  verifyIndexedParticleDraws?: true;
  verifyMaskedGroundDraws?: true;
};
const reviewedScenes = [
  { label: "opening", timeSeconds: 15 },
  { label: "first lane wave clock", timeSeconds: 38.5 },
  { label: "first champion kill", timeSeconds: 78 },
  { label: "Fire Dragon movement", timeSeconds: 1063.9 },
  { label: "late siege waves", timeSeconds: 1200 },
  { label: "super minion wave", timeSeconds: 1500 },
  { label: "closing structures", timeSeconds: 1734 },
] as const;
const reviewedAnimationViews = [
  { label: "Warwick recorded ability", timeSeconds: 1033.4 },
  { label: "Galio recorded ability", timeSeconds: 1708.1 },
] as const;
const reviewedFollowViews = [
  { label: "Renekton follow", timeSeconds: 15, follow: 1_073_742_161 },
  { label: "Galio ability follow", timeSeconds: 1708.1, follow: 1_073_742_170 },
] as const;
const reviewedTeamViews = [
  {
    label: "opening red-team visibility",
    timeSeconds: 33.1,
    perspective: "red",
  },
  {
    label: "late blue-team visibility",
    timeSeconds: 1500,
    perspective: "blue",
  },
] as const;
type WorkerLifetime = { openedMs: number; closedMs: number | null };

function verifySamplingDraws(
  window: SamplingWindow,
  counts: {
    particleDraws: number;
    indexedParticleDraws: number;
    maskedGroundDraws: number;
  },
) {
  if (window.verifyParticleDraws === true)
    expect(counts.particleDraws).toBeGreaterThan(0);
  if (window.verifyIndexedParticleDraws === true)
    expect(counts.indexedParticleDraws).toBeGreaterThan(0);
  if (window.verifyMaskedGroundDraws === true)
    expect(counts.maskedGroundDraws).toBeGreaterThan(0);
}

declare global {
  var recordedFrameStarts: number[];
  var recordedPerformanceParticleDraws: number;
  var recordedPerformanceIndexedParticleDraws: number;
  var recordedPerformanceMaskedGroundDraws: number;
}

async function installFrameProbe(page: Page) {
  await page.addInitScript((label) => {
    const starts: number[] = [];
    globalThis.recordedFrameStarts = starts;
    globalThis.recordedPerformanceParticleDraws = 0;
    globalThis.recordedPerformanceIndexedParticleDraws = 0;
    globalThis.recordedPerformanceMaskedGroundDraws = 0;
    const gl = WebGL2RenderingContext.prototype;
    const clear = Reflect.get(gl, "clear");
    gl.clear = function (mask) {
      if (
        mask === (this.COLOR_BUFFER_BIT | this.DEPTH_BUFFER_BIT) &&
        this.canvas instanceof HTMLCanvasElement &&
        this.canvas.getAttribute("aria-label") === label
      )
        starts.push(performance.now());
      clear.call(this, mask);
    };
    const particlePrograms = new WeakSet<WebGLProgram>();
    const maskedGroundPrograms = new WeakSet<WebGLProgram>();
    const activePrograms = new WeakMap<WebGL2RenderingContext, boolean>();
    const activeMaskedGround = new WeakMap<WebGL2RenderingContext, boolean>();
    const getUniformBlockIndex = Reflect.get(gl, "getUniformBlockIndex");
    const getUniformLocation = Reflect.get(gl, "getUniformLocation");
    const useProgram = Reflect.get(gl, "useProgram");
    const drawElements = Reflect.get(gl, "drawElements");
    gl.getUniformBlockIndex = function (program, name) {
      const index = getUniformBlockIndex.call(this, program, name);
      if (
        name === "VFXDynamicPerParticleInstanceCBVS_vs" &&
        index !== this.INVALID_INDEX
      )
        particlePrograms.add(program);
      return index;
    };
    gl.getUniformLocation = function (program, name) {
      const location = getUniformLocation.call(this, program, name);
      if (location !== null && name === "NAVMESH_MASK_TEXTURE_SharedTexture")
        maskedGroundPrograms.add(program);
      return location;
    };
    gl.useProgram = function (program) {
      activePrograms.set(
        this,
        program !== null && particlePrograms.has(program),
      );
      activeMaskedGround.set(
        this,
        program !== null && maskedGroundPrograms.has(program),
      );
      useProgram.call(this, program);
    };
    gl.drawElements = function (mode, count, type, offset) {
      drawElements.call(this, mode, count, type, offset);
      if (
        count === 12 &&
        mode === this.TRIANGLES &&
        type === this.UNSIGNED_SHORT &&
        activeMaskedGround.get(this) === true
      )
        globalThis.recordedPerformanceMaskedGroundDraws += 1;
      if (
        count > 0 &&
        mode === this.TRIANGLES &&
        activePrograms.get(this) === true
      ) {
        globalThis.recordedPerformanceParticleDraws += 1;
        if (count !== 6 && activeMaskedGround.get(this) !== true)
          globalThis.recordedPerformanceIndexedParticleDraws += 1;
      }
    };
  }, sceneLabel);
}

function observeWorkerLifetimes(page: Page) {
  const navigationStart = performance.now();
  const workers: WorkerLifetime[] = [];
  page.on("worker", (worker) => {
    const lifetime: WorkerLifetime = {
      openedMs: performance.now() - navigationStart,
      closedMs: null,
    };
    workers.push(lifetime);
    worker.on("close", () => {
      lifetime.closedMs = performance.now() - navigationStart;
    });
  });
  return workers;
}

async function preparePlaybackSurface(page: Page) {
  await installFrameProbe(page);
  const play = page.getByRole("button", { name: "Play", exact: true });
  await page.goto(replayPath);
  await expect(play).toBeVisible();
  const canvas = page.getByLabel(sceneLabel);
  const surface = await canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement))
      throw new TypeError("Missing canvas.");
    const context = element.getContext("webgl2");
    if (context === null) throw new Error("Missing WebGL 2 context.");
    const debug = context.getExtension("WEBGL_debug_renderer_info");
    const css = element.getBoundingClientRect();
    return {
      pixels: [context.drawingBufferWidth, context.drawingBufferHeight],
      cssPixels: [css.width, css.height],
      viewportCssPixels: [globalThis.innerWidth, globalThis.innerHeight],
      devicePixelRatio: globalThis.devicePixelRatio,
      renderer:
        debug === null
          ? null
          : String(context.getParameter(debug.UNMASKED_RENDERER_WEBGL)),
      visibility: document.visibilityState,
    };
  });
  expect(surface.pixels).toEqual([1920, 1080]);
  return { play, surface };
}

function reviewedInhibitorReturnWindows(
  fixture: Awaited<ReturnType<typeof readRecordedReplay>>,
) {
  const returnSeconds = fixture.directInhibitors
    ? recordedInhibitorReturnWitnesses.map(({ returnedAt }) => returnedAt)
    : (fixture.inhibitorInstances ?? [])
        .flatMap(({ inactiveRanges }) =>
          (inactiveRanges ?? []).map(([, end]) => end),
        )
        .filter((end) => end !== null);
  return returnSeconds.map((end) => ({
    label: `inhibitor return at ${Math.floor(end).toString()}s`,
    timeSeconds: Math.floor(end) - 2,
  }));
}

async function currentRiftSamplingWindows(
  fixture: Awaited<ReturnType<typeof readRecordedReplay>>,
): Promise<readonly SamplingWindow[]> {
  const track = await readRecordedParticleTrack(fixture);
  const hasFightParticles =
    track?.effects.some(({ start }) => start >= 1714 && start < 1719) ?? false;
  return [
    { label: "opening", timeSeconds: 15 },
    { label: "first lane wave", timeSeconds: 36 },
    {
      label: "first champion elimination",
      timeSeconds: 118,
      ...(fixture.followCameraDefaults === undefined
        ? {}
        : { follow: 1_073_742_169 }),
    },
    ...(fixture.directTerrainVisibility || fixture.terrainVisibility
      ? [{ label: "Mountain terrain transition", timeSeconds: 881 }]
      : []),
    { label: "first turret loss", timeSeconds: 854 },
    ...((fixture.directNeutralModels?.length ?? 0) > 0
      ? [{ label: "Rift Herald movement", timeSeconds: 954.5 }]
      : []),
    ...(fixture.directNeutralCamps
      ? [{ label: "Scuttle movement and defeat", timeSeconds: 231 }]
      : []),
    { label: "siege wave", timeSeconds: 1200 },
    ...(hasFightParticles
      ? [
          {
            label: "recorded particle fight",
            timeSeconds: 1714,
            follow: 1_073_742_170,
            verifyParticleDraws: true as const,
            ...(track !== undefined && "worldRibbon" in track
              ? { verifyIndexedParticleDraws: true as const }
              : {}),
            ...(track?.schema === 6
              ? { verifyMaskedGroundDraws: true as const }
              : {}),
          },
        ]
      : []),
    ...(fixture.unitVisibility
      ? [
          {
            label: "blue-team vision",
            timeSeconds: 1200,
            perspective: "blue" as const,
          },
          {
            label: "red-team vision",
            timeSeconds: 2076,
            perspective: "red" as const,
          },
        ]
      : []),
    { label: "late super minions", timeSeconds: 2076 },
    ...reviewedInhibitorReturnWindows(fixture),
  ];
}

async function reviewedSamplingWindows(
  fixture: Awaited<ReturnType<typeof readRecordedReplay>>,
): Promise<readonly SamplingWindow[]> {
  if (fixture.descriptor.sha256 === reviewedCurrentRift)
    return currentRiftSamplingWindows(fixture);
  if (fixture.descriptor.sha256 !== reviewedLongReplay)
    return [
      {
        label: "mid-match",
        timeSeconds: Math.floor(fixture.descriptor.durationSeconds / 2),
      },
    ];
  return [
    ...reviewedScenes,
    ...(fixture.unitVisibility ? reviewedTeamViews : []),
    ...(fixture.championAnimationCueCount > 1 ? reviewedAnimationViews : []),
    ...(fixture.followCameraDefaults === undefined ? [] : reviewedFollowViews),
  ];
}

test("samples recorded replay frame submissions at 1080p and both playback rates", async ({
  baseURL,
  browser,
  page,
}, testInfo) => {
  if (baseURL === undefined)
    throw new Error("A loopback base URL is required.");
  const fixture = await readRecordedReplay();
  const traffic = await observeRecordedReplayRequests(page, baseURL);
  const workers = observeWorkerLifetimes(page);
  const { play, surface } = await preparePlaybackSurface(page);
  const scenes = await reviewedSamplingWindows(fixture);
  const clock = page.getByRole("slider", { name: "Replay time" });
  const camera = page.getByRole("combobox", { name: "Camera" });
  const samples = [];
  for (const scene of scenes) {
    const {
      label,
      timeSeconds: sceneTime,
      perspective = "all",
      follow = null,
    } = scene;
    await camera.selectOption(
      follow === null ? "free" : `player:${String(follow)}`,
    );
    if (fixture.unitVisibility)
      await page
        .getByRole("combobox", { name: "Unit visibility" })
        .selectOption(perspective);
    for (const rate of [1, 4]) {
      await seek(page, sceneTime);
      await page
        .getByRole("combobox", { name: "Speed" })
        .selectOption(String(rate));
      const beforeDraws = await page.evaluate(() => ({
        indexed: globalThis.recordedPerformanceIndexedParticleDraws,
        masked: globalThis.recordedPerformanceMaskedGroundDraws,
      }));
      await play.click();
      await expect
        .poll(async () => Number(await clock.inputValue()))
        .toBeGreaterThan(sceneTime);
      const initialTime = Number(await clock.inputValue());
      const workersAtStart = page.workers().length;
      // Sample draw starts after playback begins. The browser timer does not
      // block rendering, and no Playwright calls run while sampling.
      const { starts, particleDraws } = await page.evaluate(
        async (duration) => {
          const frames = globalThis.recordedFrameStarts;
          const start = frames.length;
          const initialParticles = globalThis.recordedPerformanceParticleDraws;
          await new Promise<void>((resolve) =>
            globalThis.setTimeout(resolve, duration),
          );
          return {
            starts: frames.slice(start),
            particleDraws:
              globalThis.recordedPerformanceParticleDraws - initialParticles,
          };
        },
        sampleMilliseconds,
      );
      const finalTime = Number(await clock.inputValue());
      const { indexedParticleDraws, maskedGroundDraws } = await page.evaluate(
        (before) => ({
          indexedParticleDraws:
            globalThis.recordedPerformanceIndexedParticleDraws - before.indexed,
          maskedGroundDraws:
            globalThis.recordedPerformanceMaskedGroundDraws - before.masked,
        }),
        beforeDraws,
      );
      const workersAtEnd = page.workers().length;
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      expect(starts.length).toBeGreaterThan(1);
      expect(finalTime).toBeGreaterThan(initialTime);
      verifySamplingDraws(scene, {
        particleDraws,
        indexedParticleDraws,
        maskedGroundDraws,
      });
      samples.push({
        scene: label,
        requestedStartTime: sceneTime,
        rate,
        perspective,
        follow,
        initialTime,
        finalTime,
        workersAtStart,
        workersAtEnd,
        particleDraws,
        indexedParticleDraws,
        maskedGroundDraws,
        ...summarizeFrameStarts(starts),
      });
    }
  }
  expect(traffic.credentialed.size).toBe(0);
  const receipt = JSON.stringify(
    {
      browserVersion: browser.version(),
      headless: true,
      build: fixture.descriptor.gameBuild,
      replaySha256: fixture.descriptor.sha256,
      manifestSha256: fixture.descriptor.playback.package.sha256,
      durationSeconds: fixture.descriptor.durationSeconds,
      surface,
      sampleMilliseconds,
      scenes,
      measurement: "Headless WebGL scene frame starts at color/depth clear",
      samples,
      workers,
      requestedMotionWorker: [...traffic.requested].some((url) =>
        url.endsWith("/replay-motion-worker.mjs"),
      ),
    },
    null,
    2,
  );
  await Bun.write(testInfo.outputPath("frame-submissions.json"), receipt);
});

test("samples replay compositor draws at 1080p and both playback rates", async ({
  baseURL,
  browser,
  page,
}, testInfo) => {
  if (baseURL === undefined)
    throw new Error("A loopback base URL is required.");
  const fixture = await readRecordedReplay();
  const traffic = await observeRecordedReplayRequests(page, baseURL);
  const { play, surface } = await preparePlaybackSurface(page);
  const scenes = await reviewedSamplingWindows(fixture);
  const scene =
    scenes.find(({ verifyParticleDraws }) => verifyParticleDraws === true) ??
    scenes[0];
  if (scene === undefined) throw new Error("Missing replay sampling scene.");
  if (scene.follow !== undefined)
    await page
      .getByRole("combobox", { name: "Camera" })
      .selectOption(`player:${String(scene.follow)}`);
  const clock = page.getByRole("slider", { name: "Replay time" });
  const samples = [];
  for (const rate of [1, 4]) {
    await seek(page, scene.timeSeconds);
    await page
      .getByRole("combobox", { name: "Speed" })
      .selectOption(String(rate));
    const { drawTimes, ...compositor } = await captureRecordedCompositor(
      browser,
      {
        clock,
        play,
        pause: page.getByRole("button", { name: "Pause", exact: true }),
        sceneTime: scene.timeSeconds,
        duration: sampleMilliseconds,
      },
    );
    expect(compositor.finalTime).toBeGreaterThan(compositor.initialTime);
    expect(compositor.sceneSubmissions).toBeGreaterThan(1);
    if (scene.verifyParticleDraws === true)
      expect(compositor.particleDraws).toBeGreaterThan(0);
    expect(drawTimes.length).toBeGreaterThan(1);
    const intervals = summarizeFrameStarts(drawTimes);
    samples.push({
      rate,
      ...compositor,
      drawFrames: intervals.frameSubmissions,
      drawsPerSecond: intervals.submissionsPerSecond,
      intervalMilliseconds: intervals.intervalMilliseconds,
    });
  }
  expect(traffic.credentialed.size).toBe(0);
  await Bun.write(
    testInfo.outputPath("compositor-draws.json"),
    JSON.stringify(
      {
        browserVersion: browser.version(),
        headless: true,
        replaySha256: fixture.descriptor.sha256,
        manifestSha256: fixture.descriptor.playback.package.sha256,
        measurement:
          "Chromium compositor DrawFrame trace events for the replay page",
        surface,
        scene,
        samples,
      },
      null,
      2,
    ),
  );
});
