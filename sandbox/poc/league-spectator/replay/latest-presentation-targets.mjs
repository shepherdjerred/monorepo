import { CHAMPION_STATE_SHA } from "./latest-champion-state.mjs";

export const PRESENTATION_TARGET_POLICY =
  "native-rofl-no-local-player-constructor-provider-v1";
export const PRESENTATION_TARGET_ASSUMPTIONS = Object.freeze([
  "target:declared-no-linked-network-owner",
  "target:declared-no-external-character-flags-provider",
  "target:declared-no-local-player-view",
  "target:original-constructor-bypass-flag-clear",
  "target:original-constructor-byte38cd-clear",
]);
export const PRESENTATION_TARGET_OMISSIONS = Object.freeze([
  "target:actual-linked-owner-provider-and-local-player-producers-unrecovered",
  "target:packet733-cross-team-special-state-not-consumed-by-declared-view",
  "target:aim-offset-cache-unrecovered-not-a-motion-endpoint",
  "target:original-engine-acceptance-and-generation-handles-unrecovered",
  "target:snapshot-base-flags-restoration-unimplemented",
]);
const uint = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
const ordinal = (v) => Number.isSafeInteger(v) && v >= 0;
const validTime = (v) => Number.isFinite(v) && v >= 0;
const vector = (v) =>
  Array.isArray(v) &&
  v.length === 3 &&
  v.every((n) => Number.isFinite(n) && Number.isFinite(Math.fround(n)));
const order = (a, b) =>
  a.time - b.time ||
  a.transportSequence - b.transportSequence ||
  (a.entryOrder ?? 0) - (b.entryOrder ?? 0);
const included = (row, time, cursor) =>
  row.time < time ||
  (row.time === time &&
    (!cursor ||
      (cursor.exclusive
        ? order(row, { time, ...cursor }) < 0
        : order(row, { time, ...cursor }) <= 0)));

// Native group4/index0 is the first varuint in this group. Remaining fields
// stay in the ordinary replication record; no alternate wire grammar is used.
export function readPresentationBaseFlags(record) {
  const group = record.groups?.find((g) => g.group === 4);
  if (!group || !(group.mask & 1)) return null;
  if (!uint(group.mask) || !/^(?:[a-f0-9]{2})+$/.test(group.dataHex))
    throw Error("Registered base-flags group bytes required");
  const data = Uint8Array.from(group.dataHex.match(/../g), (v) =>
    parseInt(v, 16),
  );
  let value = 0,
    consumed = 0;
  for (let i = 0; i < 8; i++) {
    if (i >= data.length)
      throw Error("Truncated registered base-flags varuint");
    const b = data[i];
    consumed++;
    if (i < 5) value = (value | ((i === 4 ? b : b & 127) << (i * 7))) >>> 0;
    if (b < 128 || i === 7) break;
  }
  if (group.mask === 1 && consumed !== data.length)
    throw Error("Complete base-flags-only group has unexpected trailing bytes");
  return { value, consumedPrefixBytes: consumed };
}

export function queryConstructorViewTargetPredicate(initialized, flags) {
  if (typeof initialized !== "boolean" || !uint(flags))
    throw Error("Typed constructor-view visibility and base flags required");
  return initialized && !(flags & 0x20000);
}

