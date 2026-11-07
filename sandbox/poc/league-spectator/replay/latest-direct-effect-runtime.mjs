import {
  validateDirectAbsentRotationController,
  applyDirectAbsentRotationController,
} from "./latest-direct-effect-absent-rotation.mjs";
import {
  directParticleBasis,
  directParticleRotation,
  directParticleWorldBasis,
  directParticleWorldVector,
} from "./latest-direct-effect-math.mjs";
import {
  freezeDirectOwnedData,
  protectDirectDataGraph,
} from "./latest-direct-immutable-data.mjs";
import { sampleDirectEffectBirth } from "./latest-direct-effect-birth.mjs";
import { directBoundFlexScale } from "./latest-direct-effect-flex.mjs";
import {
  sampleDirectLegacyOffset,
  validateDirectLegacyOffsetProgram,
} from "./latest-direct-effect-legacy-offset.mjs";
import { directStaticMeshRetainedDraw } from "./latest-direct-effect-static-mesh-draw.mjs";
import { directRayRetainedParticle } from "./latest-direct-effect-ray-draw.mjs";
import { directRayGeometry } from "./latest-direct-effect-ray.mjs";
import { validateDirectRayProgram } from "./latest-direct-effect-ray-program.mjs";
import { validateDirectCameraMeshFlags } from "./latest-direct-effect-camera-mesh-flags.mjs";
import { validateDirectCameraLocalOffsetProgram } from "./latest-direct-effect-camera-local.mjs";
import {
  validateDirectMultUv,
  DIRECT_CONSTANT_MULT_UV_POLICY,
  directConstantMultUvCorners,
  sampleDirectMultUvCorners,
} from "./latest-direct-effect-mult-uv.mjs";
import { createDirectPoseEvidenceSnapshots } from "./latest-direct-pose-evidence-snapshots.mjs";
import { validateDirectNavGroundProgram } from "./latest-direct-nav-ground-materials.mjs";
import {
  isLatestDirectChildSiblingProgram,
  directChildFreeSiblingEligible,
} from "./latest-direct-child-siblings.mjs";
import { directChildSiblingResourceInputs } from "./latest-direct-child-sibling-resources.mjs";
import { validateDirectStaticMeshProgram } from "./latest-direct-effect-static-mesh-program.mjs";
import { NETWORK_EFFECT_LIFECYCLE_POLICY } from "./latest-network-effect-lifecycle.mjs";
import { compileDirectEmptySingleResourceProgram } from "./latest-direct-effect-link-controllers.mjs";
import { directRemovalFlagTransition } from "./latest-direct-effect-retirement.mjs";
import {
  compileDirectEmitterLifecycle,
  createDirectEmitterLifecycleState,
  beginDirectEmitterLifecycle,
  finishDirectEmitterLifecycle,
} from "./latest-direct-effect-lifecycle.mjs";
import {
  createDirectCameraCache,
  directCameraBasis,
} from "./latest-direct-effect-camera.mjs";
import { directTrailGeometry } from "./latest-direct-effect-trail.mjs";
import { validateDirectSystemAudio } from "./latest-direct-effect-audio.mjs";
import {
  directIntegratedParticleRotation,
  validateDirectIntegratedRotation,
} from "./latest-direct-effect-integrated-rotation.mjs";
import { validateDirectDepthDisabledSoftProgram } from "./latest-direct-effect-soft.mjs";
import { validateDirectDepthBiasProgram } from "./latest-direct-effect-depth-bias.mjs";
import {
  validateDirectQuadSpriteProgram,
  directQuadSpriteFrameHalf,
} from "./latest-direct-effect-sprite.mjs";
import {
  validateDirectParticlePaletteProgram,
  directDefaultParticlePalette,
} from "./latest-direct-particle-palette.mjs";
import {
  validateDirectPlacementRequirements,
  directComponentWorldInputOmissions,
} from "./latest-direct-effect-world-inputs.mjs";
// Browser/worker runtime. No native executor, process snapshots, camera history,
// asset IO or champion-specific branches belong in this module.
export const DIRECT_EFFECT_BUILD = "16.21.829.8620";
export const DIRECT_EFFECT_PROTOCOL = "20e09df23c66b85e";
export const DIRECT_EFFECT_PROGRAM_VERSION = 38;
const f = Math.fround;
const identityBasis = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const vector = (v, n) =>
  (Array.isArray(v) || ArrayBuffer.isView(v)) &&
  v.length === n &&
  Array.from(v).every((x) => Number.isFinite(f(x)));
const order = (a, b) =>
  a.time - b.time ||
  a.transportSequence - b.transportSequence ||
  a.entryOrder - b.entryOrder;
const copy = (value) => structuredClone(value);
const now = () => performance.now();
const effectReferenceFields = [
  "resourceContextEntityId",
  "lookup14EntityId",
  "attachmentEntityId",
  "lookupA8EntityId",
];

function validateLinkedRemoval(event, prior) {
  const input = event.removalInput;
  if (!input) return;
  const target = input.targetCreation;
  const expectedTarget = prior
    ? {
        sourceEventId: prior.id,
        generation: prior.generation,
        entityId: prior.entityId,
        time: prior.time,
        transportSequence: prior.transportSequence,
        entryOrder: prior.entryOrder,
        kind: prior.kind,
        creationSequence: prior.creationSequence,
        ...Object.fromEntries(
          ["stream", "chunkId", "blockOffset", "contextId"].map((k) => [
            k,
            prior.creationInput?.[k],
          ]),
        ),
        entityReferences: Object.fromEntries(
          effectReferenceFields.map((k) => [k, prior.descriptor?.[k]]),
        ),
      }
    : null;
  if (
    event.origin !== "network-effect" ||
    input.policy !== NETWORK_EFFECT_LIFECYCLE_POLICY ||
    !Number.isInteger(input.reasonByte) ||
    input.reasonByte < 0 ||
    input.reasonByte > 255 ||
    input.requestedFlagMask !==
      (input.reasonByte === 61 ? 0x800 : 0x10000000) ||
    event.requestedFlags !== input.requestedFlagMask ||
    input.nativeWorldLookupAcceptance !== null ||
    event.sourceEventId !== (prior?.id ?? null) ||
    event.generation !== (prior?.generation ?? null) ||
    input.targetStatus !==
      (prior
        ? "decoded-prior-creation-native-acceptance-unknown"
        : "no-decoded-prior-creation") ||
    (prior &&
      prior.creationInput?.policy !== NETWORK_EFFECT_LIFECYCLE_POLICY) ||
    (!prior && target !== null) ||
    (prior &&
      (!target ||
        Object.keys(expectedTarget).some((k) =>
          k === "entityReferences"
            ? effectReferenceFields.some(
                (field) => target[k]?.[field] !== expectedTarget[k][field],
              )
            : target[k] !== expectedTarget[k],
        )))
  )
    throw Error("Incompatible linked network removal input");
}

// Programs are admitted by the compiler, not by this simulation kernel. A
// supplied seed/cadence is reproducible but does not recover the match seed.
export class LatestDirectEffectRuntime {
  #rayCameraRequired = false;
  #checkpoints = [];
  #initial;
  #checkpointLedger = new WeakMap();
  #poseEvidenceSnapshot = createDirectPoseEvidenceSnapshots();

