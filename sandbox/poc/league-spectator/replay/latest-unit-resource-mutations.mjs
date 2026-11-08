import { sha256 } from "./structural-comparison.mjs";

export const UNIT_RESOURCE_MUTATIONS_SHA =
  "e853e6d446ca861ed34df0a03e7640b21f60dfdc638ddc541205d3e5da810613";
const uint = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const ordinal = (value) => Number.isSafeInteger(value) && value >= 0;
const token = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9:/_.-]{1,256}$/.test(value);
const digest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const copy = (value) => structuredClone(value);
const compare = (a, b) =>
  a.time - b.time ||
  a.transportSequence - b.transportSequence ||
  a.entryOrder - b.entryOrder;
const same = (a, b) => (a === null || b === null ? a === b : a.id === b.id);

function handle(value) {
  if (
    value !== null &&
    (!value || !token(value.id) || !uint(value.contextIdentity))
  )
    throw Error(
      "Explicit stable resolver handle/context identity or null required",
    );
  return value === null
    ? null
    : { id: value.id, contextIdentity: value.contextIdentity };
}
function context(value) {
  if (value !== null && (!value || !token(value.id)))
    throw Error("Explicit typed resource context or null required");
  return value === null
    ? null
    : { id: value.id, resolver: handle(value.resolver) };
}
function vector(values) {
  if (!Array.isArray(values) || values.length > 4096)
    throw Error("Bounded explicit resolver vector required");
  return values.map(handle);
}
function provenance(event) {
  const verified = event?.verification;
  if (
    !event ||
    !token(event.id) ||
    !token(event.sourceEventId) ||
    !uint(event.entityId) ||
    event.entityId === 0 ||
    !Number.isFinite(event.time) ||
    event.time < 0 ||
    !ordinal(event.transportSequence) ||
    !ordinal(event.entryOrder) ||
    !verified ||
    !["explicit-control", "verified-producer"].includes(verified.kind) ||
    !token(verified.producerId) ||
    !digest(verified.evidenceSha256) ||
    event.acceptedByLiveUnit !== (verified.kind === "verified-producer")
  )
    throw Error(
      "Explicit verified resource mutation provenance and causal clock required",
    );
  return {
    id: event.id,
    sourceEventId: event.sourceEventId,
    time: event.time,
    transportSequence: event.transportSequence,
    entryOrder: event.entryOrder,
    acceptedByLiveUnit: event.acceptedByLiveUnit,
    verification: copy(verified),
  };
}
function bind(bindings, handles) {
  const identities = new Map();
  for (const value of [...bindings, ...handles].filter(
    (entry) => entry !== null,
  )) {
    const item = handle(value);
    if (
      identities.has(item.id) &&
      identities.get(item.id).contextIdentity !== item.contextIdentity
    )
      throw Error("Resolver handle identity changed its resource context");
    identities.set(item.id, item);
  }
  if (identities.size > 4096)
    throw Error("Resource handle identity registry exceeds its bound");
  return [...identities.values()];
}

// Pure mutation kernel. Its inputs are explicit verified controls/producers,
// never decoded appearance/form requests. The factory below verifies build data.
export class LatestUnitResourceMutations {
  constructor(contract, metadata = null) {
    if (
      contract?.build !== "16.21.829.8620" ||
      contract.protocol !== "20e09df23c66b85e" ||
      contract.programSha256 !== UNIT_RESOURCE_MUTATIONS_SHA ||
      !digest(contract.decoderImageSha256)
    )
      throw Error("Compatible unit resource mutation contract required");
    this.contract = freeze(copy(contract));
    this.metadata = freeze(copy(metadata));
    Object.freeze(this);
  }

  initialize(input) {
    if (input?.status !== "verified-unit-resource-initial-state")
      throw Error("Explicit verified initial resource state required");
    const lastEvent = provenance(input);
    const ctx = context(input.context),
      base = handle(input.base),
      overlays = vector(input.overlays);
    return freeze({
      status: "verified-unit-resource-state",
      contract: copy(this.contract),
      entityId: input.entityId,
      context: ctx,
      stack: { status: "supplied-resource-stack", base, overlays },
      identityBindings: bind([], [base, ...overlays, ctx?.resolver ?? null]),
      initialEventId: input.id,
      mutationCount: 0,
      lastEvent,
    });
  }

