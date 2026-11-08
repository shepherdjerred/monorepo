import { prepareLatestMovement } from "./latest-movement.mjs";
import { sampleMovement } from "./playback.mjs";
import { createLatestDisplayFacing } from "./latest-display-facing.mjs";
import {
  prepareLatestLifecycle,
  sampleLatestLifecycle,
  movementFollowsRespawn,
} from "./latest-lifecycle.mjs";
import { sampleLatestMissileTrace } from "./latest-missile-playback.mjs";
import { createProjectilePresentation } from "./latest-projectile-presentation.mjs";
import {
  createLatestVisibilityComponentPolicy,
  ROFL_ALL_VISION_POLICY,
} from "./latest-target-visibility-policy.mjs";
import { INITIAL_VISIBILITY_PREFIX_POLICY } from "./latest-initial-visibility-prefix.mjs";
import { INITIAL_RESOURCE_PREFIX_POLICY } from "./latest-initial-resource-prefix.mjs";
import {
  createLatestDirectMissileAdapter,
  DIRECT_MISSILE_PRESENTATION_POLICY,
} from "./latest-direct-missile-presentation.mjs";
import {
  createLatestDirectMissileFamilyAdapter,
  DIRECT_MISSILE_FAMILY_POLICY,
} from "./latest-direct-missile-family-adapter.mjs";
import {
  createPresentationTargetPolicy,
  PRESENTATION_TARGET_POLICY,
} from "./latest-presentation-targets.mjs";
import {
  DIRECT_EFFECT_BUILD,
  DIRECT_EFFECT_PROTOCOL,
} from "./latest-direct-effect-runtime.mjs";
import { createLatestViewerPoseService } from "./latest-viewer-pose-service.mjs";
import { VIEWER_BOUND_SIZE_POLICY } from "./latest-viewer-bound-size.mjs";
import { VIEWER_POSE_POLICY } from "./latest-viewer-pose-sampler.mjs";
import { linkLatestNetworkEffectLifecycle } from "./latest-network-effect-lifecycle.mjs";

export const EFFECT_ENTITY_FIELDS = Object.freeze([
  "resourceContextEntityId",
  "lookup14EntityId",
  "attachmentEntityId",
  "lookupA8EntityId",
]);
export const VIEWER_ROOT_POLICY = "decoded-replay-clock-visible-actor-root-v1";
const finiteVector = (v, size) =>
  Array.isArray(v) && v.length === size && v.every(Number.isFinite);
const validateCursor = (cursor) => {
  if (
    cursor !== null &&
    (!cursor ||
      !Number.isSafeInteger(cursor.transportSequence) ||
      cursor.transportSequence < 0 ||
      !Number.isSafeInteger(cursor.entryOrder) ||
      cursor.entryOrder < 0 ||
      (cursor.exclusive !== undefined && typeof cursor.exclusive !== "boolean"))
  )
    throw Error("Ordered world query requires original packet ordinals");
};
const atOrBefore = (record, time, cursor) => {
  validateCursor(cursor);
  if (record.time !== time || !cursor) return record.time <= time;
  if (
    !Number.isSafeInteger(record.transportSequence) ||
    record.transportSequence < 0 ||
    !Number.isSafeInteger(record.entryOrder ?? 0) ||
    (record.entryOrder ?? 0) < 0
  )
    throw Error("Ordered world query requires original packet ordinals");
  const order =
    record.transportSequence - cursor.transportSequence ||
    (record.entryOrder ?? 0) - cursor.entryOrder;
  return cursor.exclusive ? order < 0 : order <= 0;
};
const latest = (track, time, cursor = null, event = (row) => row) => {
  let lo = 0,
    hi = track?.length ?? 0;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (atOrBefore(event(track[mid]), time, cursor)) lo = mid + 1;
    else hi = mid;
  }
  return lo ? track[lo - 1] : null;
};