  constructor({
    build,
    protocol,
    contentHash,
    replayHash,
    definitions,
    events,
    world,
    kernels,
    checkpointSeconds = 2,
    maximumCheckpoints = 16,
  }) {
    if (
      build !== DIRECT_EFFECT_BUILD ||
      protocol !== DIRECT_EFFECT_PROTOCOL ||
      !/^[a-f0-9]{64}$/.test(contentHash) ||
      !/^[a-f0-9]{64}$/.test(replayHash) ||
      !(definitions instanceof Map) ||
      !Array.isArray(events) ||
      typeof world?.placement !== "function" ||
      (world.presentationContentHash != null &&
        (typeof world.presentationContentHash !== "string" ||
          !/^[a-f0-9]{64}$/.test(world.presentationContentHash))) ||
      typeof kernels?.birth?.createRandom !== "function" ||
      typeof kernels?.emission?.count !== "function" ||
      !Number.isFinite(checkpointSeconds) ||
      checkpointSeconds <= 0 ||
      !Number.isInteger(maximumCheckpoints) ||
      maximumCheckpoints < 1
    )
      throw Error("Invalid direct effect runtime contract");
    this.contract = {
      build,
      protocol,
      contentHash,
      replayHash,
      runtimeVersion: DIRECT_EFFECT_PROGRAM_VERSION,
      worldPresentationContentHash: world.presentationContentHash ?? null,
    };
    this.definitions = definitions;
    for (const [id, d] of definitions) {
      if (
        id !== d.id ||
        d.programVersion !== DIRECT_EFFECT_PROGRAM_VERSION ||
        d.build !== build ||
        d.protocol !== protocol ||
        d.contentHash !== contentHash ||
        !Array.isArray(d.emitters) ||
        !Array.isArray(d.unsupported) ||
        new Set(d.emitters.map((e) => e.index)).size !== d.emitters.length
      )
        throw Error("Incompatible compiled effect definition");
      validateDirectSystemAudio(d.systemAudio);
      if (
        d.childSiblingProgram != null &&
        (!isLatestDirectChildSiblingProgram(d.childSiblingProgram) ||
          d.childResourceAncestryRequired !== true ||
          d.systemIdentity?.objectPathHash !==
            d.childSiblingProgram.parentObjectPathHash ||
          d.blockers?.includes("system:child-resource-ancestry"))
      )
        throw Error("Owned compiled child sibling capability required");
      if (
        d.childResourceAncestryRequired === true &&
        !d.childSiblingProgram &&
        !d.blockers?.includes("system:child-resource-ancestry")
      )
        throw Error("Unresolved child ancestry cannot lose its blocker");
      for (const emitter of d.emitters) {
        if (
          emitter.depthBiasProgram != null ||
          Object.hasOwn(emitter.source ?? {}, "depthBiasFactors")
        )
          validateDirectDepthBiasProgram(
            emitter.depthBiasProgram,
            emitter.source,
            emitter.primitive,
          );
        if (
          d.childSiblingProgram &&
          !directChildFreeSiblingEligible(emitter.source, d.childSiblingProgram)
        )
          throw Error("Unadmitted child-bearing or primitive sibling program");
        validateDirectRayProgram(emitter);
        if (emitter.primitive === "ray") this.#rayCameraRequired = true;
        validateDirectStaticMeshProgram(emitter, {
          id: d.id,
          definitionHash: d.definitionHash,
          index: emitter.index,
        });
        if (d.schema === 1 || emitter.lifecycleProgram != null) {
          const singleResourceProgram = compileDirectEmptySingleResourceProgram(
            emitter.source,
            emitter.primitive,
          );
          const candidate = compileDirectEmitterLifecycle(
            emitter.source,
            emitter.primitive,
          );
          const expected = candidate?.requiresLinkControllerCount
            ? singleResourceProgram
              ? {
                  ...candidate,
                  lifetime: singleResourceProgram.effectiveLifetime,
                }
              : null
            : candidate;
          if (
            !Object.hasOwn(emitter, "lifecycleProgram") ||
            JSON.stringify(expected) !==
              JSON.stringify(emitter.lifecycleProgram) ||
            !Object.hasOwn(emitter, "singleResourceProgram") ||
            JSON.stringify(singleResourceProgram) !==
              JSON.stringify(emitter.singleResourceProgram) ||
            (d.schema === 1 &&
              emitter.lifetime !==
                f(
                  singleResourceProgram?.effectiveLifetime ??
                    emitter.source.lifetime,
                ))
          )
            throw Error("Incompatible compiled emitter lifecycle program");
        }
        validateDirectPlacementRequirements(emitter.placementRequirements);
        validateDirectDepthDisabledSoftProgram(emitter);
        validateDirectQuadSpriteProgram(emitter);
        validateDirectParticlePaletteProgram(emitter);
        validateDirectCameraMeshFlags(emitter);
        validateDirectCameraLocalOffsetProgram(emitter);
        validateDirectMultUv(emitter);
        validateDirectNavGroundProgram(emitter, {
          id: d.id,
          definitionHash: d.definitionHash,
          index: emitter.index,
        });
        validateDirectLegacyOffsetProgram(emitter);
        if (
          !validateDirectAbsentRotationController(
            emitter.absentRotationControllerProgram,
            emitter.source,
            emitter.primitive,
            emitter.integratedRotation,
          )
        )
          validateDirectIntegratedRotation(
            emitter.integratedRotation,
            emitter.source,
            emitter.primitive,
          );
      }
    }
    this.events = copy(events);
    // Creation inputs are retained by instances and never mutated. Omitted
    // request reasons also serve as a live ledger list; protect their complete
    // reachable graph, including any aliases from otherwise read-only events.
    // Stop/remove/removal-request paths only copy scalar input into live state.
    const mutableEventData = new WeakSet();
    for (const event of this.events)
      if (event.kind === "omitted")
        protectDirectDataGraph(event, mutableEventData);
    for (const event of this.events)
      if (event.kind === "create")
        freezeDirectOwnedData(event, mutableEventData);
    const ids = new Set();
    const networkCreations = new Map();
    const networkGenerations = new Map();
    for (const [i, e] of this.events.entries()) {
      if (
        typeof e.id !== "string" ||
        ids.has(e.id) ||
        !Number.isFinite(e.time) ||
        e.time < 0 ||
        !Number.isSafeInteger(e.transportSequence) ||
        e.transportSequence < 0 ||
        !Number.isSafeInteger(e.entryOrder) ||
        e.entryOrder < 0 ||
        !["create", "stop", "remove", "removal-request", "omitted"].includes(
          e.kind,
        ) ||
        (!["network-effect", "missile", "animation", "combat"].includes(
          e.origin,
        ) &&
          !(e.origin === "missile-behavior" && e.kind === "omitted")) ||
        (i > 0 && order(this.events[i - 1], e) > 0)
      )
        throw Error("Invalid, duplicate or unordered presentation event");
      if (e.kind === "create" && !definitions.has(e.definitionId))
        throw Error("Presentation event references an uncompiled definition");
      if (e.kind === "removal-request")
        validateLinkedRemoval(e, networkCreations.get(e.entityId));
      else if (
        e.origin === "network-effect" &&
        ["create", "omitted"].includes(e.kind)
      ) {
        const generation = (networkGenerations.get(e.entityId) ?? 0) + 1;
        networkGenerations.set(e.entityId, generation);
        if (
          e.creationInput &&
          (e.creationInput.policy !== NETWORK_EFFECT_LIFECYCLE_POLICY ||
            e.generation !== generation ||
            e.creationInput.nativeWorldLookupAcceptance !== null)
        )
          throw Error("Incompatible linked network creation input");
        networkCreations.set(e.entityId, e);
      }
      ids.add(e.id);
    }
    this.world = world;
    this.kernels = kernels;
    this.checkpointSeconds = checkpointSeconds;
    this.maximumCheckpoints = maximumCheckpoints;
    this.time = 0;
    this.tick = 0;
    this.cursor = 0;
    this.instances = new Map();
    this.generations = new Map();
    this.ledger = new Map();
    this.generated = new Map();
    this.generatedCount = 0;
    // Derived camera data survives redraw/seek independently of simulation.
    // It is intentionally absent from checkpoints and transfer buffers.
    this.cameraGeometry = null;
    this.counts = {
      resourceResolved: 0,
      placementResolved: 0,
      worldInputsResolved: 0,
      allCompiledComponentInputsResolved: 0,
      runtimeActivated: 0,
    };
    this.#initial = this.checkpoint();
    this.lastCheckpoint = 0;
    this.metrics = {
      simulationMs: 0,
      worldQueryMs: 0,
      worldQueries: 0,
      geometryMs: 0,
      simulationSteps: 0,
      transferredBytes: 0,
      cameraCacheBuilds: 0,
    };
  }

