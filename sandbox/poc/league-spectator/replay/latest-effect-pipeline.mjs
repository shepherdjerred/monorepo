// Canonical replay effect requests. A creation request is not proof that the
// native factory succeeded; a removal request is not an immediate deletion.
// All requests enter one ordered, seekable registry before presentation policy.
import { bindLatestCreationResources } from "./latest-effect-creation.mjs";
import { EFFECT_DESCRIPTOR_PACKAGE_SHA } from "./latest-effect-descriptor.mjs";
import { EFFECT_PLACEMENT_PACKAGE_SHA } from "./latest-effect-placement.mjs";
import { sha256 } from "./structural-comparison.mjs";
import { assertLatestSelectedMaterials } from "./latest-selected-materials.mjs";

export const COMPLETE_QUAD_GPU_SHA =
  "90ece241edc84d09db14503bc120c907ffb756b96b59aed522d7b78da8100762";
const TRAIL_GPU_SHA =
  "b4dee053c3721792cb019c6433e53c303abd036effa2f783db80deeb8aeb156a";
const uint = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
const freeze = (v) => {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    for (const child of Object.values(v)) freeze(child);
    Object.freeze(v);
  }
  return v;
};
const finiteVector = (v, n) =>
  Array.isArray(v) && v.length === n && v.every(Number.isFinite);
const increment = (counts, key, n = 1) => {
  counts[key] = (counts[key] ?? 0) + n;
};

