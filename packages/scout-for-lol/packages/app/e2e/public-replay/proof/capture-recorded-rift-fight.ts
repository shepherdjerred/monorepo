import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { PublicReplayDescriptorSchema } from "@scout-for-lol/domain/artifacts/public-replay.ts";
import {
  installRecordedDrawProbe,
  readRecordedDraw,
} from "#replay-e2e/recorded-draw-probe.ts";
import { seek } from "#replay-e2e/recorded-replay-fixture.ts";
import { comparePixels } from "./compare-recorded-pixels.ts";
import { installRiftFightTextureProbe } from "./rift-fight-texture-probe.ts";

// Base texture hashes and inclusive UI-clock windows from the reviewed Rift
// particle track. Multiple instances of a family can draw the same texture.
const textures: Record<string, string> = {
  "77fe7d5cb87d81abbb080dc57dc446e311699df17cc0910d7e815016f6d9d3e4":
    "illaoi-ground-ring",
  "5d12032cdab3f822722f45ac312843f78b3723572181bc760d76d231cee027ce":
    "maokai-r-ribbon",
  c2c40c2bc7f6d15811504ccda9bcdcb3cc8ac1208674a41a3a086bd660e538a9:
    "anivia-q-snowflash",
  "3a6f6646121c4881b8df499088f5d4b99f76b0369a44852a893538caaa8363e3":
    "yasuo-wind-wall-flash",
  a177eee4d856d39db66d579c806ce0fe3cfc72063069860fdb74d2e53a1632d9:
    "heimerdinger-w-impact",
  "13678fbc62c31d02bc3ae0f66f92ad03b8a25ff87f22d0e23180ced7189a57c1":
    "heimerdinger-w-impact",
  "0df0fde80d211e8b9f53222a27b197fa79701a88e049a103554985cb1c1ac633":
    "heimerdinger-q-ammo-spend",
  "33fbb0aa732bf24befe556da253e9fefbac5f19fa1f3551924c4b1f85d63f10b":
    "kaisa-e-activation",
};
const cues: {
  family: string;
  from: number;
  to: number;
  seekAt: number;
  label?: string;
  minimumDraws?: number;
}[] = [
  { family: "illaoi-ground-ring", from: 1712.7, to: 1714.7, seekAt: 1713.1 },
  { family: "maokai-r-ribbon", from: 1714, to: 1715.1, seekAt: 1714.3 },
  { family: "anivia-q-snowflash", from: 1714.4, to: 1714.5, seekAt: 1714.5 },
  { family: "yasuo-wind-wall-flash", from: 1714.8, to: 1717.6, seekAt: 1717.5 },
  { family: "heimerdinger-w-impact", from: 1715.6, to: 1715.9, seekAt: 1715.7 },
  {
    family: "heimerdinger-q-ammo-spend",
    from: 1715.7,
    to: 1717.2,
    seekAt: 1715.8,
  },
  { family: "kaisa-e-activation", from: 1718.9, to: 1719.6, seekAt: 1719 },
];
const mapPoint = { x: 0.806, y: 0.254 };
const fightBounds = { minX: 11_606, maxX: 12_120, minZ: 10_616, maxZ: 11_516 };

function fightRegionInFrame(matrix: number[]) {
  if (matrix.length !== 16) return false;
  for (const x of [fightBounds.minX, fightBounds.maxX])
    for (const z of [fightBounds.minZ, fightBounds.maxZ])
      for (const y of [0, 192]) {
        const at = (row: number) =>
          x * (matrix[row] ?? Number.NaN) +
          y * (matrix[row + 4] ?? Number.NaN) +
          z * (matrix[row + 8] ?? Number.NaN) +
          (matrix[row + 12] ?? Number.NaN);
        const w = at(3);
        if (!(
          w > 0 &&
          Math.abs(at(0)) < w * 0.95 &&
          Math.abs(at(1)) < w * 0.95
        ))
          return false;
      }
  return true;
}