  #poseEvidence(placement) {
    const evidence = placement.poseEvidence;
    if (evidence == null) return null;
    if (
      typeof evidence !== "object" ||
      Array.isArray(evidence) ||
      this.contract.worldPresentationContentHash === null ||
      evidence.presentationContentHash !==
        this.contract.worldPresentationContentHash ||
      evidence.nativeAcceptance !== null ||
      evidence.nativePoseParity !== null
    )
      throw Error(
        "Pose evidence requires matching static presentation content and explicit partial status",
      );
    return this.#poseEvidenceSnapshot(evidence);
  }

  #placement(event, time, cursor) {
    const start = now();
    this.metrics.worldQueries++;
    try {
      return this.world.placement(event, time, cursor);
    } finally {
      this.metrics.worldQueryMs += now() - start;
    }
  }

  #apply(event) {
    if (event.kind === "omitted") {
      const identity = `${event.origin}:${event.entityId}`;
      const generation =
        event.origin === "network-effect"
          ? (this.generations.get(identity) ?? 0) + 1
          : null;
      if (generation !== null) {
        this.generations.set(identity, generation);
        this.instances.delete(identity);
      }
      this.ledger.set(event.id, {
        id: event.id,
        origin: event.origin,
        time: event.time,
        sourceKind: event.sourceKind ?? null,
        transportSequence: event.transportSequence,
        entryOrder: event.entryOrder,
        entityId: event.entityId,
        ownerId: event.ownerId ?? null,
        ownershipStatus:
          event.ownershipStatus ?? (event.ownerId ? "supplied" : "unresolved"),
        definitionId: event.definitionId ?? null,
        resourceEvidence: copy(event.resourceSelection?.presentation ?? null),
        generation,
        decoded: true,
        resourceResolved: false,
        placementResolved: false,
        worldInputsResolved: false,
        allCompiledComponentInputsResolved: false,
        compiledComponentCount: 0,
        eligibleComponentCount: 0,
        initialComponentWorldInputs: [],
        componentWorldInputs: [],
        runtimeActivated: false,
        componentsGenerated: [],
        reasons: event.reasons,
        entityReferences: event.descriptor
          ? Object.fromEntries(
              [
                "resourceContextEntityId",
                "lookup14EntityId",
                "attachmentEntityId",
                "lookupA8EntityId",
              ].map((field) => [field, event.descriptor[field]]),
            )
          : null,
      });
      return;
    }
    const identity = `${event.origin}:${event.entityId}`;
    if (event.kind !== "create") {
      const instance = this.instances.get(identity);
      if (event.kind === "removal-request") {
        const row = this.ledger.get(event.sourceEventId);
        const input = event.removalInput;
        const translated =
          instance &&
          instance.event.id === event.sourceEventId &&
          instance.generation === event.generation &&
          input?.policy === NETWORK_EFFECT_LIFECYCLE_POLICY &&
          input.targetCreation?.sourceEventId === event.sourceEventId &&
          input.targetCreation?.generation === instance.generation &&
          input.requestedFlagMask === event.requestedFlags &&
          input.nativeWorldLookupAcceptance === null &&
          instance.emitters.some((e) => e.lifecycle !== null);
        if (row) {
          this.#checkpointLedger.delete(row);
          (row.removalRequests ??= []).push(event.id);
          row.requestedFlags =
            ((row.requestedFlags ?? 0) | (event.requestedFlags ?? 0)) >>> 0;
          const reason = translated
            ? "lifecycle:partial-emitter-removal-native-world-acceptance-unknown"
            : `lifecycle:untranslated-removal-flags:${event.requestedFlags}`;
          if (!row.reasons.includes(reason)) row.reasons.push(reason);
        }
        if (translated) {
          const transition = directRemovalFlagTransition({
            reasonByte: input.reasonByte,
            objectFlags: instance.lifecycleObjectFlags,
            parentFlags: instance.lifecycleParentFlags,
            effectPresent: instance.lifecycleEffectPresent,
          });
          instance.lifecycleObjectFlags = transition.objectFlags;
          instance.lifecycleParentFlags = transition.parentFlags;
          instance.lifecycleEffectPresent =
            instance.lifecycleEffectPresent && !transition.entityEffectCleared;
          (row.translatedRemovalRequests ??= []).push({
            id: event.id,
            policy: "linked-presentation-emitter-stop-and-tail-v1",
            parentFlags: transition.parentFlags,
            mode: transition.mode,
            emitterIndices: instance.emitters
              .filter((e) => e.lifecycle !== null)
              .map((e) => e.index),
            nativeWorldLookupAcceptance: null,
            nativeParentCompletion: null,
            omissions: [
              "native-world-lookup-and-particle-entity-type-acceptance",
              "post-route-encoded-entity-state-and-world-callback",
              "ongoing-native-wrapper-provider-flag-writes",
              "original-sibling-completion-and-parent-draw-selection",
            ],
          });
        }
        // A request for an older/omitted generation cannot alter a newer one.
        if (instance && instance.event.id === event.sourceEventId)
          instance.requestedFlags =
            ((instance.requestedFlags ?? 0) | (event.requestedFlags ?? 0)) >>>
            0;
        return;
      }
      if (instance) {
        instance.stopTime = f(event.time);
        instance.requestedFlags =
          ((instance.requestedFlags ?? 0) | (event.requestedFlags ?? 0)) >>> 0;
        // Retirement is explicit. A stop suspends birth while retaining tails.
        if (event.kind === "remove" && event.retireImmediately === true) {
          instance.retired = true;
          for (const emitter of instance.emitters) emitter.count = 0;
        }
      }
      return;
    }
    const generation = (this.generations.get(identity) ?? 0) + 1;
    this.generations.set(identity, generation);
    const definition = this.definitions.get(event.definitionId);
    const creationCursor = {
      transportSequence: event.transportSequence,
      entryOrder: event.entryOrder,
    };
    const placement = this.#placement(event, event.time, creationCursor);
    const childInputs = directChildSiblingResourceInputs(
      definition.childSiblingProgram,
      event,
      definition.id,
    );
    const lastResolvedPoseEvidence = this.#poseEvidence(placement);
    const placementEvidence = Object.fromEntries(
      [
        "policy",
        "basisStatus",
        "nativeParentFlags",
        "secondaryPosition",
        "rootInput",
        "boundObjectSize",
        "boundObjectSizeStatus",
        "boundObjectSizeEvidence",
        "poseEvidence",
      ]
        .filter((key) => placement[key] !== undefined)
        .map((key) => [key, copy(placement[key])]),
    );
    const componentWorldInputs = definition.emitters.map((program) => {
      const reasons = placement.resolved
        ? directComponentWorldInputOmissions(program, placement)
        : ["world:instance-placement-unresolved"];
      reasons.push(...childInputs.reasons);
      return {
        index: program.index,
        requirements: copy(program.placementRequirements),
        resolved: reasons.length === 0,
        reasons,
      };
    });
    const admitted = definition.emitters.filter(
      (program) =>
        componentWorldInputs.find((c) => c.index === program.index).resolved,
    );
    const row = {
      id: event.id,
      origin: event.origin,
      time: event.time,
      generation,
      transportSequence: event.transportSequence,
      entryOrder: event.entryOrder,
      entityId: event.entityId,
      ownerId: event.ownerId ?? null,
      ownershipStatus:
        event.ownershipStatus ?? (event.ownerId ? "supplied" : "unresolved"),
      definitionId: definition.id,
      resourceEvidence: copy(event.resourceSelection?.presentation ?? null),
      ...(definition.childSiblingProgram
        ? {
            childPresentation: {
              policy: definition.childSiblingProgram.policy,
              packageSha256: definition.childSiblingProgram.packageSha256,
              resourceInputsResolved: childInputs.resolved,
              resourceEvidence: copy(childInputs.evidence),
              declarations: definition.childSiblingProgram.children.map(
                (child) => ({
                  ...copy(child),
                  declarationId: `child-declaration:${event.id}:${generation}:${child.emitterIndex}`,
                  parentSourceEventId: event.id,
                  parentGeneration: generation,
                  requestClock: null,
                  nativeActivation: null,
                }),
              ),
              omissions: copy(definition.childSiblingProgram.omissions),
            },
          }
        : {}),
      decoded: true,
      resourceResolved: true,
      // These stages describe creation-time eligibility. Current input-loss
      // evidence remains separate in componentWorldInputs below.
      placementResolved: placement.resolved,
      worldInputsResolved: placement.resolved && admitted.length > 0,
      allCompiledComponentInputsResolved:
        placement.resolved &&
        definition.emitters.length > 0 &&
        admitted.length === definition.emitters.length,
      compiledComponentCount: definition.emitters.length,
      eligibleComponentCount: admitted.length,
      lifecycleComponents: admitted
        .filter((e) => e.lifecycleProgram != null)
        .map((e) => e.index),
      runtimeActivated: false,
      componentsGenerated: [],
      initialComponentWorldInputs: copy(componentWorldInputs),
      componentWorldInputs,
      placementEvidence,
      lastResolvedPoseEvidence: copy(lastResolvedPoseEvidence),
      systemFlags: copy(definition.systemFlags ?? null),
      systemAudio: copy(definition.systemAudio),
      systemOmissions: copy(definition.systemOmissions ?? []),
      componentOmissions: definition.emitters.flatMap((e) => {
        const reasons = [
          ...(e.omissions ?? []),
          ...componentWorldInputs.find((c) => c.index === e.index).reasons,
        ];
        return reasons.length
          ? [{ index: e.index, reasons: copy(reasons) }]
          : [];
      }),
      reasons: [
        ...(placement.reasons ?? []),
        ...(definition.blockers ?? []),
        ...childInputs.reasons,
        ...(definition.systemOmissions ?? []),
        ...definition.emitters.flatMap((e) =>
          (e.omissions ?? []).map((r) => `emitter:${e.index}:${r}`),
        ),
        ...componentWorldInputs.flatMap((c) =>
          c.reasons.map((reason) => `emitter:${c.index}:${reason}`),
        ),
        ...definition.unsupported.map(
          (e) => `emitter:${e.index}:${e.reasons.join(",")}`,
        ),
      ],
      entityReferences: event.descriptor
        ? Object.fromEntries(
            [
              "resourceContextEntityId",
              "lookup14EntityId",
              "attachmentEntityId",
              "lookupA8EntityId",
            ].map((field) => [field, event.descriptor[field]]),
          )
        : null,
    };
    this.ledger.set(event.id, row);
    this.counts.resourceResolved++;
    if (row.placementResolved) this.counts.placementResolved++;
    if (row.worldInputsResolved) this.counts.worldInputsResolved++;
    if (row.allCompiledComponentInputsResolved)
      this.counts.allCompiledComponentInputsResolved++;
    if (this.generated.has(event.id)) this.generatedCount++;
    // Reuse creates a generation even if the new generation cannot activate.
    // The old entity must never remain visible in place of an unresolved one.
    this.instances.delete(identity);
    if (!placement.resolved || !admitted.length || definition.blockers?.length)
      return;
    if (!vector(placement.position, 3))
      throw Error("Resolved effect has no finite placement");
    const instance = {
      identity,
      event,
      generation,
      definitionId: definition.id,
      createdAt: f(event.time),
      stopTime: null,
      retired: false,
      requestedFlags: 0,
      // Activated original factory controls start with this runtime flag word.
      // Authored definition flags and placement flags are separate inputs.
      lifecycleParentFlags: 0x8000,
      lifecycleObjectFlags: 0,
      lifecycleEffectPresent: true,
      resourceEvidence: copy(event.resourceSelection?.presentation ?? null),
      placementEvidence,
      lastResolvedPoseEvidence,
      systemFlags: copy(definition.systemFlags ?? null),
      systemAudio: copy(definition.systemAudio),
      systemOmissions: copy(definition.systemOmissions ?? []),
      position: Float32Array.from(placement.position),
      basis: Float32Array.from(placement.basis ?? identityBasis),
      emitters: admitted.map((program) => ({
        index: program.index,
        createdAt: f(event.time),
        count: 0,
        capacity: 0,
        data: new Float32Array(0),
        birthBases: new Float32Array(0),
        motion: new Float32Array(0),
        birthOrigins: new Float32Array(0),
        ...(program.primitive === "camera-trail"
          ? {
              trailData: new Float32Array(0),
              trailDistance: 0,
              lastTrailPosition: null,
            }
          : {}),
        random: this.kernels.birth.createRandom(
          BigInt(event.seedHex ? `0x${event.seedHex}` : "0"),
        ),
        hasEmitted: false,
        lifecycle: program.lifecycleProgram
          ? createDirectEmitterLifecycleState(
              program.lifecycleProgram,
              program.singleResourceProgram?.linkControllerCount ?? null,
            )
          : null,
        lastEmissionTime: 0,
        previousPosition: Float32Array.from(placement.position),
        previousUpdateTime: f(event.time),
        blocked: false,
        worldInputLost: false,
      })),
    };
    this.instances.set(identity, instance);
    row.runtimeActivated = true;
    this.counts.runtimeActivated++;
    this.#updateInstance(instance, event.time, creationCursor);
  }

  #reserve(emitter, needed) {
    if (needed <= emitter.capacity) return;
    // Limits fail visibly. Pool pressure never silently drops a particle.
    if (needed > 16383)
      throw Error("Direct particle pool exceeds uint16 geometry capacity");
    const capacity = Math.min(
      16383,
      Math.max(needed, emitter.capacity * 2, 16),
    );
    const data = new Float32Array(capacity * 20);
    data.set(emitter.data.subarray(0, emitter.count * 20));
    const birthBases = new Float32Array(capacity * 9);
    birthBases.set(emitter.birthBases.subarray(0, emitter.count * 9));
    const motion = new Float32Array(capacity * 6);
    motion.set(emitter.motion.subarray(0, emitter.count * 6));
    const birthOrigins = new Float32Array(capacity * 3);
    birthOrigins.set(emitter.birthOrigins.subarray(0, emitter.count * 3));
    emitter.capacity = capacity;
    emitter.data = data;
    emitter.birthBases = birthBases;
    emitter.motion = motion;
    emitter.birthOrigins = birthOrigins;
    if (emitter.trailData) {
      const trailData = new Float32Array(capacity * 6);
      trailData.set(emitter.trailData.subarray(0, emitter.count * 6));
      emitter.trailData = trailData;
    }
  }

  #loseComponentInputs(emitter, row, inputReasons) {
    if (emitter.worldInputLost) return;
    // A later valid input cannot reconstruct births skipped while a producer
    // was unresolved. Only restoration and replay can recover that history.
    emitter.worldInputLost = true;
    emitter.blocked = true;
    const reasons = [
      ...inputReasons,
      "world:component-input-loss-requires-replay",
    ];
    const evidence = row.componentWorldInputs.find(
      (c) => c.index === emitter.index,
    );
    evidence.resolved = false;
    evidence.reasons = reasons;
    let omission = row.componentOmissions.find(
      (c) => c.index === emitter.index,
    );
    if (!omission)
      row.componentOmissions.push(
        (omission = { index: emitter.index, reasons: [] }),
      );
    for (const reason of reasons) {
      if (!omission.reasons.includes(reason)) omission.reasons.push(reason);
      const attributed = `emitter:${emitter.index}:${reason}`;
      if (!row.reasons.includes(attributed)) row.reasons.push(attributed);
    }
  }

  #updateInstance(instance, time, cursor) {
    if (instance.retired) return;
    this.#checkpointLedger.delete(this.ledger.get(instance.event.id));
    const definition = this.definitions.get(instance.definitionId);
    const placement = this.#placement(instance.event, time, cursor);
    const row = this.ledger.get(instance.event.id);
    if (!placement.resolved) {
      for (const emitter of instance.emitters)
        this.#loseComponentInputs(emitter, row, [
          "world:instance-placement-lost",
          ...(placement.reasons ?? []),
        ]);
      for (const reason of placement.reasons ?? [])
        if (!row.reasons.includes(reason)) row.reasons.push(reason);
      // This is presentation retirement after losing required inputs, not an
      // inferred native removal. A checkpoint before the loss can still replay.
      instance.retired = true;
      row.reasons.push("lifecycle:presentation-retired-after-world-input-loss");
      return;
    }
    if (!vector(placement.position, 3))
      throw Error("Resolved effect has no finite placement");
    instance.position.set(placement.position);
    instance.lastResolvedPoseEvidence = this.#poseEvidence(placement);
    // This is one owned snapshot, replaced rather than mutated. Coverage and
    // checkpoints clone it at their public boundaries.
    row.lastResolvedPoseEvidence = instance.lastResolvedPoseEvidence;
    if (placement.basis != null) {
      if (!vector(placement.basis, 9))
        throw Error("Resolved effect has no finite column-major system basis");
      instance.basis.set(placement.basis);
    }
    let allFinished = true;
    for (const emitter of instance.emitters) {
      const program = definition.emitters.find(
        (e) => e.index === emitter.index,
      );
      const inputReasons = directComponentWorldInputOmissions(
        program,
        placement,
      );
      if (inputReasons.length)
        this.#loseComponentInputs(emitter, row, inputReasons);
      emitter.blocked = emitter.worldInputLost;
      if (emitter.blocked) continue;
      if (
        program.placementRequirements.boundObjectSize === "finite-nonnegative"
      )
        emitter.boundScale = directBoundFlexScale(
          program.source.FlexShapeDefinition,
          placement.boundObjectSize,
        );
      const elapsed = f(f(time) - instance.createdAt);
      const lifecycleDecision = emitter.lifecycle
        ? beginDirectEmitterLifecycle(
            program.lifecycleProgram,
            emitter.lifecycle,
            {
              time: elapsed,
              parentFlags: instance.lifecycleParentFlags,
            },
          )
        : null;
      if (lifecycleDecision?.skip) {
        // Event splitting can visit an identical actor clock more than once.
        // Native controllers do not prune, emit or advance at a repeated time.
        allFinished = false;
        continue;
      }
      // The native quad pool visits deaths forwards and revisits a removed slot
      // after filling it with the last particle. Equality is still alive.
      // Ordered primitives need their own removal policy when admitted.
      for (let i = 0; i < emitter.count;) {
        const at = i * 20;
        if (f(f(time) - emitter.data[at]) <= emitter.data[at + 1]) {
          if (program.velocity) {
            const duration = f(
              f(time) -
                f(Math.max(emitter.previousUpdateTime, emitter.data[at])),
            );
            const motion = i * 6;
            for (let lane = 0; lane < 3; lane++)
              emitter.motion[motion + lane] = f(
                emitter.motion[motion + lane] +
                  f(emitter.motion[motion + 3 + lane] * duration),
              );
          }
          i++;
          continue;
        }
        if (program.primitive === "camera-trail") {
          // Original CameraTrail vtable+128 returns true: pool175d030 erases
          // every stream stably. A last-slot swap changes the ribbon topology.
          emitter.count--;
          for (const [key, stride] of [
            ["data", 20],
            ["birthBases", 9],
            ["motion", 6],
            ["birthOrigins", 3],
            ["trailData", 6],
          ])
            emitter[key].copyWithin(
              i * stride,
              (i + 1) * stride,
              (emitter.count + 1) * stride,
            );
          continue;
        }
        const last = --emitter.count * 20;
        if (last !== at) {
          emitter.data.copyWithin(at, last, last + 20);
          emitter.birthBases.copyWithin(
            i * 9,
            emitter.count * 9,
            (emitter.count + 1) * 9,
          );
          emitter.motion.copyWithin(
            i * 6,
            emitter.count * 6,
            (emitter.count + 1) * 6,
          );
          emitter.birthOrigins.copyWithin(
            i * 3,
            emitter.count * 3,
            (emitter.count + 1) * 3,
          );
        }
      }
      const local = f(elapsed - f(program.delay));
      const stopped = instance.stopTime !== null && time >= instance.stopTime;
      const emitting =
        !stopped &&
        (lifecycleDecision?.emit ?? true) &&
        local >= 0 &&
        elapsed < program.lifetime &&
        !(program.single && emitter.hasEmitted);
      let emitted = false;
      if (emitting) {
        const result = this.kernels.emission.count(program.source, {
          // Delay gates birth and offsets normalized authoring age. The
          // original emission accumulator still receives the elapsed clock.
          time: elapsed,
          normalizedAge: f(local / program.lifetime),
          lastEmissionTime: emitter.lastEmissionTime,
          hasEmitted: emitter.hasEmitted,
          qualityScale: 1,
        });
        if (result.count > 1000)
          throw Error(
            "Direct runtime requires an admitted emission capacity policy",
          );
        if (result.count) {
          if (program.velocity && result.count > 1)
            throw Error(
              "Direct velocity requires verified single-particle birth timing",
            );
          this.#reserve(emitter, emitter.count + result.count);
          const origins = this.kernels.emission.birthOrigins(
            Array.from(emitter.previousPosition),
            Array.from(instance.position),
            result.count,
          );
          const step = f(f(time) - emitter.previousUpdateTime);
          for (const [index, origin] of origins.entries()) {
            const share = f(f(index + 1) / f(result.count));
            const birthTime = f(emitter.previousUpdateTime + f(step * share));
            this.#birth(
              emitter,
              program,
              birthTime,
              local,
              origin,
              instance.position,
              instance.basis,
            );
          }
          this.kernels.emission.commitBirth(emitter, elapsed);
          emitted = true;
        }
      }
      if (lifecycleDecision) {
        if (lifecycleDecision.resetLoopState)
          throw Error("Unadmitted periodic emitter lifecycle state reset");
        finishDirectEmitterLifecycle(
          program.lifecycleProgram,
          emitter.lifecycle,
          {
            time: elapsed,
            parentFlags: instance.lifecycleParentFlags,
            decision: lifecycleDecision,
            emitted,
            data: emitter.data,
            count: emitter.count,
            stride: 20,
            birthClockLane: 19,
          },
        );
      }
      emitter.previousPosition.set(instance.position);
      emitter.previousUpdateTime = f(time);
      if (
        emitter.count ||
        (emitting && !(program.single && emitter.hasEmitted)) ||
        (!stopped && !lifecycleDecision?.stopRequested && local < 0)
      )
        allFinished = false;
      if (
        !stopped &&
        !lifecycleDecision?.stopRequested &&
        elapsed < program.lifetime &&
        !program.single
      )
        allFinished = false;
    }
    if (allFinished) {
      instance.retired = true;
      // Every current fixture definition has omitted original siblings. Empty
      // compiled presentation storage does not establish native parent completion.
      row.presentationRetirement =
        "compiled-components-finished-native-siblings-unresolved";
    }
  }

  #birth(emitter, program, time, local, origin, anchor, systemBasis) {
    const { birth } = this.kernels;
    const { life, color, scale, rotation, velocity, chance } =
      sampleDirectEffectBirth(
        birth,
        program.source,
        f(local / program.lifetime),
        emitter.random,
      );
    if (!(life > 0)) throw Error("Admitted particle has invalid lifetime");
    const offset = program.legacyOffsetProgram
      ? sampleDirectLegacyOffset(
          program.legacyOffsetProgram,
          f(local / program.lifetime),
          this.kernels.values,
        )
      : program.offset;
    const at = emitter.count++ * 20;
    if (program.primitive === "camera-trail" && emitter.count > 1024)
      throw Error("Direct CameraTrail exceeds native point capacity");
    const basis =
      program.inheritSystemBasis === false ? identityBasis : systemBasis;
    emitter.birthBases.set(basis, (emitter.count - 1) * 9);
    const localPosition = offset.map((value, lane) =>
      f(value + (program.emitterPosition?.[lane] ?? 0)),
    );
    const position = directParticleWorldVector(localPosition, basis);
    emitter.motion.set(
      [...localPosition, ...velocity],
      (emitter.count - 1) * 6,
    );
    emitter.birthOrigins.set(
      origin.map((value, lane) =>
        program.bound ? f(value - anchor[lane]) : f(value),
      ),
      (emitter.count - 1) * 3,
    );
    emitter.data.set(
      [
        time,
        life,
        ...origin.map((v, i) => f(v + position[i])),
        ...color,
        ...scale,
        ...rotation,
        // Bound newborns retain their interpolated offset from the current
        // emitter anchor. Collapsing it to zero moves an entire burst to its
        // last birth position and loses the original root-motion spacing.
        ...anchor,
        chance,
        program.lifecycleProgram ? f(f(time) - emitter.createdAt) : 0,
      ],
      at,
    );
    if (program.primitive === "camera-trail") {
      const normalizedAge = f(local / program.lifetime);
      const uv = birth.sampleValue(
        program.source.birthUVOffset,
        normalizedAge,
        [0, 0],
        emitter.random,
        chance,
      );
      const tiling = birth.sampleValue(
        program.trail.mBirthTilingSize,
        normalizedAge,
        [0, 0, 0],
        emitter.random,
        chance,
      );
      if (emitter.lastTrailPosition) {
        const d = origin.map((value, lane) =>
          f(value - emitter.lastTrailPosition[lane]),
        );
        const distance = f(
          Math.sqrt(f(f(d[2] * d[2]) + f(f(d[0] * d[0]) + f(d[1] * d[1])))),
        );
        emitter.trailDistance = f(emitter.trailDistance + distance);
      }
      emitter.lastTrailPosition = Float32Array.from(origin);
      const frames = program.source.numFrames ?? 1;
      const frame = program.source.isRandomStartFrame
        ? f(f(chance * frames) % frames)
        : 0;
      emitter.trailData.set(
        [...uv, tiling[0], tiling[1], emitter.trailDistance, frame],
        (emitter.count - 1) * 6,
      );
    }
  }

  #step(time, cursor = null) {
    for (const [identity, instance] of this.instances) {
      this.#updateInstance(instance, time, cursor);
      if (instance.retired) this.instances.delete(identity);
    }
    this.metrics.simulationSteps++;
  }

  #checkWorldPresentation() {
    if (
      (this.world.presentationContentHash ?? null) !==
      this.contract.worldPresentationContentHash
    )
      throw Error(
        "World presentation content changed after runtime initialization",
      );
  }

  advanceTo(time) {
    this.#checkWorldPresentation();
    if (!Number.isFinite(time) || time < 0)
      throw Error("Invalid direct replay time");
    const start = now();
    // Placement/resource/pose queries are included in simulationMs. Report
    // their own subset so attachment work cannot hide inside particle cost.
    this.metrics.worldQueryMs = 0;
    this.metrics.worldQueries = 0;
    if (time < this.time) {
      const saved =
        this.#checkpoints.findLast((s) => s.time <= time) ?? this.#initial;
      this.restore(saved);
    }
    // Use an integer tick index. Display rate/speed and fractional displays never
    // alter the canonical schedule or RNG consumption. Events split a tick and
    // retain transport order, including multiple entries at identical times.
    while (true) {
      const event = this.events[this.cursor];
      const nextTick = (this.tick + 1) / 60;
      const nextTime = Math.min(nextTick, event?.time ?? Infinity);
      if (nextTime > time) break;
      if (event && event.time <= nextTick) {
        this.#step(event.time, {
          transportSequence: event.transportSequence,
          entryOrder: event.entryOrder,
          exclusive: true,
        });
        this.#apply(event);
        this.cursor++;
      } else {
        this.#step(nextTick);
        this.tick++;
      }
      this.time = nextTime;
      if (this.time - this.lastCheckpoint >= this.checkpointSeconds) {
        this.lastCheckpoint = this.time;
        this.#checkpoints.push(this.#automaticCheckpoint());
        if (this.#checkpoints.length > this.maximumCheckpoints)
          this.#checkpoints.shift();
      }
    }
    this.time = time;
    this.metrics.simulationMs = now() - start;
    return this.coverage();
  }

  generateDraws(camera) {
    this.#checkWorldPresentation();
    if (!["right", "up"].every((k) => vector(camera[k], 3)))
      throw Error("Finite direct draw camera required");
    if (this.#rayCameraRequired && !vector(camera.position, 3))
      throw Error("Finite explicit camera position required for Ray geometry");
    const start = now(),
      draws = [];
    let cameraCache = null;
    this.metrics.cameraCacheBuilds = 0;
    for (const instance of this.instances.values()) {
      if (instance.retired) continue;
      const definition = this.definitions.get(instance.definitionId);
      for (const emitter of instance.emitters) {
        if (!emitter.count || emitter.blocked) continue;
        const program = definition.emitters.find(
          (e) => e.index === emitter.index,
        );
        if (program.primitive === "camera-trail") {
          const draw = this.#trailDraw(
            instance,
            emitter,
            program,
            definition,
            camera,
          );
          if (draw) draws.push(draw);
          continue;
        }
        if (program.primitive === "static-mesh") {
          const draw = this.#staticMeshDraw(
            instance,
            emitter,
            program,
            definition,
          );
          if (draw) draws.push(draw);
          continue;
        }
        if (program.primitive === "ray") {
          const draw = this.#rayDraw(
            instance,
            emitter,
            program,
            definition,
            camera,
          );
          if (draw) draws.push(draw);
          continue;
        }
        // Camera redraws can fall between simulation ticks. The retained pool
        // can still contain expired particles, but transferring a subarray
        // would transfer their unused backing storage too. Count the drawable
        // particles without changing simulation or allocating a scratch pool.
        let drawableCount = 0;
        for (let i = 0; i < emitter.count; i++) {
          const age = f(f(this.time) - emitter.data[i * 20]);
          if (age >= 0 && age <= emitter.data[i * 20 + 1]) drawableCount++;
        }
        if (!drawableCount) continue;
        const positions = new Float32Array(drawableCount * 12);
        const colors = new Float32Array(drawableCount * 16);
        const uv = new Float32Array(drawableCount * 8);
        // The original quad writer supplies one frame and two palette lookup
        // halves per particle, repeated at all four corners by the renderer.
        // These are derived draw data, never additional RNG or checkpoint state.
        const particleUV = new Uint16Array(drawableCount * 3);
        // Constant transforms share eight halves. Authored scale curves use
        // each particle's normalized age and retain distinct corner streams.
        const dynamicMultUV =
          program.multUvProgram &&
          program.multUvProgram.policy !== DIRECT_CONSTANT_MULT_UV_POLICY;
        const multUV = program.multUvProgram
          ? dynamicMultUV
            ? new Uint16Array(drawableCount * 8)
            : directConstantMultUvCorners(program.multUvProgram)
          : null;
        const indices = new Uint16Array(drawableCount * 6);
        let particles = 0;
        for (let i = emitter.count - 1; i >= 0; i--) {
          const at = i * 20,
            data = emitter.data;
          const age = f(f(this.time) - data[at]);
          if (age < 0 || age > data[at + 1]) continue;
          const fraction = f(age / data[at + 1]);
          const scale = this.kernels.values.sample(
            program.source.scale0,
            fraction,
            [1, 1, 1],
          );
          const color = this.kernels.values.sample(
            program.source.Color,
            fraction,
            [1, 1, 1, 1],
          );
          const vertexColor = color.map((value, lane) =>
            f(data[at + 5 + lane] * value),
          );
          // Original camera/arbitrary writers test blend & 0xfd. Admitted
          // mode0 premultiplies RGB by the final alpha, then stores alpha1
          // before byte packing. Mode2 shares that branch but is not admitted.
          if (program.blend === 0) {
            for (let lane = 0; lane < 3; lane++)
              vertexColor[lane] = f(vertexColor[lane] * vertexColor[3]);
            vertexColor[3] = 1;
          }
          const flexScale =
            program.placementRequirements.boundObjectSize ===
            "finite-nonnegative"
              ? emitter.boundScale
              : 1;
          const sx = f(f(data[at + 9] * scale[0]) * flexScale);
          const sy = program.uniformScale
            ? sx
            : f(f(data[at + 10] * scale[1]) * flexScale);
          const cameraQuad = program.primitive === "camera-quad";
          let rotation = directParticleRotation(
            [data[at + 12], data[at + 13], data[at + 14]],
            program.angularVelocity,
            age,
          );
          if (program.absentRotationControllerProgram)
            rotation = applyDirectAbsentRotationController(
              rotation,
              program.absentRotationControllerProgram,
              data[at + 1],
            );
          if (program.integratedRotation)
            rotation = directIntegratedParticleRotation(
              rotation,
              program.integratedRotation,
              age,
              data[at + 1],
            );
          const birthBasis = emitter.birthBases.subarray(i * 9, (i + 1) * 9);
          const basis = cameraQuad
            ? directCameraBasis(
                (cameraCache ??= this.#cameraCache(camera)),
                rotation[0],
              )
            : directParticleWorldBasis(
                directParticleBasis(rotation),
                birthBasis,
              );
          const localPosition = directParticleWorldVector(
            [
              emitter.motion[i * 6],
              emitter.motion[i * 6 + 1],
              emitter.motion[i * 6 + 2],
            ],
            program.cameraLocalOffsetProgram?.useCurrentRootBasis === true
              ? instance.basis
              : birthBasis,
          );
          const p = particles++;
          if (dynamicMultUV)
            multUV.set(
              sampleDirectMultUvCorners(
                program.multUvProgram,
                fraction,
                this.kernels.values,
              ),
              p * 8,
            );
          particleUV.set(directDefaultParticlePalette(fraction), p * 3 + 1);
          if (program.spriteProgram)
            particleUV[p * 3] = directQuadSpriteFrameHalf(
              program.spriteProgram,
              data[at + 18],
            );
          for (let lane = 0; lane < 3; lane++) {
            const root = program.bound ? instance.position[lane] : 0;
            const center = f(
              emitter.birthOrigins[i * 3 + lane] + localPosition[lane],
            );
            if (cameraQuad) {
              const up = f(basis[1][lane] * sy);
              const right = f(basis[0][lane] * sx);
              const position = f(root + center);
              for (let v = 0; v < 4; v++)
                positions[p * 12 + v * 3 + lane] =
                  v === 0
                    ? f(f(position + up) - right)
                    : v === 1
                      ? f(f(up + position) + right)
                      : v === 2
                        ? f(right + f(position - up))
                        : f(f(position - up) - right);
            } else {
              // Original 0x1730576–0x1730600 adds the center and right
              // first, then the signed up vector. Grouping the two axes
              // before the center loses an observed float32 rounding step.
              const position = f(root + center),
                right = f(basis[0][lane] * sx),
                down = f(basis[1][lane] * f(-sy));
              for (let v = 0; v < 4; v++)
                positions[p * 12 + v * 3 + lane] =
                  v === 0
                    ? f(f(position + right) + down)
                    : v === 1
                      ? f(f(position + right) - down)
                      : v === 2
                        ? f(f(position - right) - down)
                        : f(f(position - right) + down);
            }
          }
          for (let v = 0; v < 4; v++) {
            for (let lane = 0; lane < 4; lane++)
              colors[p * 16 + v * 4 + lane] = vertexColor[lane];
          }
          uv.set([0, 0, 1, 0, 1, 1, 0, 1], p * 8);
          const vertex = p * 4,
            index = p * 6;
          indices[index] = vertex;
          indices[index + 1] = vertex + 1;
          indices[index + 2] = vertex + 2;
          indices[index + 3] = vertex;
          indices[index + 4] = vertex + 2;
          indices[index + 5] = vertex + 3;
        }
        if (!particles) continue;
        if (!this.generated.has(instance.event.id)) {
          this.generated.set(instance.event.id, new Set());
          this.generatedCount++;
        }
        this.generated.get(instance.event.id).add(program.index);
        draws.push({
          sourceEventId: instance.event.id,
          generation: instance.generation,
          definitionId: definition.id,
          emitterId: program.index,
          ownerId: instance.event.ownerId ?? null,
          ownershipStatus:
            instance.event.ownershipStatus ??
            (instance.event.ownerId ? "supplied" : "unresolved"),
          materialKey: program.materialKey,
          particleCount: particles,
          positions: positions.subarray(0, particles * 12),
          colors: colors.subarray(0, particles * 16),
          uv: uv.subarray(0, particles * 8),
          particleUV: particleUV.subarray(0, particles * 3),
          ...(multUV ? { multUV } : {}),
          indices: indices.subarray(0, particles * 6),
        });
      }
    }
    this.metrics.geometryMs = now() - start;
    this.metrics.transferredBytes = directDrawTransfers({ draws }).reduce(
      (total, buffer) => total + buffer.byteLength,
      0,
    );
    return {
      time: this.time,
      draws,
      metrics: { ...this.metrics },
      coverage: this.coverage(),
    };
  }

  #cameraCache(camera) {
    const axes = [...camera.right, ...camera.up].map(f);
    if (
      !this.cameraGeometry ||
      axes.some((n, i) => n !== this.cameraGeometry.axes[i])
    ) {
      this.cameraGeometry = { axes, data: createDirectCameraCache(camera) };
      this.metrics.cameraCacheBuilds++;
    }
    return this.cameraGeometry.data;
  }

  #staticMeshDraw(instance, emitter, program, definition) {
    const records = [];
    for (let i = emitter.count - 1; i >= 0; i--) {
      const at = i * 20,
        data = emitter.data;
      const age = f(f(this.time) - data[at]);
      if (age < 0 || age > data[at + 1]) continue;
      const fraction = f(age / data[at + 1]);
      let rotation = directParticleRotation(
        Array.from(data.subarray(at + 12, at + 15)),
        program.angularVelocity,
        age,
      );
      if (program.integratedRotation)
        rotation = directIntegratedParticleRotation(
          rotation,
          program.integratedRotation,
          age,
          data[at + 1],
        );
      const mesh = program.meshProgram;
      const result = directStaticMeshRetainedDraw({
        birthBasis: emitter.birthBases.subarray(i * 9, (i + 1) * 9),
        birthOrigin: emitter.birthOrigins.subarray(i * 3, (i + 1) * 3),
        motion: emitter.motion.subarray(i * 6, i * 6 + 3),
        rootPosition: instance.position,
        bound: program.bound,
        rotation,
        birthScale: data.subarray(at + 9, at + 12),
        sampledScale: this.kernels.values.sample(
          program.source.scale0,
          fraction,
          [1, 1, 1],
        ),
        birthColor: data.subarray(at + 5, at + 9),
        sampledColor: this.kernels.values.sample(
          program.source.Color,
          fraction,
          [1, 1, 1, 1],
        ),
        fraction,
        uniformScale: program.uniformScale,
        // The compiled root subset has no system-scale controller or color
        // modulation field. Original constructor defaults remain explicit.
        systemScale: [1, 1],
        definitionColor: [1, 1, 1, 1],
        resourceFields: mesh.resourceFields,
        textureDivisions: mesh.uv.textureDivisions,
        blendByte: program.blend,
        particleIndex: i,
        linkedUvMatrices: [mesh.uv.baseMatrix, mesh.uv.multMatrix],
      });
      records.push(result.record);
    }
    if (!records.length) return null;
    const meshRecords = new Uint8Array(records.length * 176);
    records.forEach((record, index) => meshRecords.set(record, index * 176));
    if (!this.generated.has(instance.event.id)) {
      this.generated.set(instance.event.id, new Set());
      this.generatedCount++;
    }
    this.generated.get(instance.event.id).add(program.index);
    return {
      primitive: "static-mesh",
      sourceEventId: instance.event.id,
      generation: instance.generation,
      definitionId: definition.id,
      emitterId: program.index,
      ownerId: instance.event.ownerId ?? null,
      ownershipStatus:
        instance.event.ownershipStatus ??
        (instance.event.ownerId ? "supplied" : "unresolved"),
      materialKey: program.materialKey,
      particleCount: records.length,
      meshRecords,
      // Static SCB vertices/indices belong to the definition's loaded resource;
      // only compact per-particle records cross the worker boundary each frame.
      indices: new Uint16Array(0),
    };
  }

  #rayDraw(instance, emitter, program, definition, camera) {
    const active = [];
    for (let i = 0; i < emitter.count; i++) {
      const age = f(f(this.time) - emitter.data[i * 20]);
      if (age >= 0 && age <= emitter.data[i * 20 + 1]) active.push(i);
    }
    if (!active.length) return null;
    const positions = new Float32Array(active.length * 3),
      axes = new Float32Array(active.length * 3),
      attributes = new Float32Array(active.length * 11);
    for (const [slot, i] of active.entries()) {
      const at = i * 20,
        data = emitter.data,
        age = f(f(this.time) - data[at]),
        fraction = f(age / data[at + 1]);
      const particle = directRayRetainedParticle({
        birthBasis: emitter.birthBases.subarray(i * 9, (i + 1) * 9),
        birthOrigin: emitter.birthOrigins.subarray(i * 3, (i + 1) * 3),
        motion: emitter.motion.subarray(i * 6, i * 6 + 3),
        rootPosition: instance.position,
        bound: program.bound,
        rotation: directParticleRotation(
          Array.from(data.subarray(at + 12, at + 15)),
          program.angularVelocity,
          age,
        ),
        birthScale: data.subarray(at + 9, at + 12),
        sampledScale: this.kernels.values.sample(
          program.source.scale0,
          fraction,
          [1, 1, 1],
        ),
        birthColor: data.subarray(at + 5, at + 9),
        sampledColor: this.kernels.values.sample(
          program.source.Color,
          fraction,
          [1, 1, 1, 1],
        ),
        fraction,
        chance: data[at + 18],
        rayProgram: program.rayProgram,
      });
      positions.set(particle.position, slot * 3);
      axes.set(particle.axis, slot * 3);
      attributes.set(particle.attributes, slot * 11);
    }
    const geometry = directRayGeometry({
      count: active.length,
      positions,
      axes,
      attributes,
      viewPosition: camera.position,
      systemScale: [1, 1],
      colorMultiplier: [1, 1, 1, 1],
      blendMode: program.blend,
      projectionScroll: 0,
      uvScale: [1, 1],
      emitterUv: [0, 0],
      baseUvPresent: false,
      multUvPresent: false,
      multTexturePresent: false,
    });
    if (!this.generated.has(instance.event.id)) {
      this.generated.set(instance.event.id, new Set());
      this.generatedCount++;
    }
    this.generated.get(instance.event.id).add(program.index);
    return {
      primitive: "ray",
      sourceEventId: instance.event.id,
      generation: instance.generation,
      definitionId: definition.id,
      emitterId: program.index,
      ownerId: instance.event.ownerId ?? null,
      ownershipStatus:
        instance.event.ownershipStatus ??
        (instance.event.ownerId ? "supplied" : "unresolved"),
      materialKey: program.materialKey,
      particleCount: active.length,
      vertexBytes: geometry.vertices,
      indices: geometry.indices,
    };
  }

  #trailDraw(instance, emitter, program, definition, camera) {
    if (!vector(camera.axis, 3))
      throw Error("Finite CameraTrail view axis required");
    const active = [];
    for (let i = 0; i < emitter.count; i++) {
      const age = f(f(this.time) - emitter.data[i * 20]);
      if (age >= 0 && age <= emitter.data[i * 20 + 1]) active.push(i);
    }
    if (!active.length) return null;
    const positions = new Float32Array(active.length * 3),
      attributes = new Float32Array(active.length * 11),
      tiling = new Float32Array(active.length * 2),
      odometer = new Float32Array(active.length),
      uvTransform = program.source.birthUVOffset
        ? new Float32Array(active.length * 6)
        : null;
    for (const [slot, i] of active.entries()) {
      const at = i * 20,
        age = f(f(this.time) - emitter.data[at]),
        fraction = f(age / emitter.data[at + 1]);
      const scale = this.kernels.values.sample(
          program.source.scale0,
          fraction,
          [1, 1, 1],
        ),
        color = this.kernels.values.sample(
          program.source.Color,
          fraction,
          [1, 1, 1, 1],
        );
      // Native particleIsLocalOrientation applies the current system basis to
      // every retained local spawn offset, including particles born earlier.
      // Unbound birth origins still retain their original world translation.
      const particleBasis = program.source.particleIsLocalOrientation
        ? instance.basis
        : emitter.birthBases.subarray(i * 9, (i + 1) * 9);
      const localPosition = directParticleWorldVector(
        Array.from(emitter.motion.subarray(i * 6, i * 6 + 3)),
        particleBasis,
      );
      for (let lane = 0; lane < 3; lane++)
        positions[slot * 3 + lane] = f(
          (program.bound ? instance.position[lane] : 0) +
            f(emitter.birthOrigins[i * 3 + lane] + localPosition[lane]),
        );
      attributes[slot * 11] = emitter.trailData[i * 6 + 5];
      for (let lane = 0; lane < 4; lane++)
        attributes[slot * 11 + lane + 1] = f(
          emitter.data[at + 5 + lane] * color[lane],
        );
      const sx = f(emitter.data[at + 9] * scale[0]);
      attributes.set(
        [
          sx,
          program.uniformScale ? sx : f(emitter.data[at + 10] * scale[1]),
          f(emitter.data[at + 11] * scale[2]),
          fraction,
          1,
          0,
        ],
        slot * 11 + 5,
      );
      tiling.set(emitter.trailData.subarray(i * 6 + 2, i * 6 + 4), slot * 2);
      odometer[slot] = emitter.trailData[i * 6 + 4];
      if (uvTransform)
        uvTransform.set(
          [1, 0, 0, 1, emitter.trailData[i * 6], emitter.trailData[i * 6 + 1]],
          slot * 6,
        );
    }
    const geometry = directTrailGeometry({
      count: active.length,
      positions,
      attributes,
      tiling,
      odometer,
      uvTransform,
      mode: program.trail.mMode,
      smoothingMode: program.trail.mSmoothingMode,
      smoothingQuality: 0,
      textureAddressMode: program.source.texAddressModeBase ?? 0,
      blendMode: program.blend,
      cutoff: program.trail.mCutoff,
      viewForward: camera.axis,
      systemScale: [1, 1],
      colorMultiplier: [1, 1, 1, 1],
      emitterUv: [0, 0],
    });
    if (!geometry.vertices.length) return null;
    if (!this.generated.has(instance.event.id)) {
      this.generated.set(instance.event.id, new Set());
      this.generatedCount++;
    }
    this.generated.get(instance.event.id).add(program.index);
    return {
      sourceEventId: instance.event.id,
      generation: instance.generation,
      definitionId: definition.id,
      emitterId: program.index,
      ownerId: instance.event.ownerId ?? null,
      ownershipStatus:
        instance.event.ownershipStatus ??
        (instance.event.ownerId ? "supplied" : "unresolved"),
      materialKey: program.materialKey,
      primitive: "camera-trail",
      particleCount: geometry.vertices.length / 56,
      vertexBytes: geometry.vertices,
      indices: geometry.indices,
    };
  }

  #checkpointData(ledger) {
    return {
      schema: 1,
      contract: this.contract,
      time: this.time,
      tick: this.tick,
      cursor: this.cursor,
      generations: [...this.generations],
      ledger,
      counts: this.counts,
      lastCheckpoint: this.lastCheckpoint ?? 0,
      instances: [...this.instances].map(([id, instance]) => [
        id,
        {
          ...instance,
          emitters: instance.emitters.map((e) => ({
            ...e,
            random: e.random.snapshot(),
          })),
        },
      ]),
    };
  }

  #automaticCheckpoint() {
    this.#checkWorldPresentation();
    // Most ledger rows describe historical requests and no longer change.
    // Copy live simulation/RNG state each time, but reuse detached ledger-row
    // snapshots until an active update or later removal request invalidates one.
    // Both the cache and checkpoint ring are private; no caller can mutate a
    // shared snapshot. Restore copies it before making it live again.
    const saved = copy(this.#checkpointData([]));
    saved.ledger = [...this.ledger].map(([id, row]) => {
      let snapshot = this.#checkpointLedger.get(row);
      if (!snapshot) {
        snapshot = copy(row);
        this.#checkpointLedger.set(row, snapshot);
      }
      return [id, snapshot];
    });
    return saved;
  }

  checkpoint() {
    this.#checkWorldPresentation();
    // The public boundary always returns an independent complete state.
    return copy(this.#checkpointData([...this.ledger]));
  }

  restore(saved) {
    this.#checkWorldPresentation();
    if (
      saved.schema !== 1 ||
      JSON.stringify(saved.contract) !== JSON.stringify(this.contract)
    )
      throw Error("Incompatible direct effect checkpoint");
    const state = copy(saved);
    const mutableLedgerData = protectDirectDataGraph(state.ledger);
    for (const [, instance] of state.instances)
      freezeDirectOwnedData(instance.event, mutableLedgerData);
    // Checkpoint compatibility also covers copied pose provenance. Validate
    // before changing any live clock, ledger or particle state.
    for (const [, row] of [...state.ledger, ...state.instances]) {
      this.#poseEvidence({ poseEvidence: row.placementEvidence?.poseEvidence });
      this.#poseEvidence({ poseEvidence: row.lastResolvedPoseEvidence });
    }
    this.time = state.time;
    this.tick = state.tick;
    this.cursor = state.cursor;
    this.lastCheckpoint = state.lastCheckpoint;
    this.generations = new Map(state.generations);
    this.ledger = new Map(state.ledger);
    this.#checkpointLedger = new WeakMap();
    this.counts = state.counts;
    this.generatedCount = [...this.ledger.keys()].filter((id) =>
      this.generated.has(id),
    ).length;
    this.instances = new Map(
      state.instances.map(([id, instance]) => [
        id,
        {
          ...instance,
          emitters: instance.emitters.map((e) => {
            const random = this.kernels.birth.createRandom(1n);
            random.restore(e.random);
            return { ...e, random };
          }),
        },
      ]),
    );
  }

  coverage({ includeRows = false } = {}) {
    const rows = includeRows
      ? [...this.ledger.values()].map((row) => ({
          ...copy(row),
          componentsGenerated: [...(this.generated.get(row.id) ?? [])],
        }))
      : null;
    return {
      time: this.time,
      decoded: this.ledger.size,
      ...this.counts,
      geometryGenerated: this.generatedCount,
      // A worker cannot know whether a visible pixel or draw submission occurred.
      componentsRendered: null,
      complete: null,
      stageScope:
        "creation-time eligibility; current dependency evidence is componentWorldInputs",
      geometryScope: "generated in this runtime session",
      ...(includeRows ? { rows } : {}),
    };
  }
}
export function directDrawTransfers(packet) {
  return [
    ...new Set(
      packet.draws.flatMap((d) => [
        ...(d.primitive === "static-mesh"
          ? [d.meshRecords.buffer]
          : ["camera-trail", "ray"].includes(d.primitive)
            ? [d.vertexBytes.buffer]
            : [
                d.positions.buffer,
                d.colors.buffer,
                d.uv.buffer,
                d.particleUV.buffer,
                ...(d.multUV === undefined ? [] : [d.multUV.buffer]),
              ]),
        d.indices.buffer,
      ]),
    ),
  ];
}
