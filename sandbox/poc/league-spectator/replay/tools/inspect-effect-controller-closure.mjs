// Closed-v23 actual creation inventory. Complete compiled membership is a
// necessary parent-controller gate, not proof of native acceptance/retirement.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { linkLatestNetworkEffectLifecycle } from "../latest-network-effect-lifecycle.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Input drift: ${path}`);
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const worker = await read(
    `${cache}/research/shared-direct-playback-worker.json`,
  ),
  session = await read(`${cache}/research/direct-session-control.json`),
  { report } = await read(`${cache}/research/viewer-root-reconstruction.json`),
  manifest = await read(`${cache}/public/latest-effects/manifest.json`);
if (
  worker.schedules[0].summary.contract.runtimeVersion !== 23 ||
  session.diagnostic.definitions.some((d) => d.programVersion !== 23)
)
  throw Error("Closed v23 compiled/runtime evidence required");
const rows = worker.schedules[0].coverage.rows.filter(
    (row) => row.time >= 69 && row.time <= 99 && row.runtimeActivated,
  ),
  definitions = new Map(
    session.diagnostic.definitions.map((definition) => [
      definition.id,
      definition,
    ]),
  ),
  groups = [];
const children = (value) =>
  value &&
  typeof value === "object" &&
  (Object.hasOwn(value, "childParticleSetDefinition") ||
    Object.hasOwn(value, "children") ||
    Object.values(value).some(children));
for (const id of new Set(rows.map((row) => row.definitionId))) {
  const ref = manifest.definitions[id],
    compiled = definitions.get(id),
    path = resolve(`${cache}/public/latest-effects/${ref.file}`),
    source = await read(path),
    definition = source.definition,
    original = definition.complexEmitterDefinitionData ?? [],
    excludedDisabled = compiled.unsupported
      .filter(
        (entry) =>
          entry.reasons.length === 1 &&
          entry.reasons[0] === "authored-disabled",
      )
      .map((entry) => entry.index),
    supported = new Set(compiled.supported),
    missing = original.flatMap((emitter, index) =>
      supported.has(index) || excludedDisabled.includes(index) ? [] : [index],
    ),
    lifetimeFailures = [...supported].flatMap((index) => {
      const life = original[index].particleLifetime;
      return life &&
        life.__type === "ValueFloat" &&
        Number.isFinite(life.constantValue) &&
        life.constantValue >= 0 &&
        Object.keys(life).every((key) =>
          ["__type", "constantValue"].includes(key),
        )
        ? []
        : [{ index, source: life ?? null }];
    }),
    active = rows.filter((row) => row.definitionId === id),
    reasons = [
      ...(missing.length ? ["uncompiled-complex-emitters"] : []),
      ...(ref.simpleEmitters || definition.simpleEmitterDefinitionData?.length
        ? ["simple-emitters"]
        : []),
      ...(children(definition) ? ["child-resource-ancestry"] : []),
      ...compiled.blockers,
      ...(lifetimeFailures.length
        ? ["particle-lifetime-not-exact-constant-only"]
        : []),
    ];
  if (ref.sha256 !== inputs[path])
    throw Error(`Definition hash differs: ${id}`);
  if (excludedDisabled.some((index) => !original[index]?.disabled))
    throw Error("Disabled exclusion is not authored");
  groups.push({
    id,
    requests: active.length,
    networkRequests: active.filter((row) => row.origin === "network-effect")
      .length,
    sourceComplexEmitters: original.length,
    supported: [...supported],
    excludedDisabled,
    missingComplexEmitterIndices: missing,
    simpleEmitters: ref.simpleEmitters,
    hasChildDeclaration: !!children(definition),
    rootBlockers: compiled.blockers,
    constantLifetimes: [...supported]
      .filter((index) => !lifetimeFailures.some((f) => f.index === index))
      .map((index) => ({
        index,
        value: original[index].particleLifetime.constantValue,
      })),
    lifetimeFailures,
    reasons,
    wholeControllerCandidate: reasons.length === 0,
    requestIds: active.map((row) => row.id),
  });
}
const normalized = [
    ...report.effectCreations.map((record, index) => ({
      id: `network-effect:${record.entityId}:${record.creationSequence}`,
      kind: "omitted",
      origin: "network-effect",
      entityId: record.entityId,
      time: record.time,
      transportSequence: record.transportSequence,
      entryOrder: record.creationSequence,
      creationSequence: record.creationSequence,
      descriptor: report.effectDescriptors[index],
    })),
    ...report.effectRemovals.map((record) => ({
      id: `network-removal:${record.entityId}:${record.removalSequence}`,
      kind: "removal-request",
      origin: "network-effect",
      entityId: record.entityId,
      time: record.time,
      transportSequence: record.transportSequence,
      entryOrder: 0,
      removalSequence: record.removalSequence,
      requestedFlags: record.requestedFlagMask,
    })),
  ],
  linked = linkLatestNetworkEffectLifecycle({
    events: normalized,
    creations: report.effectCreations,
    removals: report.effectRemovals,
  }).filter((row) => row.kind === "removal-request");
for (const group of groups) {
  const ids = new Set(group.requestIds),
    removals = linked.filter((row) => ids.has(row.sourceEventId));
  group.removalOccurrences = removals.length;
  group.removalReasonBytes = Object.fromEntries(
    [...new Set(removals.map((row) => row.removalInput.reasonByte))].map(
      (reason) => [
        reason,
        removals.filter((row) => row.removalInput.reasonByte === reason).length,
      ],
    ),
  );
  group.removals = removals.map((row) => ({
    id: row.id,
    time: row.time,
    sourceEventId: row.sourceEventId,
    generation: row.generation,
    reasonByte: row.removalInput.reasonByte,
  }));
}
const eligible = groups.filter((group) => group.wholeControllerCandidate),
  result = {
    schema: 1,
    kind: "closed-v23-actual-controller-closure-inventory",
    window: [69, 99],
    activeRequests: rows.length,
    activeNetworkRequests: rows.filter((row) => row.origin === "network-effect")
      .length,
    activeDefinitions: groups.length,
    wholeControllerCandidateDefinitions: eligible.length,
    wholeControllerCandidateRequests: eligible.reduce(
      (n, g) => n + g.requests,
      0,
    ),
    wholeControllerCandidateNetworkRequests: eligible.reduce(
      (n, g) => n + g.networkRequests,
      0,
    ),
    wholeControllerCandidateRequestIds: eligible.flatMap((g) => g.requestIds),
    wholeControllerCandidateRemovalOccurrences: eligible.reduce(
      (n, g) => n + g.removalOccurrences,
      0,
    ),
    groups,
    inputs,
    scope: {
      originalEmittersChecked: true,
      compiledLingerAnnotationsDoNotExclude: true,
      wholeControllerCandidateDoesNotProveNativeCompletion: true,
      nativeWorldLookupAcceptance: null,
      priorV23EvidenceIsHistoricalAfterV24SourceEdits: true,
      runtimeInput: false,
    },
  };
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error(`Final input drift: ${path}`);
const output = `${cache}/research/effect-controller-closure-v23.json`;
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    ...result,
    groups: groups.map(({ requestIds, removals, ...group }) => group),
    inputs: Object.keys(inputs).length,
  }),
);