export async function createLatestEffectPipeline({
  report,
  effectsManifestBytes,
  quadGpuBytes,
  trailGpuBytes,
  selectedMaterials = null,
}) {
  const selection =
      selectedMaterials === null
        ? null
        : assertLatestSelectedMaterials(selectedMaterials).staticCatalog,
    selectedRoots = selection?.describe(),
    selectedHash = (role) =>
      selectedRoots?.files[selectedRoots.roles[role]]?.sha256;
  if (
    report.build !== "16.21.829.8620" ||
    report.protocol !== "20e09df23c66b85e" ||
    report.effectDescriptorPackageSha256 !==
      (selection
        ? selectedHash("effectDescriptor")
        : EFFECT_DESCRIPTOR_PACKAGE_SHA) ||
    report.effectPlacementPackageSha256 !==
      (selection
        ? selectedHash("effectPlacement")
        : EFFECT_PLACEMENT_PACKAGE_SHA) ||
    !Array.isArray(report.effectDescriptors) ||
    report.effectDescriptors.length !== report.effectCreations.length ||
    !Number.isFinite(report.endTime) ||
    report.endTime < 0
  )
    throw Error(
      "Complete native effect descriptors and matching replay required",
    );
  if (selectedMaterials !== null)
    await selectedMaterials.assertPackages({
      effectsManifestBytes,
      quadPackageBytes: quadGpuBytes,
      trailPackageBytes: trailGpuBytes,
      erosionPackageBytes: selectedMaterials.packageBytes("erosion"),
    });
  else if (
    (await sha256(quadGpuBytes)) !== COMPLETE_QUAD_GPU_SHA ||
    (await sha256(trailGpuBytes)) !== TRAIL_GPU_SHA
  )
    throw Error("Effect pipeline capability package changed");
  const parse = (bytes) =>
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    effects = parse(effectsManifestBytes),
    quad = parse(quadGpuBytes),
    trail = trailGpuBytes === undefined ? null : parse(trailGpuBytes),
    effectsSha = await sha256(effectsManifestBytes);
  for (const p of [effects, quad, ...(trail === null ? [] : [trail])])
    if (p.build !== report.build || p.protocol !== report.protocol)
      throw Error("Effect pipeline build mismatch");
  if (
    quad.effectsManifestSha256 !== effectsSha ||
    (trail !== null && trail.effectsManifestSha256 !== effectsSha)
  )
    throw Error("Effect pipeline asset/capability identity differs");
  const capabilities = buildCapabilities(
      effects,
      selectedMaterials === null
        ? [
            ["quad", quad],
            ["trail", trail],
          ]
        : selectedMaterials.capabilityPackages(),
    ),
    bindings = bindLatestCreationResources(report, effects),
    events = [],
    templates = new Map(),
    summary = {
      creationRequests: report.effectCreations.length,
      removalRequests: report.effectRemovals.length,
      preparedResourceRequests: 0,
      requestsWithGpuBindings: 0,
      requestsWithAllGpuBindings: 0,
      requestedEmitterInstances: 0,
      preparedEmitterInstances: 0,
      resourceGaps: {},
      dependencyRequests: {},
      emitterGaps: {},
      uniqueEffects: 0,
      renderedEffectRequests: 0,
    },
    uniqueEffects = new Set();
  for (const [index, c] of report.effectCreations.entries()) {
    const d = report.effectDescriptors[index],
      b = bindings[index];
    validateCreation(c, d, index, report.endTime);
    const dependencies = [];
    if (b.status !== "prepared-context-resource") {
      increment(summary.resourceGaps, b.status);
      dependencies.push(`resource:${b.status}`);
    }
    for (const field of [
      "attachmentEntityId",
      "lookup14EntityId",
      "lookupA8EntityId",
    ])
      if (c[field] !== 0) dependencies.push(`registry:${field}`);
    if (d.unresolvedAuxiliaryContextIds.length)
      dependencies.push("registry:auxiliary-contexts");
    for (const field of ["attachmentKey4c", "attachmentKey50"])
      if (d[field] !== 0) dependencies.push(`attachment:${field}`);
    const capability = b.effectId ? capabilities.get(b.effectId) : null;
    if (b.effectId && !capability)
      throw Error("Prepared effect has no capability inventory");
    if (capability) {
      summary.preparedResourceRequests++;
      uniqueEffects.add(b.effectId);
      summary.requestedEmitterInstances += capability.total;
      summary.preparedEmitterInstances += capability.prepared.length;
      if (capability.prepared.length) summary.requestsWithGpuBindings++;
      if (capability.complete) summary.requestsWithAllGpuBindings++;
      for (const reason of capability.gaps)
        increment(summary.emitterGaps, reason);
    }
    // These unresolved engine stages apply across requests. Do not activate a
    // renderer merely because its textures and packet position are available.
    dependencies.push(
      "engine:factory-finalization",
      "engine:parent-activation",
      "engine:runtime-clock-and-seed",
      "engine:removal-retirement",
    );
    for (const dependency of dependencies)
      increment(summary.dependencyRequests, dependency);
    const template = freeze({
      entityId: c.entityId,
      creationSequence: index,
      time: c.time,
      transportSequence: c.transportSequence,
      resource: structuredClone(b),
      descriptor: structuredClone(d),
      capability,
      dependencies,
    });
    templates.set(index, template);
    events.push(
      freeze({
        kind: "create-request",
        time: c.time,
        transportSequence: c.transportSequence,
        entryOrder: index,
        entityId: c.entityId,
        creationSequence: index,
      }),
    );
  }
  for (const [index, r] of report.effectRemovals.entries()) {
    if (
      !uint(r.entityId) ||
      r.entityId === 0 ||
      !uint(r.reasonByte) ||
      r.reasonByte > 255 ||
      r.removalSequence !== index ||
      !Number.isSafeInteger(r.transportSequence) ||
      r.transportSequence < 0 ||
      !Number.isFinite(r.time) ||
      r.time < 0 ||
      r.time > report.endTime ||
      r.requestedFlagMask !== (r.reasonByte === 61 ? 0x800 : 0x10000000)
    )
      throw Error("Invalid native effect removal request");
    events.push(
      freeze({
        kind: "remove-request",
        time: r.time,
        transportSequence: r.transportSequence,
        entryOrder: 0,
        entityId: r.entityId,
        removalSequence: index,
        reasonByte: r.reasonByte,
        requestedFlagMask: r.requestedFlagMask,
      }),
    );
  }
  summary.uniqueEffects = uniqueEffects.size;
  events.sort(
    (a, b) =>
      a.time - b.time ||
      a.transportSequence - b.transportSequence ||
      a.entryOrder - b.entryOrder,
  );
  for (let i = 1; i < events.length; i++)
    if (
      events[i].transportSequence === events[i - 1].transportSequence &&
      events[i].kind !== events[i - 1].kind
    )
      throw Error("Transport ordinal contains conflicting effect packet kinds");
  return createRequestTimeline(events, templates, summary, report.endTime);
}