// One absolute-time view shared by resource, attachment and projectile clients.
// Accepted resource observations and the explicit initial presentation prefix
// are separate inputs. Missing visibility/bones stay unknown.
export function createLatestWorldPresentation({
  report,
  scene,
  terrain,
  missilePlayback = { traces: [] },
  targetedMissilePresentation = null,
  directMissilePresentation = null,
  effectsManifest = null,
  entities = [],
  resourceTracks = [],
  attachmentTracks = [],
  visibilitySeedObservations = [],
  initialResourcePrefix = null,
  placementResolver = null,
  viewerPoseAssets = null,
}) {
  if (
    report.build !== DIRECT_EFFECT_BUILD ||
    report.protocol !== DIRECT_EFFECT_PROTOCOL ||
    scene.build !== report.build ||
    scene.protocol !== report.protocol ||
    typeof terrain?.sampleHeight !== "function"
  )
    throw Error("Incompatible world presentation inputs");
  if (
    viewerPoseAssets !== null &&
    (viewerPoseAssets.policy !== VIEWER_POSE_POLICY ||
      !/^[0-9a-f]{64}$/.test(viewerPoseAssets.contentHash))
  )
    throw Error("Validated viewer pose static assets required");
  let viewerPoses =
    viewerPoseAssets === null
      ? null
      : createLatestViewerPoseService({
          assets: viewerPoseAssets,
          report,
          negativeFormPrefix: initialResourcePrefix?.negativeFormPrefix ?? null,
        });
  const poseService = () =>
    (viewerPoses ??= createLatestViewerPoseService({
      assets: viewerPoseAssets,
      report,
      negativeFormPrefix: initialResourcePrefix?.negativeFormPrefix ?? null,
    }));
  if (
    initialResourcePrefix !== null &&
    (resourceTracks.length ||
      initialResourcePrefix.metadata?.policy !==
        INITIAL_RESOURCE_PREFIX_POLICY ||
      initialResourcePrefix.metadata.build !== report.build ||
      initialResourcePrefix.metadata.protocol !== report.protocol ||
      typeof initialResourcePrefix.query !== "function")
  )
    throw Error(
      "Choose an explicit initial resource presentation policy or supplied resource tracks",
    );
  const movement = prepareLatestMovement(report, scene.map).tracks;
  const lifecycle = prepareLatestLifecycle(report).tracks;
  const displayFacingHeroes = structuredClone(report.heroes);
  let displayFacing = null;
  // Display-facing provenance is required only by the visible-model service.
  // Position-only worlds retain unknown ordinals until an ordered query needs
  // them; they must not acquire an unrelated renderer initialization dependency.
  const displayFacingService = () =>
    (displayFacing ??= createLatestDisplayFacing({
      movement,
      lifecycle,
      heroes: displayFacingHeroes,
    }));
  const registry = new Map();
  const register = (entity) => {
    if (
      !Number.isInteger(entity.entityId) ||
      entity.entityId <= 0 ||
      entity.entityId > 0xffffffff ||
      registry.has(entity.entityId) ||
      (entity.position !== null && !finiteVector(entity.position, 3)) ||
      !Number.isFinite(entity.creationTime) ||
      entity.creationTime < 0 ||
      (entity.removalTime !== undefined &&
        (!Number.isFinite(entity.removalTime) ||
          entity.removalTime < entity.creationTime)) ||
      [
        "creationTransportSequence",
        "creationEntryOrder",
        "removalTransportSequence",
        "removalEntryOrder",
      ].some(
        (field) =>
          entity[field] !== undefined &&
          (!Number.isSafeInteger(entity[field]) || entity[field] < 0),
      )
    )
      throw Error("Invalid or duplicate world presentation entity");
    registry.set(entity.entityId, structuredClone(entity));
  };
  for (const hero of report.heroes)
    register({
      entityId: hero.entityId,
      character: hero.champion,
      skinId: hero.skinId,
      appearanceStatus: hero.skinIdStatus,
      position: hero.creationPosition,
      creationTime: hero.provenance?.time ?? 0,
      creationTransportSequence: hero.provenance?.transportSequence,
      creationEntryOrder: hero.provenance?.entryOrder ?? 0,
      creationStream: hero.provenance?.stream,
      creationChunkId: hero.provenance?.chunkId,
      creationSourceKind: hero.kind,
      entityClass: "champion",
      team: hero.team,
    });
  if (report.worldEvents !== undefined && !Array.isArray(report.worldEvents))
    throw Error("Decoded world entity events must be an array");
  for (const event of report.worldEvents ?? []) {
    const common = {
      entityId: event.entityId,
      creationTime: event.time,
      creationTransportSequence: event.transportSequence,
      creationEntryOrder: event.entryOrder ?? 0,
      sourceKind: event.kind,
      position: null,
    };
    if (event.kind === "npc-creation-candidate") {
      if (
        !finiteVector(event.creationPosition, 3) ||
        typeof event.character !== "string" ||
        !event.character.length ||
        !Number.isInteger(event.skinId) ||
        event.skinId < 0 ||
        event.skinId > 0xffffffff
      )
        throw Error("Invalid decoded NPC presentation fields");
      register({
        ...common,
        entityClass: "npc",
        character: event.character,
        skinId: event.skinId,
        appearanceStatus: event.skinStatus,
        position: event.creationPosition,
        name: event.name,
      });
    } else if (event.kind === "building-identity-candidate") {
      if (
        !Number.isInteger(event.mapNameHash) ||
        event.mapNameHash < 0 ||
        event.mapNameHash > 0xffffffff ||
        !Number.isInteger(event.team) ||
        event.team < 0 ||
        event.team > 0xffffffff
      )
        throw Error("Invalid decoded building identity");
      register({
        ...common,
        entityClass: "building",
        mapNameHash: event.mapNameHash,
        name: event.name,
        team: event.team,
        appearanceStatus: "unresolved-static-map-binding",
      });
    } else if (event.kind === "lane-minion-creation-candidate") {
      if (
        !Number.isInteger(event.barracksId) ||
        event.barracksId <= 0 ||
        event.barracksId > 0xffffffff ||
        !Number.isInteger(event.unitType) ||
        event.unitType < 0 ||
        event.unitType > 0xffffffff
      )
        throw Error("Invalid decoded lane-minion identity");
      // A decoded identity does not establish an actual spawn transform. The
      // barracks proxy used by model preview is not a recorded unit position.
      register({
        ...common,
        entityClass: "lane-minion",
        barracksId: event.barracksId,
        unitType: event.unitType,
        appearanceStatus: "unresolved-map-barracks-binding",
      });
    } else throw Error(`Unknown decoded world entity event ${event.kind}`);
  }
  for (const hero of report.heroes) {
    const initial = movement.get(hero.entityId)?.[0];
    if (initial?.source === "initial-hero-creation")
      initial.transportSequence = hero.provenance?.transportSequence;
  }
  for (const entity of entities) register(entity);
  const projectiles = createProjectilePresentation(
    report,
    targetedMissilePresentation,
  );
  const directMissiles =
    directMissilePresentation === null
      ? null
      : createLatestDirectMissileAdapter({
          report,
          manifest: effectsManifest,
          presentation: directMissilePresentation,
        });
  const directFamilies =
    directMissiles && targetedMissilePresentation && effectsManifest
      ? createLatestDirectMissileFamilyAdapter({
          report,
          manifest: effectsManifest,
          presentation: targetedMissilePresentation,
        })
      : null;
  const legacyCreates =
    directMissiles?.events.filter((event) => event.kind === "create") ?? [];
  const legacySources = new Set(
    legacyCreates.map((event) => event.sourceEventId),
  );
  const legacyEntities = new Set(legacyCreates.map((event) => event.entityId));
  for (const event of directFamilies?.events ?? [])
    if (
      event.kind === "create" &&
      (legacySources.has(event.sourceEventId) ||
        legacyEntities.has(event.entityId))
    )
      throw Error("Legacy and targeted direct missile ownership overlaps");
  for (const entity of projectiles.identities) register(entity);
  const targetedBySequence = new Map(
    (targetedMissilePresentation?.traces ?? []).map((trace) => [
      trace.sequence,
      trace.entityId,
    ]),
  );
  const resources = new Map(),
    attachments = new Map();
  const trackOrdinals = new WeakMap();
  const addTrack = (map, id, record) => {
    if (
      !registry.has(record.entityId) ||
      !Number.isFinite(record.time) ||
      record.time < 0 ||
      ["transportSequence", "entryOrder"].some(
        (field) =>
          record[field] !== undefined &&
          (!Number.isSafeInteger(record[field]) || record[field] < 0),
      )
    )
      throw Error("Presentation track lacks a registered entity/clock");
    if (!map.has(id)) {
      const track = [];
      map.set(id, track);
      trackOrdinals.set(track, new Set());
    }
    const track = map.get(id),
      ordinals = trackOrdinals.get(track);
    // Missing ordinals remain explicit supplied observations. They sort as
    // zero, so they cannot coexist with another observation at that same key.
    const identity = JSON.stringify([
      record.time,
      record.transportSequence ?? 0,
      record.entryOrder ?? 0,
    ]);
    if (ordinals.has(identity))
      throw Error("Duplicate causal presentation track observation");
    ordinals.add(identity);
    track.push(structuredClone(record));
  };
  for (const r of resourceTracks) addTrack(resources, r.entityId, r);
  for (const a of attachmentTracks) {
    if (
      !Number.isInteger(a.key) ||
      a.key < 0 ||
      a.key > 0xffffffff ||
      !finiteVector(a.transform, 16) ||
      (a.validUntil !== undefined &&
        (!Number.isFinite(a.validUntil) || a.validUntil < a.time))
    )
      throw Error("Invalid bone/attachment transform");
    addTrack(attachments, `${a.entityId}:${a.key}`, a);
  }
  for (const tracks of [resources, attachments])
    for (const track of tracks.values())
      track.sort(
        (a, b) =>
          a.time - b.time ||
          (a.transportSequence ?? 0) - (b.transportSequence ?? 0) ||
          (a.entryOrder ?? 0) - (b.entryOrder ?? 0),
      );
  const missiles = new Map(missilePlayback.traces.map((t) => [t.sequence, t]));
  const resourceView = (entityId, time, cursor) => {
    if (initialResourcePrefix !== null) {
      const presentation = initialResourcePrefix.query(entityId, time, cursor);
      // Prefix states are deeply immutable and owned by the prepared policy.
      // Internal entity snapshots may share them; public entity/reference
      // boundaries clone their complete view below.
      if (
        !Object.isFrozen(presentation) ||
        (presentation.stack !== null &&
          (!Object.isFrozen(presentation.stack) ||
            !Object.isFrozen(presentation.stack.base) ||
            !Object.isFrozen(presentation.stack.overlays)))
      )
        throw Error(
          "Initial resource presentation requires immutable owned state",
        );
      return {
        resourceStack: presentation.stack,
        resourcePresentation: presentation,
      };
    }
    return {
      resourceStack: structuredClone(
        latest(resources.get(entityId), time, cursor)?.stack ?? null,
      ),
    };
  };
  const visibilityPolicy = createLatestVisibilityComponentPolicy({
    build: report.build,
    protocol: report.protocol,
    policy: ROFL_ALL_VISION_POLICY,
    requests: report.visibilityRequests ?? [],
    seedObservations: visibilitySeedObservations,
    initialRestorePolicy: INITIAL_VISIBILITY_PREFIX_POLICY,
  });
  const generatedTargetIds = new Map(
    [...registry.keys()].map((id, index) => [id, index + 1]),
  );
  let targetQueries = null;

  const api = {
    presentationContentHash: viewerPoseAssets?.contentHash ?? null,
    viewerBoundSize(entityId, time, cursor = null) {
      validateCursor(cursor);
      if (
        !viewerPoseAssets ||
        typeof viewerPoseAssets.sampleBoundSize !== "function"
      )
        return {
          resolved: false,
          policy: VIEWER_BOUND_SIZE_POLICY,
          reasons: ["bound-size:owned-viewer-resource-unavailable"],
        };
      const entity = internalEntity(entityId, time, cursor),
        pose = poseService().querySnapshot(entity, [0], time, cursor);
      if (!pose.resolved)
        return {
          resolved: false,
          policy: VIEWER_BOUND_SIZE_POLICY,
          reasons: [...pose.reasons],
        };
      const sampled = viewerPoseAssets.sampleBoundSize(
        entityId,
        entity.position,
      );
      if (sampled.resolved === false)
        return { ...sampled, policy: VIEWER_BOUND_SIZE_POLICY };
      return {
        resolved: true,
        policy: VIEWER_BOUND_SIZE_POLICY,
        entityId,
        time,
        cursor: structuredClone(cursor),
        ...sampled,
        evidence: {
          actorKey: pose.poseEvidence.actorKey,
          rootPosition: [...entity.position],
          rootSource: structuredClone(entity.positionSource),
          poseEvidence: structuredClone(pose.poseEvidence),
          nativeLiveModelReadiness: null,
          nativeExtraDisplays: null,
          nativeGameplayScale: null,
        },
        omissions: [
          "bound-size:native-live-model-readiness-unestablished",
          "bound-size:native-extra-display-aggregation-unrecovered",
          "bound-size:native-gameplay-scale-and-root-offset-state-unrecovered",
        ],
      };
    },
    viewerPose(entityId, keys, time, cursor = null) {
      validateCursor(cursor);
      if (!viewerPoseAssets)
        return {
          resolved: false,
          policy: VIEWER_POSE_POLICY,
          reasons: ["pose:static-presentation-package-unavailable"],
        };
      return poseService().query(
        internalEntity(entityId, time, cursor),
        keys,
        time,
        cursor,
      );
    },
    bindViewerPoseActor(entityId, entry) {
      if (!viewerPoseAssets)
        throw Error("Static viewer pose assets unavailable");
      poseService().bindRendered(entityId, entry);
    },
    presentViewerPose(entityId, time) {
      if (!viewerPoseAssets)
        throw Error("Static viewer pose assets unavailable");
      return poseService().present(
        internalEntity(entityId, time),
        time,
        displayFacingService().sample(entityId, time),
      );
    },
    viewerPoseMetrics() {
      return viewerPoses?.metrics() ?? { poseUpdates: 0, cacheHits: 0 };
    },
    presentationTarget(entityId, time, cursor = null) {
      targetQueries ??= createPresentationTargetPolicy({
        report,
        policy: PRESENTATION_TARGET_POLICY,
      });
      return targetQueries.query(
        {
          entity: api.entity(entityId, time, cursor),
          visibility: api.visibility(entityId, time, cursor),
          presentationTargetId: generatedTargetIds.get(entityId),
        },
        time,
        cursor,
      );
    },
    visibility(entityId, time, cursor = null) {
      const entity = internalEntity(entityId, time, cursor);
      if (!entity) return visibilityPolicy.query(null, time, cursor);
      if (!Number.isSafeInteger(entity.creationTransportSequence))
        return {
          ...visibilityPolicy.query(null, time, cursor),
          reasons: ["visibility:presentation-registration-ordinal-unavailable"],
        };
      return visibilityPolicy.query(
        {
          ...entity,
          presentationHandle: `presentation-ai:${entity.entityId}:${entity.creationTransportSequence}:${entity.creationEntryOrder ?? 0}`,
          componentClass:
            entity.entityClass === "champion" ? "ai-client" : "unproven",
        },
        time,
        cursor,
      );
    },
    entity(entityId, time, cursor = null) {
      validateCursor(cursor);
      if (!Number.isInteger(entityId) || !Number.isFinite(time))
        throw Error("Invalid world identity/time");
      const entity = registry.get(entityId);
      if (
        !entity ||
        !atOrBefore(
          {
            time: entity.creationTime,
            transportSequence: entity.creationTransportSequence,
            entryOrder: entity.creationEntryOrder ?? 0,
          },
          time,
          cursor,
        ) ||
        (entity.removalTime !== undefined &&
          atOrBefore(
            {
              time: entity.removalTime,
              transportSequence: entity.removalTransportSequence,
              entryOrder: entity.removalEntryOrder ?? 0,
            },
            time,
            cursor,
          ))
      )
        return null;
      if (entity.entityClass === "projectile") {
        const motion = projectiles.query(entityId, time, cursor);
        if (!motion) return null;
        return {
          ...entity,
          ...motion,
          ...resourceView(entityId, time, cursor),
          direction: null,
          orientationStatus: "unknown",
          visibility: "unknown",
          reasons: [...motion.omissions],
        };
      }
      let interval = latest(
        lifecycle.get(entityId),
        time,
        cursor,
        (row) => row.death,
      );
      if (interval?.respawn && !atOrBefore(interval.respawn, time, cursor))
        interval = { ...interval, respawn: null };
      const life = sampleLatestLifecycle(interval ? [interval] : null, time);
      const motionTime = life.dead ? life.interval.death.time : time;
      const motionCursor = life.dead
        ? {
            transportSequence: life.interval.death.transportSequence,
            entryOrder: life.interval.death.entryOrder ?? 0,
          }
        : cursor;
      validateCursor(motionCursor);
      const motionEvent = latest(
        movement.get(entityId),
        motionTime,
        motionCursor,
      );
      const motion = sampleMovement(
        motionEvent ? [motionEvent] : null,
        motionTime,
      );
      let position = entity.position === null ? null : [...entity.position],
        direction = null,
        positionStatus = position ? "recorded-creation-position" : "unknown";
      let positionSource = position
        ? {
            kind: "creation",
            entityId,
            time: entity.creationTime,
            transportSequence: entity.creationTransportSequence ?? null,
            entryOrder: entity.creationEntryOrder ?? null,
            sourceKind: entity.creationSourceKind ?? entity.sourceKind ?? null,
          }
        : null;
      const reasons = [];
      if (motion) {
        const h = terrain.sampleHeight(...motion.point);
        if (!h.inside) {
          position = null;
          positionStatus = "unknown";
          reasons.push("world:terrain-outside-grid");
        } else {
          position = [motion.point[0], h.height, motion.point[1]];
          direction = [motion.direction[0], 0, motion.direction[1]];
          positionStatus = "movement-derived-preview";
          positionSource = {
            kind: "movement",
            entityId,
            time: motionEvent.time,
            sequence: motionEvent.sequence,
            transportSequence: motionEvent.transportSequence ?? null,
            entryOrder: motionEvent.entryOrder ?? null,
            sourceKind: motionEvent.source,
            frozenAtDeath: life.dead
              ? {
                  time: life.interval.death.time,
                  transportSequence: life.interval.death.transportSequence,
                  entryOrder: life.interval.death.entryOrder ?? 0,
                }
              : null,
          };
        }
      }
      if (!life.dead && !movementFollowsRespawn(motion, life.respawn)) {
        const h = terrain.sampleHeight(...life.respawn.point);
        if (!h.inside) {
          position = null;
          positionStatus = "unknown";
          reasons.push("world:respawn-terrain-outside-grid");
        } else {
          position = [life.respawn.point[0], h.height, life.respawn.point[1]];
          positionStatus = "recorded-respawn-point";
          positionSource = {
            kind: "respawn",
            entityId,
            time: life.respawn.time,
            transportSequence: life.respawn.transportSequence ?? null,
            entryOrder: life.respawn.entryOrder ?? null,
          };
        }
        direction = null;
      }
      if (!position && !reasons.length)
        reasons.push(`world:missing-entity-position:${entityId}`);
      return {
        ...entity,
        position: position?.map(Math.fround) ?? null,
        positionStatus,
        positionSource: position ? positionSource : null,
        reasons,
        direction,
        orientationStatus: direction ? "movement-derived-preview" : "unknown",
        lifecycle: life.dead ? "dead" : "alive",
        // Alive pose sampling never consumes the previous death interval. Keep
        // its potentially large post-death cast history out of every reference.
        viewerLifecycle: life.dead ? structuredClone(life) : { dead: false },
        viewerMotion: {
          moving:
            !!motion?.moving &&
            !life.dead &&
            movementFollowsRespawn(motion, life.respawn),
          orientationKnown:
            !!motionEvent &&
            motionEvent.source !== "initial-hero-creation" &&
            motionEvent.waypoints.some(
              (point, index) =>
                index > 0 &&
                Math.hypot(
                  point[0] - motionEvent.waypoints[index - 1][0],
                  point[1] - motionEvent.waypoints[index - 1][1],
                ) > 0,
            ),
        },
        visibility: "unknown",
        ...resourceView(entityId, time, cursor),
      };
    },
    viewerRoot(entityId, time, cursor = null) {
      const entity = internalEntity(entityId, time, cursor);
      if (!entity)
        return {
          resolved: false,
          policy: VIEWER_ROOT_POLICY,
          reasons: [
            `world:viewer-root-entity-inactive-or-unregistered:${entityId}`,
          ],
        };
      if (entity.entityClass !== "champion")
        return {
          resolved: false,
          policy: VIEWER_ROOT_POLICY,
          reasons: [
            `world:viewer-root-class-not-integrated:${entity.entityClass}`,
          ],
        };
      if (!entity.position)
        return {
          resolved: false,
          policy: VIEWER_ROOT_POLICY,
          reasons: [...entity.reasons],
        };
      return {
        resolved: true,
        policy: VIEWER_ROOT_POLICY,
        entityId,
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
      };
    },
    attachment(entityId, key, time, cursor = null) {
      const entity = internalEntity(entityId, time, cursor);
      if (!entity)
        return {
          resolved: false,
          reasons: [`world:missing-entity:${entityId}`],
        };
      const pose = latest(attachments.get(`${entityId}:${key}`), time, cursor);
      if (
        !pose ||
        (pose.validUntil === undefined
          ? time !== pose.time
          : time > pose.validUntil)
      )
        return {
          resolved: false,
          reasons: [`world:missing-attachment:${entityId}:${key}`],
        };
      return {
        resolved: true,
        transform: [...pose.transform],
        sourceTime: pose.time,
      };
    },
    references(descriptor, time, cursor = null) {
      validateCursor(cursor);
      return EFFECT_ENTITY_FIELDS.map((field) => {
        const entityId = descriptor[field];
        if (
          !Number.isInteger(entityId) ||
          entityId < 0 ||
          entityId > 0xffffffff
        )
          throw Error(`Invalid effect entity reference ${field}`);
        const entity = entityId ? internalEntity(entityId, time, cursor) : null;
        return {
          field,
          entityId,
          entity,
          status:
            entityId === 0
              ? "native-null"
              : entity
                ? "registered"
                : registry.has(entityId)
                  ? "inactive"
                  : "unresolved",
        };
      });
    },
    projectilePresentation(entityId, time, cursor = null) {
      validateCursor(cursor);
      return projectiles.query(entityId, time, cursor);
    },
    directMissileEvents() {
      return structuredClone([
        ...(directMissiles?.events ?? []),
        ...(directFamilies?.events ?? []),
      ]);
    },
    directMissileFamilyDiagnostics() {
      return directFamilies
        ? {
            policy: directFamilies.policy,
            creates: directFamilies.events.filter(
              (event) => event.kind === "create",
            ).length,
            omitted: structuredClone(directFamilies.omitted),
            nativeAcceptance: null,
          }
        : null;
    },
    projectile(sequence, time, cursor = null) {
      validateCursor(cursor);
      const trace = missiles.get(sequence);
      if (!trace)
        return targetedBySequence.has(sequence)
          ? projectiles.query(targetedBySequence.get(sequence), time, cursor)
          : null;
      const state = sampleLatestMissileTrace(trace, time);
      if (!state) return null;
      return {
        ...state,
        sourceId: trace.ownerId,
        targetId: trace.targetId ?? null,
        sourceEventId: `missile:${trace.entityId}:${trace.sequence}`,
      };
    },
    placement(event, time, cursor = null) {
      validateCursor(cursor);
      if (event.missilePresentation !== undefined) {
        if (
          event.missilePresentation.policy ===
            DIRECT_MISSILE_PRESENTATION_POLICY &&
          directMissiles
        )
          return directMissiles.placement(event, time);
        if (
          event.missilePresentation.policy === DIRECT_MISSILE_FAMILY_POLICY &&
          directFamilies
        )
          return directFamilies.placement(event, time, cursor);
        throw Error(
          "Direct missile placement requires its explicit owned policy",
        );
      }
      if (event.placement?.kind === "explicit-world") {
        if (
          event.descriptor &&
          EFFECT_ENTITY_FIELDS.some((k) => event.descriptor[k] !== 0)
        )
          throw Error(
            "Entity-referenced effect cannot be converted into an explicit detached effect",
          );
        if (!finiteVector(event.placement.position, 3))
          throw Error("Invalid explicit world effect placement");
        if (
          event.placement.basis != null &&
          !finiteVector(event.placement.basis, 9)
        )
          throw Error("Invalid explicit world effect basis");
        if (
          event.placement.boundObjectSize != null &&
          (typeof event.placement.boundObjectSize !== "number" ||
            !Number.isFinite(Math.fround(event.placement.boundObjectSize)) ||
            event.placement.boundObjectSize < 0)
        )
          throw Error("Invalid explicit world bound-object size");
        return {
          resolved: true,
          position: [...event.placement.position],
          ...(event.placement.basis == null
            ? {}
            : {
                basis: event.placement.basis.map(Math.fround),
                basisStatus: "explicit-supplied-world-basis",
              }),
          ...(event.placement.boundObjectSize == null
            ? {}
            : {
                boundObjectSize: Math.fround(event.placement.boundObjectSize),
                boundObjectSizeStatus: "explicit-supplied-bound-object-size",
              }),
          reasons: [],
        };
      }
      const descriptor = event.descriptor;
      if (!descriptor)
        return {
          resolved: false,
          reasons: ["world:missing-effect-descriptor"],
        };
      const references = internalReferences(descriptor, time, cursor);
      const reasons = references
        .filter((r) => r.entityId && !r.entity)
        .map(
          (r) =>
            `world:${r.status === "inactive" ? "inactive" : "unresolved"}-reference:${r.field}:${r.entityId}`,
        );
      if (reasons.length) return { resolved: false, references, reasons };
      // Registry resolution alone is not placement. The native descriptor's
      // override/attachment algorithm must explicitly own the result.
      if (!placementResolver)
        return {
          resolved: false,
          references,
          reasons: ["world:descriptor-placement-algorithm"],
        };
      return placementResolver({
        event,
        time,
        cursor,
        references,
        world: placementWorld,
      });
    },
  };
  const sampleEntity = api.entity,
    internalReferences = api.references,
    entityCache = new Map();
  const immutable = (value) => {
    if (
      value &&
      typeof value === "object" &&
      !ArrayBuffer.isView(value) &&
      !Object.isFrozen(value)
    ) {
      for (const child of Object.values(value)) immutable(child);
      Object.freeze(value);
    }
    return value;
  };
  // The adapter's decoded tracks and initial presentation policy are immutable.
  // Retain only the latest absolute sample per registered identity, including
  // the complete causal cursor. Placement references can share this owned,
  // immutable snapshot; public queries always receive independent clones.
  function internalEntity(entityId, time, cursor = null) {
    validateCursor(cursor);
    if (!Number.isInteger(entityId) || !Number.isFinite(time))
      throw Error("Invalid world identity/time");
    const prior = entityCache.get(entityId),
      packet = cursor?.transportSequence ?? null,
      entry = cursor?.entryOrder ?? null,
      exclusive = cursor?.exclusive;
    if (
      prior &&
      Object.is(prior.time, time) &&
      prior.packet === packet &&
      prior.entry === entry &&
      prior.exclusive === exclusive
    )
      return prior.value;
    const value = immutable(sampleEntity(entityId, time, cursor));
    if (registry.has(entityId))
      entityCache.set(entityId, { time, packet, entry, exclusive, value });
    return value;
  }
  api.entity = (entityId, time, cursor = null) =>
    structuredClone(internalEntity(entityId, time, cursor));
  api.references = (descriptor, time, cursor = null) =>
    structuredClone(internalReferences(descriptor, time, cursor));
  // The placement boundary owns only immutable pose snapshots. It cannot
  // mutate the service or expose those snapshots through public viewerPose().
  const placementWorld = Object.freeze({
    ...api,
    viewerPose(entityId, keys, time, cursor = null) {
      validateCursor(cursor);
      if (!viewerPoseAssets)
        return immutable({
          resolved: false,
          policy: VIEWER_POSE_POLICY,
          reasons: ["pose:static-presentation-package-unavailable"],
        });
      return poseService().querySnapshot(
        internalEntity(entityId, time, cursor),
        keys,
        time,
        cursor,
      );
    },
  });
  return Object.freeze(api);
}

