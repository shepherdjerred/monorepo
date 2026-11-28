import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { PublicReplayDescriptorSchema } from "@scout-for-lol/domain/artifacts/public-replay.ts";
import { installRecordedDrawProbe } from "#replay-e2e/recorded-draw-probe.ts";

// Run with bun and the installed Playwright Chromium. Pass the real signed-out
// loopback replay URL and a fresh local directory for the evidence.
const [previewArgument, output] = Bun.argv.slice(2);
assert.ok(
  previewArgument !== undefined &&
    previewArgument !== "" &&
    output !== undefined &&
    output !== "",
  "Usage: bun capture-recorded-rift-fight.ts <loopback replay URL> <new evidence directory>",
);
const preview = new URL(previewArgument);
assert.equal(preview.protocol, "http:");
assert.equal(preview.hostname, "127.0.0.1");
assert.notEqual(preview.port, "");
assert.equal(preview.username + preview.password, "");
const replayId = /^\/app\/replays\/([\da-f-]+)$/.exec(preview.pathname)?.[1];
assert.ok(replayId !== undefined, "Expected the public replay route.");
const start = 1712;
const end = 1721;
const follow = "1073742170";
preview.search = new URLSearchParams({ t: String(start), follow }).toString();
await mkdir(output);

const browser = await chromium.launch({
  headless: true,
  args: ["--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
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
  await expect(cameraControl).toHaveValue(`player:${follow}`);
  await page.screenshot({ path: path.join(output, "fight-start.png") });

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
      cameraAnchor: number[];
      texturedIndices: number;
      actorDraws: number;
      particleDraws: number;
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
      } = globalThis.recordedReplayDraw;
      // At fixed zoom and pitch the homogeneous translation columns change
      // as the followed actor moves. Keep them for cross-package comparison.
      samples.push({
        elapsedMilliseconds: now - startedAt,
        seconds: clock.valueAsNumber,
        seekBusy: clock.getAttribute("aria-busy") === "true",
        rate: speed.value,
        camera: camera.value,
        cameraAnchor: viewProjection.slice(12, 16),
        texturedIndices,
        actorDraws: actorOrigins.length,
        particleDraws: recordedParticleDraws,
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
  await page.screenshot({ path: path.join(output, "fight-end.png") });

  const bytes = Buffer.from(video, "base64");
  // These disjoint windows are anchored by the baseline package's events.
  // Draws in the windows corroborate rendering during play. The video still
  // requires visual review, particularly where later packages overlap effects.
  const events = [
    { family: "heimerdinger-w-impact", start: 1715.5684140625, lifetime: 0.3 },
    { family: "kaisa-e-activation", start: 1718.8984140625, lifetime: 0.15 },
    { family: "kaisa-e-activation", start: 1719.4314140625, lifetime: 0.15 },
  ].map((event) => {
    // The range control represents current time to the nearest tenth.
    const peakParticleDraws = Math.max(
      0,
      ...samples
        .filter(
          (sample) =>
            sample.seconds >= event.start - 0.05 &&
            sample.seconds <= event.start + event.lifetime + 0.05,
        )
        .map((sample) => sample.particleDraws),
    );
    return { ...event, peakParticleDraws };
  });
  await writeFile(path.join(output, "rift-fight-1x.webm"), bytes);
  await writeFile(
    path.join(output, "timeline.json"),
    JSON.stringify(
      {
        replaySha256: descriptor.sha256,
        packageSha256: descriptor.playback.package.sha256,
        cameraTarget: follow,
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
    assert.equal(sample.camera, `player:${follow}`);
    previousSeconds = sample.seconds;
  }
  for (let second = start; second < end; second += 1) {
    assert.ok(
      samples.some(
        (sample) =>
          Math.floor(sample.seconds) === second &&
          sample.texturedIndices > 0 &&
          sample.actorDraws > 0 &&
          sample.cameraAnchor.length === 4,
      ),
      `Missing terrain, actors, or camera at ${String(second)}s.`,
    );
  }
  assert.notDeepEqual(
    samples.at(0)?.cameraAnchor,
    samples.at(-1)?.cameraAnchor,
  );

  for (const event of events)
    assert.ok(
      event.peakParticleDraws > 0,
      `No particle draws around ${event.family} at ${String(event.start)}s.`,
    );
  process.stdout.write(
    JSON.stringify(
      {
        samples: samples.length,
        wallMilliseconds: samples.at(-1)?.elapsedMilliseconds,
        bytes: bytes.length,
        events,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
}
