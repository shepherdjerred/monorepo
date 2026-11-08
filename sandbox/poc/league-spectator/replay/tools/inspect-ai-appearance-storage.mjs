// Compare browser storage reduction/checkpoint seeking to ordered native unit
// handler prefixes. This does not verify live routes or completed callbacks.
import { resolve } from "node:path";
import {
  createLatestAIAppearanceStorage,
  AI_APPEARANCE_STORAGE_SHA,
} from "../latest-ai-appearance-storage.mjs";
import { createLatestAppearanceResources } from "../latest-appearance-resources.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  inputs = {},
  sha = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  raw = async (path) => {
    const bytes = await Bun.file(path).bytes();
    inputs[path] = sha(bytes);
    return bytes;
  },
  read = async (path) => JSON.parse(new TextDecoder().decode(await raw(path))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`),
  packageBytes = await raw(
    `${cache}/public/latest-ai-appearance-storage/package.json`,
  ),
  native = await read(
    `${cache}/research/ai-appearance-transitions-native.json`,
  ),
  capture = await read(`${cache}/research/appearance-packets.json`),
  reader = await createLatestAIAppearanceStorage({
    profile,
    image,
    packageBytes,
  }),
  resources = await createLatestAppearanceResources({
    profile,
    image,
    packageBytes: await raw(
      `${cache}/public/latest-appearance-resources/package.json`,
    ),
  });
check(
  native.completeControls &&
    native.boundaries.length === 0 &&
    sha(packageBytes) === AI_APPEARANCE_STORAGE_SHA,
  "Completed scoped original AI storage evidence required",
);
check(
  sha(await raw(`${root}/tools/prepare-ai-appearance-storage.mjs`)) ===
    reader.metadata.producerSha256,
  "Static AI storage contract producer changed",
);
for (const [path, digest] of Object.entries(native.inputs))
  check(sha(await raw(path)) === digest, "Original AI storage input changed");
for (const [name, digest] of Object.entries(native.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === digest,
    "Original AI storage source changed",
  );
for (const b of native.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Executed AI storage instructions changed",
  );
const defaults = native.defaultInputs.map((hero) => ({
    entityId: hero.entityId,
    defaultKey: {
      name: hero.champion,
      namespace: "",
      skinId: hero.skinId,
      keyFlags: 0,
    },
  })),
  preparedCache = native.preparedCache.map((entry) => ({
    handleId: String(entry.object),
    key: Object.fromEntries(
      ["name", "namespace", "skinId", "keyFlags"].map((k) => [k, entry[k]]),
    ),
    contextIdentity: null,
  })),
  events = capture.records.filter(
    (e) =>
      Object.hasOwn(native.units, e.entityId) &&
      e.stream === 1 &&
      [984, 459, 1045].includes(e.opcode),
  ),
  states = new Map(),
  counts = {
    initialStates: 0,
    orderedOperations: 0,
    syntheticStorageControls: 0,
    resourceChannels: 0,
    seekQueries: 0,
    maxTailReplay: 0,
    boundaryRejections: 0,
    immutableInputs: 0,
  },
  structural = (state) => ({
    localPlayer: state.localPlayer,
    defaultEntry: state.defaultEntry,
    entries: state.entries,
  }),
  canonical = (value) =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((k) => [k, canonical(value[k])]),
          )
        : value,
  same = (a, b) =>
    JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
for (const input of defaults) {
  const state = reader.createSuppliedState(input);
  check(
    same(structural(state), native.initialStates[input.entityId]),
    "Original/JS initial AI storage differs",
  );
  states.set(input.entityId, state);
  counts.initialStates++;
}
check(
  events.length === native.records.length,
  "AI storage comparison omitted native events",
);
for (const [index, event] of events.entries()) {
  const reference = native.records[index],
    supplied = states.get(event.entityId),
    before = JSON.stringify({ supplied, event }),
    state = reader.applySuppliedState(supplied, event);
  check(
    reference.transportSequence === event.transportSequence &&
      same(structural(state), reference.stack),
    "Ordered original/JS AI storage differs",
  );
  check(
    JSON.stringify({ supplied, event }) === before &&
      Object.isFrozen(state) &&
      Object.isFrozen(state.entries),
    "AI storage input/output ownership differs",
  );
  states.set(event.entityId, state);
  counts.orderedOperations++;
  counts.immutableInputs++;
  const projection = resources.projectSuppliedStack({
      stack: structural(state),
      preparedCache,
    }),
    selected = resources.metadata.channels.map(
      (channel) => projection.channels[channel]?.handleId ?? null,
    );
  check(
    same(
      selected,
      reference.projection.objects.map((value) =>
        value ? String(value) : null,
      ),
    ) && projection.gearIndex === reference.projection.gearIndex,
    "Ordered AI storage resource projection differs",
  );
  counts.resourceChannels += 6;
}
let controlled = reader.createSuppliedState({
  entityId: 1073741887,
  defaultKey: { name: "Viego", namespace: "", skinId: 43, keyFlags: 0 },
});
for (const control of native.controls) {
  const event = {
    ...control.operation,
    entityId: controlled.entityId,
    status: "appearance-stack-request",
    kind: { 984: "push", 459: "pop", 1045: "clear" }[control.operation.opcode],
    acceptedByLiveUnit: null,
    resourceIdentity: null,
  };
  controlled = reader.applySuppliedState(controlled, event);
  check(
    same(structural(controlled), control.stack),
    "Original/JS signed-skin/duplicate-pop storage differs",
  );
  counts.syntheticStorageControls++;
}
const track = reader.createSuppliedTrack({ defaults, events });
for (const record of [...native.records].reverse())
  for (const time of [
    record.time,
    record.time + 0.0001,
    Math.max(0, record.time - 0.0001),
  ]) {
    const prior = native.records
        .filter((r) => r.entityId === record.entityId && r.time <= time)
        .sort(
          (a, b) =>
            a.time - b.time || a.transportSequence - b.transportSequence,
        ),
      result = track.at(record.entityId, time),
      expected = prior.length
        ? prior[prior.length - 1].stack
        : native.initialStates[record.entityId];
    check(
      same(structural(result.state), expected) &&
        result.replayedEvents < 16 &&
        result.checkpointEventCount + result.replayedEvents === prior.length,
      "Original/JS checkpoint seek differs",
    );
    counts.seekQueries++;
    counts.maxTailReplay = Math.max(
      counts.maxTailReplay,
      result.replayedEvents,
    );
  }
for (const fn of [
  () => track.at(123, 0),
  () => track.at(defaults[0].entityId, -1),
  () =>
    reader.createSuppliedTrack({ defaults, events: [events[0], events[0]] }),
  () =>
    reader.createSuppliedTrack({
      defaults,
      events: [{ ...events[0], stream: 2 }],
    }),
  () =>
    reader.applySuppliedState(states.get(events[0].entityId), {
      ...events[0],
      preloadFlag: true,
    }),
  () =>
    reader.applySuppliedState(states.get(events[0].entityId), {
      ...events[0],
      modifierNames: ["unknown"],
    }),
  () =>
    reader.applySuppliedState(
      {
        ...states.get(events[0].entityId),
        acceptedLiveAppearanceVerified: true,
      },
      events[0],
    ),
]) {
  let rejected = false;
  try {
    fn();
  } catch {
    rejected = true;
  }
  check(rejected, "Unsupported AI storage boundary accepted");
  counts.boundaryRejections++;
}
const bundle = await Bun.build({
  entrypoints: [`${root}/latest-ai-appearance-storage.mjs`],
  target: "browser",
  write: false,
});
check(bundle.success, "Browser AI storage module failed to bundle");
await Bun.write(
  `${cache}/research/ai-appearance-storage-comparison.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "ai-appearance-storage-native-js-comparison",
      inputs,
      sources: Object.fromEntries(
        await Promise.all(
          [
            "latest-ai-appearance-storage.mjs",
            "tools/inspect-ai-appearance-storage.mjs",
          ].map(async (path) => [
            path,
            sha(await Bun.file(`${root}/${path}`).bytes()),
          ]),
        ),
      ),
      counts,
      mismatchCount: 0,
      unresolvedTargets: native.unresolved,
      scope: {
        browserBundleBuilt: true,
        browserExecuted: false,
        checkpointSeekingVerified: true,
        originalNativeStoragePrefixesCompared: true,
        originalNativeProjectionCompared: true,
        wasmPacketDecoderUsed: true,
        fullUnitHandlersExecutedInWasm: false,
        liveWorldRouteVerified: false,
        acceptedLiveAppearanceRecovered: false,
        assetReadinessVerified: false,
        postProjectionCallbacksExecuted: false,
        mainViewerExpanded: false,
      },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ counts, mismatchCount: 0 }));