  #validateState(state) {
    if (
      state?.status !== "verified-unit-resource-state" ||
      JSON.stringify(state.contract) !== JSON.stringify(this.contract) ||
      !uint(state.entityId) ||
      state.entityId === 0 ||
      !token(state.initialEventId) ||
      !ordinal(state.mutationCount) ||
      state.stack?.status !== "supplied-resource-stack" ||
      !Array.isArray(state.identityBindings)
    )
      throw Error("Compatible verified resource state required");
    const ctx = context(state.context),
      base = handle(state.stack.base),
      overlays = vector(state.stack.overlays);
    provenance({ ...state.lastEvent, entityId: state.entityId });
    const active = [base, ...overlays, ctx?.resolver ?? null];
    const normalized = bind(state.identityBindings, active);
    if (
      normalized.length !== state.identityBindings.length ||
      new Set(state.identityBindings.map((entry) => entry.id)).size !==
        state.identityBindings.length
    )
      throw Error(
        "Resource state omitted or duplicated an active handle identity",
      );
    return { ctx, base, overlays };
  }

  apply(state, event) {
    const { ctx, base, overlays } = this.#validateState(state);
    if (
      event?.status !== "verified-unit-resource-mutation" ||
      event.entityId !== state.entityId ||
      !["assign-context", "push-overlay", "remove-overlay"].includes(event.kind)
    )
      throw Error("Explicit verified mutation for the same unit required");
    const lastEvent = provenance(event);
    if (
      compare(lastEvent, state.lastEvent) <= 0 ||
      event.id === state.lastEvent.id
    )
      throw Error("Resource mutations must retain strict causal order");
    let nextContext = ctx,
      nextBase = base,
      nextOverlays = overlays,
      incoming = [];
    if (event.kind === "assign-context") {
      nextContext = context(event.context);
      if (nextContext !== null) nextBase = nextContext.resolver;
      incoming = [nextContext?.resolver ?? null];
    } else {
      const next = handle(event.resolver);
      incoming = [next];
      const at = nextOverlays.findIndex((value) => same(value, next));
      if (at >= 0) nextOverlays.splice(at, 1);
      if (event.kind === "push-overlay") nextOverlays.push(next);
    }
    if (nextOverlays.length > 4096)
      throw Error("Resource overlay vector exceeds its bound");
    return freeze({
      ...copy(state),
      context: nextContext,
      stack: {
        status: "supplied-resource-stack",
        base: nextBase,
        overlays: nextOverlays,
      },
      identityBindings: bind(state.identityBindings, incoming),
      mutationCount: state.mutationCount + 1,
      lastEvent,
    });
  }

  checkpoint(state) {
    this.#validateState(state);
    return freeze({
      schema: 1,
      contract: copy(this.contract),
      state: copy(state),
    });
  }

  restore(checkpoint) {
    if (
      checkpoint?.schema !== 1 ||
      JSON.stringify(checkpoint.contract) !== JSON.stringify(this.contract)
    )
      throw Error("Incompatible resource mutation checkpoint");
    this.#validateState(checkpoint.state);
    return freeze(copy(checkpoint.state));
  }

  createTrack({ initialStates, mutations }) {
    if (
      !Array.isArray(initialStates) ||
      !Array.isArray(mutations) ||
      initialStates.length > 4096 ||
      mutations.length > 65536
    )
      throw Error(
        "Bounded explicit initial states and verified mutations required",
      );
    const ids = new Set(),
      states = new Map(),
      groups = new Map(),
      observations = [];
    let globalBindings = [];
    const events = [...initialStates, ...mutations].map(copy).sort(compare);
    for (const event of events) {
      if (ids.has(event.id))
        throw Error("Duplicate resource mutation event identity");
      ids.add(event.id);
      let state;
      if (event.status === "verified-unit-resource-initial-state") {
        if (states.has(event.entityId))
          throw Error("Duplicate initial unit resource state");
        state = this.initialize(event);
      } else {
        if (!states.has(event.entityId))
          throw Error("Resource mutation has no verified initial state");
        state = this.apply(states.get(event.entityId), event);
      }
      globalBindings = bind(globalBindings, state.identityBindings);
      states.set(event.entityId, state);
      if (!groups.has(event.entityId)) groups.set(event.entityId, []);
      groups.get(event.entityId).push(state);
      observations.push(
        freeze({
          entityId: state.entityId,
          time: state.lastEvent.time,
          transportSequence: state.lastEvent.transportSequence,
          entryOrder: state.lastEvent.entryOrder,
          stack: copy(state.stack),
          context: copy(state.context),
          mutationEventId: state.lastEvent.id,
          sourceEventId: state.lastEvent.sourceEventId,
          verification: copy(state.lastEvent.verification),
          acceptedByLiveUnit: state.lastEvent.acceptedByLiveUnit,
        }),
      );
    }
    return Object.freeze({
      resourceTracks: Object.freeze(observations),
      state(entityId, time, cursor = null) {
        if (
          !uint(entityId) ||
          entityId === 0 ||
          !Number.isFinite(time) ||
          time < 0 ||
          (cursor !== null &&
            (!ordinal(cursor.transportSequence) ||
              !ordinal(cursor.entryOrder) ||
              (cursor.exclusive !== undefined &&
                typeof cursor.exclusive !== "boolean")))
        )
          throw Error(
            "Explicit resource state query identity/time/cursor required",
          );
        const list = groups.get(entityId) ?? [];
        let low = 0,
          high = list.length;
        while (low < high) {
          const middle = (low + high) >>> 1,
            point = list[middle].lastEvent;
          const included =
            point.time < time ||
            (point.time === time &&
              (cursor === null ||
                point.transportSequence < cursor.transportSequence ||
                (point.transportSequence === cursor.transportSequence &&
                  (point.entryOrder < cursor.entryOrder ||
                    (!cursor.exclusive &&
                      point.entryOrder === cursor.entryOrder)))));
          if (included) low = middle + 1;
          else high = middle;
        }
        return low ? list[low - 1] : null;
      },
    });
  }
}

