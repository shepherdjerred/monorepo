import { resolve } from "node:path";
import { createLatestEffectContexts } from "../latest-effect-contexts.mjs";
import { createLatestEffectResolvers } from "../latest-effect-resolvers.mjs";
import { createLatestUnitResources } from "../latest-unit-resources.mjs";
import {
  createLatestWorldPresentation,
  selectLatestWorldEffectResource,
  buildLatestDirectEffectEvents,
  EFFECT_ENTITY_FIELDS,
} from "../latest-world-presentation.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { createDirectEffectWorkerHandler } from "../latest-direct-effect-worker.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const inputs = {};
const raw = async (path) => {
  const bytes = await Bun.file(path).bytes();
  inputs[path] = await sha256(bytes);
  return bytes;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const load = (path) => raw(`${cache}/public/${path}`);
let assertions = 0;
const check = (condition, message) => {
  if (!condition) throw Error(message);
  assertions++;
};
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`);
const effectsManifestBytes = await load("latest-effects/manifest.json");
const contexts = await createLatestEffectContexts({
  profile,
  packageBytes: await load("latest-effect-contexts/package.json"),
  effectsManifestBytes,
});
const resolvers = await createLatestEffectResolvers({
  profile,
  builtinContextPackageBytes: await load(
    "latest-builtin-resource-contexts/package.json",
  ),
  contexts,
  effectsManifestBytes,
  packageBytes: await load("latest-effect-resolvers/package.json"),
});
const unitResources = await createLatestUnitResources({
  profile,
  resolvers,
  packageBytes: await load("latest-unit-resources/package.json"),
});
const nativePath = `${cache}/research/unit-resources-native.json`;
const native = await read(nativePath);
check(
  inputs[nativePath] === unitResources.metadata.observationSha256,
  "World binding comparison requires the policy's exact native observation",
);
const handles = new Map(
  native.maps.map((map) => [
    map.object,
    {
      id: `${map.actorKey}/${map.handle}`,
      contextIdentity: contexts.metadata.contexts.find(
        (context) => context.actorKey === map.actorKey,
      ).identity,
    },
  ]),
);
const handle = (pointer) => {
  if (pointer === 0) return null;
  const value = handles.get(pointer);
  check(value, "Native observation references an unknown resource handle");
  return value;
};
const stacks = new Map(
  native.units.map((unit) => [
    unit.object,
    {
      status: "supplied-resource-stack",
      base: handle(unit.baseResolver),
      overlays: unit.overlays.map(handle),
    },
  ]),
);
const report = {
  build: profile.clientVersion,
  protocol: profile.protocolDigest,
  heroes: [],
  movement: [],
  lifecycle: [],
  casts: [],
  attacks: [],
  missiles: [],
};
const scene = {
  build: report.build,
  protocol: report.protocol,
  map: { min: [0, 0, 0], max: [10, 1, 10], movementOrigin: [5, 5] },
};
const terrain = { sampleHeight: () => ({ inside: true, height: 0 }) };
const entities = [...stacks.keys()].map((entityId) => ({
  entityId,
  position: [0, 0, 0],
  creationTime: 0,
  creationTransportSequence: 0,
}));
const world = createLatestWorldPresentation({
  report,
  scene,
  terrain,
  entities,
  resourceTracks: [...stacks].map(([entityId, stack]) => ({
    entityId,
    time: 0,
    transportSequence: 1,
    stack,
  })),
  attachmentTracks: [
    {
      entityId: entities[0].entityId,
      key: 7,
      time: 0,
      transportSequence: 1,
      validUntil: 3,
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3, 4, 1],
    },
  ],
});
const cursor = { transportSequence: 10, entryOrder: 0 };
const descriptor = (sample) => ({
  ...Object.fromEntries(EFFECT_ENTITY_FIELDS.map((field) => [field, 0])),
  resourceContextEntityId: sample.units[0] ?? 0,
  lookupA8EntityId: sample.units[1] ?? 0,
  unresolvedAuxiliaryContextIds: sample.auxiliaries.map(
    (pointer) => handle(pointer).contextIdentity,
  ),
  resourceKey: sample.key,
  field8c: 0,
  coordinateSpace: "native-world",
  packetVectorsResolved: true,
  primaryPacketPosition: [0, 0, 0],
  secondaryPacketVector: [0, 0, 0],
  vector6c: [0, 0, 0],
  flags: 0x20,
  attachmentKey4c: 0,
  attachmentKey50: 0,
  byteFields: { field98: 0 },
});
let nativeCases = 0,
  matchedReferences = 0,
  globalBoundaries = 0;
for (const sample of native.cases) {
  check(
    sample.units.length <= 2,
    "Native case exceeds ordinary factory unit inputs",
  );
  const result = selectLatestWorldEffectResource({
    descriptor: descriptor(sample),
    time: 1,
    cursor,
    world,
    unitResources,
  });
  check(
    result.status === sample.status,
    `Native resource status differs: ${sample.label}`,
  );
  if (sample.status === "matched-authored-reference") {
    check(
      result.referenceToken === sample.value,
      "Native resource token differs",
    );
    if (result.stage.kind !== "auxiliary")
      check(
        result.handleId === handle(sample.owner).id,
        "Native unit resource owner differs",
      );
    matchedReferences++;
  } else globalBoundaries++;
  nativeCases++;
}
const sample = native.cases.find(
  (sample) => sample.label === "first-unit-base",
);
const d = descriptor(sample);
const callerPose = world.attachment(
  entities[0].entityId,
  7,
  1,
  cursor,
).transform;
callerPose[12] = 999;
check(
  world.attachment(entities[0].entityId, 7, 1, cursor).transform[12] === 2,
  "Caller mutation changed a historical attachment transform",
);
check(
  world.attachment(entities[0].entityId, 7, 0, {
    transportSequence: 2,
    entryOrder: 0,
  }).transform[12] === 2,
  "Caller mutation changed a backward attachment query",
);
const callerStack = world.entity(
  d.resourceContextEntityId,
  1,
  cursor,
).resourceStack;
const originalStack = structuredClone(callerStack);
callerStack.base.id = "caller-mutated-handle";
callerStack.overlays.push(null);
check(
  JSON.stringify(
    world.entity(d.resourceContextEntityId, 1, cursor).resourceStack,
  ) === JSON.stringify(originalStack),
  "Caller mutation changed a historical world resource observation",
);
check(
  JSON.stringify(
    world.entity(d.resourceContextEntityId, 0, {
      transportSequence: 2,
      entryOrder: 0,
    }).resourceStack,
  ) === JSON.stringify(originalStack),
  "Caller mutation changed a backward resource query",
);
const select = (descriptor, selectedWorld = world, selectedCursor = cursor) =>
  selectLatestWorldEffectResource({
    descriptor,
    time: 1,
    cursor: selectedCursor,
    world: selectedWorld,
    unitResources,
  });
const unknownId = 0xf0000000;
const inactiveWorld = createLatestWorldPresentation({
  report,
  scene,
  terrain,
  entities: [
    ...entities,
    {
      entityId: unknownId,
      position: [0, 0, 0],
      creationTime: 2,
      creationTransportSequence: 15,
    },
  ],
});
check(
  select({ ...d, resourceContextEntityId: unknownId }, inactiveWorld).status ===
    "inactive-unit-resource-entity",
  "Known inactive resource entity was confused with an unknown identity",
);
check(
  select({ ...d, resourceContextEntityId: unknownId }).status ===
    "unresolved-unit-resource-entity",
  "Unresolved first unit incorrectly fell through to auxiliary resources",
);
check(
  select({
    ...d,
    resourceContextEntityId: unknownId,
    lookupA8EntityId: unknownId,
  }).field === "resourceContextEntityId",
  "Repeated missing identity overwrote its first causal unit field",
);
check(
  select({ ...d, lookupA8EntityId: unknownId }).referenceToken === sample.value,
  "A later unresolved unit incorrectly blocked a preceding matching unit",
);
check(
  !world.placement(
    { descriptor: { ...d, lookupA8EntityId: unknownId } },
    1,
    cursor,
  ).resolved,
  "Resource success incorrectly manufactured effect placement",
);
check(
  select({ ...d, resourceKey: 0 }).status === "alternate-name-unresolved",
  "Key zero fell through ordinary resolution",
);
check(
  select({ ...d, field8c: 1 }).status === "nonordinary-factory-order",
  "An unverified factory mode used ordinary precedence",
);
const emptyStack = {
  status: "supplied-resource-stack",
  base: null,
  overlays: [],
};
const causalWorld = createLatestWorldPresentation({
  report,
  scene,
  terrain,
  entities,
  resourceTracks: [
    {
      entityId: d.resourceContextEntityId,
      time: 0,
      transportSequence: 1,
      stack: stacks.get(d.resourceContextEntityId),
    },
    {
      entityId: d.resourceContextEntityId,
      time: 1,
      transportSequence: 12,
      entryOrder: 1,
      stack: emptyStack,
    },
  ],
});
const causalDescriptor = {
  ...d,
  lookupA8EntityId: 0,
  unresolvedAuxiliaryContextIds: [],
};
check(
  select(causalDescriptor, causalWorld).referenceToken === sample.value,
  "Resource selection observed a later same-time update",
);
check(
  select(causalDescriptor, causalWorld, {
    transportSequence: 12,
    entryOrder: 0,
  }).referenceToken === sample.value,
  "Resource selection lost packet entry ordering",
);
check(
  select(causalDescriptor, causalWorld, {
    transportSequence: 12,
    entryOrder: 1,
  }).status === "continue-global-resolution",
  "Resource selection did not observe its inclusive world update",
);
check(
  select(causalDescriptor, causalWorld).referenceToken === sample.value,
  "Backward resource sampling retained future state",
);
const unknownWorld = createLatestWorldPresentation({
  report,
  scene,
  terrain,
  entities,
});
check(
  select(d, unknownWorld).status === "unresolved-unit-resource-stack",
  "Equipped identity was substituted for a live unit stack",
);
let invalidStackRejected = false;
try {
  select(
    d,
    createLatestWorldPresentation({
      report,
      scene,
      terrain,
      entities,
      resourceTracks: [
        {
          entityId: d.resourceContextEntityId,
          time: 0,
          transportSequence: 1,
          stack: { status: "equipped-appearance" },
        },
      ],
    }),
  );
} catch {
  invalidStackRejected = true;
}
check(
  invalidStackRejected,
  "Malformed world resource observation was accepted",
);
const pipeline = {
  events: [
    {
      kind: "create-request",
      creationSequence: 0,
      entityId: 1,
      time: 1,
      ...cursor,
    },
  ],
  creation: () => ({
    descriptor: d,
    resourceStages: { auxiliary: { status: "unprepared-context-id" } },
  }),
};
const [event] = buildLatestDirectEffectEvents({
  pipeline,
  report,
  world,
  unitResources,
});
const expected = select(d);
check(
  event.resourceSelection.referenceToken === sample.value,
  "Event builder did not retain the causal resource result",
);
check(
  event.kind ===
    (expected.resource.status === "prepared-definition" ? "create" : "omitted"),
  "Event builder used an auxiliary candidate instead of the selected unit resource",
);
check(
  JSON.stringify(event.descriptor) === JSON.stringify(d),
  "World resource selection changed one of the original descriptor inputs",
);
check(
  event.ownerId === null,
  "Resource context was incorrectly promoted to champion ownership",
);
const [blockedEvent] = buildLatestDirectEffectEvents({
  pipeline: {
    ...pipeline,
    creation: () => ({
      descriptor: d,
      resourceStages: {
        auxiliary: {
          status: "matched-authored-reference",
          resource: expected.resource,
        },
      },
    }),
  },
  report,
  world: unknownWorld,
  unitResources,
});
check(
  blockedEvent.kind === "omitted" && blockedEvent.definitionId === undefined,
  "Unknown unit precedence promoted an auxiliary candidate to selected definition",
);
check(
  blockedEvent.auxiliaryCandidateDefinitionId === expected.resource.effectId,
  "Static auxiliary inventory was not retained separately from actual selection",
);
check(
  event.kind === "create",
  "Worker boundary case requires a prepared native-selected definition",
);
const prepared = await loadLatestDirectEffectPackage({
  load,
  manifestBytes: effectsManifestBytes,
  effectIds: [event.definitionId],
});
const matchScene = await read(`${cache}/public/latest-scene/manifest.json`);
const heightBytes = await load("latest-scene/heights.bin");
const worker = createDirectEffectWorkerHandler();
await worker({
  type: "initialize",
  payload: {
    profile: prepared.profile,
    packages: prepared.packages,
    contract: { ...prepared.contract, replayHash: "0".repeat(64) },
    definitions: [...prepared.definitions.values()],
    events: [event],
    report,
    scene: matchScene,
    heights: new Float32Array(
      heightBytes.buffer,
      heightBytes.byteOffset,
      heightBytes.byteLength / 4,
    ),
    world: {
      entities,
      resourceTracks: [...stacks].map(([entityId, stack]) => ({
        entityId,
        time: 0,
        transportSequence: 1,
        stack,
      })),
    },
  },
});
await worker({
  type: "advance",
  payload: { time: 1, camera: { right: [1, 0, 0], up: [0, 1, 0] } },
});
const workerCoverage = await worker({ type: "coverage" });
check(
  workerCoverage.rows.length === 1,
  "Worker lost the selected resource event",
);
check(
  workerCoverage.rows[0].resourceResolved === true,
  "Selected resource did not reach runtime coverage",
);
check(
  workerCoverage.rows[0].placementResolved === false,
  "Resource success incorrectly established worker placement",
);
check(
  workerCoverage.rows[0].worldInputsResolved === false,
  "Resource success incorrectly established component world inputs",
);
check(
  workerCoverage.rows[0].allCompiledComponentInputsResolved === false &&
    workerCoverage.rows[0].eligibleComponentCount === 0,
  "Unresolved placement admitted compiled component inputs",
);
check(
  workerCoverage.rows[0].reasons.includes(
    "world:additional-provider-class-unproven:unknown",
  ),
  "Worker did not preserve the precise remaining placement dependency",
);
const summary = {
  nativeCases,
  matchedReferences,
  globalBoundaries,
  assertions,
  workerResourceResolved: workerCoverage.rows[0].resourceResolved,
  workerPlacementResolved: workerCoverage.rows[0].placementResolved,
  workerWorldInputsResolved: workerCoverage.rows[0].worldInputsResolved,
  workerAllCompiledComponentInputsResolved:
    workerCoverage.rows[0].allCompiledComponentInputsResolved,
  workerEligibleComponentCount: workerCoverage.rows[0].eligibleComponentCount,
  scope: {
    exactNativeSuppliedStackCases: true,
    worldQueriesUseCreationPacketAndEntry: true,
    containsObservedMatchStacks: false,
    matchEffectsActivated: false,
    placementPolicyEvaluatedInWorker: true,
    resolvedPlacement: false,
  },
};
const sources = {};
for (const path of [
  import.meta.path,
  resolve(import.meta.dir, "../latest-world-presentation.mjs"),
  resolve(import.meta.dir, "../latest-unit-resources.mjs"),
  resolve(import.meta.dir, "../latest-effect-resolvers.mjs"),
  resolve(import.meta.dir, "../latest-effect-contexts.mjs"),
  resolve(import.meta.dir, "../latest-direct-effect-worker.mjs"),
  resolve(import.meta.dir, "../latest-direct-effect-runtime.mjs"),
  resolve(import.meta.dir, "../latest-direct-effect-package.mjs"),
  resolve(import.meta.dir, "../latest-direct-effect-session.mjs"),
])
  sources[path] = await sha256(await Bun.file(path).bytes());
await Bun.write(
  `${cache}/research/world-resource-bindings-comparison.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "native-world-resource-binding-comparison",
      build: report.build,
      protocol: report.protocol,
      inputs,
      sources,
      ...summary,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(summary, null, 2));
