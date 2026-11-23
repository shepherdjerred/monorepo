// Local proof of exact native camera samples in Scout's scene renderer.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { zstdDecompressSync } from "node:zlib";
import { prepareReplayForSeek } from "../../../../../packages/scout-for-lol/packages/replay/src/prepare.ts";
import { openReplay } from "../transport.mjs";
import { createNativePositionSceneTrace } from "./research/native-position-scene.mjs";

const [outputPath, replayPath, ...inputs] = process.argv.slice(2);
const terrainIndex = inputs.indexOf("--terrain");
const receiptPaths = terrainIndex < 0 ? inputs : inputs.slice(0, terrainIndex);
const [terrainPath, boundsPath, ...extra] =
  terrainIndex < 0 ? [] : inputs.slice(terrainIndex + 1);
if (
  !outputPath ||
  !replayPath ||
  !receiptPaths.length ||
  (terrainIndex >= 0 && (!terrainPath || !boundsPath || extra.length))
)
  throw Error(
    "Usage: bun verify-browser-native-scene.mjs <local-output-directory> <replay.rofl> <reference.json> [reference.json...] [--terrain <local-image.png> <projection-proof.json>]",
  );

const bytes = new Uint8Array(await readFile(replayPath));
const replay = openReplay(bytes.buffer);
const replaySha256 = createHash("sha256").update(bytes).digest("hex");
const identity = {
  replaySha256,
  build: replay.build,
  protocol: replay.protocol,
  durationMilliseconds: replay.durationMilliseconds,
  participantCount: replay.roster.length,
};
const receipts = await Promise.all(
  receiptPaths.map(async (path) => JSON.parse(await readFile(path, "utf8"))),
);
const { observations } = prepareReplayForSeek(bytes.buffer, (input, target) =>
  zstdDecompressSync(input, { maxOutputLength: target.byteLength }),
);
const { trace } = createNativePositionSceneTrace(
  identity,
  observations,
  receipts,
);
const contexts = new Map(
  observations.binding.verified.map(({ footerRow, context }) => [
    footerRow,
    context,
  ]),
);
const originalFrames = new Map();
for (const { samples } of receipts) {
  for (const { key, time, position } of samples) {
    if (!originalFrames.has(time)) originalFrames.set(time, new Map());
    const frame = originalFrames.get(time);
    const participantId = contexts.get(key);
    assert.ok(participantId !== undefined && !frame.has(participantId));
    frame.set(participantId, [position[0], position[2]]);
  }
}
const times = [...originalFrames.keys()].sort((a, b) => a - b);
assert.ok(times.length >= 2, "Expected at least two captured timestamps");
assert.equal(
  trace.frames.filter(({ actors }) => actors.length).length,
  times.length,
);
for (const frame of trace.frames) {
  assert.deepEqual(
    new Map(
      frame.actors.map(({ participantId, x, y }) => [participantId, [x, y]]),
    ),
    originalFrames.get(frame.timeSeconds) ?? new Map(),
  );
  assert.equal(frame.directedParticipantId, null);
  assert.ok(frame.actors.every(({ visibleTo }) => visibleTo.length === 0));
}

const terrainBytes = terrainPath ? await readFile(terrainPath) : null;
const terrainImageSha256 = terrainBytes
  ? createHash("sha256").update(terrainBytes).digest("hex")
  : null;
if (terrainBytes) {
  const proof = JSON.parse(await readFile(boundsPath, "utf8"));
  assert.equal(proof.terrainImageSha256, terrainImageSha256);
  for (const field of [
    "replaySha256",
    "build",
    "protocol",
    "durationMilliseconds",
  ])
    assert.equal(proof[field], identity[field]);
  const { min, max } = proof.mapBounds;
  assert.ok(
    [0, 2].every(
      (axis) =>
        Number.isFinite(min[axis]) &&
        Number.isFinite(max[axis]) &&
        max[axis] > min[axis],
    ),
    "Expected finite world X/Z bounds",
  );
  trace.width = max[0] - min[0];
  trace.height = max[2] - min[2];
  for (const { actors } of trace.frames)
    for (const actor of actors) {
      assert.ok(
        actor.x >= min[0] &&
          actor.x <= max[0] &&
          actor.y >= min[2] &&
          actor.y <= max[2],
        "Captured position is outside the terrain bounds",
      );
      actor.x -= min[0];
      actor.y = max[2] - actor.y;
    }
}

