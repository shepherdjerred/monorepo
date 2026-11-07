// Original component operations, plus an explicitly selected presentation view.
// This policy never establishes original target acceptance or engine handles.
import {
  INITIAL_VISIBILITY_PREFIX_POLICY,
  INITIAL_VISIBILITY_PREFIX_PROOF,
  initialVisibilityPrefixEligibility,
} from "./latest-initial-visibility-prefix.mjs";
export const ROFL_ALL_VISION_POLICY =
  "native-rofl-mode3-disabled-view-filter-v1";
export const VISIBILITY_POLICY_OMISSIONS = Object.freeze([
  "visibility:original-client-owner-payload-callbacks-unimplemented",
  "visibility:actual-client-ui-view-setting-unrecovered",
  "visibility:original-world-component-registration-not-replayed",
  "visibility:full-snapshot-owner-restoration-unimplemented",
  "target:original-character-state-and-team-acceptance-unrecovered",
]);
const uint = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const byte = (value) => Number.isInteger(value) && value >= 0 && value <= 255;
const ordinal = (value) => Number.isSafeInteger(value) && value >= 0;
const clock = (value) => Number.isFinite(value) && value >= 0;
const checkState = (state) => {
  if (
    !state ||
    state.schema !== 1 ||
    typeof state.initialized !== "boolean" ||
    typeof state.override !== "boolean" ||
    !uint(state.mask)
  )
    throw Error("Typed original visibility component state required");
};
export const initialVisibilityComponentState = () => ({
  schema: 1,
  initialized: false,
  override: false,
  mask: 0,
});

export function decodeVisibilityViewSlot(encoded) {
  if (!byte(encoded)) throw Error("Encoded visibility view slot must be uint8");
  const added = (encoded + 0xea) & 255;
  const rotated = ((added << 6) | (added >>> 2)) & 255;
  return ((rotated >>> 1) & 0x55) | ((rotated << 1) & 0xaa);
}

export function applyVisibilityComponentEvent(state, event, mode) {
  checkState(state);
  if (!uint(mode)) throw Error("Visibility configuration mode must be uint32");
  const next = { ...state };
  if (event?.opcode === 822) next.initialized = true;
  else if (event?.opcode === 918) {
    if (mode === 0) next.initialized = false;
  } else if (event?.opcode === 48 || event?.opcode === 582) {
    const slot = decodeVisibilityViewSlot(event.encodedViewSlotByte);
    const bit = (1 << (slot & 31)) >>> 0;
    next.mask =
      (event.opcode === 48 ? state.mask | bit : state.mask & ~bit) >>> 0;
  } else throw Error("Unknown original visibility component event");
  return next;
}

export function queryVisibilityComponent(
  state,
  {
    mode,
    querySelectedView,
    viewFilterEnabled,
    selectedViewSlot,
    sentinelSlot,
  },
) {
  checkState(state);
  if (
    !uint(mode) ||
    typeof querySelectedView !== "boolean" ||
    typeof viewFilterEnabled !== "boolean"
  )
    throw Error("Explicit typed visibility view inputs required");
  if (mode === 0) return state.override || state.initialized;
  if (!state.initialized) return false;
  if (!querySelectedView || !viewFilterEnabled) return true;
  if (!byte(selectedViewSlot) || !byte(sentinelSlot))
    throw Error("Consumed selected-view query inputs must be uint8");
  return selectedViewSlot === sentinelSlot
    ? state.mask !== 0
    : Boolean(state.mask & (1 << (selectedViewSlot & 31)));
}

const validateCursor = (cursor) => {
  if (
    cursor !== null &&
    (!cursor ||
      !ordinal(cursor.transportSequence) ||
      !ordinal(cursor.entryOrder) ||
      (cursor.exclusive !== undefined && typeof cursor.exclusive !== "boolean"))
  )
    throw Error("Visibility query requires original causal ordinals");
};
const compare = (a, b) =>
  a.time - b.time ||
  a.transportSequence - b.transportSequence ||
  (a.entryOrder ?? 0) - (b.entryOrder ?? 0);
const included = (record, time, cursor) =>
  record.time < time ||
  (record.time === time &&
    (!cursor ||
      (cursor.exclusive
        ? compare(record, { time, ...cursor }) < 0
        : compare(record, { time, ...cursor }) <= 0)));

