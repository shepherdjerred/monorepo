import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  projectLatestDirectWorldInput,
  restoreLatestDirectWorldInput,
  consumeLatestDirectWorldInput,
} from "../latest-direct-world-input.mjs";
import {
  replayRowCount,
  replayRowProjection,
  replayRowAt,
  replayRows,
} from "../latest-replay-columns.mjs";
import { readPresentationBaseFlags } from "../latest-presentation-targets.mjs";
import { createLatestWorldPresentation } from "../latest-world-presentation.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { loadLatestViewerPoseAssets } from "../latest-viewer-pose-assets.mjs";
import { loadLatestInitialResourcePrefix } from "../latest-initial-resource-prefix.mjs";
import { loadLatestStaticCatalogSelection } from "../latest-static-catalog.mjs";

const [reportPath, assetRoot, outputPath, smokeArgument] =
  process.argv.slice(2);
if (
  !outputPath ||
  (smokeArgument !== undefined && !/^smoke:\d+$/.test(smokeArgument))
)
  throw Error(
    "Usage: bun compare-direct-world-input.mjs <full-semantic-report.json> <exact-public-assets> <output.json> [smoke:rows-per-domain]",
  );
const smokeLimit = smokeArgument ? Number(smokeArgument.slice(6)) : Infinity,
  started = performance.now(),
  report = await Bun.file(reportPath).json(),
  owned = projectLatestDirectWorldInput(report),
  wire = structuredClone(owned.input, {
    transfer: consumeLatestDirectWorldInput(owned.ownership, owned.input),
  }),
  projected = restoreLatestDirectWorldInput(wire);
const descriptorFields = [
  "attachmentEntityId",
  "lookup14EntityId",
  "attachmentKey4c",
  "attachmentKey50",
];
for (let index = 0; index < replayRowCount(report.effectDescriptors); index++)
  if (
    !isDeepStrictEqual(
      replayRowProjection(report.effectDescriptors, index, descriptorFields),
      replayRowProjection(projected.effectDescriptors, index, descriptorFields),
    )
  )
    throw Error(
      `Descriptor projection changed original attachment identity at ${index}`,
    );
const heroIds = new Set(report.heroes.map((hero) => hero.entityId)),
  expectedReplication = report.replicationRecords.filter(
    (row) =>
      heroIds.has(row.entityId) && readPresentationBaseFlags(row) !== null,
  );
if (!isDeepStrictEqual(expectedReplication, projected.replicationRecords))
  throw Error(
    "Projected target replication differs from original consumer selection",
  );
console.log(
  JSON.stringify({
    stage: "projection",
    counts: owned.counts,
    elapsedMs: performance.now() - started,
  }),
);
const files = new Map(),
  read = (path) => {
    if (!files.has(path))
      files.set(path, Bun.file(resolve(assetRoot, path)).bytes());
    return files.get(path);
  };
const selection = await loadLatestStaticCatalogSelection({ load: read }),
  profile = selection.profile(),
  load = (path) => selection.read(path),
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
  manifestBytes = await load("latest-effects/manifest.json"),
  effectsManifest = JSON.parse(new TextDecoder().decode(manifestBytes));
async function world(source) {
  const assets = await loadLatestViewerPoseAssets({
      profile,
      report: source,
      scene,
      load,
      staticCatalog: selection,
    }),
    resources = await loadLatestInitialResourcePrefix({
      profile,
      report: source,
      load,
      manifestBytes,
      staticCatalog: selection,
    });
  return createLatestWorldPresentation({
    report: source,
    scene,
    terrain,
    viewerPoseAssets: assets,
    initialResourcePrefix: resources.policy,
    effectsManifest,
  });
}
const full = await world(report),
  derived = await world(projected);
console.log(
  JSON.stringify({ stage: "worlds", elapsedMs: performance.now() - started }),
);
const counts = {},
  unresolved = {},
  digest = createHash("sha256");
function compare(method, args, domain) {
  const original = full[method](...args),
    received = derived[method](...args);
  if (!isDeepStrictEqual(original, received))
    throw Error(
      `World projection changed ${domain}/${method} query ${JSON.stringify(args)}`,
    );
  counts[method] = (counts[method] ?? 0) + 1;
  if (original?.resolved === false)
    unresolved[method] = (unresolved[method] ?? 0) + 1;
  digest.update(JSON.stringify([domain, method, args, original]));
}
const domains = [
    "movement",
    "lifecycle",
    "casts",
    "attacks",
    "animations",
    "worldEvents",
    "resourceRequests",
    "replicationRecords",
    "visibilityRequests",
    "missiles",
    "missileEvents",
    "effectDescriptors",
  ],
  coverage = {};
