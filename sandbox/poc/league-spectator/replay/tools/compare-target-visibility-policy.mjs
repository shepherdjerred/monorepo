import { resolve } from "node:path";
import {
  initialVisibilityComponentState,
  applyVisibilityComponentEvent,
  queryVisibilityComponent,
  decodeVisibilityViewSlot,
  createLatestVisibilityComponentPolicy,
  ROFL_ALL_VISION_POLICY,
} from "../latest-target-visibility-policy.mjs";
import {
  INITIAL_VISIBILITY_PREFIX_POLICY,
  INITIAL_VISIBILITY_PREFIX_PROOF,
} from "../latest-initial-visibility-prefix.mjs";
import { sha256 } from "../structural-comparison.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
const raw = async (path) => {
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Visibility proof input changed: ${path}`);
  inputs[path] = hash;
  return bytes;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const native = await read(
  `${cache}/research/target-visibility-lifecycle-native.json`,
);
if (
  native.build !== "16.21.829.8620" ||
  native.protocol !== "20e09df23c66b85e" ||
  native.kind !== "original-visibility-component-lifecycle-controls" ||
  native.suppliedReplayLaunchControl?.modeValue !== 3 ||
  native.scope.recordedVisibilityRecovered !== false ||
  native.scope.concreteClientOwnerCallbacksExecuted !== false
)
  throw Error(
    "Matching scoped original visibility lifecycle evidence required",
  );
for (const [path, hash] of Object.entries(native.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error(`Native visibility input changed: ${path}`);
for (const [name, hash] of Object.entries(native.sources))
  if ((await sha256(await raw(resolve(import.meta.dir, name)))) !== hash)
    throw Error(`Native visibility producer changed: ${name}`);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
if ((await sha256(image)) !== native.decoderImageSha256)
  throw Error("Native visibility image changed");
for (const block of native.blocks)
  if (
    (await sha256(image.subarray(block.rva, block.rva + block.bytes))) !==
    block.sha256
  )
    throw Error(
      `Original visibility instruction range changed: ${block.label}`,
    );
for (const owner of native.ownerInterfaces)
  if (
    (await sha256(image.subarray(owner.vtableRva, owner.vtableRva + 0x60))) !==
    owner.sha256
  )
    throw Error("Original visibility owner interface changed");
for (const path of [
  import.meta.path,
  resolve(import.meta.dir, "../latest-target-visibility-policy.mjs"),
  resolve(import.meta.dir, "../latest-initial-visibility-prefix.mjs"),
  resolve(import.meta.dir, "../structural-comparison.mjs"),
])
  await raw(path);
const mismatches = [];
const initial = await read(
  `${cache}/research/initial-visibility-prefix-native.json`,
);
if (
  initial.build !== native.build ||
  initial.protocol !== native.protocol ||
  initial.decoderImageSha256 !==
    INITIAL_VISIBILITY_PREFIX_PROOF.decoderImageSha256 ||
  initial.scope.ownerCallbacksExecuted !== false ||
  initial.scope.browserRuntimeStatePackage !== false
)
  throw Error("Scoped original initial component prefix evidence required");
for (const [path, hash] of Object.entries(initial.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error(`Initial visibility native input changed: ${path}`);
for (const [name, hash] of Object.entries(initial.sources))
  if ((await sha256(await raw(resolve(import.meta.dir, name)))) !== hash)
    throw Error(`Initial visibility native producer changed: ${name}`);
if (initial.blocks.length !== INITIAL_VISIBILITY_PREFIX_PROOF.blocks.length)
  throw Error("Initial visibility static proof range count changed");
for (const [index, block] of initial.blocks.entries()) {
  const pinned = INITIAL_VISIBILITY_PREFIX_PROOF.blocks[index];
  if (
    block.rva !== pinned.rva ||
    block.bytes !== pinned.bytes ||
    block.sha256 !== pinned.sha256 ||
    (await sha256(image.subarray(block.rva, block.rva + block.bytes))) !==
      pinned.sha256
  )
    throw Error(
      "Initial visibility pinned static proof differs from original bytes",
    );
}
for (const [index, control] of initial.controls.entries()) {
  const request = {
    ...control,
    id: control.sourceEventId,
    opcode: 822,
    acceptedByLiveUnit: null,
    visible: null,
  };
  const registration = {
    entityId: control.entityId,
    presentationHandle: `comparison-ai:${index}`,
    componentClass: "ai-client",
    creationSourceKind: "hero-creation-candidate",
    creationTime: 0,
    creationStream: 2,
    creationChunkId: control.chunkId,
    creationTransportSequence: 0,
  };
  const policy = createLatestVisibilityComponentPolicy({
    build: initial.build,
    protocol: initial.protocol,
    policy: ROFL_ALL_VISION_POLICY,
    requests: [request],
    initialRestorePolicy: INITIAL_VISIBILITY_PREFIX_POLICY,
  });
  const cursor = {
    transportSequence: control.transportSequence,
    entryOrder: control.entryOrder,
  };
  const before = policy.query(registration, control.time, {
    ...cursor,
    exclusive: true,
  });
  const after = policy.query(registration, control.time, cursor);
  if (
    before.state.initialized !== Boolean(control.beforeInitializedByte) ||
    after.state.initialized !== Boolean(control.afterInitializedByte) ||
    after.initialRestorePrefixEvents[0]?.id !== control.sourceEventId ||
    after.nativeAcceptedInternalId !== null ||
    after.nativeAcceptance !== null
  )
    mismatches.push({ stage: "initial-prefix", index, before, after });
}
let state, previousGroup;
for (const [index, control] of native.controls.entries()) {
  const group = `${control.suppliedModeValue}:${control.originalOverrideSetterExecuted}`;
  if (group !== previousGroup) {
    state = {
      ...initialVisibilityComponentState(),
      override: control.originalOverrideSetterExecuted,
    };
    previousGroup = group;
  }
  if (["primary", "primary-again"].includes(control.action))
    state = applyVisibilityComponentEvent(
      state,
      { opcode: 822 },
      control.suppliedModeValue,
    );
  else if (control.action === "reset")
    state = applyVisibilityComponentEvent(
      state,
      { opcode: 918 },
      control.suppliedModeValue,
    );
  else if (!["constructor-state", "unknown-id"].includes(control.action))
    throw Error("Unrecognized native visibility lifecycle case");
  const result = queryVisibilityComponent(state, {
    mode: control.suppliedModeValue,
    querySelectedView: false,
    viewFilterEnabled: false,
    selectedViewSlot: null,
    sentinelSlot: null,
  });
  if (
    state.initialized !== Boolean(control.byte201) ||
    state.override !== Boolean(control.byte208) ||
    result !== Boolean(control.queryResult)
  )
    mismatches.push({ stage: "lifecycle", index, state, result });
}
for (const [index, control] of native.encodedMaskControls.entries()) {
  if (![0x21b5a0, 0x21b5d0].includes(control.callbackRva))
    throw Error("Unknown native mask callback");
  const result = applyVisibilityComponentEvent(
    { ...initialVisibilityComponentState(), mask: control.initialMask },
    {
      opcode: control.callbackRva === 0x21b5a0 ? 48 : 582,
      encodedViewSlotByte: control.encodedByte10,
    },
    3,
  );
  if (
    decodeVisibilityViewSlot(control.encodedByte10) !==
      control.decodedSlotByte ||
    result.mask !== control.resultMask
  )
    mismatches.push({ stage: "mask", index, result });
}
for (const [index, control] of native.selectedViewQueryControls.entries()) {
  const result = queryVisibilityComponent(
    {
      ...initialVisibilityComponentState(),
      initialized: true,
      mask: control.suppliedMask,
    },
    {
      mode: control.suppliedModeValue,
      querySelectedView: true,
      viewFilterEnabled: Boolean(control.suppliedFilterEnabled),
      selectedViewSlot: control.suppliedSelectedSlot,
      sentinelSlot: control.originalSentinelByte,
    },
  );
  if (result !== Boolean(control.queryResult))
    mismatches.push({ stage: "selected-view", index, result });
}
const report = {
  schema: 1,
  build: native.build,
  protocol: native.protocol,
  inputs,
  kind: "direct-javascript-visibility-component-comparison",
  counts: {
    lifecycle: native.controls.length,
    encodedMasks: native.encodedMaskControls.length,
    selectedViewQueries: native.selectedViewQueryControls.length,
    originalViewProducerControls: native.selectedViewProducerControls.length,
    originalInitialRegisteredComponentPrefixes: initial.controls.length,
  },
  mismatches,
  scope: {
    originalAiBaseCallbacks: "no-ops",
    suppliedNativeControls: true,
    originalReplayLaunchModeObserved: 3,
    actualClientViewSettingRecovered: false,
    originalClientOwnerPayloadCallbacksImplemented: false,
    actualTargetAcceptanceRecovered: false,
    ordinaryPlaybackMotionEligibilityChanged: false,
  },
};
const output = `${cache}/research/target-visibility-policy-comparison.json`;
await Bun.write(output, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    output,
    counts: report.counts,
    mismatches: mismatches.length,
  }),
);
if (mismatches.length) process.exitCode = 1;
