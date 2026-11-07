import {
  createLatestViewerPoseSampler,
  VIEWER_POSE_POLICY,
} from "./latest-viewer-pose-sampler.mjs";
import { assertLatestDisplayFacing } from "./latest-display-facing.mjs";
import { createLatestResourceRequestTrack } from "./latest-resource-requests.mjs";
import { isLatestNegativeFormPrefix } from "./latest-negative-form-prefix.mjs";
const uint = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const immutable = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
};
export function compareLatestViewerPoseRecords(a, b) {
  for (const record of [a, b])
    if (
      !Number.isFinite(record.time) ||
      record.time < 0 ||
      !Number.isSafeInteger(record.transportSequence) ||
      record.transportSequence < 0 ||
      !Number.isSafeInteger(record.entryOrder) ||
      record.entryOrder < 0
    )
      throw Error("Exact pose causal records required");
  return (
    a.time - b.time ||
    a.transportSequence - b.transportSequence ||
    a.entryOrder - b.entryOrder
  );
}
const before = (event, time, cursor) =>
  event.time < time ||
  (event.time === time &&
    (cursor === null ||
      event.transportSequence < cursor.transportSequence ||
      (event.transportSequence === cursor.transportSequence &&
        (event.entryOrder < cursor.entryOrder ||
          (!cursor.exclusive && event.entryOrder === cursor.entryOrder)))));
