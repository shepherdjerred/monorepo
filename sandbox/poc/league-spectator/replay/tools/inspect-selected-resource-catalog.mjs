// Actual selected resource consumers over an identified decoded fixture.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { sameDirectCompiledData } from "../latest-direct-compiled-restore.mjs";
import { loadLatestStaticCatalogSelection } from "../latest-static-catalog.mjs";
import { loadLatestInitialResourcePrefix } from "../latest-initial-resource-prefix.mjs";
import { createLatestUnitResources } from "../latest-unit-resources.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const [cacheArg, reportArg, legacyArg] = process.argv.slice(2);
if (
  !cacheArg ||
  !reportArg ||
  (legacyArg !== undefined && legacyArg !== "--compare-legacy") ||
  process.argv.length > 5
)
  throw Error(
    "Usage: bun inspect-selected-resource-catalog.mjs <cache> <decoded-report> [--compare-legacy]",
  );
const cache = resolve(cacheArg),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error("Resource control input changed: " + path);
  inputs[path] = digest;
  return bytes;
}
const load = (path) => raw(`${cache}/public/${path}`),
  decode = (bytes) => JSON.parse(new TextDecoder().decode(bytes));
await captureDirectSourceInputs([import.meta.path], raw);
const selection = await loadLatestStaticCatalogSelection({ load }),
  profile = selection.profile(),
  manifestBytes = await selection.readRole("effects"),
  document = decode(await raw(reportArg)),
  report =
    document.kind === "verified-ordinary-reconstruction-diagnostic-export"
      ? document.report
      : document;
if (
  report?.build !== profile.clientVersion ||
  report.protocol !== profile.protocolDigest ||
  !Array.isArray(report.heroes) ||
  !Array.isArray(report.resourceRequests)
)
  throw Error("Exact decoded resource request fixture required");
const selected = await loadLatestInitialResourcePrefix({
  profile,
  load,
  manifestBytes,
  report,
  staticCatalog: selection,
});
const unit = await createLatestUnitResources({
  profile,
  resolvers: selected.resolvers,
  packageBytes: await selection.readRole("unitResources"),
  staticCatalog: selection,
});
const legacy =
  legacyArg === undefined
    ? null
    : await loadLatestInitialResourcePrefix({
        profile,
        load,
        manifestBytes,
        report,
      });
const queries = [];
for (const hero of report.heroes) {
  for (const time of [0, 69, 84, 99])
    queries.push({ entityId: hero.entityId, time, cursor: null });
  for (const request of report.resourceRequests.filter(
    (r) => r.entityId === hero.entityId,
  )) {
    const cursor = {
      transportSequence: request.transportSequence,
      entryOrder: request.entryOrder,
    };
    queries.push(
      {
        entityId: hero.entityId,
        time: request.time,
        cursor: { ...cursor, exclusive: true },
      },
      { entityId: hero.entityId, time: request.time, cursor },
    );
  }
}
let legacyComparisons = 0;
const statuses = {};
for (const query of [...queries, ...queries.slice().reverse()]) {
  const actual = selected.policy.query(
    query.entityId,
    query.time,
    query.cursor,
  );
  statuses[actual.status] = (statuses[actual.status] ?? 0) + 1;
  if (legacy) {
    const expected = legacy.policy.query(
      query.entityId,
      query.time,
      query.cursor,
    );
    if (!sameDirectCompiledData(actual, expected))
      throw Error(
        "Selected initial resource query differs from legacy: " +
          JSON.stringify(query),
      );
    legacyComparisons++;
  }
}
let rows = 0;
for (const actor of selected.resolvers.metadata.actors)
  for (const row of actor.rows) {
    const actual = selected.resolvers.lookup(actor.contextIdentity, row.key);
    if (
      actual.status !== "matched-authored-reference" ||
      actual.referenceToken !== row.referenceToken
    )
      throw Error(
        "Selected resolver lookup differs from its original typed row",
      );
    if (
      legacy &&
      !sameDirectCompiledData(
        actual,
        legacy.resolvers.lookup(actor.contextIdentity, row.key),
      )
    )
      throw Error("Legacy resolver lookup changed");
    rows++;
  }
const bound = selected.resolvers.bindRequests(report),
  stages = {};
for (const request of bound)
  stages[request.auxiliary.status] =
    (stages[request.auxiliary.status] ?? 0) + 1;
if (
  legacy &&
  !sameDirectCompiledData(bound, legacy.resolvers.bindRequests(report))
)
  throw Error("Selected auxiliary requests differ from legacy");
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error("Resource input changed before publication: " + path);
const output = `${cache}/research/selected-resource-catalog-control.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "actual-selected-resource-catalog-consumers",
      inputs,
      catalog: selection.describe(),
      counts: {
        contexts: selected.contexts.metadata.contexts.length,
        resolvers: selected.resolvers.metadata.actors.length,
        rows,
        queries: queries.length * 2,
        legacyComparisons,
        boundRequests: bound.length,
      },
      negativeCapabilityProjection:
        selected.policy.negativeFormPrefix.selectedCapabilityProjection,
      queryStatuses: statuses,
      auxiliaryStages: stages,
      unitProgram: unit.metadata,
      scope: {
        actualSelectedResourceConsumers: true,
        legacyExactComparison: legacy !== null,
        decodedFixtureInput: true,
        ordinaryReconstructionSourceFreshnessEstablished: false,
        nativeWorldAcceptance: false,
        effectsRendered: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    counts: { rows, queries: queries.length * 2, legacyComparisons },
    auxiliaryStages: stages,
  }),
);