const require = createRequire(
  new URL(
    "../../../../../packages/scout-for-lol/packages/app/package.json",
    import.meta.url,
  ),
);
const { chromium } = require("@playwright/test");
const bundle = await Bun.build({
  entrypoints: [
    fileURLToPath(
      new URL(
        "../../../../../packages/scout-for-lol/packages/replay/src/scene-playback.ts",
        import.meta.url,
      ),
    ),
  ],
  target: "browser",
  format: "esm",
});
assert.ok(bundle.success, bundle.logs.map(({ message }) => message).join("\n"));
const module = await bundle.outputs[0].text();
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/terrain.png" && terrainBytes)
      return new Response(terrainBytes, {
        headers: { "Content-Type": "image/png" },
      });
    if (path === "/scene.mjs")
      return new Response(module, {
        headers: { "Content-Type": "text/javascript" },
      });
    if (path === "/")
      return new Response(
        '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Native position samples</title><body style="margin:0;background:#0a111e;color:#f2f6ff;font:14px system-ui"><p style="margin:12px">Scout scene · Native position sample <span></span></p><canvas style="display:block;width:100%;height:calc(100dvh - 48px)"></canvas>',
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    return new Response(null, { status: 404 });
  },
});

const profiles = [
  { name: "desktop", width: 960, height: 640, deviceScaleFactor: 1 },
  { name: "mobile", width: 390, height: 685, deviceScaleFactor: 2 },
];
let browser;
try {
  await mkdir(outputPath, { recursive: true });
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const verified = [];
  for (const { name, deviceScaleFactor, ...viewport } of profiles) {
    const page = await browser.newPage({
      viewport,
      deviceScaleFactor,
      serviceWorkers: "block",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === server.url.origin
        ? route.continue()
        : route.abort(),
    );
    await page.goto(server.url.href);
    const summary = await page.evaluate(
      async ({ trace, times, hasTerrain }) => {
        const { createReplaySceneSession, parseReplaySceneTrace } =
          await import("/scene.mjs");
        const canvas = document.querySelector("canvas");
        const context = canvas.getContext("2d", { alpha: false });
        const background = hasTerrain ? new Image() : undefined;
        if (background) {
          background.src = "/terrain.png";
          await background.decode();
        }
        const arc = context.arc.bind(context);
        const painted = [];
        context.arc = (x, y, radius, ...rest) => {
          painted.push({ x, y, radius, color: context.fillStyle });
          arc(x, y, radius, ...rest);
        };
        const session = createReplaySceneSession({
          canvas,
          trace: parseReplaySceneTrace(trace),
          sampling: "exact",
          background,
        });
        session.subscribeErrors((error) => {
          throw error;
        });
        const bounds = canvas.getBoundingClientRect();
        const expectedCenter = (actor, focus) => {
          const scale =
            Math.min(bounds.width / trace.width, bounds.height / trace.height) *
            (focus ? 1.45 : 0.9);
          return [
            bounds.width / 2 +
              (actor.x - (focus?.x ?? trace.width / 2)) * scale,
            bounds.height / 2 +
              (actor.y - (focus?.y ?? trace.height / 2)) * scale,
          ];
        };
        const seek = async (time) => {
          painted.length = 0;
          await session.seek(time);
          if (session.getState().timeSeconds !== time)
            throw Error("Scene did not seek to the requested exact time");
        };
        const checkFrame = (time, followedId) => {
          const frame = trace.frames.find(
            ({ timeSeconds }) => timeSeconds === time,
          );
          const focus = frame.actors.find(
            ({ participantId }) => participantId === followedId,
          );
          if (painted.length !== frame.actors.length)
            throw Error("Scene marker count differs from native sample");
          for (const [index, actor] of frame.actors.entries()) {
            const { x, y, radius, color } = painted[index];
            const [expectedX, expectedY] = expectedCenter(actor, focus);
            const team = trace.participants.find(
              ({ participantId }) => participantId === actor.participantId,
            ).teamId;
            if (
              Math.abs(x - expectedX) > 1e-8 ||
              Math.abs(y - expectedY) > 1e-8 ||
              radius < 3 ||
              color !== (team === 100 ? "#66dfeb" : "#ff9a88")
            )
              throw Error(
                "Scene marker coordinates or team color differ from projection",
              );
          }
          return focus === undefined
            ? null
            : painted[frame.actors.indexOf(focus)];
        };
        for (const time of times) {
          await seek(time);
          checkFrame(time);
        }
        const [first, second] = times;
        const gap = (first + second) / 2;
        await seek(gap);
        if (painted.length !== 0)
          throw Error("An uncaptured time drew actor markers");
        const terrainProbe = () => {
          const { a, d } = context.getTransform();
          const scale =
            Math.min(
              canvas.width / a / trace.width,
              canvas.height / d / trace.height,
            ) * 0.9;
          const px = Math.round(
            canvas.width / 2 - trace.width * scale * a * 0.32,
          );
          const py = Math.round(
            canvas.height / 2 - trace.height * scale * d * 0.32,
          );
          return [...context.getImageData(px, py, 1, 1).data];
        };
        const gapTerrainPixel = background ? terrainProbe() : null;
        const paintsTerrain = (pixel) =>
          !["19,33,53,255", "10,17,30,255"].includes(pixel.join());
        if (gapTerrainPixel && !paintsTerrain(gapTerrainPixel))
          throw Error(
            "Uncaptured time replaced the terrain with the default grid fill",
          );
        const followTime = background ? times.at(-2) : first;
        await seek(followTime);
        checkFrame(followTime);
        const frame = trace.frames.find(
          ({ timeSeconds }) => timeSeconds === followTime,
        );
        const follow = frame.actors[0].participantId;
        painted.length = 0;
        session.setCamera({ mode: "follow", participantId: follow });
        const focus = checkFrame(followTime, follow);
        const densityX = canvas.width / bounds.width;
        const densityY = canvas.height / bounds.height;
        const center = context.getImageData(
          Math.floor(focus.x * densityX),
          Math.floor(focus.y * densityY),
          1,
          1,
        ).data;
        const color = [1, 3, 5].map((offset) =>
          parseInt(focus.color.slice(offset, offset + 2), 16),
        );
        // Several actors can overlap precisely at the first sample; a
        // visible team fill at the followed location still proves raster output.
        const pixels = [...center].slice(0, 3).join(",");
        if (![color.join(","), "102,223,235", "255,154,136"].includes(pixels))
          throw Error("Followed actor center did not produce a visible marker");
        await seek(gap);
        if (painted.length !== 0)
          throw Error("Follow camera retained an actor in a gap");
        if (background && !paintsTerrain(terrainProbe()))
          throw Error("Follow camera lost terrain in a gap");
        session.setCamera({ mode: "free" });
        const screenshotTime = times.at(-1);
        await seek(screenshotTime);
        checkFrame(screenshotTime);
        document.querySelector("span").textContent =
          `at ${screenshotTime.toFixed(3)} s${background ? " · Map11 terrain" : ""}`;
        session.dispose();
        return {
          frames: times.length,
          gapSeconds: gap,
          screenshotTime,
          followPixel: true,
          terrainPixel: gapTerrainPixel,
        };
      },
      { trace, times, hasTerrain: terrainBytes !== null },
    );
    assert.deepEqual(errors, []);
    await page.screenshot({ path: join(outputPath, `${name}.png`) });
    verified.push({ viewport: name, ...summary });
    await page.close();
  }
  const comparison = await browser.newPage({
    viewport: { width: 960, height: 500 },
    serviceWorkers: "block",
  });
  await comparison.route("**/*", (route) =>
    new URL(route.request().url()).origin === server.url.origin
      ? route.continue()
      : route.abort(),
  );
  await comparison.goto(server.url.href);
  const gap = (times[0] + times[1]) / 2;
  const gapPixels = await comparison.evaluate(
    async ({ trace, gap, hasTerrain }) => {
      const { createReplaySceneSession, parseReplaySceneTrace } =
        await import("/scene.mjs");
      const heading = document.querySelector("p");
      heading.textContent = `Same uncaptured time · ${gap.toFixed(3)} s`;
      document.querySelector("canvas").remove();
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px";
      document.body.append(row);
      const counts = [];
      const background = hasTerrain ? new Image() : undefined;
      if (background) {
        background.src = "/terrain.png";
        await background.decode();
      }
      for (const exact of [false, true]) {
        const panel = document.createElement("div");
        panel.style.cssText = "flex:1;min-width:0";
        const label = document.createElement("p");
        label.style.cssText = "margin:12px";
        label.textContent = exact
          ? "Exact sampling · no native positions"
          : "Default hold · previous native sample";
        const canvas = document.createElement("canvas");
        canvas.style.cssText = "display:block;width:100%;height:418px";
        panel.append(label, canvas);
        row.append(panel);
      }
      for (const [index, canvas] of [
        ...row.querySelectorAll("canvas"),
      ].entries()) {
        const scene = createReplaySceneSession({
          canvas,
          trace: parseReplaySceneTrace(trace),
          background,
          ...(index === 1 ? { sampling: "exact" } : {}),
        });
        await scene.seek(gap);
        const pixels = canvas
          .getContext("2d")
          .getImageData(0, 0, canvas.width, canvas.height).data;
        let teamPixels = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const [r, g, b] = pixels.subarray(i, i + 3);
          if (
            (r === 102 && g === 223 && b === 235) ||
            (r === 255 && g === 154 && b === 136)
          )
            teamPixels++;
        }
        counts.push(teamPixels);
        scene.dispose();
      }
      return counts;
    },
    { trace, gap, hasTerrain: terrainBytes !== null },
  );
  assert.ok(gapPixels[0] > 0);
  assert.equal(gapPixels[1], 0);
  await comparison.screenshot({ path: join(outputPath, "gap-comparison.png") });
  await comparison.close();
  console.log(
    JSON.stringify(
      {
        build: replay.build,
        replaySha256,
        terrainImageSha256,
        originalSamples: receipts.reduce(
          (count, { samples }) => count + samples.length,
          0,
        ),
        gapComparison: {
          gapSeconds: gap,
          defaultHoldTeamPixels: gapPixels[0],
          exactSamplingTeamPixels: gapPixels[1],
        },
        verified,
      },
      null,
      2,
    ),
  );
} finally {
  try {
    await browser?.close();
  } finally {
    await server.stop(true);
  }
}