const rootInput = (entity, time) => ({
  resolved: true,
  policy: "decoded-replay-clock-visible-actor-root-v1",
  entityId: entity.entityId,
  time,
  position: [...entity.position],
  positionStatus: entity.positionStatus,
  source: structuredClone(entity.positionSource),
  lifecycle: entity.lifecycle,
  nativeAcceptance: null,
  nativePlacementParity: null,
  omissions: [
    "world:native-hero-proxy-root-selection-unrecovered",
    "world:native-hero-root-override-state-unrecovered",
    "world:native-movement-collision-acceleration-and-height-unrecovered",
  ],
});
export function createLatestViewerPoseService({
  assets,
  report,
  negativeFormPrefix = null,
}) {
  if (
    negativeFormPrefix !== null &&
    !isLatestNegativeFormPrefix(negativeFormPrefix)
  )
    throw Error("Owned negative-form conditional-prefix policy required");
  if (
    assets?.policy !== VIEWER_POSE_POLICY ||
    typeof assets.contentHash !== "string"
  )
    throw Error("Validated static viewer pose assets required");
  const heroes = new Map(
      report.heroes.map((hero) => [hero.entityId, structuredClone(hero)]),
    ),
    requests = createLatestResourceRequestTrack(
      report.resourceRequests,
    ).records,
    cpu = new Map(),
    rendered = new Map(),
    firstAppearanceRequests = new Map(),
    preservingRequests = new Map();
  // The request track is causally sorted and owned. Only its first request
  // after this actor's creation can change this conservative policy's result.
  // Retain that request once instead of rescanning unrelated owners' history
  // for every particle substep; the absolute query cursor still controls it.
  for (const request of requests) {
    const hero = heroes.get(request.entityId);
    if (
      hero &&
      !firstAppearanceRequests.has(request.entityId) &&
      compareLatestViewerPoseRecords(request, {
        time: hero.provenance.time,
        transportSequence: hero.provenance.transportSequence,
        entryOrder: hero.provenance.entryOrder ?? 0,
      }) > 0
    ) {
      const preserved = negativeFormPrefix?.classify(hero, request) ?? null;
      if (preserved) {
        if (!preservingRequests.has(request.entityId))
          preservingRequests.set(request.entityId, []);
        preservingRequests.get(request.entityId).push(preserved);
      } else firstAppearanceRequests.set(request.entityId, request);
    }
  }
  let simulations = 0,
    cacheHits = 0;
  function source(entityId) {
    const actor = assets.actor(entityId);
    if (!actor) return null;
    const entry = assets.createEntry(entityId),
      sampler = createLatestViewerPoseSampler({
        THREE: assets.THREE,
        entry,
        entityId,
        bindings: actor.bindings,
      }),
      known = new Set([0]);
    for (const d of report.effectDescriptors) {
      if (d.attachmentEntityId === entityId) known.add(d.attachmentKey4c);
      if (d.lookup14EntityId === entityId) known.add(d.attachmentKey50);
    }
    const installed = new Set(
      actor.bindings.map((binding) => binding.resolvedBoneKey),
    );
    const keys = [...known].filter((key) => key === 0 || installed.has(key));
    return {
      actor,
      entry,
      sampler,
      keys,
      installed,
      lastRoot: null,
      lastFull: null,
    };
  }
  function reason(entity, time, cursor) {
    const hero = heroes.get(entity?.entityId);
    if (!entity || entity.entityClass !== "champion" || !hero)
      return "pose:registered-champion-required";
    if (
      entity.creationTransportSequence !== hero.provenance.transportSequence ||
      entity.character !== hero.champion ||
      entity.skinId !== hero.skinId
    )
      return "pose:actor-generation-or-static-appearance-differs";
    if (!entity.position) return "pose:viewer-root-unresolved";
    if (entity.lifecycle !== "alive" || entity.viewerLifecycle?.dead !== false)
      return "pose:provider-death-revive-lifecycle-unimplemented";
    const first = firstAppearanceRequests.get(entity.entityId),
      blocker = first && before(first, time, cursor) ? first : null;
    return blocker
      ? {
          reason: "pose:untranslated-appearance-or-form-request",
          blockingRequest: structuredClone(blocker),
        }
      : null;
  }
  function input(entity, time, cursor, keys) {
    return {
      time,
      cursor,
      root: rootInput(entity, time),
      viewerYawInput: {
        status: entity.viewerMotion?.orientationKnown
          ? entity.orientationStatus
          : "unknown",
        direction: entity.direction
          ? [entity.direction[0], entity.direction[2]]
          : null,
        source: structuredClone(entity.positionSource),
      },
      moving: entity.viewerMotion?.moving === true,
      life: structuredClone(entity.viewerLifecycle),
      attachmentKeys: keys,
    };
  }
  function evidence(value, sampled) {
    const preserved = (preservingRequests.get(sampled.entityId) ?? []).filter(
      (o) => before(o.request, sampled.time, sampled.cursor),
    );
    return {
      policy: VIEWER_POSE_POLICY,
      presentationContentHash: assets.contentHash,
      entityId: sampled.entityId,
      actorKey: value.actor.actorKey,
      time: sampled.time,
      cursor: structuredClone(sampled.cursor),
      staticHashes: structuredClone(value.actor.staticHashes),
      rootSource: structuredClone(sampled.rootInput.source),
      orientationSource: structuredClone(sampled.viewerYawInput.source),
      animationSources: sampled.layers
        .filter((layer) => layer.event)
        .map((layer) => ({
          sourceKind: layer.event.sourceKind,
          time: layer.event.time,
          sequence: layer.event.sequence,
          transportSequence:
            layer.event.transportSequence ??
            layer.event.sourceEvent?.transportSequence ??
            null,
          entryOrder:
            layer.event.entryOrder ??
            layer.event.sourceEvent?.entryOrder ??
            null,
          name: layer.event.name,
          file: layer.file,
        })),
      nativeAcceptance: null,
      nativePoseParity: null,
      prefixPreservingRequestObservations: preserved,
      omissions: [
        ...new Set([
          ...sampled.omissions,
          ...preserved.flatMap((o) => o.omissions),
        ]),
      ],
    };
  }
  // Static hierarchy/clip ownership is prepared during decode/worker startup,
  // never in response to a particular effect birth during ordinary Play.
  for (const hero of report.heroes)
    cpu.set(hero.entityId, source(hero.entityId));
  const api = {
    policy: VIEWER_POSE_POLICY,
    presentationContentHash: assets.contentHash,
    query(entity, keys, time, cursor = null) {
      return structuredClone(api.querySnapshot(entity, keys, time, cursor));
    },
    // Internal placement consumers share immutable owned values. Public world
    // queries use query() above, retaining independent mutable result ownership.
    querySnapshot(entity, keys, time, cursor = null) {
      if (
        !Number.isFinite(time) ||
        time < 0 ||
        !Array.isArray(keys) ||
        Array.from(keys).some((key) => !uint(key))
      )
        throw Error("Dense installed pose keys and absolute time required");
      if (
        cursor !== null &&
        (!Number.isSafeInteger(cursor.transportSequence) ||
          cursor.transportSequence < 0 ||
          !Number.isSafeInteger(cursor.entryOrder) ||
          cursor.entryOrder < 0 ||
          (cursor.exclusive !== undefined &&
            typeof cursor.exclusive !== "boolean"))
      )
        throw Error("Exact causal pose cursor required");
      const omitted = reason(entity, time, cursor);
      if (omitted)
        return immutable({
          resolved: false,
          policy: VIEWER_POSE_POLICY,
          reasons: [typeof omitted === "string" ? omitted : omitted.reason],
          ...(typeof omitted === "object"
            ? { blockingRequest: omitted.blockingRequest }
            : {}),
        });
      let value = cpu.get(entity.entityId);
      if (!value) {
        value = source(entity.entityId);
        if (!value)
          return immutable({
            resolved: false,
            policy: VIEWER_POSE_POLICY,
            reasons: ["pose:static-actor-unprepared"],
          });
        cpu.set(entity.entityId, value);
      }
      const missing = keys.filter((key) => key && !value.installed.has(key));
      if (missing.length)
        return immutable({
          resolved: false,
          policy: VIEWER_POSE_POLICY,
          reasons: missing.map((key) => `pose:installed-key-unresolved:${key}`),
        });
      for (const key of keys)
        if (!value.keys.includes(key)) {
          value.keys.push(key);
          value.lastFull = null;
        }
      const source = entity.positionSource;
      // These are all mutable inputs consumed by the alive sampler. Static
      // clips, rig, creation identity and appearance are separately guarded.
      // Avoid cloning/stringifying an entire lifecycle/source object on hits.
      const state = [
        time,
        cursor?.transportSequence ?? null,
        cursor?.entryOrder ?? null,
        cursor?.exclusive,
        ...entity.position,
        ...(entity.direction ?? [null, null, null]),
        entity.viewerMotion?.moving,
        entity.viewerMotion?.orientationKnown,
        entity.orientationStatus,
        entity.positionStatus,
        source?.kind,
        source?.time,
        source?.sequence,
        source?.transportSequence,
        source?.entryOrder,
        source?.sourceKind,
      ];
      const matches = (cached) =>
        cached &&
        cached.state.length === state.length &&
        state.every((part, index) => Object.is(part, cached.state[index]));
      const rootOnly = keys.length > 0 && keys.every((key) => key === 0),
        slot = rootOnly ? "lastRoot" : "lastFull";
      let cached =
        rootOnly && matches(value.lastFull) ? value.lastFull : value[slot];
      if (!matches(cached)) {
        simulations++;
        const supplied = input(
          entity,
          time,
          cursor,
          rootOnly ? [0] : value.keys,
        );
        cached = {
          state,
          result: value.sampler.sample({ ...supplied, rootOnly }),
          views: new Map(),
        };
        if (cached.result.resolved)
          cached.evidence = evidence(value, cached.result);
        value[slot] = cached;
      } else cacheHits++;
      const sampled = cached.result;
      if (!sampled.resolved) return immutable(sampled);
      const viewKey = keys.join(",");
      if (cached.views.has(viewKey)) return cached.views.get(viewKey);
      const view = immutable({
        resolved: true,
        policy: VIEWER_POSE_POLICY,
        entityId: entity.entityId,
        time,
        attachments: keys.map((key) =>
          sampled.attachments.find((item) => item.key === key),
        ),
        poseEvidence: { ...cached.evidence, keys: [...keys] },
        nativeAcceptance: null,
        nativePoseParity: null,
        reasons: [...sampled.omissions],
      });
      cached.views.set(viewKey, view);
      return view;
    },
    bindRendered(entityId, entry) {
      if (rendered.has(entityId))
        throw Error("Rendered pose actor already bound");
      const actor = assets.actor(entityId);
      if (!actor) throw Error("Rendered static actor is unprepared");
      assets.bindRenderedEntry(entityId, entry);
      rendered.set(entityId, {
        entry,
        bindDisplayRotation: entry.group.quaternion.clone(),
        sampler: createLatestViewerPoseSampler({
          THREE: assets.THREE,
          entry,
          entityId,
          bindings: actor.bindings,
        }),
      });
    },
    present(entity, time, displayFacing) {
      const value = rendered.get(entity?.entityId);
      if (!value || !entity.position || !entity.viewerLifecycle)
        throw Error("Registered visible pose actor/root required");
      const supplied = input(entity, time, null, []),
        sampled = value.sampler.sample(supplied);
      if (sampled.resolved)
        return {
          ...sampled,
          displayOnly: true,
          lifecycle: entity.lifecycle,
          moving: entity.viewerMotion.moving,
        };
      // Unknown current orientation has a separate, time-addressable display
      // convention. It supplies NO world attachment or projectile basis.
      assertLatestDisplayFacing(displayFacing, entity.entityId, time);
      value.entry.group.position.fromArray(entity.position);
      if (displayFacing.direction)
        value.entry.group.rotation.set(
          0,
          Math.atan2(displayFacing.direction[0], displayFacing.direction[1]),
          0,
        );
      else value.entry.group.quaternion.copy(value.bindDisplayRotation);
      const local = value.sampler.applyLocalPose(supplied);
      value.entry.group.updateWorldMatrix(true, true);
      return {
        ...local,
        displayOnly: true,
        lifecycle: entity.lifecycle,
        moving: entity.viewerMotion.moving,
        worldAttachmentResolved: false,
        orientationReasons: sampled.reasons,
        displayFacing: structuredClone(displayFacing),
      };
    },
    metrics() {
      return { poseUpdates: simulations, cacheHits };
    },
  };
  return Object.freeze(api);
}
