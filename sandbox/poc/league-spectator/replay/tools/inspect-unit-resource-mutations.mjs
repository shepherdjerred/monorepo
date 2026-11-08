import { resolve } from "node:path";
import { createLatestUnitResourceMutations } from "../latest-unit-resource-mutations.mjs";
import { sha256 } from "../structural-comparison.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const root = resolve(import.meta.dir, "..");
const inputs = {};
const raw = async (path) => {
  const bytes = await Bun.file(path).bytes();
  inputs[path] = await sha256(bytes);
  return bytes;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
const packageBytes = await raw(
  `${cache}/public/latest-unit-resource-mutations/package.json`,
);
const kernel = await createLatestUnitResourceMutations({
  profile,
  image,
  packageBytes,
});
const evidencePath = `${cache}/research/resource-stack-producers-native.json`;
const native = await read(evidencePath);
if (
  inputs[evidencePath] !== kernel.metadata.observationSha256 ||
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest ||
  native.decoderImageSha256 !== profile.decoderImageSha256 ||
  native.controls.length !== 11 ||
  !native.scope.originalMutationFunctionsExecuted ||
  native.scope.acceptedReplayState
)
  throw Error("Pinned original typed mutation controls required");
for (const [name, expected] of Object.entries(native.sources))
  if ((await sha256(await raw(resolve(root, "tools", name)))) !== expected)
    throw Error(`Stale native mutation evidence: ${name}`);
for (const block of native.originalBlocks)
  if (
    (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
    block.sha256
  )
    throw Error("Original executed mutation block changed");
for (const name of [
  "latest-unit-resource-mutations.mjs",
  "latest-unit-resource-mutations.test.mjs",
  "structural-comparison.mjs",
  "tools/prepare-unit-resource-mutations.mjs",
  "tools/inspect-unit-resource-mutations.mjs",
])
  await raw(resolve(root, name));
if (
  inputs[resolve(root, "tools/prepare-unit-resource-mutations.mjs")] !==
  kernel.metadata.preparerSha256
)
  throw Error("Mutation package preparer changed");

// Only this comparison maps native control pointers to stable IDs. Neither the
// static package nor ordinary reconstruction imports these supplied instances.
const typed = native.typedInputs;
if (
  typed.emptyResolverObjects.length !== 3 ||
  typed.contexts.length !== 3 ||
  new Set(typed.emptyResolverObjects).size !== 3 ||
  new Set(typed.contexts.map((value) => value.object)).size !== 3
)
  throw Error(
    "Three distinct explicitly constructed native control identities required",
  );
const handles = new Map(
  typed.emptyResolverObjects.map((pointer, index) => [
    pointer,
    {
      id: `control-resolver:${index}`,
      contextIdentity: typed.contexts[index].identity,
    },
  ]),
);
const handle = (pointer) => {
  if (pointer === 0) return null;
  if (!handles.has(pointer))
    throw Error("Native control contains an unknown resolver pointer");
  return handles.get(pointer);
};
const contextResolvers = new Map();
for (const control of native.controls.filter(
  (value) => value.entryRva === 0x548bf0 && value.argument,
)) {
  if (
    control.after.context !== control.argument ||
    contextResolvers.has(control.argument)
  )
    throw Error("Native control context assignment identity differs");
  contextResolvers.set(control.argument, handle(control.after.base));
}
const context = (pointer) => {
  if (pointer === 0) return null;
  const index = typed.contexts.findIndex((value) => value.object === pointer);
  if (index < 0 || !contextResolvers.has(pointer))
    throw Error("Unobserved native control context");
  return {
    id: `control-context:${index}`,
    resolver: contextResolvers.get(pointer),
  };
};
const projected = (state) => ({
  context: state.context,
  base: state.stack.base,
  overlays: state.stack.overlays,
});
const expected = (state) => ({
  context: context(state.context),
  base: handle(state.base),
  overlays: state.overlays.map(handle),
});
const equal = (actual, wanted, label) => {
  if (JSON.stringify(actual) !== JSON.stringify(wanted))
    throw Error(`Native/browser mutation mismatch: ${label}`);
};
const clock = (sequence) => ({
  id: `native-control:${sequence}`,
  sourceEventId: `supplied-control:${sequence}`,
  entityId: 1,
  time: sequence === 0 ? 0 : 1,
  transportSequence: sequence,
  entryOrder: 0,
  acceptedByLiveUnit: false,
  verification: {
    kind: "explicit-control",
    producerId: "original-typed-resource-mutation-control",
    evidenceSha256: inputs[evidencePath],
  },
});
const before = expected(native.controls[0].before);
const initial = {
  ...clock(0),
  status: "verified-unit-resource-initial-state",
  ...before,
};
let state = kernel.initialize(initial);
const events = [],
  snapshots = [state],
  comparisons = [];
for (const [index, control] of native.controls.entries()) {
  equal(projected(state), expected(control.before), `${control.label}:before`);
  const event = {
    ...clock(index + 1),
    status: "verified-unit-resource-mutation",
  };
  if (control.entryRva === 0x548bf0)
    Object.assign(event, {
      kind: "assign-context",
      context: context(control.argument),
    });
  else if (control.entryRva === 0x377390)
    Object.assign(event, {
      kind: "push-overlay",
      resolver: handle(control.argument),
    });
  else if (control.entryRva === 0x3774f0)
    Object.assign(event, {
      kind: "remove-overlay",
      resolver: handle(control.argument),
    });
  else throw Error("Native control used an untranslated mutation");
  state = kernel.apply(state, event);
  equal(projected(state), expected(control.after), `${control.label}:after`);
  equal(
    kernel.restore(JSON.parse(JSON.stringify(kernel.checkpoint(state)))),
    state,
    `${control.label}:checkpoint`,
  );
  events.push(event);
  snapshots.push(state);
  comparisons.push({
    label: control.label,
    entryRva: control.entryRva,
    eventId: event.id,
    state: projected(state),
    matched: true,
  });
}
const track = kernel.createTrack({
  initialStates: [initial],
  mutations: events.toReversed(),
});
let causalQueries = 0;
for (const event of [...events, ...events.toReversed()]) {
  for (const exclusive of [true, false]) {
    equal(
      track.state(1, event.time, {
        transportSequence: event.transportSequence,
        entryOrder: 0,
        exclusive,
      }),
      snapshots[event.transportSequence - Number(exclusive)],
      `${event.id}:seek:${exclusive}`,
    );
    causalQueries++;
  }
}
equal(track.state(1, 0), snapshots[0], "initial-time");
equal(track.state(1, 1), snapshots.at(-1), "latest-time");
// Same label is deliberately supplied here: native pointer identity must remain
// handle identity even if a future accepted producer supplies equal context IDs.
const sameLabelA = { id: "same-label:A", contextIdentity: 100 };
const sameLabelB = { id: "same-label:B", contextIdentity: 100 };
const sameLabel = kernel.apply(
  kernel.initialize({
    ...initial,
    base: sameLabelA,
    overlays: [sameLabelA, sameLabelB],
  }),
  {
    ...clock(1),
    status: "verified-unit-resource-mutation",
    kind: "push-overlay",
    resolver: sameLabelA,
  },
);
equal(
  sameLabel.stack.overlays,
  [sameLabelB, sameLabelA],
  "same-label-distinct-handle",
);
let boundaryRejections = 0;
const changed = packageBytes.slice();
changed[0] ^= 1;
for (const fixture of [
  { profile, image, packageBytes: changed },
  {
    profile: { ...profile, clientVersion: "incompatible" },
    image,
    packageBytes,
  },
  {
    profile: { ...profile, decoderImageSha256: "0".repeat(64) },
    image,
    packageBytes,
  },
]) {
  try {
    await createLatestUnitResourceMutations(fixture);
  } catch {
    boundaryRejections++;
  }
}
if (boundaryRejections !== 3)
  throw Error("Incompatible mutation contract admitted");
for (const [path, expectedHash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== expectedHash)
    throw Error(`Mutation comparison input changed: ${path}`);
const output = `${cache}/research/unit-resource-mutations-comparison.json`;
const counts = {
  originalNativeControls: comparisons.length,
  beforeAfterStateComparisons: comparisons.length * 2,
  checkpointRestores: comparisons.length,
  causalQueries,
  sameLabelDistinctHandleControls: 1,
  boundaryRejections,
};
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      contract: kernel.contract,
      inputs,
      counts,
      comparisons,
      mismatchCount: 0,
      scope: {
        suppliedNativeControlPointersMappedOnlyInComparison: true,
        staticPackageContainsUnitInstances: false,
        browserMutationReducer: true,
        browserCompatibleKernelExecutedInBun: true,
        actualBrowserExecuted: false,
        rawRequestsAcceptedAsMutations: false,
        acceptedLiveProducerVerified: false,
        actualReplayResourceStacksReconstructed: false,
        normalPlaybackIntegrated: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    counts,
    inputFingerprintsVerified: Object.keys(inputs).length,
  }),
);
