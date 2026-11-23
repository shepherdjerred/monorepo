import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { prepareTargetedMissilePresentation } from "../latest-targeted-missile-worker.mjs";
import {
  createProjectilePresentation,
  createOwnedProjectilePresentation,
} from "../latest-projectile-presentation.mjs";
import { loadLatestStaticCatalogSelection } from "../latest-static-catalog.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import { stringifyAssetJson } from "./asset-json.mjs";

const [reportPath, assetRoot, output, mode = "causal-filter", artifactCache] =
  process.argv.slice(2);
if (!output || !["causal-filter", "owned-source"].includes(mode))
  throw Error(
    "Usage: bun compare-full-projectile-query.mjs <full-semantic-report.json> <approved-public-root> <output.json> [causal-filter|owned-source] [component-artifact-cache]",
  );
const started = performance.now(),
  inputs = {},
  raw = async (file) => {
    const bytes = await Bun.file(file).bytes(),
      digest = await sha256(bytes);
    if (inputs[file] && inputs[file] !== digest)
      throw Error(`Input changed during original query comparison: ${file}`);
    inputs[file] = digest;
    return bytes;
  };
const reportBytes = await raw(path.resolve(reportPath)),
  report = JSON.parse(new TextDecoder().decode(reportBytes));
const read = (file) => raw(path.resolve(assetRoot, file));
const selection = await loadLatestStaticCatalogSelection({ load: read }),
  profile = selection.profile(),
  load = (file) => selection.read(file),
  scene = JSON.parse(
    new TextDecoder().decode(await load("latest-scene/manifest.json")),
  ),
  heightBytes = await load("latest-scene/heights.bin"),
  heights = new Float32Array(
    heightBytes.buffer,
    heightBytes.byteOffset,
    heightBytes.byteLength / 4,
  );
console.log(
  JSON.stringify({
    stage: "source-ready",
    elapsedMs: performance.now() - started,
    missiles: report.missiles.length,
  }),
);
const presentation = await prepareTargetedMissilePresentation(
  {
    family: "all",
    report,
    profile,
    scene,
    heights,
    world: {
      entities: [],
      resourceTracks: [],
      attachmentTracks: [],
      missilePlayback: { traces: [] },
    },
    staticCatalogInitialization: selection.serializeForWorker(),
  },
  load,
  null,
  (event) =>
    console.log(JSON.stringify({ stage: "original-preparation", event })),
);
console.log(
  JSON.stringify({
    stage: "presentation-ready",
    elapsedMs: performance.now() - started,
    traces: presentation.traces.length,
  }),
);
const sourcePath = path.resolve(
    import.meta.dir,
    "../latest-projectile-presentation.mjs",
  ),
  sourceBytes = await raw(sourcePath),
  source = new TextDecoder().decode(sourceBytes);
const optimization = "cursor && notificationClocks.get(entityId).has(time)";
if (source.split(optimization).length !== 2)
  throw Error("Expected one exact causal-filter optimization boundary");
// Executable control changes only the new gate back to the original unconditional
// cursor filter. All constructors, sampler math, validation and clone boundaries
// stay byte-for-byte identical; rewritten imports target the same local modules.
const baselineSource = (
  mode === "causal-filter" ? source.replace(optimization, "cursor") : source
).replace(
  /from "(\.\/[^\"]+)"/g,
  (_, dependency) =>
    `from ${JSON.stringify(pathToFileURL(path.resolve(path.dirname(sourcePath), dependency)).href)}`,
);
const { createProjectilePresentation: createBaseline } = await import(
  `data:text/javascript;base64,${Buffer.from(baselineSource).toString("base64")}`
);
const baseline = createBaseline(report, presentation),
  actual =
    mode === "owned-source"
      ? createOwnedProjectilePresentation(report, presentation)
      : createProjectilePresentation(report, presentation),
  digest = createHash("sha256");
let queries = 0,
  notifications = 0,
  baselineMs = 0,
  indexedMs = 0;
