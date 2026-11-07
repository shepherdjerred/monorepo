import {
  createLatestAppearanceStackInputs,
  APPEARANCE_STACK_INPUTS_SHA,
} from "./latest-appearance-stack-inputs.mjs";
import {
  createLatestUnitFormInputs,
  UNIT_FORM_INPUTS_SHA,
} from "./latest-unit-form-inputs.mjs";

const opcodes = Object.freeze([984, 459, 1045, 965, 129]);
const kinds = { 984: "push", 459: "pop", 1045: "clear", 965: "copy" };
const uint = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const ordinal = (value) => Number.isSafeInteger(value) && value >= 0;
const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const id = (sequence) => `resource-request:${sequence}:0`;

function validate(event) {
  if (
    !opcodes.includes(event?.opcode) ||
    !uint(event.entityId) ||
    !Number.isFinite(event.time) ||
    event.time < 0 ||
    !ordinal(event.transportSequence) ||
    event.entryOrder !== 0 ||
    ![1, 2].includes(event.stream) ||
    !ordinal(event.chunkId) ||
    !ordinal(event.blockOffset) ||
    event.id !== id(event.transportSequence) ||
    event.origin !== "network" ||
    event.acceptedByLiveUnit !== null ||
    event.resourceIdentity !== null ||
    (event.opcode === 129
      ? event.status !== "unit-form-selection-request" ||
        !Number.isInteger(event.index) ||
        event.index < 0 ||
        event.index > 255 ||
        event.signedIndex !== (event.index << 24) >> 24 ||
        typeof event.nativeFlag !== "boolean"
      : event.status !== "appearance-stack-request" ||
        event.kind !== kinds[event.opcode])
  )
    throw Error(
      "Original resource request identity, provenance and unaccepted status required",
    );
}

// These decoders expose requests only. Producer acceptance and live resource
// mutations remain separate contracts; a successful field decode cannot supply
// a base resolver, gear selection, overlay absence or accepted appearance.
export async function createLatestResourceRequestReader({
  profile,
  image,
  appearancePackageBytes,
  formPackageBytes,
}) {
  const appearance = await createLatestAppearanceStackInputs({
    profile,
    image,
    packageBytes: appearancePackageBytes,
  });
  const forms = await createLatestUnitFormInputs({
    profile,
    image,
    packageBytes: formPackageBytes,
  });
  return Object.freeze({
    opcodes,
    contract: Object.freeze({
      build: profile.clientVersion,
      protocol: profile.protocolDigest,
      decoderImageSha256: profile.decoderImageSha256,
      appearanceStackInputsSha256: APPEARANCE_STACK_INPUTS_SHA,
      unitFormInputsSha256: UNIT_FORM_INPUTS_SHA,
      liveProducerAcceptanceVerified: false,
    }),
    read(packet, observation) {
      if (!opcodes.includes(packet?.opcode)) return null;
      if (packet.entryOrder !== undefined && packet.entryOrder !== 0)
        throw Error(
          "Original scalar resource packet has one entry at order zero",
        );
      const decoded =
        packet.opcode === 129
          ? forms.read(observation)
          : appearance.read(observation);
      if (decoded.entityId !== packet.param)
        throw Error(
          "Resource request entity differs from original packet identity",
        );
      const event = {
        ...structuredClone(decoded),
        opcode: packet.opcode,
        id: id(packet.transportSequence),
        origin: "network",
        time: packet.time,
        transportSequence: packet.transportSequence,
        entryOrder: 0,
        stream: packet.stream,
        chunkId: packet.chunkId,
        blockOffset: packet.blockOffset,
        producerStatus:
          packet.opcode === 965
            ? "copy-producer-unresolved"
            : "live-producer-acceptance-unresolved",
        producerOmissions:
          packet.opcode === 965
            ? ["appearance-copy-source-state-and-unit-callbacks"]
            : ["live-unit-acceptance-and-resource-callbacks"],
      };
      validate(event);
      return freeze(event);
    },
    createTrack(events) {
      if (!Array.isArray(events))
        throw Error("Ordered resource requests required");
      appearance.createTrack(events.filter((event) => event.opcode !== 129));
      forms.createTrack(events.filter((event) => event.opcode === 129));
      return createLatestResourceRequestTrack(events);
    },
  });
}

export function createLatestResourceRequestTrack(events) {
  if (!Array.isArray(events)) throw Error("Ordered resource requests required");
  const identities = new Set();
  const records = events
    .map((event) => {
      validate(event);
      if (identities.has(event.id))
        throw Error("Duplicate original resource request identity");
      identities.add(event.id);
      return freeze(structuredClone(event));
    })
    .sort(
      (a, b) =>
        a.time - b.time ||
        a.transportSequence - b.transportSequence ||
        a.entryOrder - b.entryOrder,
    );
  const groups = new Map();
  for (const record of records) {
    const key = `${record.stream}:${record.entityId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return Object.freeze({
    records: Object.freeze(records),
    scope: Object.freeze({
      acceptedMutations: false,
      liveResourceStacks: false,
    }),
    // Snapshots remain isolated from gameplay until their native restore and
    // producer acceptance protocol is established.
    requests(entityId, time, stream, cursor = null) {
      if (
        !uint(entityId) ||
        !Number.isFinite(time) ||
        time < 0 ||
        ![1, 2].includes(stream) ||
        (cursor !== null &&
          (!ordinal(cursor.transportSequence) ||
            !ordinal(cursor.entryOrder) ||
            (cursor.exclusive !== undefined &&
              typeof cursor.exclusive !== "boolean")))
      )
        throw Error(
          "Resource query requires an entity, replay time, stream and explicit causal cursor",
        );
      const before = (event) =>
        event.time < time ||
        (event.time === time &&
          (cursor === null ||
            event.transportSequence < cursor.transportSequence ||
            (event.transportSequence === cursor.transportSequence &&
              (event.entryOrder < cursor.entryOrder ||
                (!cursor.exclusive &&
                  event.entryOrder === cursor.entryOrder)))));
      const list = groups.get(`${stream}:${entityId}`) ?? [];
      let low = 0,
        high = list.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (before(list[middle])) low = middle + 1;
        else high = middle;
      }
      return Object.freeze(list.slice(0, low));
    },
  });
}