export function createPresentationTargetPolicy({ report, policy }) {
  if (
    report.build !== "16.21.829.8620" ||
    report.protocol !== "20e09df23c66b85e" ||
    policy !== PRESENTATION_TARGET_POLICY ||
    (report.replicationRecords?.length &&
      report.championStatePackageSha256 !== CHAMPION_STATE_SHA)
  )
    throw Error(
      "Exact pinned constructor-view presentation target policy required",
    );
  const ids = new Set(report.heroes.map((hero) => hero.entityId)),
    tracks = new Map();
  for (const record of report.replicationRecords ?? []) {
    if (!ids.has(record.entityId)) continue;
    const decoded = readPresentationBaseFlags(record);
    if (!decoded) continue;
    if (
      !validTime(record.time) ||
      !ordinal(record.transportSequence) ||
      !ordinal(record.recordIndex) ||
      ![1, 2].includes(record.stream)
    )
      throw Error("Causal raw base-flags replication record required");
    const row = {
      id: `base-flags:${record.transportSequence}:${record.recordIndex}:4:0`,
      entityId: record.entityId,
      time: record.time,
      transportSequence: record.transportSequence,
      entryOrder: record.recordIndex,
      stream: record.stream,
      value: decoded.value,
      group: 4,
      fieldIndex: 0,
      registeredOffset: 0xc50,
    };
    if (!tracks.has(row.entityId)) tracks.set(row.entityId, []);
    tracks.get(row.entityId).push(row);
  }
  for (const track of tracks.values()) {
    track.sort(order);
    for (let i = 1; i < track.length; i++)
      if (order(track[i - 1], track[i]) === 0)
        throw Error("Ambiguous base-flags replication order");
  }
  return Object.freeze({
    policy,
    query({ entity, visibility, presentationTargetId }, time, cursor = null) {
      if (
        !validTime(time) ||
        (cursor !== null &&
          (!ordinal(cursor?.transportSequence) ||
            !ordinal(cursor?.entryOrder) ||
            (cursor.exclusive !== undefined &&
              typeof cursor.exclusive !== "boolean")))
      )
        throw Error("Causal presentation target query required");
      const base = {
        policy,
        nativeAcceptance: null,
        nativeAcceptedInternalId: null,
        assumptions: [...PRESENTATION_TARGET_ASSUMPTIONS],
        omissions: [
          ...PRESENTATION_TARGET_OMISSIONS,
          ...(visibility?.omissions ?? []),
        ],
        complete: null,
      };
      const blocked = (reason) => ({
        ...base,
        resolved: false,
        presentationEligible: null,
        reasons: [reason],
      });
      if (!entity) return blocked("target:no-active-known-presentation-entity");
      if (!visibility?.resolved || visibility.componentClass !== "ai-client")
        return blocked("target:verified-ai-client-component-view-required");
      if (
        !uint(presentationTargetId) ||
        !presentationTargetId ||
        typeof visibility.presentationHandle !== "string" ||
        !ordinal(entity.creationTransportSequence)
      )
        throw Error("Generated causal presentation target handle required");
      const creation = {
        time: entity.creationTime,
        transportSequence: entity.creationTransportSequence,
        entryOrder: entity.creationEntryOrder ?? 0,
      };
      let flags = 0xf;
      const sourceEventIds = [],
        ignoredSnapshotEventIds = [];
      for (const row of tracks.get(entity.entityId) ?? []) {
        if (!included(row, time, cursor)) break;
        if (row.stream === 2) {
          ignoredSnapshotEventIds.push(row.id);
          continue;
        }
        if (order(row, creation) < 0) continue;
        flags = row.value;
        sourceEventIds.push(row.id);
      }
      const predicate = queryConstructorViewTargetPredicate(
        visibility.nativeVisibilityResult,
        flags,
      );
      if (!vector(entity.position))
        return {
          ...blocked("target:actual-world-position-unresolved"),
          presentationEligible: predicate,
          presentationHandle: visibility.presentationHandle,
          presentationTargetId,
          baseFlags: flags,
          sourceEventIds,
          ignoredSnapshotEventIds,
        };
      return {
        ...base,
        resolved: true,
        reasons: [],
        presentationEligible: predicate,
        presentationHandle: visibility.presentationHandle,
        presentationTargetId,
        presentationHandleProvenance:
          "generated-causal-presentation-registration-not-engine-internal-id",
        position: entity.position.map(Math.fround),
        positionStatus: entity.positionStatus,
        lifecycle: entity.lifecycle,
        visible: visibility.nativeVisibilityResult,
        radius: 0,
        radiusProvenance:
          "original-ai-client-and-hero-virtual5c0-d2240-returns-zero",
        aimOffset: null,
        baseFlags: flags,
        baseFlagsProvenance: sourceEventIds.length
          ? "decoded-gameplay-group4-index0"
          : "original-constructor-c50-0x0f",
        sourceEventIds,
        ignoredSnapshotEventIds,
        visibilitySourceEventIds: [...visibility.sourceEventIds],
      };
    },
  });
}