const compare = (entityId, time, cursor) => {
  let at = performance.now();
  const expected = baseline.query(entityId, time, cursor);
  baselineMs += performance.now() - at;
  at = performance.now();
  const received = actual.query(entityId, time, cursor);
  indexedMs += performance.now() - at;
  if (!isDeepStrictEqual(expected, received))
    throw Error(
      `Projectile query changed: ${JSON.stringify({ entityId, time, cursor })}`,
    );
  queries++;
  digest.update(JSON.stringify([entityId, time, cursor, received]));
  if (received) {
    received.position[0] = 999999;
    received.velocity[0] = 999999;
    if (received.targetPosition) received.targetPosition[0] = 999999;
    if (received.effectBasis) received.effectBasis[0] = 999999;
    if (!isDeepStrictEqual(expected, actual.query(entityId, time, cursor)))
      throw Error("Public projectile result retained a mutable alias");
  }
};
let states = 0;
for (const trace of presentation.traces) {
  const record = report.missiles.find(
    (row) => row.entityId === trace.entityId && row.sequence === trace.sequence,
  );
  const creation = {
    transportSequence: record.transportSequence,
    entryOrder: record.entryOrder ?? 0,
  };
  const times = [];
  for (let index = 0; index < trace.states.length; index++) {
    const state = trace.states[index];
    states++;
    times.push(state.time);
    const next = trace.states[index + 1];
    if (next && next.time > state.time)
      times.push(state.time + (next.time - state.time) / 2);
    if (state.notificationSourceEventId) {
      notifications++;
      for (const cursor of [
        {
          transportSequence: state.notificationTransportSequence,
          entryOrder: state.notificationEntryOrder,
          exclusive: true,
        },
        {
          transportSequence: state.notificationTransportSequence,
          entryOrder: state.notificationEntryOrder,
        },
        {
          transportSequence: state.notificationTransportSequence + 1,
          entryOrder: 0,
        },
      ])
        compare(trace.entityId, state.time, cursor);
    }
  }
  for (const time of [...times, ...times.toReversed()])
    for (const cursor of [null, creation])
      compare(trace.entityId, time, cursor);
  compare(trace.entityId, record.time, { ...creation, exclusive: true });
  compare(trace.entityId, presentation.endTime, creation);
  compare(trace.entityId, presentation.endTime + 1, creation);
}
let componentArtifact = null;
if (artifactCache) {
  const { out } = await createStaticPreparationOutput(
    assetRoot,
    artifactCache,
    {
      prefix: "projectile-probe-",
      directory: "projectile-probe",
    },
  );
  const body = {
      "report.json": new TextEncoder().encode(
        stringifyAssetJson({
          build: report.build,
          protocol: report.protocol,
          replaySha256: report.replaySha256,
          endTime: report.endTime,
          heroes: report.heroes,
          missiles: report.missiles,
        }),
      ),
      "presentation.json": new TextEncoder().encode(
        stringifyAssetJson(presentation),
      ),
      "effects.json": await load("latest-effects/manifest.json"),
    },
    files = [];
  for (const [file, bytes] of Object.entries(body)) {
    await Bun.write(path.join(out, file), bytes);
    const digest = await sha256(bytes),
      readback = await Bun.file(path.join(out, file)).bytes();
    if (readback.length !== bytes.length || (await sha256(readback)) !== digest)
      throw Error("Projectile component input readback differs");
    files.push({ path: file, bytes: bytes.length, sha256: digest });
  }
  await Bun.write(
    path.join(out, "manifest.json"),
    JSON.stringify(
      {
        schema: 1,
        kind: "source-bound-projectile-component-control-inputs",
        originalReportSha256: inputs[path.resolve(reportPath)],
        sourceSha256: inputs[sourcePath],
        files,
        scope:
          "Exact source-derived component inputs only; no world/controller/native rendering admission",
      },
      null,
      2,
    ),
  );
  componentArtifact = out;
}
const result = {
  schema: 1,
  kind:
    mode === "owned-source"
      ? "full-owned-projectile-query-comparison"
      : "full-original-projectile-query-filter-comparison",
  mode,
  componentArtifact,
  reportSha256: inputs[path.resolve(reportPath)],
  sourceSha256: inputs[sourcePath],
  baselineSourceSha256: await sha256(new TextEncoder().encode(baselineSource)),
  inputs,
  traces: presentation.traces.length,
  states,
  notificationStates: notifications,
  queries,
  baselineMs,
  indexedMs,
  outputSha256: digest.digest("hex"),
  mismatches: [],
  elapsedMs: performance.now() - started,
  scope:
    "All generated presentation families from the retained full semantic report under explicit empty supplied legacy world tracks, source-bound static inputs, exact state/midpoint and causal cutoffs in forward/reverse order. Same sampler/envelope/clone behavior; this supplied-context comparison and standalone Bun timings do not establish ordinary browser seek performance or native parity.",
};
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    traces: result.traces,
    states,
    notificationStates: notifications,
    queries,
    baselineMs,
    indexedMs,
    mismatches: 0,
    elapsedMs: result.elapsedMs,
  }),
);