// Run with bun and the installed Playwright Chromium. Pass the real signed-out
// loopback replay URL and a fresh local directory for the evidence.
const [previewArgument, output, ...components] = Bun.argv.slice(2);
assert.ok(
  previewArgument !== undefined &&
    previewArgument !== "" &&
    output !== undefined &&
    output !== "",
  "Usage: bun capture-recorded-rift-fight.ts <loopback replay URL> <new evidence directory> [--senna-w] [--outer-maokai-ribbons]",
);
for (const component of components) {
  assert.ok(
    component === "--senna-w" || component === "--outer-maokai-ribbons",
    `Unknown recorded fight component: ${component}`,
  );
}
if (components.includes("--outer-maokai-ribbons")) {
  cues.push({
    family: "maokai-r-ribbon",
    label: "maokai-r-outer-ribbons",
    from: 1715.3,
    to: 1717.3,
    seekAt: 1716,
    minimumDraws: 2,
  });
}
if (components.includes("--senna-w")) {
  textures["3b38892fe260d501aa7ae6f2d3026d7cf28e9b92f88beb0b72060282e41ca44d"] =
    "senna-w-hit-flare";
  cues.push({
    family: "senna-w-hit-flare",
    from: 1719.9,
    to: 1720.1,
    seekAt: 1720,
  });
}
const preview = new URL(previewArgument);
assert.equal(preview.protocol, "http:");
assert.equal(preview.hostname, "127.0.0.1");
assert.notEqual(preview.port, "");
assert.equal(preview.username + preview.password, "");
const replayId = /^\/app\/replays\/([\da-f-]+)$/.exec(preview.pathname)?.[1];
assert.ok(replayId !== undefined, "Expected the public replay route.");
const start = 1712;
const end = 1721;
preview.search = new URLSearchParams({ t: String(start) }).toString();
await mkdir(output);