// Origin and packet ordering remain distinct. No deduplication occurs without
// an ownership relation; network, missile and animation counts may overlap.
export function selectLatestWorldEffectResource({
  descriptor,
  time,
  cursor,
  world,
  unitResources,
}) {
  validateCursor(cursor);
  if (
    !cursor ||
    !Number.isFinite(time) ||
    !world ||
    typeof world.references !== "function" ||
    unitResources?.metadata?.build !== DIRECT_EFFECT_BUILD ||
    unitResources.metadata.protocol !== DIRECT_EFFECT_PROTOCOL ||
    typeof unitResources.selectSuppliedStacks !== "function"
  )
    throw Error("Ordered world and exact-build unit resource policy required");
  // The observed factory order applies only to this branch. In particular,
  // alternate factory modes must not inherit an ordinary branch's resource.
  if (descriptor.field8c !== 0) return { status: "nonordinary-factory-order" };
  const units = [],
    presentations = [],
    missingEntities = new Map();
  const references = world.references(descriptor, time, cursor);
  for (const field of ["resourceContextEntityId", "lookupA8EntityId"]) {
    const entityId = descriptor[field];
    if (!Number.isInteger(entityId) || entityId < 0 || entityId > 0xffffffff)
      throw Error(`Invalid effect entity reference ${field}`);
    // Native null unit pointers do not contribute a unit resource stage.
    if (entityId === 0) continue;
    const reference = references.find((reference) => reference.field === field);
    if (!reference || reference.entityId !== entityId)
      throw Error(
        "World resource reference differs from the original descriptor",
      );
    const entity = reference.entity;
    if (!entity)
      missingEntities.set(units.length, { field, status: reference.status });
    const stack = entity?.resourceStack;
    if (entity?.resourcePresentation)
      presentations.push({
        unitIndex: units.length,
        field,
        entityId,
        ...structuredClone(entity.resourcePresentation),
      });
    if (stack === null || stack === undefined)
      units.push({ status: "unresolved-unit-resource-stack", entityId });
    else {
      if (stack.status !== "supplied-resource-stack")
        throw Error("World resource observation must contain a supplied stack");
      units.push(stack);
    }
  }
  if (!Array.isArray(descriptor.unresolvedAuxiliaryContextIds))
    throw Error("Original effect auxiliary context vector required");
  const auxiliaries = descriptor.unresolvedAuxiliaryContextIds.map(
    (contextIdentity) => ({
      id: `auxiliary:${contextIdentity}`,
      contextIdentity,
    }),
  );
  const selected = unitResources.selectSuppliedStacks(
    { units, auxiliaries },
    descriptor.resourceKey,
  );
  const result =
    selected.status === "unresolved-unit-resource-stack" &&
    missingEntities.has(selected.unitIndex)
      ? {
          ...selected,
          status: `${missingEntities.get(selected.unitIndex).status === "inactive" ? "inactive" : "unresolved"}-unit-resource-entity`,
          field: missingEntities.get(selected.unitIndex).field,
        }
      : selected;
  return presentations.length
    ? {
        ...result,
        presentation: {
          policy: INITIAL_RESOURCE_PREFIX_POLICY,
          units: presentations,
          nativeAcceptance: null,
          nativeCacheReadiness: null,
          liveEngineResourceState: null,
        },
      }
    : result;
}

