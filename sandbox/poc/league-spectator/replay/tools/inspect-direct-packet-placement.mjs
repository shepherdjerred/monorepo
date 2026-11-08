import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { NativeDecoder } from "../native-decoder.mjs";
import { createLatestDirectEffectPlacement } from "../latest-direct-effect-placement.mjs";
import { EFFECT_ENTITY_FIELDS } from "../latest-world-presentation.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import {
  ADDITIONAL_AUDIO_ANCHOR_POLICY,
  ADDITIONAL_AUDIO_ANCHOR_BLOCKS,
} from "../latest-additional-audio-anchor.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const inputs = {};
const raw = async (path) => {
  const bytes = await Bun.file(path).bytes();
  const digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Placement verification input changed: ${path}`);
  inputs[path] = digest;
  return bytes;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
let assertions = 0;
const check = (condition, message) => {
  if (!condition) throw Error(message);
  assertions++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
await captureDirectSourceInputs([import.meta.path], raw);
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
check(
  (await sha256(image)) === profile.decoderImageSha256,
  "Original placement image differs",
);
const packageBytes = await raw(
  `${cache}/public/latest-world-descriptor-abi/package.json`,
);
const packageMeta = JSON.parse(new TextDecoder().decode(packageBytes));
const policy = await createLatestDirectEffectPlacement({
  profile,
  packageBytes,
});
const rejects = async (operation) => {
  try {
    await operation();
  } catch {
    return true;
  }
  return false;
};
check(
  await rejects(() =>
    createLatestDirectEffectPlacement({
      profile: { ...profile, clientVersion: "different-build" },
      packageBytes,
    }),
  ),
  "Placement policy accepted an incompatible build",
);
const modifiedPackage = packageBytes.slice();
modifiedPackage[0] ^= 1;
check(
  await rejects(() =>
    createLatestDirectEffectPlacement({
      profile,
      packageBytes: modifiedPackage,
    }),
  ),
  "Placement policy accepted an unpinned static package",
);
const nativePath = `${cache}/research/world-descriptors-native.json`;
const wholeFactory = await read(nativePath);
check(
  inputs[nativePath] === packageMeta.observationSha256,
  "Complete native factory observation differs from the pinned policy",
);
check(
  wholeFactory.counts.returningRoots === 10 &&
    wholeFactory.scope.completeOriginalDescriptorFactory &&
    !wholeFactory.scope.entityBoneAttachments,
  "Complete scoped native factory controls required",
);
for (const block of packageMeta.sourceBlocks)
  check(
    (await sha256(image.subarray(block.rva, block.rva + block.size))) ===
      block.sha256,
    "Original factory instructions differ",
  );
const refs = (descriptor, missing = null) =>
  EFFECT_ENTITY_FIELDS.map((field) => ({
    field,
    entityId: descriptor[field],
    entity:
      descriptor[field] && field !== missing
        ? { entityId: descriptor[field] }
        : null,
    status: !descriptor[field]
      ? "native-null"
      : field === missing
        ? "unresolved"
        : "registered",
  }));
const invoke = (descriptor, missing = null) =>
  policy.resolve({
    event: { descriptor },
    references: refs(descriptor, missing),
  });
const f32 = (bytes, offset, count) =>
  Array.from({ length: count }, (_, lane) =>
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat32(
      offset + lane * 4,
      true,
    ),
  );
const fromHex = (hex) => Uint8Array.from(Buffer.from(hex, "hex"));
const float32Hex = (values) => {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return Buffer.from(bytes).toString("hex");
};
const canonical = (creation) => {
  const bytes = fromHex(creation.descriptorHex);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    ...Object.fromEntries(EFFECT_ENTITY_FIELDS.map((field) => [field, 0])),
    primaryPacketPosition: f32(bytes, 0x54, 3),
    secondaryPacketVector: f32(bytes, 0x60, 3),
    vector6c: f32(bytes, 0x6c, 3),
    coordinateSpace: "native-world",
    packetVectorsResolved: true,
    flags: view.getUint32(0x48, true),
    field8c: view.getUint32(0x8c, true),
    attachmentKey4c: view.getUint32(0x4c, true),
    attachmentKey50: view.getUint32(0x50, true),
    byteFields: { field98: view.getUint8(0x98) },
  };
};
let completeFactoryControls = 0;
for (const sample of wholeFactory.cases) {
  const result = invoke(canonical(sample.creation));
  check(result.resolved, "Complete native provider-free control was omitted");
  const object = fromHex(sample.creation.objectHex);
  const synchronizedObject = fromHex(sample.creation.synchronization.objectHex);
  const parent = fromHex(sample.creation.initialState.parentHex);
  check(
    result.nativeParentFlags ===
      new DataView(
        object.buffer,
        object.byteOffset,
        object.byteLength,
      ).getUint32(0x60, true),
    "Mapped placement flags differ from the original factory object",
  );
  check(
    result.nativeParentFlags ===
      new DataView(
        parent.buffer,
        parent.byteOffset,
        parent.byteLength,
      ).getUint32(0xf8, true),
    "Mapped placement flags differ from original parent propagation",
  );
  check(
    same(result.position, f32(object, 0x8c, 3)),
    "Packet position differs from complete factory object",
  );
  check(
    same(result.position, sample.supplied.position.map(Math.fround)),
    "Native factory changed its supplied packet position",
  );
  for (const [bytes, offset] of [
    [object, 0x120],
    [synchronizedObject, 0x120],
    [parent, 0x1e0],
  ])
    check(
      same(
        result.basis,
        f32(bytes, offset, 16).filter((_, lane) => lane < 12 && lane % 4 !== 3),
      ),
      "Constructor basis differs from native object/parent before or after activation",
    );
  completeFactoryControls++;
}

const directionFactory = await read(
  `${cache}/research/provider-free-direction-native.json`,
);
check(
  directionFactory.kind ===
    "original-provider-free-direction-factory-controls" &&
    directionFactory.build === profile.clientVersion &&
    directionFactory.protocol === profile.protocolDigest &&
    directionFactory.decoderImageSha256 === profile.decoderImageSha256 &&
    directionFactory.scope.completeOriginalDescriptorFactory === true &&
    directionFactory.scope.suppliedDirectionInputOnly === true &&
    directionFactory.scope.originalActivationAndParentSynchronization ===
      true &&
    directionFactory.scope.selectedReplayDefinitionsExecuted === false &&
    directionFactory.scope.nativeMatchAcceptanceEstablished === false &&
    directionFactory.cases.length === 6,
  "Six scoped original provider-free direction factory controls required",
);
for (const [path, expected] of Object.entries(directionFactory.inputs))
  check(
    (await sha256(await raw(path))) === expected,
    "Direction factory input changed",
  );
for (const [path, expected] of Object.entries(directionFactory.sources))
  check(
    (await sha256(await raw(path))) === expected,
    "Direction factory producer changed",
  );
for (const block of directionFactory.originalBlocks)
  check(
    (await sha256(image.subarray(block.rva, block.rva + block.size))) ===
      block.sha256,
    "Direction factory original instructions differ",
  );
let directionFactoryControls = 0;
const directionSources = new Set();
for (const sample of directionFactory.cases) {
  check(
    typeof sample.sourceEventId === "string" &&
      !directionSources.has(sample.sourceEventId) &&
      sample.controlDefinitionId ===
        directionFactory.scope.staticControlDefinition,
    "Unique direction fixture source and explicit static control definition required",
  );
  directionSources.add(sample.sourceEventId);
  const creation = sample.creation;
  const descriptor = canonical(creation);
  const before = fromHex(creation.preEntryDescriptorHex),
    after = fromHex(creation.descriptorHex);
  check(
    before.length === 0xc0 &&
      after.length === 0xc0 &&
      before.slice(0x6c, 0x78).every((value) => value === 0) &&
      same(before.slice(0, 0x6c), after.slice(0, 0x6c)) &&
      same(before.slice(0x78), after.slice(0x78)) &&
      float32Hex(descriptor.vector6c) === float32Hex(sample.direction) &&
      descriptor.vector6c.every(Number.isFinite) &&
      descriptor.vector6c[1] === 0 &&
      descriptor.vector6c.some((value) => value !== 0),
    "Direction control changed more than the exact horizontal descriptor input",
  );
  const result = invoke(descriptor);
  check(
    result.resolved,
    "Native provider-free horizontal direction was omitted",
  );
  const object = fromHex(creation.objectHex);
  check(
    float32Hex(result.position) === float32Hex(f32(object, 0x8c, 3)),
    "Direction factory packet position differs at the float32 boundary",
  );
  for (const [bytes, offset] of [
    [object, 0x120],
    [fromHex(creation.synchronization.objectHex), 0x120],
    [fromHex(creation.initialState.parentHex), 0x1e0],
  ]) {
    check(
      Buffer.from(bytes.slice(offset, offset + 64)).toString("hex") ===
        sample.matrixHex,
      "Direction matrix changed across original object, activation or parent synchronization",
    );
    check(
      float32Hex(result.basis) ===
        float32Hex(
          f32(bytes, offset, 16).filter(
            (_, lane) => lane < 12 && lane % 4 !== 3,
          ),
        ),
      "Horizontal packet basis differs from complete original factory matrix bytes",
    );
  }
  directionFactoryControls++;
}

const additionalVisuals = await read(
  `${cache}/research/additional-provider-visuals-native.json`,
);
check(
  additionalVisuals.kind ===
    "original-auxiliary-provider-visual-independence-control" &&
    additionalVisuals.build === profile.clientVersion &&
    additionalVisuals.protocol === profile.protocolDigest &&
    additionalVisuals.boundary === null &&
    additionalVisuals.cases.length === 2 &&
    additionalVisuals.scope.originalAuxiliarySetterExecuted === true &&
    additionalVisuals.scope.originalVisualSyncSchedulerParticlesAndGeometry ===
      true &&
    additionalVisuals.scope.suppliedUnreadableProviderOnly === true &&
    additionalVisuals.scope.concreteProviderFactoryExecuted === false &&
    additionalVisuals.scope.audioAnchorHooksExecuted === false &&
    additionalVisuals.scope.nativeMatchPlacementOrAcceptanceEstablished ===
      false,
  "Scoped original auxiliary-provider visual controls required",
);
const heroProvider = await read(
  `${cache}/research/hero-root-attachment-native.json`,
);
check(
  heroProvider.kind === "original-concrete-hero-root-attachment-controls" &&
    heroProvider.build === profile.clientVersion &&
    heroProvider.protocol === profile.protocolDigest &&
    heroProvider.decoderImageSha256 === profile.decoderImageSha256 &&
    heroProvider.scope.fullOriginalConcreteHeroConstructor === true &&
    heroProvider.scope.originalSourceProviderFactory === true &&
    heroProvider.scope.matchTransformsRecovered === false &&
    heroProvider.cases.length === 3,
  "Independent original concrete Hero key-zero provider factory required",
);
for (const proof of [additionalVisuals, heroProvider]) {
  check(
    Object.keys(proof.inputs).length > 0 &&
      Object.keys(proof.sources).length > 0,
    "Nonempty auxiliary-provider provenance required",
  );
  for (const [path, expected] of Object.entries(proof.inputs))
    check(
      (await sha256(await raw(path))) === expected,
      "Auxiliary-provider input changed",
    );
  for (const [path, expected] of Object.entries(proof.sources))
    check(
      (await sha256(await raw(path))) === expected,
      "Auxiliary-provider producer changed",
    );
  const blocks = proof.originalBlocks ?? proof.sourceBlocks;
  check(
    blocks.length > 0,
    "Original auxiliary-provider instruction evidence required",
  );
  for (const block of blocks)
    check(
      (await sha256(image.subarray(block.rva, block.rva + block.size))) ===
        block.sha256,
      "Original auxiliary-provider instruction bytes differ",
    );
}
for (const [rva, size, expected] of ADDITIONAL_AUDIO_ANCHOR_BLOCKS)
  check(
    (await sha256(image.subarray(rva, rva + size))) === expected,
    "Auxiliary-anchor policy instruction bytes differ",
  );
const baselineAdditional = additionalVisuals.cases.find(
  (sample) => sample.suppliedAuxiliaryProvider === false,
);
const suppliedAdditional = additionalVisuals.cases.find(
  (sample) => sample.suppliedAuxiliaryProvider === true,
);
check(
  Boolean(baselineAdditional && suppliedAdditional),
  "Both absent and supplied auxiliary-provider variants required",
);
let additionalProviderVisualFrames = 0;
for (const sample of additionalVisuals.cases) {
  check(
    sample.frames.length === 121 &&
      sample.setterOnlyChangedProviderPair === true &&
      sample.providerReadsAndWritesDuringVisuals === 0 &&
      sample.differentFrames.length === 0 &&
      JSON.stringify(sample.frames) ===
        JSON.stringify(baselineAdditional.frames) &&
      sample.frames.some((frame) =>
        frame.draws.some((draw) => draw.indicesHex.length > 0),
      ),
    "Original auxiliary provider changed visual state or was read during the bounded visual control",
  );
  additionalProviderVisualFrames += sample.frames.length;
}

const { default: factory } = await import(
  pathToFileURL(`${cache}/public/vendor/unicorn_x86_candidate.mjs`).href
);
const uc = await factory();
const native = new NativeDecoder(uc, profile, image, { captureWrites: false });
const engine = native.engine;
const base = profile.imageBase;
const FRAME = 0x100f5000,
  DESCRIPTOR = 0x100f6000,
  WRAPPER = 0x100f7000;
const executed = new Set();
const guards = [
  0x83e8d3, 0x83eb0c, 0x83ee36, 0x83ee94, 0x83f096, 0x83f163, 0x83f2e4,
];
let active = false,
  endpoint = 0;
engine.hook_add(
  uc.HOOK_CODE,
  (_engine, address) => {
    if (!active) return;
    const rva = Number(address) - base;
    executed.add(rva);
    if (guards.includes(rva) || rva === endpoint) engine.emu_stop();
  },
  null,
  base,
  base + image.length - 1,
);
function run(start, end) {
  engine.context_restore(native.context);
  engine.reg_write_i64(uc.X86_REG_RSP, 0x201ff008n);
  engine.reg_write_i64(uc.X86_REG_RBP, BigInt(FRAME));
  engine.reg_write_i64(uc.X86_REG_R12, BigInt(WRAPPER));
  endpoint = end;
  active = true;
  try {
    engine.emu_start(base + start, base + end, 0, 10000);
    return Number(engine.reg_read_i64(uc.X86_REG_RIP)) - base;
  } finally {
    active = false;
  }
}
function supply(descriptor) {
  const bytes = new Uint8Array(0xc0);
  const view = new DataView(bytes.buffer);
  for (const [field, offset] of [
    ["resourceContextEntityId", 0x10],
    ["lookup14EntityId", 0x18],
    ["attachmentEntityId", 0x20],
    ["lookupA8EntityId", 0x28],
  ])
    view.setBigUint64(offset, descriptor[field] ? 0x100f9000n : 0n, true);
  view.setUint32(0x48, descriptor.flags, true);
  view.setUint8(0x98, descriptor.byteFields.field98);
  for (const [name, offset] of [
    ["primaryPacketPosition", 0x54],
    ["secondaryPacketVector", 0x60],
    ["vector6c", 0x6c],
  ])
    descriptor[name].forEach((value, lane) =>
      view.setFloat32(offset + lane * 4, value, true),
    );
  engine.mem_write(DESCRIPTOR, bytes);
  engine.mem_write(FRAME - 0x240, new Uint8Array(0x240));
  native.u64(FRAME - 0x58, DESCRIPTOR);
  // The admitted path only reaches the original secondary-position setter.
  // This owned scratch sink is not a constructed or activated VFX wrapper.
  engine.mem_write(WRAPPER, new Uint8Array(0x268).fill(0xa5));
  return bytes;
}
let packetBranchControls = 0;
const compareBranch = (descriptor) => {
  check(
    descriptor.vector6c.every((value) => value === 0),
    "Fragment comparison requires zero direction; nonzero directions use the complete factory proof",
  );
  const result = invoke(descriptor);
  check(result.resolved, "Packet branch fixture was unexpectedly omitted");
  const descriptorBytes = supply(descriptor);
  check(
    run(0x83e8c4, 0x83f2c7) === 0x83f2c7,
    "Native packet branch selected a transform provider or basis writer",
  );
  const wrapper = native.read(WRAPPER, 0x268);
  check(
    same(f32(wrapper, 0x190, 3), result.secondaryPosition),
    "Secondary packet point differs from original factory setter",
  );
  check(
    wrapper[0x1d4] === 1,
    "Original secondary-point activation flag differs",
  );
  for (let index = 0; index < wrapper.length; index++)
    if (!(index >= 0x190 && index < 0x19c) && index !== 0x1d4)
      check(
        wrapper[index] === 0xa5,
        "Packet branch changed another wrapper field",
      );
  check(
    same(native.read(DESCRIPTOR, 0xc0), descriptorBytes),
    "Packet branch changed the original descriptor",
  );
  check(
    run(0x83f2d7, 0x83f33a) === 0x83f33a,
    "Packet branch selected an additional A8 transform provider",
  );
  packetBranchControls++;
};
let fixtureCandidates = 0,
  comparisonCandidates = 0,
  directionalCandidatesExcludedFromFragment = 0;
try {
  for (const sample of wholeFactory.cases)
    compareBranch(canonical(sample.creation));
  const report = await read(`${cache}/research/latest-semantics-effects.json`);
  for (const descriptor of report.effectDescriptors) {
    const result = invoke(descriptor);
    if (!result.resolved) continue;
    if (descriptor.vector6c.some((value) => value !== 0)) {
      directionalCandidatesExcludedFromFragment++;
      continue;
    }
    compareBranch(descriptor);
    fixtureCandidates++;
    if (descriptor.time >= 69 && descriptor.time <= 99) comparisonCandidates++;
  }
  // Zero is a valid authored packet position. Resource identity is retained,
  // and never substituted as a transform for this verified branch.
  const control = {
    ...canonical(wholeFactory.cases[0].creation),
    resourceContextEntityId: 17,
    primaryPacketPosition: [0, 0, 0],
    secondaryPacketVector: [-0, 1.125, -7.5],
  };
  compareBranch(control);
  check(
    same(invoke(control).position, [0, 0, 0]),
    "Literal zero packet position was treated as absent",
  );
  check(
    !invoke(control, "resourceContextEntityId").resolved,
    "Unresolved resource entity became a detached effect",
  );
  check(
    await rejects(() =>
      policy.resolve({
        event: { descriptor: control },
        references: refs(control).slice(0, 3),
      }),
    ),
    "Placement policy accepted incomplete world references",
  );
  const incorrectIdentity = refs(control);
  incorrectIdentity[0].entity.entityId++;
  check(
    await rejects(() =>
      policy.resolve({
        event: { descriptor: control },
        references: incorrectIdentity,
      }),
    ),
    "Placement policy accepted a different resolved world identity",
  );
  check(
    await rejects(() =>
      invoke({ ...control, primaryPacketPosition: [Infinity, 0, 0] }),
    ),
    "Placement policy accepted a nonfinite position",
  );
  check(
    await rejects(() => invoke({ ...control, byteFields: { field98: 256 } })),
    "Placement policy accepted a non-byte provider flag",
  );
  const variants = [
    [{ ...control, attachmentEntityId: 17 }, 0x83e8d3],
    [{ ...control, lookup14EntityId: 17 }, 0x83f096],
    [{ ...control, byteFields: { field98: 1 } }, 0x83eb0c],
    [{ ...control, vector6c: [1, 1, 0] }, 0x83ee36],
    [{ ...control, flags: control.flags | 0x40 }, 0x83ee94],
    [{ ...control, flags: control.flags | 0x1000 }, 0x83f163],
  ];
  for (const [descriptor, expected] of variants) {
    check(
      !invoke(descriptor).resolved,
      "Unverified transform provider or basis branch was admitted",
    );
    supply(descriptor);
    check(
      run(0x83e8c4, 0x83f2c7) === expected,
      "Native unsupported placement branch differs from its omission",
    );
  }
  const additional = { ...control, lookupA8EntityId: 17 };
  check(
    !invoke(additional).resolved,
    "Additional entity provider was admitted",
  );
  supply(additional);
  check(
    run(0x83f2d7, 0x83f33a) === 0x83f2e4,
    "Native additional entity provider branch differs",
  );
  const additionalReferences = refs(additional);
  additionalReferences.find(
    (reference) => reference.field === "lookupA8EntityId",
  ).entity.entityClass = "champion";
  const anchored = policy.resolve({
    event: { descriptor: additional },
    references: additionalReferences,
  });
  check(
    anchored.resolved &&
      anchored.policy === ADDITIONAL_AUDIO_ANCHOR_POLICY &&
      anchored.references === additionalReferences &&
      float32Hex(anchored.position) === float32Hex(invoke(control).position) &&
      float32Hex(anchored.basis) === float32Hex(invoke(control).basis) &&
      anchored.reasons.includes(
        "audio:auxiliary-provider-anchor-getters-omitted",
      ) &&
      anchored.reasons.includes(
        "lifecycle:auxiliary-provider-shared-and-weak-ownership-omitted",
      ),
    "Explicit auxiliary audio policy did not retain packet visuals, identities and omitted side effects",
  );
} finally {
  native.close();
}
const sources = {};
for (const path of [
  import.meta.path,
  resolve(import.meta.dir, "../latest-direct-effect-placement.mjs"),
  resolve(import.meta.dir, "../latest-world-presentation.mjs"),
  resolve(import.meta.dir, "../native-decoder.mjs"),
])
  sources[path] = await sha256(await raw(path));
for (const [path, expected] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== expected)
    throw Error(`Placement verification input changed: ${path}`);
const summary = {
  completeFactoryControls,
  directionFactoryControls,
  additionalProviderVisualFrames,
  packetBranchControls,
  directionalCandidatesExcludedFromFragment,
  fixtureCandidates,
  comparisonCandidates,
  unsupportedBranchControls: 7,
  originalInstructionsObserved: executed.size,
  assertions,
  scope: {
    originalFactoryFragmentsExecuted: true,
    originalSecondaryPointSetterExecuted: true,
    pinnedCompleteFactoryPositionAndBasisCompared: true,
    originalCompleteDirectionFactoryMatricesCompared: true,
    directionControlSelectedReplayDefinitionsExecuted: false,
    auxiliaryAudioAndOwnershipExplicitlyOmitted: true,
    auxiliaryProviderPoseRecovered: false,
    suppliedOpaqueResourcePointersNotLiveEntities: true,
    entityPoseProviderExecuted: false,
    replayWorldInputsResolved: false,
    replayEffectsActivated: false,
    browserExecuted: false,
  },
};
await Bun.write(
  `${cache}/research/direct-packet-placement-comparison.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "original-direct-packet-placement-comparison",
      inputs,
      sources,
      policy: policy.metadata,
      ...summary,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(summary, null, 2));
