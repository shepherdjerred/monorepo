// This links decoded requests to presentation generations, not accepted native
// world entities. A removal's byte selects a native request bit; neither bit is
// an instruction to delete an instance immediately.
export const NETWORK_EFFECT_LIFECYCLE_POLICY =
  "decoded-network-effect-request-generations-v1";

const entityFields = [
  "resourceContextEntityId",
  "lookup14EntityId",
  "attachmentEntityId",
  "lookupA8EntityId",
];
const uint = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const ordinal = (value) => Number.isSafeInteger(value) && value >= 0;
const compare = (a, b) =>
  a.time - b.time ||
  a.transportSequence - b.transportSequence ||
  a.entryOrder - b.entryOrder;
const fail = () => {
  throw Error("Invalid decoded network effect lifecycle input");
};
function validateSource(record, opcode, sequenceField) {
  if (
    !record ||
    record.opcode !== opcode ||
    !uint(record.entityId) ||
    record.entityId === 0 ||
    !uint(record.contextId) ||
    !Number.isFinite(record.time) ||
    record.time < 0 ||
    !ordinal(record.transportSequence) ||
    !ordinal(record[sequenceField]) ||
    !ordinal(record.chunkId) ||
    !ordinal(record.blockOffset) ||
    ![1, 2].includes(record.stream)
  )
    fail();
}
const sourceLocation = (record) => ({
  stream: record.stream,
  chunkId: record.chunkId,
  blockOffset: record.blockOffset,
  contextId: record.contextId,
});

export function linkLatestNetworkEffectLifecycle({
  events,
  creations,
  removals,
}) {
  if (!Array.isArray(events)) fail();
  // Empty supplied diagnostic worlds do not need a replay request ledger.
  if (events.length === 0) {
    if ((creations?.length ?? 0) || (removals?.length ?? 0)) fail();
    return [];
  }
  if (!Array.isArray(creations) || !Array.isArray(removals)) fail();
  const sources = (records, opcode, field) => {
    const map = new Map();
    for (const record of records) {
      validateSource(record, opcode, field);
      if (map.has(record[field])) fail();
      map.set(record[field], record);
    }
    return map;
  };
  const creationSources = sources(creations, 756, "creationSequence"),
    removalSources = sources(removals, 187, "removalSequence"),
    ids = new Set(),
    cursors = new Set(),
    generations = new Map(),
    latest = new Map(),
    ordered = structuredClone(events).sort(compare);
  for (const event of ordered) {
    if (
      !event ||
      event.origin !== "network-effect" ||
      !["create", "omitted", "removal-request"].includes(event.kind) ||
      typeof event.id !== "string" ||
      !event.id ||
      ids.has(event.id) ||
      !uint(event.entityId) ||
      event.entityId === 0 ||
      !Number.isFinite(event.time) ||
      event.time < 0 ||
      !ordinal(event.transportSequence) ||
      !ordinal(event.entryOrder) ||
      [
        "generation",
        "creationInput",
        "removalInput",
        "initialObjectFlags",
        "objectFlags",
        "runtimeParentFlags",
        "parentFlags",
        "retireImmediately",
      ].some((key) => Object.hasOwn(event, key))
    )
      fail();
    ids.add(event.id);
    const cursor = `${event.time}:${event.transportSequence}:${event.entryOrder}`;
    if (cursors.has(cursor)) fail();
    cursors.add(cursor);
    const creation = event.kind !== "removal-request",
      field = creation ? "creationSequence" : "removalSequence",
      map = creation ? creationSources : removalSources,
      record = map.get(event[field]);
    if (
      !record ||
      record.entityId !== event.entityId ||
      record.time !== event.time ||
      record.transportSequence !== event.transportSequence ||
      event.entryOrder !== (creation ? record.creationSequence : 0) ||
      event.id !==
        `${creation ? "network-effect" : "network-removal"}:${event.entityId}:${event[field]}`
    )
      fail();
    map.delete(event[field]);
    if (creation) {
      if (
        !event.descriptor ||
        entityFields.some(
          (key) => !uint(record[key]) || event.descriptor[key] !== record[key],
        )
      )
        fail();
      const generation = (generations.get(event.entityId) ?? 0) + 1;
      generations.set(event.entityId, generation);
      event.generation = generation;
      event.creationInput = {
        policy: NETWORK_EFFECT_LIFECYCLE_POLICY,
        ...sourceLocation(record),
        creationSequence: record.creationSequence,
        nativeWorldLookupAcceptance: null,
      };
      latest.set(event.entityId, {
        sourceEventId: event.id,
        generation,
        entityId: event.entityId,
        time: event.time,
        transportSequence: event.transportSequence,
        entryOrder: event.entryOrder,
        kind: event.kind,
        creationSequence: record.creationSequence,
        ...sourceLocation(record),
        entityReferences: Object.fromEntries(
          entityFields.map((key) => [key, record[key]]),
        ),
      });
    } else {
      if (
        !uint(record.reasonByte) ||
        record.reasonByte > 255 ||
        record.requestedFlagMask !==
          (record.reasonByte === 61 ? 0x800 : 0x10000000) ||
        event.requestedFlags !== record.requestedFlagMask
      )
        fail();
      const targetCreation = structuredClone(
        latest.get(event.entityId) ?? null,
      );
      event.sourceEventId = targetCreation?.sourceEventId ?? null;
      event.generation = targetCreation?.generation ?? null;
      event.removalInput = {
        policy: NETWORK_EFFECT_LIFECYCLE_POLICY,
        ...sourceLocation(record),
        removalSequence: record.removalSequence,
        reasonByte: record.reasonByte,
        requestedFlagMask: record.requestedFlagMask,
        reasonBranch:
          record.reasonByte === 61
            ? "native-request-bit-0x800"
            : "native-request-bit-0x10000000",
        targetCreation,
        targetStatus: targetCreation
          ? "decoded-prior-creation-native-acceptance-unknown"
          : "no-decoded-prior-creation",
        nativeWorldLookupAcceptance: null,
        omissions: [
          "native-world-lookup-and-particle-entity-type-acceptance",
          "post-route-encoded-entity-state-and-world-callback",
        ],
      };
    }
  }
  // Linking a filtered subset could silently reuse an earlier generation.
  if (creationSources.size || removalSources.size) fail();
  return ordered;
}