export function buildLatestDirectEffectEvents({
  pipeline,
  report,
  missilePlayback = { traces: [], omitted: [] },
  targetedMissilePresentation = null,
  animationEvents = [],
  world = null,
  unitResources = null,
}) {
  if ((world === null) !== (unitResources === null))
    throw Error("World resource selection requires both world and policy");
  const events = [],
    networkEvents = [];
  for (const e of pipeline.events) {
    if (e.kind === "create-request") {
      const request = pipeline.creation(e.creationSequence);
      const d = request.descriptor;
      const resourceSelection = unitResources
        ? selectLatestWorldEffectResource({
            descriptor: d,
            time: e.time,
            cursor: {
              transportSequence: e.transportSequence,
              entryOrder: e.entryOrder,
            },
            world,
            unitResources,
          })
        : null;
      const resource = resourceSelection
        ? resourceSelection.resource
        : request.resourceStages?.auxiliary?.resource;
      const auxiliaryCandidate = request.resourceStages?.auxiliary?.resource;
      const reasons = [];
      if (
        !resourceSelection &&
        (d.resourceContextEntityId || d.lookupA8EntityId)
      )
        reasons.push("resource:live-unit-stack-precedence");
      if (d.field8c !== 0) reasons.push("resource:nonordinary-factory-order");
      if (resource?.status !== "prepared-definition")
        reasons.push(
          `resource:${resourceSelection?.status ?? request.resourceStages?.auxiliary?.status ?? request.resource.status}:${resource?.status ?? "no-reference"}`,
        );
      const id = `network-effect:${e.entityId}:${e.creationSequence}`;
      networkEvents.push({
        id,
        kind: reasons.length ? "omitted" : "create",
        origin: "network-effect",
        time: e.time,
        entityId: e.entityId,
        transportSequence: e.transportSequence,
        entryOrder: e.entryOrder,
        creationSequence: e.creationSequence,
        definitionId: resource?.effectId,
        // Resource and attachment roles do not establish the effect's creator.
        // Keep all four references without attributing a champion prematurely.
        ownerId: null,
        ownershipStatus: "network-creator-unresolved",
        descriptor: structuredClone(d),
        ...(resourceSelection
          ? {
              resourceSelection: structuredClone(resourceSelection),
              // A prepared auxiliary candidate is useful compiler inventory,
              // even while a preceding unit stage blocks actual selection.
              ...(auxiliaryCandidate?.status === "prepared-definition" &&
              auxiliaryCandidate.effectId !== resource?.effectId
                ? {
                    auxiliaryCandidateDefinitionId: auxiliaryCandidate.effectId,
                  }
                : {}),
            }
          : {}),
        reasons,
        seedHex: "0000000000000000",
      });
    } else {
      networkEvents.push({
        id: `network-removal:${e.entityId}:${e.removalSequence}`,
        kind: "removal-request",
        origin: "network-effect",
        time: e.time,
        entityId: e.entityId,
        transportSequence: e.transportSequence,
        entryOrder: e.entryOrder,
        removalSequence: e.removalSequence,
        requestedFlags: e.requestedFlagMask,
      });
    }
  }
  if (networkEvents.length)
    events.push(
      ...linkLatestNetworkEffectLifecycle({
        events: networkEvents,
        creations: report.effectCreations,
        removals: report.effectRemovals,
      }),
    );
  if (!report || !Array.isArray(report.missiles))
    throw Error("Decoded presentation report required");
  const traces = new Map(missilePlayback.traces.map((t) => [t.sequence, t]));
  const directMissileEvents = world?.directMissileEvents?.() ?? [];
  const directFamilyOmitted = new Map(
    (world?.directMissileFamilyDiagnostics?.()?.omitted ?? []).map((row) => [
      row.sequence,
      row,
    ]),
  );
  const directMissileSources = new Set(
    directMissileEvents
      .filter((event) => event.kind === "create")
      .map((event) => event.missilePresentation.sequence),
  );
  const omitted = new Map(missilePlayback.omitted.map((t) => [t.sequence, t]));
  const targeted = new Map(
    (targetedMissilePresentation?.traces ?? []).map((trace) => [
      trace.sequence,
      trace,
    ]),
  );
  if (targetedMissilePresentation !== null)
    createProjectilePresentation(report, targetedMissilePresentation);
  const targetedOmitted = new Map(
    (targetedMissilePresentation?.omitted ?? []).map((trace) => [
      trace.sequence,
      trace,
    ]),
  );
  const provenance = (record) => {
    if (
      !Number.isSafeInteger(record.transportSequence) ||
      !Number.isSafeInteger(record.entryOrder ?? 0) ||
      (record.entryOrder ?? 0) < 0 ||
      !Number.isFinite(record.time)
    )
      throw Error(
        "Presentation records require original transport ordinals; rebuild the stale semantics fixture",
      );
    return {
      time: record.time,
      transportSequence: record.transportSequence,
      entryOrder: record.entryOrder ?? 0,
    };
  };
  for (const record of report.missiles) {
    // This owned source packet is represented by the adapter's create/stop
    // lifecycle. Its network effect requests retain their separate identities.
    if (directMissileSources.has(record.sequence)) continue;
    const trace = traces.get(record.sequence),
      targetedTrace = targeted.get(record.sequence),
      gap =
        omitted.get(record.sequence) ?? targetedOmitted.get(record.sequence);
    // Each replication remains traceable. Its generation/ownership is unknown
    // until the projectile lifecycle is ported; it is never a deduplication key.
    events.push({
      id: `missile:${record.entityId}:${record.sequence}`,
      origin: "missile",
      kind: "omitted",
      entityId: record.entityId,
      ownerId: record.cast.ownerId,
      ownershipStatus: "decoded-cast-owner",
      definitionId: trace?.effectId,
      ...provenance(record),
      ...(targetedTrace
        ? {
            motionPresentation: {
              policy: targetedTrace.policy,
              instanceId: targetedTrace.instanceId,
              sourceEventId: targetedTrace.sourceEventId,
              requestedTargetEntityId: targetedTrace.requestedTargetEntityId,
              nativeAcceptance: null,
              nativeAcceptedInternalId: null,
              omissions: [...targetedTrace.omissions],
            },
          }
        : {}),
      reasons: [
        ...(targetedTrace
          ? [
              "world:missile-root-basis-and-activation",
              "resource:missile-particle-definition-binding",
            ]
          : trace
            ? ["world:missile-root-basis-and-activation"]
            : gap
              ? gap.reasons.map((r) => `missile:${r}`)
              : ["missile:movement-analysis-not-supplied"]),
        ...(directFamilyOmitted.get(record.sequence)?.reasons ?? []),
      ],
    });
  }
  for (const trace of targeted.values()) {
    const record = report.missiles.find(
      (row) =>
        row.sequence === trace.sequence && row.entityId === trace.entityId,
    );
    for (const request of trace.emittedCastRequests) {
      const decodedTrigger =
        request.trigger?.kind === "decoded-phase-notification";
      if (
        decodedTrigger &&
        (!Number.isSafeInteger(request.trigger.transportSequence) ||
          request.trigger.transportSequence < 0 ||
          !Number.isSafeInteger(request.trigger.entryOrder) ||
          request.trigger.entryOrder < 0)
      )
        throw Error(
          "Generated cast lacks its decoded trigger's original packet/entry",
        );
      events.push({
        ...structuredClone(request),
        origin: "missile-behavior",
        kind: "omitted",
        entityId: trace.entityId,
        ownerId: trace.ownerId,
        ownershipStatus: "decoded-cast-owner",
        transportSequence: decodedTrigger
          ? request.trigger.transportSequence
          : record.transportSequence,
        entryOrder: decodedTrigger
          ? request.trigger.entryOrder
          : (record.entryOrder ?? 0),
        orderingProvenance: decodedTrigger
          ? "decoded-trigger-packet-and-entry"
          : "generated-under-supplied-diagnostic-clock",
        reasons: [...request.omissions],
      });
    }
  }
  for (const [sourceKind, records] of [
    ["attack", report.attacks],
    ["cast", report.casts],
  ])
    for (const record of records)
      events.push({
        id: `${sourceKind}:${record.entityId}:${record.sequence}`,
        origin: "combat",
        sourceKind,
        kind: "omitted",
        entityId: record.entityId,
        ownerId: record.entityId,
        ownershipStatus: `decoded-${sourceKind}-entity`,
        ...provenance(record),
        reasons: [`presentation:unverified-${sourceKind}-trigger`],
      });
  for (const event of animationEvents) events.push(structuredClone(event));
  events.push(...structuredClone(directMissileEvents));
  return events.sort(
    (a, b) =>
      a.time - b.time ||
      a.transportSequence - b.transportSequence ||
      a.entryOrder - b.entryOrder,
  );
}
