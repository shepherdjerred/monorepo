// Original appearance-message arguments. These are requests, not accepted unit
// transitions or a reconstructed live resource stack.
import { sha256 } from "./structural-comparison.mjs";

export const APPEARANCE_STACK_INPUTS_SHA =
  "7af4dbf18eab1d7f20de96ac3efb3ea0a691fef70d32798b545ce565e8d34044";
const uint = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
const freeze = (v) => {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
};
const kinds = { 984: "push", 459: "pop", 1045: "clear", 965: "copy" };

export async function createLatestAppearanceStackInputs({
  profile,
  image,
  packageBytes,
}) {
  if (
    !(image instanceof Uint8Array) ||
    !(packageBytes instanceof Uint8Array) ||
    (await sha256(packageBytes)) !== APPEARANCE_STACK_INPUTS_SHA ||
    (await sha256(image)) !== profile.decoderImageSha256
  )
    throw Error("Pinned appearance input package/image required");
  const utf8 = new TextDecoder("utf-8", { fatal: true }),
    meta = JSON.parse(utf8.decode(packageBytes));
  if (
    meta.schema !== 1 ||
    meta.kind !== "prepared-original-appearance-stack-inputs" ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== meta.build ||
    profile.protocolDigest !== meta.protocol ||
    profile.decoderImageSha256 !== meta.decoderImageSha256 ||
    profile.constructorImageSha256 !== meta.constructorImageSha256 ||
    meta.arenaBase !== 0x10200000 ||
    !meta.scope.staticBuildDataOnly ||
    meta.scope.containsReplayEvents ||
    meta.scope.unitCallbacksExecuted ||
    meta.scope.fullAppearanceTransitionExecuted ||
    meta.scope.liveResourceStackReconstructed ||
    meta.scope.effectFactoryExecuted ||
    meta.scope.mainViewerIntegrated
  )
    throw Error("Unsupported appearance input build/contract");
  for (const [opcode, spec] of Object.entries(meta.packets)) {
    if (
      !kinds[opcode] ||
      profile.packets[opcode]?.entryRva !== spec.decoderRva ||
      profile.packets[opcode]?.objectSize !== spec.objectSize
    )
      throw Error("Appearance packet constructor differs");
    for (const f of Object.values(spec.fields)) {
      if (
        ![1, 4].includes(f.width) ||
        f.offset < 16 ||
        f.offset + f.width > spec.objectSize ||
        f.decode.length !== f.width ||
        f.decode.some(
          (c) =>
            c.length !== 256 ||
            (f.boolean
              ? c.some((v) => typeof v !== "boolean")
              : new Set(c).size !== 256 ||
                c.some((v) => !Number.isInteger(v) || v < 0 || v > 255)),
        )
      )
        throw Error("Invalid original appearance field codec");
    }
  }
  for (const b of meta.sourceBlocks)
    if ((await sha256(image.subarray(b.startRva, b.endRva))) !== b.sha256)
      throw Error("Original appearance instructions changed");
  function read(observation) {
    const object = observation?.object,
      heap = observation?.heap;
    if (
      !observation?.complete ||
      !(object instanceof Uint8Array) ||
      !(heap instanceof Uint8Array) ||
      object.length < 16
    )
      throw Error("Complete original appearance packet required");
    const view = new DataView(
        object.buffer,
        object.byteOffset,
        object.byteLength,
      ),
      opcode = view.getUint32(8, true),
      spec = meta.packets[opcode];
    if (
      !spec ||
      object.length !== spec.objectSize ||
      heap.length < object.length ||
      object.some((v, i) => v !== heap[i])
    )
      throw Error("Appearance packet object/arena differs");
    const result = {
      opcode,
      kind: kinds[opcode],
      entityId: view.getUint32(12, true),
      status: "appearance-stack-request",
      acceptedByLiveUnit: null,
      resourceIdentity: null,
    };
    for (const [name, f] of Object.entries(spec.fields)) {
      let value = f.boolean ? f.decode[0][object[f.offset]] : 0;
      if (!f.boolean)
        for (let i = 0; i < f.width; i++)
          value += f.decode[i][object[f.offset + i]] * 2 ** (8 * i);
      result[name] = value;
    }
    if (opcode === 984) {
      const arena = new DataView(heap.buffer, heap.byteOffset, heap.byteLength);
      function pointerOffset(pointer, length) {
        const offset = pointer - BigInt(meta.arenaBase);
        if (
          offset < 0n ||
          offset > BigInt(heap.length) ||
          offset + BigInt(length) > BigInt(heap.length)
        )
          throw Error("Appearance allocation outside original decoded arena");
        return Number(offset);
      }
      function string(offset) {
        const pointer = arena.getBigUint64(offset, true),
          length = arena.getUint32(offset + 8, true);
        if (length > 4096)
          throw Error("Appearance string exceeds explicit bound");
        let bytes;
        if (
          length === 0 &&
          pointer >= BigInt(profile.imageBase) &&
          pointer < BigInt(profile.imageBase + image.length)
        )
          bytes = image.subarray(
            Number(pointer - BigInt(profile.imageBase)),
            Number(pointer - BigInt(profile.imageBase)) + 1,
          );
        else {
          const p = pointerOffset(pointer, length + 1);
          bytes = heap.subarray(p, p + length + 1);
        }
        if (bytes[length] !== 0 || bytes.subarray(0, length).includes(0))
          throw Error("Appearance string terminator differs");
        return utf8.decode(bytes.subarray(0, length));
      }
      result.strings = Object.fromEntries(
        Object.entries(meta.strings).map(([name, offset]) => [
          name,
          string(offset),
        ]),
      );
      const vector = meta.modifierVector,
        count = view.getUint32(vector.countOffset, true);
      if (count > 256)
        throw Error("Appearance modifier vector exceeds explicit bound");
      const offset = count
        ? pointerOffset(
            view.getBigUint64(vector.pointerOffset, true),
            count * vector.stride,
          )
        : 0;
      result.modifierNames = Array.from({ length: count }, (_, i) =>
        string(offset + i * vector.stride),
      );
    }
    return freeze(result);
  }
  function createTrack(events) {
    if (!Array.isArray(events))
      throw Error("Ordered appearance inputs required");
    const groups = new Map(),
      seen = new Set();
    for (const input of events) {
      const spec = meta.packets[input?.opcode];
      if (
        !spec ||
        input.status !== "appearance-stack-request" ||
        kinds[input.opcode] !== input.kind ||
        !uint(input.entityId) ||
        input.acceptedByLiveUnit !== null ||
        input.resourceIdentity !== null ||
        ![1, 2].includes(input.stream) ||
        !Number.isFinite(input.time) ||
        input.time < 0 ||
        !Number.isSafeInteger(input.transportSequence) ||
        input.transportSequence < 0
      )
        throw Error("Explicit ordered appearance request required");
      for (const [name, field] of Object.entries(spec.fields))
        if (
          field.boolean
            ? typeof input[name] !== "boolean"
            : !uint(input[name]) || input[name] >= 2 ** (field.width * 8)
        )
          throw Error(
            "Appearance request field differs from original argument contract",
          );
      if (
        input.opcode === 984 &&
        (!input.strings ||
          Object.keys(input.strings).length !== 4 ||
          Object.keys(meta.strings).some(
            (name) =>
              typeof input.strings[name] !== "string" ||
              input.strings[name].includes("\0") ||
              new TextEncoder().encode(input.strings[name]).length > 4096,
          ) ||
          !Array.isArray(input.modifierNames) ||
          input.modifierNames.length > 256 ||
          input.modifierNames.some(
            (name) =>
              typeof name !== "string" ||
              name.includes("\0") ||
              new TextEncoder().encode(name).length > 4096,
          ))
      )
        throw Error(
          "Appearance request strings/modifiers differ from original argument contract",
        );
      const sequence = `${input.stream}:${input.transportSequence}`;
      if (seen.has(sequence))
        throw Error("Duplicate appearance transport sequence");
      seen.add(sequence);
      const event = freeze(structuredClone(input)),
        key = `${event.stream}:${event.entityId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(event);
    }
    for (const list of groups.values()) {
      list.sort(
        (a, b) => a.time - b.time || a.transportSequence - b.transportSequence,
      );
      Object.freeze(list);
    }
    return Object.freeze({
      // This exposes request history only. Snapshots stay separate until their
      // restore protocol and native appearance transitions are implemented.
      requestsThrough(entityId, time, stream) {
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
        return Object.freeze(list.slice(0, low));
      },
    });
  }
  return Object.freeze({ metadata: freeze(meta), read, createTrack });
}
