// Measure the spectator's real native effect timeline, outside a browser.
// Timing and geometry digests are separate; this does not measure GPU/FPS.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createLatestParentFrames } from "../latest-parent-frames.mjs";
import { LatestParentMissileTimeline } from "../latest-parent-missile-timeline.mjs";
import { createLatestBulkUnicorn } from "../latest-unicorn-bulk.mjs";

const [directory, label] = process.argv.slice(2);
if (!directory || !/^[a-z0-9-]+$/.test(label ?? ""))
  throw Error("Usage: profile-parent-playback.mjs <cache> <label>");
const cache = resolve(directory),
  assets = `${cache}/public`,
  inputs = {};
const sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
const raw = async (p) => {
  const b = new Uint8Array(await Bun.file(p).arrayBuffer());
  inputs[p] = sha(b);
  return b;
};
const read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p)));
const fixture = await read(`${cache}/research/bound-vfx-playback.json`);
const schedule = await read(`${cache}/research/parent-missile-inputs.json`);
if (
  schedule.sourceSha256 !== inputs[`${cache}/research/bound-vfx-playback.json`]
)
  throw Error("Replay schedule differs from trajectory fixture");
const profile = await read(`${assets}/decoder-16.21-macos/profile.json`);
const catalogBytes = await raw(
  `${assets}/latest-parent-frame-caches/package.json`,
);
const catalog = JSON.parse(new TextDecoder().decode(catalogBytes));
const bulkBytes = await raw(`${assets}/latest-unicorn-bulk/package.json`);
const bulk = JSON.parse(new TextDecoder().decode(bulkBytes));
const { default: factory } = await import(
  pathToFileURL(`${assets}/vendor/unicorn_x86_candidate.mjs`).href
);
const common = {
  profile,
  image: await raw(`${assets}/decoder-16.21-macos/image.bin`),
  spawnBytes: await raw(`${assets}/decoder-16.21-macos/vfx-spawn.json`),
  abiBytes: await raw(`${assets}/latest-parent-frame-runtime/package.json`),
  cachePackageBytes: catalogBytes,
  mathPackageBytes: await raw(`${assets}/latest-parent-math/package.json`),
  loadBytes: (p) => raw(`${assets}/latest-parent-frame-caches/${p}`),
  loadMathBytes: (p) => raw(`${assets}/latest-parent-math/${p}`),
};
const runtimeBytes = await raw(`${assets}/vendor/unicorn_x86_candidate.mjs`);
const wasmBytes = await raw(`${assets}/latest-unicorn-bulk/${bulk.file}`);
const frames = [],
  preparations = [];
for (const burst of schedule.bursts) {
  const ref = catalog.caches.find((c) => c.effectId === burst.effectId);
  const started = performance.now();
  const runtime = await createLatestParentFrames({
    ...common,
    uc: await createLatestBulkUnicorn(
      factory,
      runtimeBytes,
      bulkBytes,
      wasmBytes,
    ),
    cacheBytes: await raw(`${assets}/latest-parent-frame-caches/${ref.file}`),
  });
  let current;
  for (const name of [
    "restore",
    "checkpoint",
    "advance",
    "setPlacement",
    "render",
    "completion",
  ]) {
    const fn = runtime[name].bind(runtime);
    runtime[name] = (...args) => {
      const at = performance.now();
      try {
        return fn(...args);
      } finally {
        if (current) {
          current.costs[name] =
            (current.costs[name] ?? 0) + performance.now() - at;
          current.calls[name] = (current.calls[name] ?? 0) + 1;
        }
      }
    };
  }
  let timeline;
  try {
    timeline = new LatestParentMissileTimeline(
      runtime,
      fixture.traces.filter(
        (t) =>
          t.effectId === burst.effectId &&
          Math.fround(t.startTime) === burst.startTime,
      ),
    );
    preparations.push(performance.now() - started);
    // Same forward, fractional, paused and backward samples before/after edits.
    const times = [0, 1, 1.5, 2, 3, 6, 9, 12, 15, 18, 18, 5, 12, 18];
    for (const tick of times) {
      current = { burst: burst.startTime, tick, costs: {}, calls: {} };
      const time = Math.fround(burst.startTime + tick / 60),
        at = performance.now();
      const packet = timeline.sample(time, schedule.camera);
      current.elapsedMs = performance.now() - at;
      current.steps = packet.canonicalSteps;
      const hash = new Bun.CryptoHasher("sha256");
      for (const parent of packet.parents) {
        hash.update(
          JSON.stringify([parent.sequence, parent.time, parent.visible]),
        );
        for (const draw of parent.geometry ?? []) {
          hash.update(
            JSON.stringify([
              draw.emitterIndex,
              draw.actor,
              draw.kind,
              draw.particleCount,
            ]),
          );
          for (const bytes of [draw.vertices, draw.indices, draw.draw])
            hash.update(bytes);
        }
      }
      current.geometrySha256 = hash.digest("hex");
      frames.push(current);
      current = null;
    }
  } finally {
    timeline?.close();
    runtime.close();
  }
}
const sources = {};
for (const name of [
  "latest-parent-frames.mjs",
  "latest-parent-missile-timeline.mjs",
  "tools/profile-parent-playback.mjs",
])
  sources[name] = sha(await raw(resolve(import.meta.dir, "..", name)));
const sorted = frames.map((f) => f.elapsedMs).sort((a, b) => a - b);
const result = {
  schema: 1,
  label,
  inputs,
  sources,
  preparations,
  frames,
  timings: {
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.floor(sorted.length * 0.95)],
    maxMs: sorted.at(-1),
    totalMs: sorted.reduce((a, b) => a + b, 0),
  },
  scope: {
    actualViewerTimeline: true,
    browserExecuted: false,
    gpuSubmission: false,
  },
};
await Bun.write(
  `${cache}/research/parent-performance-${label}.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    label,
    preparations,
    timings: result.timings,
    costs: Object.fromEntries(
      [
        "restore",
        "checkpoint",
        "advance",
        "setPlacement",
        "render",
        "completion",
      ].map((name) => [
        name,
        frames.reduce((sum, f) => sum + (f.costs[name] ?? 0), 0),
      ]),
    ),
  }),
);