function validateCreation(c, d, index, endTime) {
  if (
    c.creationSequence !== index ||
    d.creationSequence !== index ||
    c.entityId === 0 ||
    !uint(c.entityId) ||
    c.entityId !== d.entityId ||
    c.groupIndex !== d.groupIndex ||
    c.entryIndex !== d.entryIndex ||
    c.resourceKey !== d.resourceKey ||
    c.time !== d.time ||
    c.transportSequence !== d.transportSequence ||
    !Number.isSafeInteger(c.transportSequence) ||
    c.transportSequence < 0 ||
    !Number.isFinite(c.time) ||
    c.time < 0 ||
    c.time > endTime ||
    !finiteVector(d.primaryPacketPosition, 3) ||
    !finiteVector(d.secondaryPacketVector, 3) ||
    !finiteVector(d.tertiaryPacketVector, 3) ||
    !finiteVector(d.vector6c, 3) ||
    !Array.isArray(d.unresolvedAuxiliaryContextIds) ||
    !d.unresolvedAuxiliaryContextIds.every(uint) ||
    !/^[0-9a-f]{384}$/.test(d.descriptorHex) ||
    !d.packetVectorsResolved ||
    d.worldPlacementResolved ||
    d.factoryExecuted
  )
    throw Error("Effect descriptor does not match creation request");
  for (const field of [
    "resourceContextEntityId",
    "attachmentEntityId",
    "lookup14EntityId",
    "lookupA8EntityId",
  ])
    if (!uint(c[field]) || c[field] !== d[field])
      throw Error("Effect context identity differs");
}

function buildCapabilities(effects, packages) {
  const admitted = new Map(),
    omitted = new Map();
  for (const [kind, p] of packages) {
    for (const e of p.emitters) {
      const ref = effects.definitions[e.effectId],
        key = `${e.effectId}:${e.emitterIndex}`;
      if (
        !ref ||
        ref.sha256 !== e.sourceDefinitionSha256 ||
        !Number.isInteger(e.emitterIndex) ||
        e.emitterIndex < 0 ||
        e.emitterIndex >= ref.complexEmitters ||
        admitted.has(key)
      )
        throw Error("Effect capability binding differs from its definition");
      admitted.set(
        key,
        freeze({ kind, index: e.emitterIndex, graphSha256: e.graphSha256 }),
      );
    }
    for (const e of p.omitted) {
      const key = `${e.effectId}:${e.emitterIndex}`;
      if (!omitted.has(key)) omitted.set(key, []);
      omitted.get(key).push(...e.reasons);
    }
  }
  const out = new Map();
  for (const [id, ref] of Object.entries(effects.definitions)) {
    const prepared = [],
      gaps = [];
    for (let i = 0; i < ref.complexEmitters; i++) {
      const key = `${id}:${i}`;
      if (admitted.has(key)) prepared.push(admitted.get(key));
      else {
        const reasons = omitted.get(key);
        if (!reasons?.length)
          throw Error("Effect emitter missing from capability inventory");
        gaps.push(...reasons);
      }
    }
    if (ref.simpleEmitters) gaps.push("native-runtime:simple-emitter");
    const total = ref.complexEmitters + ref.simpleEmitters;
    out.set(
      id,
      freeze({
        total,
        prepared,
        gaps: [...new Set(gaps)],
        complete: total > 0 && prepared.length === total,
      }),
    );
  }
  return out;
}