export async function createLatestUnitResourceMutations({
  profile,
  image,
  packageBytes,
}) {
  if (
    !(image instanceof Uint8Array) ||
    !(packageBytes instanceof Uint8Array) ||
    (await sha256(packageBytes)) !== UNIT_RESOURCE_MUTATIONS_SHA ||
    (await sha256(image)) !== profile.decoderImageSha256
  )
    throw Error("Pinned unit resource mutation package/image required");
  const metadata = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(packageBytes),
  );
  if (
    metadata.schema !== 1 ||
    metadata.kind !== "prepared-unit-resource-mutations" ||
    metadata.build !== profile.clientVersion ||
    metadata.protocol !== profile.protocolDigest ||
    metadata.decoderImageSha256 !== profile.decoderImageSha256 ||
    !metadata.scope.staticBuildDataOnly ||
    metadata.scope.containsUnitInstances ||
    metadata.scope.containsReplayEvents ||
    metadata.scope.liveProducerAcceptanceVerified ||
    metadata.scope.typedNativeControls !== 11
  )
    throw Error("Unsupported unit resource mutation build/contract");
  for (const block of metadata.sourceBlocks)
    if (
      (await sha256(image.subarray(block.startRva, block.endRva))) !==
      block.sha256
    )
      throw Error("Original resource mutation instructions changed");
  return new LatestUnitResourceMutations(
    {
      build: metadata.build,
      protocol: metadata.protocol,
      decoderImageSha256: metadata.decoderImageSha256,
      programSha256: UNIT_RESOURCE_MUTATIONS_SHA,
    },
    metadata,
  );
}
