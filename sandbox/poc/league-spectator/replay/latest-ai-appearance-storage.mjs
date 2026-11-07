// Ordered storage prefixes for supplied cold AI units. The state does not claim
// live entity routing, asset readiness or completed post-projection callbacks.
import { sha256 } from "./structural-comparison.mjs";
export const AI_APPEARANCE_STORAGE_SHA =
  "a56f945c82d29cb2dc4d4c57c5b5838f179d173958fa8fc9c979101c9cc861cb";
const uint = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
const freeze = (v) => {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
};
const kinds = { 984: "push", 459: "pop", 1045: "clear" };

export async function createLatestAIAppearanceStorage({
  profile,
  image,
  packageBytes,
}) {
  if (
    !(image instanceof Uint8Array) ||
    !(packageBytes instanceof Uint8Array) ||
    (await sha256(packageBytes)) !== AI_APPEARANCE_STORAGE_SHA ||
    (await sha256(image)) !== profile.decoderImageSha256
  )
    throw Error("Pinned AI appearance storage package/image required");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(packageBytes),
  );
  if (
    meta.schema !== 1 ||
    meta.kind !== "prepared-original-ai-appearance-storage" ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== meta.build ||
    profile.protocolDigest !== meta.protocol ||
    profile.decoderImageSha256 !== meta.decoderImageSha256 ||
    profile.constructorImageSha256 !== meta.constructorImageSha256 ||
    !meta.scope.staticBuildDataOnly ||
    meta.scope.containsReplayEvents ||
    meta.scope.liveWorldRouteVerified ||
    meta.scope.acceptedLiveAppearanceRecovered ||
    meta.scope.assetReadinessVerified ||
    meta.scope.postProjectionCallbacksExecuted ||
    meta.scope.mainViewerExpanded ||
    meta.contract.checkpointInterval !== 16
  )
    throw Error("Unsupported AI appearance storage build/contract");
  for (const b of meta.sourceBlocks)
    if ((await sha256(image.subarray(b.startRva, b.endRva))) !== b.sha256)
      throw Error("Original AI appearance storage instructions changed");
  const encoder = new TextEncoder(),
    decoder = new TextDecoder("utf-8", { fatal: true });
  function text(v) {
    if (
      typeof v !== "string" ||
      v.includes("\0") ||
      encoder.encode(v).length > 4096 ||
      decoder.decode(encoder.encode(v)) !== v
    )
      throw Error("Bounded valid appearance string required");
    return v;
  }
  function key(v) {
    if (!v || !uint(v.skinId) || !uint(v.keyFlags))
      throw Error("Explicit appearance key required");
    return {
      name: text(v.name),
      namespace: text(v.namespace),
      skinId: v.skinId,
      keyFlags: v.keyFlags,
    };
  }
  function entry(v) {
    if (
      !v ||
      !Array.isArray(v.flags) ||
      v.flags.length !== 5 ||
      v.flags.some((f) => typeof f !== "boolean") ||
      !Number.isInteger(v.gearIndex) ||
      v.gearIndex < 0 ||
      v.gearIndex > 255 ||
      !uint(v.entryId) ||
      !Number.isInteger(v.overrideMask) ||
      v.overrideMask < 0 ||
      v.overrideMask > 255 ||
      !uint(v.alternateSkinA) ||
      !uint(v.alternateSkinB) ||
      !Array.isArray(v.modifierNames) ||
      v.modifierNames.length ||
      v.alternateCharacterA !== "" ||
      v.alternateCharacterB !== ""
    )
      throw Error("Explicit supported appearance entry required");
    return { ...v, key: key(v.key), flags: [...v.flags], modifierNames: [] };
  }
  function createSuppliedState({ entityId, defaultKey }) {
    if (!uint(entityId)) throw Error("Explicit supplied unit ID required");
    return freeze({
      status: "supplied-ai-appearance-storage",
      entityId,
      localPlayer: "absent",
      defaultEntry: {
        ...structuredClone(meta.defaultEntry),
        key: key(defaultKey),
      },
      entries: [],
      acceptedLiveAppearanceVerified: false,
      postProjectionCallbacksExecuted: false,
    });
  }
  function applySuppliedState(state, event) {
    if (
      state?.status !== "supplied-ai-appearance-storage" ||
      !uint(state.entityId) ||
      state.localPlayer !== "absent" ||
      state.acceptedLiveAppearanceVerified !== false ||
      state.postProjectionCallbacksExecuted !== false ||
      !Array.isArray(state.entries) ||
      event?.status !== "appearance-stack-request" ||
      !kinds[event.opcode] ||
      event.kind !== kinds[event.opcode] ||
      event.entityId !== state.entityId ||
      event.acceptedByLiveUnit !== null ||
      event.resourceIdentity !== null
    )
      throw Error(
        "Supplied AI storage state and matching decoded request required",
      );
    const defaultEntry = entry(state.defaultEntry),
      entries = state.entries.map(entry),
      expectedDefault = {
        ...structuredClone(meta.defaultEntry),
        key: defaultEntry.key,
      };
    if (JSON.stringify(defaultEntry) !== JSON.stringify(expectedDefault)) {
      // Object key order is not a state invariant.
      for (const [name, value] of Object.entries(expectedDefault))
        if (JSON.stringify(defaultEntry[name]) !== JSON.stringify(value))
          throw Error(
            "Supplied default differs from constructor storage contract",
          );
    }
    if (event.opcode === 984) {
      for (const name of [
        "entryId",
        "skinId",
        "alternateSkinA",
        "alternateSkinB",
      ])
        if (!uint(event[name]))
          throw Error("Unsigned decoded appearance scalar required");
      if (
        !Number.isInteger(event.overrideMask) ||
        event.overrideMask < 0 ||
        event.overrideMask > 255 ||
        !Number.isInteger(event.gearIndex) ||
        event.gearIndex < 0 ||
        event.gearIndex > 255 ||
        event.preloadFlag !== false ||
        !Array.isArray(event.modifierNames) ||
        event.modifierNames.length ||
        event.strings?.alternateCharacterA !== "" ||
        event.strings?.alternateCharacterB !== ""
      )
        throw Error(
          "Appearance preload/modifier/alternate inputs remain unresolved",
        );
      const flags = [
        "flagR8",
        "flagR9",
        "flagStack0",
        "flagStack2",
        "flagStack3",
      ].map((name) => event[name]);
      if (flags.some((f) => typeof f !== "boolean"))
        throw Error("Decoded appearance flags required");
      let skin = event.skinId;
      if (skin === 0xffffffff) {
        skin = defaultEntry.key.skinId;
        for (let i = entries.length - 1; i >= 0; i--)
          if (entries[i].overrideMask === 16) {
            skin = entries[i].key.skinId;
            break;
          }
      }
      entries.push({
        key: {
          name: text(event.strings.character),
          namespace: text(event.strings.namespace),
          skinId: skin,
          keyFlags: 0,
        },
        flags,
        gearIndex: event.gearIndex,
        modifierNames: [],
        alternateCharacterA: "",
        alternateCharacterB: "",
        entryId: event.entryId,
        overrideMask: event.overrideMask,
        alternateSkinA:
          event.alternateSkinA === 0xffffffff
            ? defaultEntry.key.skinId
            : event.alternateSkinA,
        alternateSkinB:
          event.alternateSkinB === 0xffffffff
            ? defaultEntry.key.skinId
            : event.alternateSkinB,
      });
    } else if (event.opcode === 459) {
      if (!uint(event.entryId) || typeof event.popFlagR8 !== "boolean")
        throw Error("Decoded pop arguments required");
      const index = entries.findIndex((e) => e.entryId === event.entryId);
      if (index !== -1) entries.splice(index, 1);
    } else {
      if (typeof event.clearFlag !== "boolean")
        throw Error("Decoded clear flag required");
      entries.length = 0;
    }
    return freeze({ ...state, defaultEntry, entries });
  }
  function createSuppliedTrack({ defaults, events }) {
    if (!Array.isArray(defaults) || !Array.isArray(events))
      throw Error("Explicit supplied defaults and ordered inputs required");
    const groups = new Map(),
      seen = new Set(),
      interval = meta.contract.checkpointInterval;
    for (const input of defaults) {
      const state = createSuppliedState(input);
      if (groups.has(state.entityId))
        throw Error("Duplicate supplied default unit");
      groups.set(state.entityId, { events: [], checkpoints: [state] });
    }
    for (const input of events) {
      if (
        !groups.has(input.entityId) ||
        input.stream !== 1 ||
        !Number.isFinite(input.time) ||
        input.time < 0 ||
        !Number.isSafeInteger(input.transportSequence) ||
        input.transportSequence < 0 ||
        seen.has(input.transportSequence)
      )
        throw Error(
          "Explicit target default and unique ordered gameplay input required",
        );
      seen.add(input.transportSequence);
      groups.get(input.entityId).events.push(freeze(structuredClone(input)));
    }
    for (const group of groups.values()) {
      group.events.sort(
        (a, b) => a.time - b.time || a.transportSequence - b.transportSequence,
      );
      let state = group.checkpoints[0];
      for (const [index, event] of group.events.entries()) {
        state = applySuppliedState(state, event);
        if ((index + 1) % interval === 0) group.checkpoints.push(state);
      }
    }
    return Object.freeze({
      at(entityId, time) {
        if (
          !uint(entityId) ||
          !groups.has(entityId) ||
          !Number.isFinite(time) ||
          time < 0
        )
          throw Error("Supplied unit and nonnegative seek time required");
        const group = groups.get(entityId);
        let low = 0,
          high = group.events.length;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if (group.events[mid].time <= time) low = mid + 1;
          else high = mid;
        }
        const start = Math.floor(low / interval) * interval;
        let state = group.checkpoints[start / interval];
        for (let i = start; i < low; i++)
          state = applySuppliedState(state, group.events[i]);
        return freeze({
          state,
          checkpointEventCount: start,
          replayedEvents: low - start,
          eventCount: low,
        });
      },
    });
  }
  return Object.freeze({
    metadata: freeze(meta),
    createSuppliedState,
    applySuppliedState,
    createSuppliedTrack,
  });
}