function methods(domain, id) {
  if (domain === "replicationRecords") return ["presentationTarget"];
  if (domain === "visibilityRequests")
    return ["visibility", "presentationTarget"];
  if (domain === "effectDescriptors") return ["entity", "viewerPose"];
  if (["animations", "casts", "attacks"].includes(domain))
    return heroIds.has(id)
      ? ["entity", "viewerPose", "viewerBoundSize"]
      : ["entity"];
  return [
    "entity",
    "viewerRoot",
    "visibility",
    "presentationTarget",
    ...(heroIds.has(id) ? ["viewerPose", "viewerBoundSize"] : []),
  ];
}
function queryRow(row, domain, reverse) {
  if (!Number.isFinite(row.time) || row.time < 0 || row.time > report.endTime)
    throw Error(`Original ${domain} timestamp outside declared decoded window`);
  const ids = new Set(
      Object.entries(row)
        .filter(
          ([key, value]) =>
            /^(entityId|.*EntityId)$/.test(key) &&
            Number.isInteger(value) &&
            value > 0,
        )
        .map(([, value]) => value),
    ),
    cursor = Number.isSafeInteger(row.transportSequence)
      ? {
          transportSequence: row.transportSequence,
          entryOrder: row.entryOrder ?? row.recordIndex ?? 0,
          exclusive: reverse,
        }
      : null;
  for (const id of ids)
    for (const method of methods(domain, id)) {
      const keys =
        domain === "effectDescriptors"
          ? [
              ...new Set(
                [
                  0,
                  ...(id === row.attachmentEntityId
                    ? [row.attachmentKey4c]
                    : []),
                  ...(id === row.lookup14EntityId ? [row.attachmentKey50] : []),
                ].filter(Number.isInteger),
              ),
            ]
          : [0];
      compare(
        method,
        method === "viewerPose"
          ? [id, keys, row.time, cursor]
          : [id, row.time, cursor],
        domain,
      );
    }
}
for (const reverse of [false, true]) {
  for (const domain of reverse ? [...domains].reverse() : domains) {
    const rows = report[domain],
      count = replayRowCount(rows),
      selected = Math.min(count, smokeLimit);
    if (!reverse)
      coverage[domain] = { originalRows: count, queriedRowsPerPass: selected };
    // Absolute queries traverse the same real causal boundaries in both orders.
    // Reverse queries use the exclusive original ordinal to exercise restoration.
    if (reverse)
      for (let index = selected - 1; index >= 0; index--)
        queryRow(replayRowAt(rows, index), domain, true);
    else {
      let index = 0;
      for (const row of replayRows(rows)) {
        if (index++ >= selected) break;
        queryRow(row, domain, false);
      }
    }
    console.log(
      JSON.stringify({
        stage: "queries",
        domain,
        reverse,
        rows: selected,
        counts,
        elapsedMs: performance.now() - started,
      }),
    );
  }
}
// Capture the actual static consumer graph, including aliases imported by pose,
// target, resource, visibility and world services. No source-text property list is
// substituted for the executed throwing getters and complete boundary queries.
const sources = new Map(),
  transpiler = new Bun.Transpiler({ loader: "js" });
async function sourceGraph(file) {
  if (sources.has(file)) return;
  const bytes = await Bun.file(file).bytes();
  sources.set(file, createHash("sha256").update(bytes).digest("hex"));
  for (const imported of transpiler.scanImports(bytes))
    if (imported.path.startsWith(".") && imported.path.endsWith(".mjs"))
      await sourceGraph(resolve(dirname(file), imported.path));
}
for (const file of [
  "latest-world-presentation.mjs",
  "latest-viewer-pose-assets.mjs",
  "latest-initial-resource-prefix.mjs",
  "latest-direct-world-input.mjs",
])
  await sourceGraph(
    resolve(dirname(fileURLToPath(import.meta.url)), "..", file),
  );
const reportDigest = createHash("sha256");
for await (const bytes of Bun.file(reportPath).stream())
  reportDigest.update(bytes);
const { files: staticFiles, ...staticIdentity } = selection.describe();
const result = {
  status: "passed",
  scope: smokeArgument
    ? "SMOKE ONLY - incomplete boundary coverage"
    : "Every retained real source row boundary queried forward/inclusive and backward/exclusive; exact world/pose/target/resource/visibility outputs; unchanged full main report",
  fullBoundaryCoverage: !smokeArgument,
  reportSha256: reportDigest.digest("hex"),
  durationSeconds: report.endTime,
  projection: owned.counts,
  coverage,
  queryCounts: counts,
  unresolvedOriginalOutputs: unresolved,
  queryResultSha256: digest.digest("hex"),
  selectedStaticContent: {
    ...staticIdentity,
    fileCount: Object.keys(staticFiles).length,
  },
  consumerSources: Object.fromEntries(sources),
  elapsedMs: performance.now() - started,
  rssBytes: process.memoryUsage.rss(),
  omissions: [
    "No GPU/rendered whole-match acceptance",
    "No new native fidelity admission",
  ],
};
await Bun.write(outputPath, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    status: result.status,
    fullBoundaryCoverage: result.fullBoundaryCoverage,
    projection: result.projection,
    queryCounts: counts,
    consumerSources: sources.size,
    reportSha256: result.reportSha256,
    queryResultSha256: result.queryResultSha256,
    elapsedMs: result.elapsedMs,
    rssBytes: result.rssBytes,
    outputPath,
  }),
);