export function createLatestVisibilityComponentPolicy({
  build,
  protocol,
  policy,
  requests,
  seedObservations = [],
  initialRestorePolicy = null,
}) {
  if (
    build !== "16.21.829.8620" ||
    protocol !== "20e09df23c66b85e" ||
    policy !== ROFL_ALL_VISION_POLICY ||
    !Array.isArray(requests) ||
    !Array.isArray(seedObservations) ||
    (initialRestorePolicy !== null &&
      initialRestorePolicy !== INITIAL_VISIBILITY_PREFIX_POLICY)
  )
    throw Error(
      "Exact-build declared ROFL all-vision presentation policy required",
    );
  const tracks = new Map(),
    ids = new Set(),
    seeds = new Map();
  // Only caller-supplied, separately verified component observations can seed
  // state. Raw snapshot packets never acquire this provenance automatically.
  for (const input of seedObservations) {
    checkState(input?.state);
    if (
      !uint(input.entityId) ||
      !input.entityId ||
      typeof input.presentationHandle !== "string" ||
      !input.presentationHandle.length ||
      input.provenance !== "explicit-verified-component-observation" ||
      typeof input.evidenceSha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(input.evidenceSha256) ||
      typeof input.id !== "string" ||
      !input.id.length ||
      ids.has(input.id) ||
      !clock(input.time) ||
      !ordinal(input.transportSequence) ||
      !ordinal(input.entryOrder) ||
      !Array.isArray(input.sourceEventIds) ||
      !input.sourceEventIds.length ||
      input.sourceEventIds.some((id) => typeof id !== "string" || !id.length)
    )
      throw Error(
        "Explicit verified causal visibility component seed required",
      );
    ids.add(input.id);
    if (!seeds.has(input.presentationHandle))
      seeds.set(input.presentationHandle, []);
    seeds.get(input.presentationHandle).push(structuredClone(input));
  }
  for (const track of seeds.values()) {
    track.sort(compare);
    for (let i = 1; i < track.length; i++)
      if (compare(track[i - 1], track[i]) === 0)
        throw Error(
          "Visibility seed observations require distinct causal ordinals",
        );
  }
  for (const input of requests) {
    if (
      !input ||
      !uint(input.entityId) ||
      ![822, 918, 48, 582].includes(input.opcode) ||
      ![1, 2].includes(input.stream) ||
      !clock(input.time) ||
      !ordinal(input.transportSequence) ||
      !ordinal(input.entryOrder) ||
      typeof input.id !== "string" ||
      !input.id.length ||
      ids.has(input.id) ||
      input.acceptedByLiveUnit !== null ||
      input.visible !== null ||
      ([48, 582].includes(input.opcode) && !byte(input.encodedViewSlotByte))
    )
      throw Error(
        "Typed raw visibility requests with unknown native acceptance required",
      );
    ids.add(input.id);
    if (!tracks.has(input.entityId)) tracks.set(input.entityId, []);
    tracks.get(input.entityId).push(structuredClone(input));
  }
  for (const track of tracks.values()) {
    track.sort(compare);
    for (let i = 1; i < track.length; i++)
      if (compare(track[i - 1], track[i]) === 0)
        throw Error(
          "Visibility events require distinct original causal ordinals",
        );
  }
  return Object.freeze({
    policy,
    query(registration, time, cursor = null) {
      validateCursor(cursor);
      if (!clock(time)) throw Error("Finite visibility query time required");
      const unresolved = (reason) => ({
        resolved: false,
        policy,
        nativeVisibilityResult: null,
        nativeAcceptedInternalId: null,
        nativeAcceptance: null,
        reasons: [reason],
        omissions: [...VISIBILITY_POLICY_OMISSIONS],
        complete: null,
      });
      if (!registration)
        return unresolved("visibility:no-active-presentation-registration");
      const {
        entityId,
        presentationHandle,
        componentClass,
        creationTime,
        creationTransportSequence,
        creationEntryOrder = 0,
        removalTime,
        removalTransportSequence,
        removalEntryOrder = 0,
      } = registration;
      if (
        !uint(entityId) ||
        entityId === 0 ||
        typeof presentationHandle !== "string" ||
        !presentationHandle.length ||
        !clock(creationTime) ||
        !ordinal(creationTransportSequence) ||
        !ordinal(creationEntryOrder)
      )
        throw Error("Causal generated presentation registration required");
      if (
        removalTime !== undefined &&
        (!clock(removalTime) ||
          removalTime < creationTime ||
          !ordinal(removalTransportSequence) ||
          !ordinal(removalEntryOrder))
      )
        throw Error("Causal presentation removal boundary required");
      // This first policy binds the verified shared AI-client constructor used
      // by decoded heroes. Other decoded entity classes retain an explicit gate.
      if (componentClass !== "ai-client")
        return unresolved("visibility:concrete-ai-component-class-unproven");
      const creation = {
        time: creationTime,
        transportSequence: creationTransportSequence,
        entryOrder: creationEntryOrder,
      };
      if (!included(creation, time, cursor))
        return unresolved("visibility:presentation-generation-not-active");
      if (
        removalTime !== undefined &&
        included(
          {
            time: removalTime,
            transportSequence: removalTransportSequence,
            entryOrder: removalEntryOrder,
          },
          time,
          cursor,
        )
      )
        return unresolved("visibility:presentation-generation-not-active");
      let state = initialVisibilityComponentState();
      let seed = null;
      for (const candidate of seeds.get(presentationHandle) ?? []) {
        if (!included(candidate, time, cursor)) break;
        if (candidate.entityId !== entityId)
          throw Error(
            "Visibility seed presentation handle references another entity",
          );
        if (compare(candidate, creation) >= 0) seed = candidate;
      }
      if (seed) state = { ...seed.state };
      const sourceEventIds = [],
        ignoredBeforeGeneration = [],
        ignoredSnapshotEventIds = [],
        ignoredBeforeSeed = [],
        initialRestorePrefixEvents = [],
        ignoredSnapshotReasons = [];
      for (const event of tracks.get(entityId) ?? []) {
        if (!included(event, time, cursor)) break;
        if (event.stream === 2) {
          const reason =
            initialRestorePolicy === null
              ? "visibility:initial-prefix-restore-policy-not-selected"
              : initialVisibilityPrefixEligibility(registration, event);
          if (reason === null && (!seed || compare(event, seed) > 0)) {
            state = applyVisibilityComponentEvent(state, event, 3);
            sourceEventIds.push(event.id);
            initialRestorePrefixEvents.push({
              id: event.id,
              entityId,
              presentationHandle,
              transportSequence: event.transportSequence,
              entryOrder: event.entryOrder,
              chunkId: event.chunkId,
              time: event.time,
              provenance:
                "translated-original-component-prefix-before-owner-callback",
            });
            continue;
          }
          ignoredSnapshotEventIds.push(event.id);
          ignoredSnapshotReasons.push({
            id: event.id,
            reason:
              reason ?? "visibility:snapshot-prefix-precedes-explicit-seed",
          });
          continue;
        }
        if (compare(event, creation) < 0) {
          ignoredBeforeGeneration.push(event.id);
          continue;
        }
        if (seed && compare(event, seed) <= 0) {
          ignoredBeforeSeed.push(event.id);
          continue;
        }
        state = applyVisibilityComponentEvent(state, event, 3);
        sourceEventIds.push(event.id);
      }
      return {
        resolved: true,
        policy,
        presentationHandle,
        presentationHandleProvenance: "generated-causal-ai-registration",
        componentClass,
        state,
        nativeVisibilityResult: queryVisibilityComponent(state, {
          mode: 3,
          querySelectedView: true,
          viewFilterEnabled: false,
          selectedViewSlot: null,
          sentinelSlot: null,
        }),
        suppliedViewInputs: {
          mode: 3,
          viewFilterEnabled: false,
          provenance: "declared-native-rofl-disabled-view-presentation-policy",
        },
        sourceEventIds,
        ignoredBeforeGeneration,
        ignoredSnapshotEventIds,
        ignoredBeforeSeed,
        initialRestorePolicy,
        initialRestorePrefixEvents,
        ignoredSnapshotReasons,
        initialRestoreProof: initialRestorePrefixEvents.length
          ? INITIAL_VISIBILITY_PREFIX_PROOF
          : null,
        componentSeed: seed
          ? {
              id: seed.id,
              provenance: seed.provenance,
              evidenceSha256: seed.evidenceSha256,
              sourceEventIds: [...seed.sourceEventIds],
            }
          : null,
        nativeAcceptedInternalId: null,
        nativeAcceptance: null,
        reasons: [],
        omissions: [...VISIBILITY_POLICY_OMISSIONS],
        complete: null,
      };
    },
  });
}