const graphics = Bun.env["SCOUT_REPLAY_E2E_PERF_GRAPHICS"] ?? "swiftshader";
assert.ok(graphics === "edge" || graphics === "swiftshader");
const browser = await chromium.launch({
  ...(graphics === "edge" ? { channel: "msedge" } : {}),
  headless: true,
  args:
    graphics === "edge"
      ? ["--enable-gpu"]
      : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1024, height: 800 },
    serviceWorkers: "block",
  });
  const credentialedRequests = new Set<string>();
  const browserErrors: string[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== preview.origin) return route.abort();
    const headers = await request.allHeaders();
    if ("cookie" in headers || "authorization" in headers)
      credentialedRequests.add(url.pathname);
    return route.continue();
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await installRecordedDrawProbe(page);
  await installRiftFightTextureProbe(page, textures);
  const descriptorRequest = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/replays/${replayId}`,
    { timeout: 90_000 },
  );
  const navigation = await page.goto(preview.href);
  assert.equal(navigation?.status(), 200);
  const descriptorResponse = await descriptorRequest;
  const descriptor = PublicReplayDescriptorSchema.parse(
    await descriptorResponse.json(),
  );
  assert.equal(
    descriptor.sha256,
    "a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1",
  );
  assert.equal(descriptor.playback.status, "available");

  const play = page.getByRole("button", { name: "Play", exact: true });
  const pause = page.getByRole("button", { name: "Pause", exact: true });
  const clockControl = page.locator(
    'input[type="range"][aria-valuetext][id$="-time"]',
  );
  const speedControl = page.getByRole("combobox", { name: "Speed" });
  const cameraControl = page.getByRole("combobox", { name: "Camera" });
  const canvas = page.getByLabel("League of Legends replay scene");
  await expect(play).toBeEnabled({ timeout: 90_000 });
  await expect(clockControl).toHaveValue(String(start));
  await expect(clockControl).toHaveAttribute("aria-busy", "false");
  await expect(speedControl).toHaveValue("1");
  const minimap = page.getByRole("button", { name: "Replay minimap" });
  const mapImage = await minimap.locator("img").boundingBox();
  assert.ok(mapImage !== null);
  await page.mouse.click(
    mapImage.x + mapImage.width * mapPoint.x,
    mapImage.y + mapImage.height * mapPoint.y,
  );
  await expect(cameraControl).toHaveValue("free");
  await expect
    .poll(async () => {
      const { viewProjection } = await readRecordedDraw(page);
      return fightRegionInFrame(viewProjection);
    })
    .toBe(true);
  await canvas.screenshot({ path: path.join(output, "fight-start.png") });

  const capture = canvas.evaluate(async (element, endSeconds) => {
    if (!(element instanceof HTMLCanvasElement))
      throw new TypeError("The mounted replay scene is not a canvas.");
    const player = element.closest('[aria-label="Replay player"]');
    const clock = player?.querySelector<HTMLInputElement>('input[id$="-time"]');
    const speed = player?.querySelector<HTMLSelectElement>(
      'select[id$="-speed"]',
    );
    const camera = player?.querySelector<HTMLSelectElement>(
      'select[id$="-camera"]',
    );
    if (clock === undefined || clock === null || !speed || !camera)
      throw new Error("Missing replay playback controls.");

    const stream = element.captureStream(30);
    const recorder = new MediaRecorder(stream, {
      mimeType: "video/webm;codecs=vp9",
      videoBitsPerSecond: 4_000_000,
    });
    const samples: {
      elapsedMilliseconds: number;
      seconds: number;
      seekBusy: boolean;
      rate: string;
      camera: string;
      viewProjection: number[];
      families: Record<string, number>;
      texturedIndices: number;
      actorDraws: number;
      particleDraws: number;
      depthDisabledParticleDraws: number;
      maskedGroundDraws: number;
    }[] = [];
    const chunks: Blob[] = [];
    recorder.addEventListener("dataavailable", (event) =>
      chunks.push(event.data),
    );
    const startedAt = performance.now();
    const record = new Promise<Blob>((resolve, reject) => {
      recorder.addEventListener("error", reject, { once: true });
      recorder.addEventListener(
        "stop",
        () => {
          resolve(new Blob(chunks, { type: recorder.mimeType }));
        },
        { once: true },
      );
    });
    function sampleFrame(now: number) {
      if (!clock || !speed || !camera) return;
      const {
        viewProjection,
        texturedIndices,
        actorOrigins,
        recordedParticleDraws,
        recordedDepthDisabledParticleDraws,
        recordedMaskedGroundDraws,
      } = globalThis.recordedReplayDraw;
      samples.push({
        elapsedMilliseconds: now - startedAt,
        seconds: clock.valueAsNumber,
        seekBusy: clock.getAttribute("aria-busy") === "true",
        rate: speed.value,
        camera: camera.value,
        viewProjection,
        families: globalThis.recordedRiftTextures.frame.families,
        texturedIndices,
        actorDraws: actorOrigins.length,
        particleDraws: recordedParticleDraws,
        depthDisabledParticleDraws: recordedDepthDisabledParticleDraws,
        maskedGroundDraws: recordedMaskedGroundDraws,
      });
      if (clock.valueAsNumber >= endSeconds || now - startedAt > 25_000) {
        recorder.stop();
      } else {
        requestAnimationFrame(sampleFrame);
      }
    }
    recorder.start();
    requestAnimationFrame(sampleFrame);
    try {
      const blob = await record;
      const video = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("error", reject, { once: true });
        reader.addEventListener(
          "load",
          () => {
            if (typeof reader.result !== "string") {
              reject(
                new TypeError("Canvas recording did not produce a data URL."),
              );
              return;
            }
            resolve(reader.result.split(",", 2)[1] ?? "");
          },
          { once: true },
        );
        reader.readAsDataURL(blob);
      });
      return { samples, video };
    } finally {
      for (const track of stream.getTracks()) track.stop();
    }
  }, end);
  // Canvas recording and sampling have their own browser-side stop at the
  // final clock. Scrubbing or polling for individual effects changes playback.
  await play.click();
  const { samples, video } = await capture;
  await pause.click();
  await page.evaluate(() => {
    globalThis.scrollTo(0, 0);
  });
  await canvas.screenshot({ path: path.join(output, "fight-end.png") });

  const bytes = Buffer.from(video, "base64");
  const events = cues.map((cue) => ({
    ...cue,
    observed: samples
      .filter(({ seconds }) => seconds >= cue.from && seconds <= cue.to)
      .map(({ seconds, families }) => ({
        seconds,
        draws: families[cue.family] ?? 0,
      }))
      .filter(({ draws }) => draws >= (cue.minimumDraws ?? 1)),
  }));
  await writeFile(path.join(output, "rift-fight-1x.webm"), bytes);
  await writeFile(
    path.join(output, "timeline.json"),
    JSON.stringify(
      {
        replaySha256: descriptor.sha256,
        packageSha256: descriptor.playback.package.sha256,
        cameraMode: "free",
        mapPoint,
        fightBounds,
        graphics,
        textures,
        browserErrors,
        credentialedRequests: [...credentialedRequests],
        events,
        samples,
      },
      null,
      2,
    ),
  );

  assert.ok(bytes.length > 0, "The canvas recording contains no bytes.");
  assert.deepEqual(browserErrors, []);
  assert.deepEqual([...credentialedRequests], []);
  assert.equal(samples.at(0)?.seconds, start);
  assert.ok((samples.at(-1)?.seconds ?? 0) >= end);
  let previousSeconds = start;
  for (const sample of samples) {
    assert.ok(
      sample.seconds >= previousSeconds,
      "The replay clock moved backward.",
    );
    assert.equal(sample.seekBusy, false);
    assert.equal(sample.rate, "1");
    assert.equal(sample.camera, "free");
    assert.deepEqual(sample.viewProjection, samples[0]?.viewProjection);
    assert.ok(
      fightRegionInFrame(sample.viewProjection),
      "The fight left the viewport.",
    );
    previousSeconds = sample.seconds;
  }
  for (let second = start; second < end; second += 1) {
    assert.ok(
      samples.some(
        (sample) =>
          Math.floor(sample.seconds) === second &&
          sample.texturedIndices > 0 &&
          sample.actorDraws > 0,
      ),
      `Missing terrain, actors, or camera at ${String(second)}s.`,
    );
  }
  for (const event of events)
    assert.ok(
      event.observed.length > 0,
      `No ${event.family} texture submissions in its playback window.`,
    );

  // Seek away before each repeat to force a fresh paused presentation. Each
  // pass submits the same draws, while only the named texture is suppressed.
  const seekControls = [];
  const readFrame = () =>
    page.evaluate(() => globalThis.recordedRiftTextures.frame);
  for (const { family, label = family, minimumDraws = 1, seekAt } of cues) {
    const paused = [];
    for (const [variant, suppressed] of [
      ["enabled", null],
      ["suppressed", family],
      ["suppressed-repeat", family],
      ["restored", null],
    ] as const) {
      await page.evaluate((value) => {
        globalThis.recordedRiftTextures.suppress = value;
      }, suppressed);
      await seek(page, start);
      const reset = await readFrame();
      await seek(page, seekAt);
      await expect
        .poll(async () => {
          const { generation } = await readFrame();
          return generation;
        })
        .toBeGreaterThan(reset.generation);
      const before = await readFrame();
      const screenshot = await canvas.screenshot({
        path: path.join(output, `${label}-${variant}.png`),
      });
      const after = await readFrame();
      assert.equal(before.suppressed, suppressed);
      assert.equal(after.suppressed, suppressed);
      assert.deepEqual(before.families, after.families);
      const { viewProjection } = await readRecordedDraw(page);
      assert.deepEqual(viewProjection, samples[0]?.viewProjection);
      paused.push({ screenshot, frame: after });
    }
    const [enabled, suppressed, repeat, restored] = paused;
    assert.ok(enabled && suppressed && repeat && restored);
    const { metrics, mask } = await comparePixels(
      page,
      [enabled, suppressed, repeat, restored].map(
        ({ screenshot }) => screenshot,
      ),
    );
    assert.ok(mask !== undefined);
    await writeFile(
      path.join(output, `${label}-causal-pixel-mask.png`),
      Buffer.from(mask, "base64"),
    );
    const evidence = {
      family,
      label,
      seekAt,
      draws: enabled.frame.families,
      metrics,
      frames: paused.map(({ frame }) => frame),
    };
    seekControls.push(evidence);
    await writeFile(
      path.join(output, "seek-controls.json"),
      JSON.stringify(seekControls, null, 2),
    );
    for (const { frame } of paused)
      assert.deepEqual(frame.families, evidence.draws);
    assert.ok(
      (evidence.draws[family] ?? 0) >= minimumDraws,
      `Expected ${String(minimumDraws)} ${family} draws at the ${label} seek cue.`,
    );
  }
  assert.deepEqual(
    seekControls
      .filter(({ metrics }) => metrics.causal === 0)
      .map(({ label }) => label),
    [],
    "No stable visible contribution at the sampled seek for these families.",
  );
  assert.deepEqual(browserErrors, []);
  assert.deepEqual([...credentialedRequests], []);
  process.stdout.write(
    JSON.stringify(
      {
        samples: samples.length,
        wallMilliseconds: samples.at(-1)?.elapsedMilliseconds,
        bytes: bytes.length,
        events: events.map(({ family, label = family, observed }) => ({
          family,
          label,
          observations: observed.length,
          peakDraws: Math.max(...observed.map(({ draws }) => draws)),
        })),
        seekControls: seekControls.map(
          ({ family, label, seekAt, metrics }) => ({
            family,
            label,
            seekAt,
            causalPixels: metrics.causal,
            unstablePixels: metrics.unstable,
          }),
        ),
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
}
