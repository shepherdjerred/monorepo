// Requests to select an entry in a unit's native model/resource table.
// A request is not proof of acceptance, nor a champion/skin resource identity.
import { sha256 } from "./structural-comparison.mjs";

export const UNIT_FORM_INPUTS_SHA =
  "d99b23c40a4e368c8ed48a211551ed0be34515901020ff8b6e229ef7a392bc21";

const uint = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
const freeze = (v) => {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
};

export async function createLatestUnitFormInputs({
  profile,
  image,
  packageBytes,
}) {
  if (
    !(image instanceof Uint8Array) ||
    !(packageBytes instanceof Uint8Array) ||
    (await sha256(packageBytes)) !== UNIT_FORM_INPUTS_SHA ||
    (await sha256(image)) !== profile.decoderImageSha256
  )
    throw Error("Pinned unit form input package/image required");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(packageBytes),
  );
  if (
    meta.schema !== 1 ||
    meta.kind !== "prepared-original-unit-form-inputs" ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== meta.build ||
    profile.protocolDigest !== meta.protocol ||
    profile.decoderImageSha256 !== meta.decoderImageSha256 ||
    profile.constructorImageSha256 !== meta.constructorImageSha256 ||
    profile.packets[129]?.entryRva !== meta.decoderRva ||
    meta.opcode !== 129 ||
    meta.objectSize !== 20 ||
    meta.indexOffset !== 16 ||
    meta.flagOffset !== 17 ||
    meta.indexInterpretation !== "signed-int8" ||
    !meta.scope.staticBuildDataOnly ||
    meta.scope.containsReplayEvents ||
    meta.scope.fullModelTransitionExecuted ||
    meta.scope.liveFormTablesRecovered ||
    meta.scope.nativeFlagMeaningRecovered ||
    meta.scope.effectFactoryExecuted
  )
    throw Error("Unsupported unit form input build/contract");
  for (const b of meta.sourceBlocks)
    if ((await sha256(image.subarray(b.startRva, b.endRva))) !== b.sha256)
      throw Error("Original unit form instructions changed");
  const indexTable = meta.decode.index,
    flagTable = meta.decode.nativeFlag;
  if (
    indexTable.length !== 256 ||
    new Set(indexTable).size !== 256 ||
    indexTable.some((v) => !Number.isInteger(v) || v < 0 || v > 255) ||
    flagTable.length !== 256 ||
    flagTable.some((v) => typeof v !== "boolean")
  )
    throw Error("Invalid native unit form byte codecs");
  function read(observation) {
    const bytes = observation?.object;
    if (
      !observation?.complete ||
      !(bytes instanceof Uint8Array) ||
      bytes.length !== 20
    )
      throw Error("Complete original unit form packet required");
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (v.getUint32(8, true) !== 129)
      throw Error("Unit form packet opcode differs");
    const index = indexTable[bytes[16]];
    return Object.freeze({
      entityId: v.getUint32(12, true),
      index,
      signedIndex: (index << 24) >> 24,
      nativeFlag: flagTable[bytes[17]],
      status: "unit-form-selection-request",
      acceptedByLiveUnit: null,
      resourceIdentity: null,
    });
  }
  function createTrack(events) {
    if (!Array.isArray(events)) throw Error("Unit form events required");
    const groups = new Map();
    for (const input of events) {
      if (
        input.status !== "unit-form-selection-request" ||
        !uint(input.entityId) ||
        !Number.isInteger(input.index) ||
        input.index < 0 ||
        input.index > 255 ||
        input.signedIndex !== (input.index << 24) >> 24 ||
        typeof input.nativeFlag !== "boolean" ||
        input.acceptedByLiveUnit !== null ||
        input.resourceIdentity !== null ||
        ![1, 2].includes(input.stream) ||
        !Number.isFinite(input.time) ||
        input.time < 0 ||
        !Number.isSafeInteger(input.transportSequence) ||
        input.transportSequence < 0
      )
        throw Error("Explicit ordered unit form request required");
      const event = Object.freeze({ ...input }),
        key = `${event.stream}:${event.entityId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(event);
    }
    for (const list of groups.values()) {
      list.sort(
        (a, b) => a.time - b.time || a.transportSequence - b.transportSequence,
      );
      const seen = new Set();
      for (const event of list) {
        if (seen.has(event.transportSequence))
          throw Error("Duplicate unit form transport sequence");
        seen.add(event.transportSequence);
      }
      Object.freeze(list);
    }
    return Object.freeze({
      // Stream 2 is snapshot input; it must not be merged into stream 1 as a
      // new gameplay transition without the replay snapshot/restore protocol.
      latestRequest(entityId, time, stream) {
        if (
          !uint(entityId) ||
          !Number.isFinite(time) ||
          time < 0 ||
          ![1, 2].includes(stream)
        )
          throw Error(
            "Entity ID, nonnegative time and explicit replay stream required",
          );
        const list = groups.get(`${stream}:${entityId}`) ?? [];
        let low = 0,
          high = list.length;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if (list[mid].time <= time) low = mid + 1;
          else high = mid;
        }
        return low ? list[low - 1] : null;
      },
    });
  }
  return Object.freeze({ metadata: freeze(meta), read, createTrack });
}
