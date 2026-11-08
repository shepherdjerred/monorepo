// Run the production worker handler in this CLI thread so Bun's CPU sampler
// can identify world-query costs. This is not a worker/browser timing gate.
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256 } from "../structural-comparison.mjs";
import { createDirectEffectWorkerHandler } from "../latest-direct-effect-worker.mjs";

if (!process.argv.includes("--missiles"))
  throw Error("Actual combined --missiles cohort required");
const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const producer = resolve(
  import.meta.dir,
  "inspect-initial-resource-playback.mjs",
);
const text = await Bun.file(producer).text(),
  boundary = "const within = (row)";
if (
  text.indexOf(boundary) < 0 ||
  text.indexOf(boundary) !== text.lastIndexOf(boundary) ||
  text.indexOf("const camera = includeMissiles") < 0 ||
  text.indexOf("const camera = includeMissiles") > text.indexOf(boundary)
)
  throw Error("Unique complete actual worker payload setup required");
// Reuse the actual diagnostic's setup verbatim. Only module path metadata is
// relocated; no alternative event selection, world adapter or clock is built.
const setup = text
  .slice(0, text.indexOf(boundary))
  .replace(
    /\bfrom\s+(["'])(\.{1,2}\/[^"']+)\1/g,
    (_match, _quote, relative) =>
      `from ${JSON.stringify(pathToFileURL(resolve(dirname(producer), relative)).href)}`,
  )
  .replaceAll("import.meta.dir", JSON.stringify(dirname(producer)))
  .replaceAll("import.meta.path", JSON.stringify(producer));
const setupPath = `${cache}/research/profile-direct-world-v33-current.setup.mjs`;
await Bun.write(setupPath, setup + "\nexport { payload, inputs, camera };\n");
const { payload, inputs, camera } = await import(pathToFileURL(setupPath).href);
for (const path of [import.meta.path, producer, setupPath])
  inputs[resolve(path)] = await sha256(await Bun.file(path).bytes());
const handler = createDirectEffectWorkerHandler();
await handler({ type: "initialize", payload });
await handler({ type: "advance", payload: { time: 69, camera } });
const frames = [];
// A named CPU-profile ancestor separates this playback loop from package
// decoding, compilation and the initialization/seek to 69 seconds above.
async function sampleComparisonPlayback() {
  for (let frame = 1; frame <= 450; frame++) {
    const packet = await handler({
      type: "advance",
      payload: { time: 69 + (frame * 4) / 60, camera },
    });
    frames.push({
      time: packet.time,
      worldQueryMs: packet.metrics.worldQueryMs,
      worldQueries: packet.metrics.worldQueries,
      simulationMs: packet.metrics.simulationMs,
      geometryMs: packet.metrics.geometryMs,
      workerOperationMs: packet.metrics.workerOperationMs,
      draws: packet.draws.length,
    });
  }
}
await sampleComparisonPlayback();
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error(`Profile input drift: ${path}`);
const output = `${cache}/research/direct-world-query-profile-v33-current.json`;
const worst = frames
  .toSorted((a, b) => b.worldQueryMs - a.worldQueryMs)
  .slice(0, 12);
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "production-handler-main-thread-world-query-profile",
      inputs,
      frames,
      worst,
      scope: {
        productionHandler: true,
        actualDecodedEvents: true,
        sameWorldAdapter: true,
        cliThread: true,
        moduleWorkerExecution: false,
        transportMeasured: false,
        browserAcceptance: false,
        performanceGateMeasurement: false,
      },
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({ output, frames: frames.length, worst: worst.slice(0, 3) }),
);
