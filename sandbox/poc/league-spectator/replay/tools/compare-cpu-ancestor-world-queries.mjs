import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { captureResearchSourceClosure } from "./research-source-closure.mjs";

const [reportPath, assetRoot, output] = process.argv.slice(2);
if (!reportPath || !assetRoot || !output)
  throw Error(
    "Usage: compare-cpu-ancestor-world-queries.mjs <full-semantic-report.json> <approved-public-root> <output.json>",
  );
const roots = [
    new URL(import.meta.url),
    new URL("../latest-viewer-cpu-ancestor-pose.mjs", import.meta.url),
  ],
  implementationBefore = await captureResearchSourceClosure(roots);
await Bun.write(
  resolve(output) + ".source-start.json",
  JSON.stringify(implementationBefore, null, 2),
);
const [
  { cpuAncestorControlSource },
  { createLatestWorldPresentation },
  { createLatestTerrain },
  { loadLatestViewerPoseAssets },
  { loadLatestStaticCatalogSelection },
  { loadLatestInitialResourcePrefix },
  { replayRowAt, replayRowCount },
  {
    projectLatestDirectWorldInput,
    restoreLatestDirectWorldInput,
    consumeLatestDirectWorldInput,
  },
] = await Promise.all([
  import("./cpu-ancestor-control-source.mjs"),
  import("../latest-world-presentation.mjs"),
  import("../latest-terrain.mjs"),
  import("../latest-viewer-pose-assets.mjs"),
  import("../latest-static-catalog.mjs"),
  import("../latest-initial-resource-prefix.mjs"),
  import("../latest-replay-columns.mjs"),
  import("../latest-direct-world-input.mjs"),
]);
const hash = (bytes) =>
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  samplerUrl = new URL("../latest-viewer-pose-sampler.mjs", import.meta.url),
  serviceUrl = new URL("../latest-viewer-pose-service.mjs", import.meta.url),
  candidate = cpuAncestorControlSource({
    samplerSource: await Bun.file(samplerUrl).text(),
    serviceSource: await Bun.file(serviceUrl).text(),
  });
function importable(source, base, replacements = new Map()) {
  const bound = source.replace(
    /from "(\.\/[^\"]+)"/g,
    (_, file) =>
      `from ${JSON.stringify(replacements.get(file) ?? new URL(file, base).href)}`,
  );
  return `data:text/javascript;base64,${Buffer.from(bound).toString("base64")}`;
}
const candidateSamplerUrl = importable(candidate.sampler, samplerUrl),
  baselineSamplerUrl = importable(candidate.baselineSampler, samplerUrl),
  baselineServiceUrl = importable(
    candidate.baselineService,
    serviceUrl,
    new Map([["./latest-viewer-pose-sampler.mjs", baselineSamplerUrl]]),
  ),
  candidateServiceUrl = importable(
    candidate.service,
    serviceUrl,
    new Map([["./latest-viewer-pose-sampler.mjs", candidateSamplerUrl]]),
  ),
  { createLatestViewerPoseService: candidateService } = await import(
    candidateServiceUrl
  ),
  { createLatestViewerPoseService: baselineService } = await import(
    baselineServiceUrl
  ),
  reportHasher = new Bun.CryptoHasher("sha256");
for await (const bytes of Bun.file(reportPath).stream())
  reportHasher.update(bytes);
const reportSha256 = reportHasher.digest("hex"),
  started = performance.now();
let original = await Bun.file(reportPath).json();
const descriptorQueries = original.effectDescriptors.map((row) => ({
  time: row.time,
  transportSequence: row.transportSequence,
  entryOrder: row.entryOrder ?? row.recordIndex ?? 0,
  attachmentEntityId: row.attachmentEntityId,
  lookup14EntityId: row.lookup14EntityId,
  attachmentKey4c: row.attachmentKey4c,
  attachmentKey50: row.attachmentKey50,
}));
let owned = projectLatestDirectWorldInput(original);
const projectionCounts = owned.counts,
  report = restoreLatestDirectWorldInput(
    structuredClone(owned.input, {
      transfer: consumeLatestDirectWorldInput(owned.ownership, owned.input),
    }),
  );
original = null;
owned = null;
const files = new Map(),
  inputHashes = new Map();
async function read(file) {
  if (!files.has(file)) {
    const bytes = await Bun.file(resolve(assetRoot, file)).bytes();
    inputHashes.set(file, hash(bytes));
    files.set(file, bytes);
  }
  return files.get(file);
}
const selection = await loadLatestStaticCatalogSelection({ load: read }),
  profile = selection.profile(),
  load = (file) => selection.read(file),
  scene = JSON.parse(
    new TextDecoder().decode(await load("latest-scene/manifest.json")),
  ),
  heights = await load("latest-scene/heights.bin"),
  terrain = createLatestTerrain(
    scene,
    new Float32Array(
      heights.buffer,
      heights.byteOffset,
      heights.byteLength / 4,
    ),
  ),
  assets = await loadLatestViewerPoseAssets({
    profile,
    report,
    scene,
    load,
    staticCatalog: selection,
  }),
  manifestBytes = await load("latest-effects/manifest.json"),
  initialResources = await loadLatestInitialResourcePrefix({
    profile,
    report,
    load,
    manifestBytes,
    staticCatalog: selection,
  }),
  world = createLatestWorldPresentation({
    report,
    scene,
    terrain,
    effectsManifest: JSON.parse(new TextDecoder().decode(manifestBytes)),
    initialResourcePrefix: initialResources.policy,
  }),
  full = baselineService({
    assets,
    report,
    negativeFormPrefix: initialResources.policy.negativeFormPrefix ?? null,
  }),
  sparse = candidateService({
    assets,
    report,
    negativeFormPrefix: initialResources.policy.negativeFormPrefix ?? null,
  }),
  heroIds = new Set(report.heroes.map((hero) => hero.entityId)),
  domains = {
    movement: report.movement,
    lifecycle: report.lifecycle,
    animations: report.animations,
    attacks: report.attacks,
    casts: report.casts,
    resourceRequests: report.resourceRequests,
    replicationRecords: report.replicationRecords,
    worldEvents: report.worldEvents,
    visibilityRequests: report.visibilityRequests,
    missiles: report.missiles,
    missileEvents: report.missileEvents,
    effectDescriptors: descriptorQueries,
  },
  coverage = {},
  counts = {
    queries: 0,
    resolved: 0,
    unresolved: 0,
    nonRootQueries: 0,
    resolvedNonRootQueries: 0,
  },
  reasons = {},
  outputHasher = new Bun.CryptoHasher("sha256");