function createRequestTimeline(events, templates, summary, endTime) {
  // Checkpoints share immutable state records; each checkpoint owns its Map.
  // Removal requests preserve identity and accumulate native requested bits.
  const emptyCounts = () => ({
    "creation-requested": 0,
    "removal-requested": 0,
    "removal-without-observed-creation": 0,
  });
  const checkpoints = [
    {
      index: 0,
      states: new Map(),
      totals: emptyCounts(),
    },
  ];
  const apply = (states, totals, e) => {
    const prior = states.get(e.entityId);
    if (prior) totals[prior.phase]--;
    let state;
    if (e.kind === "create-request") {
      state = {
        entityId: e.entityId,
        generation: (prior?.generation ?? 0) + 1,
        creationSequence: e.creationSequence,
        phase: "creation-requested",
        requestedFlags: 0,
        removalCount: 0,
        lastRemovalSequence: null,
      };
    } else {
      state = {
        entityId: e.entityId,
        generation: prior?.generation ?? 0,
        creationSequence: prior?.creationSequence ?? null,
        phase:
          prior?.creationSequence !== null &&
          prior?.creationSequence !== undefined
            ? "removal-requested"
            : "removal-without-observed-creation",
        requestedFlags:
          ((prior?.requestedFlags ?? 0) | e.requestedFlagMask) >>> 0,
        removalCount: (prior?.removalCount ?? 0) + 1,
        lastRemovalSequence: e.removalSequence,
      };
    }
    state = freeze(state);
    states.set(e.entityId, state);
    totals[state.phase]++;
  };
  let states = new Map(),
    totals = emptyCounts();
  for (const [index, e] of events.entries()) {
    apply(states, totals, e);
    if ((index + 1) % 128 === 0)
      checkpoints.push({
        index: index + 1,
        states: new Map(states),
        totals: { ...totals },
      });
  }
  states = new Map();
  totals = emptyCounts();
  let cursor = 0;
  const seek = (time) => {
    if (!Number.isFinite(time) || time < 0 || time > endTime)
      throw Error("Invalid effect timeline time");
    let lo = 0,
      hi = events.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (events[mid].time <= time) lo = mid + 1;
      else hi = mid;
    }
    const target = lo;
    if (target < cursor) {
      const saved = checkpoints[Math.floor(target / 128)];
      states = new Map(saved.states);
      totals = { ...saved.totals };
      cursor = saved.index;
    }
    for (; cursor < target; cursor++) apply(states, totals, events[cursor]);
    return freeze({
      time,
      eventsApplied: target,
      creationRequested: totals["creation-requested"],
      removalRequested: totals["removal-requested"],
      removalWithoutObservedCreation:
        totals["removal-without-observed-creation"],
    });
  };
  return {
    summary: freeze(summary),
    events: freeze(events),
    scope: freeze({
      requestLifecycleOnly: true,
      removalIsImmediateDeletion: false,
      nativeFactorySucceededInferred: false,
      renderedCoverageMeasured: false,
      ordering: "recorded time, transport ordinal, creation entry order",
    }),
    seek,
    snapshot(time) {
      const counts = seek(time);
      return freeze({
        counts,
        entities: [...states.values()].sort((a, b) => a.entityId - b.entityId),
      });
    },
    sampleEntity(entityId, time) {
      if (!uint(entityId)) throw Error("Invalid effect entity ID");
      seek(time);
      const state = states.get(entityId);
      return state
        ? freeze({
            state,
            creation:
              state.creationSequence === null
                ? null
                : templates.get(state.creationSequence),
          })
        : null;
    },
    creation(index) {
      if (!Number.isSafeInteger(index) || !templates.has(index))
        throw Error("Unknown effect creation sequence");
      return templates.get(index);
    },
    get checkpointCount() {
      return checkpoints.length;
    },
  };
}