let fullMs = 0,
  sparseMs = 0;
function compare(entityId, keys, time, cursor) {
  const entity = world.entity(entityId, time, cursor);
  let start = performance.now();
  const baseline = full.querySnapshot(entity, keys, time, cursor);
  fullMs += performance.now() - start;
  start = performance.now();
  const candidate = sparse.querySnapshot(entity, keys, time, cursor);
  sparseMs += performance.now() - start;
  if (!isDeepStrictEqual(baseline, candidate))
    throw Error(
      `CPU ancestor world query differs: ${JSON.stringify({ entityId, keys, time, cursor, baseline, candidate })}`,
    );
  counts.queries++;
  counts[baseline.resolved ? "resolved" : "unresolved"]++;
  if (keys.some((key) => key !== 0)) {
    counts.nonRootQueries++;
    if (baseline.resolved) counts.resolvedNonRootQueries++;
  }
  if (!baseline.resolved)
    for (const reason of baseline.reasons)
      reasons[reason] = (reasons[reason] ?? 0) + 1;
  outputHasher.update(
    JSON.stringify([entityId, keys, time, cursor, baseline]) + "\n",
  );
}
for (const reverse of [false, true]) {
  for (const [domain, rows] of reverse
    ? Object.entries(domains).reverse()
    : Object.entries(domains)) {
    const rowCount = replayRowCount(rows);
    coverage[domain] ??= {
      originalRows: rowCount,
      forwardHeroRows: 0,
      backwardHeroRows: 0,
    };
    // The packed representation remains owned; row iteration materializes only
    // the current record, including the reverse/exclusive pass.
    for (let offset = 0; offset < rowCount; offset++) {
      const row = replayRowAt(rows, reverse ? rowCount - offset - 1 : offset),
        ids = [
          ...new Set(
            Object.entries(row)
              .filter(
                ([key, value]) =>
                  /^(entityId|.*EntityId|ownerId|sourceId|targetId)$/.test(
                    key,
                  ) && heroIds.has(value),
              )
              .map(([, value]) => value),
          ),
        ];
      if (!ids.length) continue;
      if (
        !Number.isFinite(row.time) ||
        row.time < 0 ||
        row.time > report.endTime
      )
        throw Error("Original query boundary lies outside the retained window");
      coverage[domain][reverse ? "backwardHeroRows" : "forwardHeroRows"]++;
      const cursor = Number.isSafeInteger(row.transportSequence)
        ? {
            transportSequence: row.transportSequence,
            entryOrder: row.entryOrder ?? row.recordIndex ?? 0,
            exclusive: reverse,
          }
        : null;
      for (const entityId of ids) {
        const keys =
          domain === "effectDescriptors"
            ? [
                ...new Set(
                  [
                    0,
                    ...(row.attachmentEntityId === entityId
                      ? [row.attachmentKey4c]
                      : []),
                    ...(row.lookup14EntityId === entityId
                      ? [row.attachmentKey50]
                      : []),
                  ].filter(Number.isInteger),
                ),
              ]
            : [0];
        compare(entityId, keys, row.time, cursor);
      }
    }
    console.log(
      JSON.stringify({
        domain,
        reverse,
        counts,
        elapsedMs: performance.now() - started,
      }),
    );
  }
}
const implementationAfter = await captureResearchSourceClosure(roots),
  sourceDrift = [
    ...new Set([
      ...Object.keys(implementationBefore),
      ...Object.keys(implementationAfter),
    ]),
  ].filter((file) => implementationBefore[file] !== implementationAfter[file]);
if (sourceDrift.length)
  throw Error(`Query control sources changed: ${sourceDrift.join(", ")}`);
const result = {
  scope:
    "CPU ancestor candidate versus full-rig CPU opt-out on every original hero row boundary, forward/inclusive and backward/exclusive; no browser performance claim",
  reportSha256,
  reportBytes: Bun.file(reportPath).size,
  projectionCounts,
  coverage,
  counts,
  reasons,
  mismatches: 0,
  outputSha256: outputHasher.digest("hex"),
  isolatedBunQueryMs: { full: fullMs, ancestors: sparseMs },
  generatedSourceSha256: {
    sampler: hash(candidate.sampler),
    service: hash(candidate.service),
    baselineSampler: hash(candidate.baselineSampler),
    baselineService: hash(candidate.baselineService),
  },
  implementationSha256: implementationBefore,
  sourceDrift,
  inputs: Object.fromEntries(inputHashes),
  elapsedMs: performance.now() - started,
};
await Bun.write(resolve(output), JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output: resolve(output),
    counts,
    mismatches: 0,
    isolatedBunQueryMs: result.isolatedBunQueryMs,
  }),
);
