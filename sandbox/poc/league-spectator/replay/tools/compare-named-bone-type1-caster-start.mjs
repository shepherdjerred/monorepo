import { resolve } from "node:path";
import { initializeNamedBoneTypeOneCasterStart } from "../latest-named-bone-caster-start.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Named start comparison input changed");
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(
    `${cache}/research/named-bone-type1-caster-start-native-v37.json`,
  ),
  source = await read(
    `${cache}/research/named-bone-type1-caster-inputs-v37.json`,
  );
if (
  native.kind !== "original-named-bone-type1-start-supplied-pose-controls" ||
  native.scope.controlledLiveModelQueryBoundaryRva !== 0x118a50 ||
  native.scope.nativeLiveModelLookupExecuted !== false
)
  throw Error("Scoped original named start proof required");
for (const [path, hash] of Object.entries({
  ...native.inputs,
  ...source.inputs,
}))
  if ((await sha256(await raw(path))) !== hash)
    throw Error("Named start proof source changed: " + path);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
for (const block of native.originalBlocks)
  if (
    (await sha256(image.subarray(block.startRva, block.endRva))) !==
    block.sha256
  )
    throw Error("Original named start instructions changed");
const scene = await read(`${cache}/public/latest-scene/manifest.json`),
  bytes = await raw(`${cache}/public/latest-scene/heights.bin`),
  terrain = createLatestTerrain(
    scene,
    new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4),
  );
const cases = [],
  mismatches = [];
let lanes = 0;
for (const control of native.cases) {
  const actual = source.cases.find((row) => row.sequence === control.sequence),
    root = { ...structuredClone(actual.root), position: control.root },
    pose = structuredClone(actual.pose),
    rig = {
      build: source.build,
      protocol: source.protocol,
      actorKey: actual.actorKey,
      rigSha256: actual.rig.rigSha256,
      binding: actual.rig.binding,
    };
  if (control.providerCalls[0].found) {
    pose.attachments[0].position = control.bone;
    const result = initializeNamedBoneTypeOneCasterStart({
      record: control.record,
      settings: control.settings,
      sourceBoneName: actual.sourceBoneName,
      root,
      rig,
      pose,
      terrain,
    });
    const expected = [
        ...control.position,
        control.planeHeightOffset,
        control.attachmentHeightOffset,
      ],
      translated = [
        ...(result.position ?? []),
        result.planeHeightOffset,
        result.attachmentHeightOffset,
      ];
    if (
      !result.resolved ||
      !translated.every((value, index) => Object.is(value, expected[index]))
    )
      mismatches.push({
        sequence: control.sequence,
        label: control.label,
        expected,
        result,
      });
    lanes += 5;
    cases.push({
      sequence: control.sequence,
      label: control.label,
      result,
      expected,
    });
  } else {
    const result = initializeNamedBoneTypeOneCasterStart({
      record: control.record,
      settings: control.settings,
      sourceBoneName: actual.sourceBoneName,
      root,
      rig,
      pose: {
        resolved: false,
        reasons: ["pose:supplied-native-named-key-missing"],
      },
      terrain,
    });
    if (result.resolved || result.position !== null)
      mismatches.push({
        sequence: control.sequence,
        label: control.label,
        result,
      });
    cases.push({
      sequence: control.sequence,
      label: control.label,
      nativeObservedFallback: control.position,
      policyRejectsMissingPose: true,
      result,
    });
  }
}
for (const actual of source.cases.filter((row) => !row.pose.resolved)) {
  const result = initializeNamedBoneTypeOneCasterStart({
    record: actual.record,
    settings: actual.settings,
    sourceBoneName: actual.sourceBoneName,
    root: actual.root,
    rig: {
      build: source.build,
      protocol: source.protocol,
      actorKey: actual.actorKey,
      rigSha256: actual.rig.rigSha256,
      binding: actual.rig.binding,
    },
    pose: actual.pose,
    terrain,
  });
  if (result.resolved || result.position !== null)
    mismatches.push({ sequence: actual.sequence, actualMissingPose: result });
  cases.push({ sequence: actual.sequence, actualMissingPose: true, result });
}
if (cases.length !== 50 || lanes !== 210)
  throw Error("Complete named-bone frontier controls required");
if (
  source.providerResults?.length !== 8 ||
  source.negativeControls?.length !== 7
)
  throw Error(
    "Complete owned named-provider frontier and boundary controls required",
  );
let providerLanes = 0;
for (const { sequence, start } of source.providerResults) {
  const control = native.cases.find(
    (row) => row.sequence === sequence && row.label === "actual-causal-pose",
  );
  if (!control) {
    if (start.resolved || start.position !== null)
      mismatches.push({ sequence, providerAdmittedMissingPose: start });
    continue;
  }
  const expected = [
      ...control.position,
      control.planeHeightOffset,
      control.attachmentHeightOffset,
    ],
    actual = [
      ...(start.position ?? []),
      start.planeHeightOffset,
      start.attachmentHeightOffset,
    ];
  if (
    !start.resolved ||
    actual.length !== expected.length ||
    !actual.every((value, index) => Object.is(value, expected[index]))
  )
    mismatches.push({ sequence, providerNativeMismatch: { actual, expected } });
  providerLanes += 5;
}
if (providerLanes !== 35)
  throw Error(
    "All seven original actual named starts must reach the owned provider",
  );
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error("Named start source changed during capture");
const output = `${cache}/research/named-bone-type1-caster-start-comparison-v37.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "translated-named-bone-type1-start-comparison",
      inputs,
      cases,
      lanesCompared: lanes,
      ownedProviderLanesCompared: providerLanes,
      ownedProviderCases: source.providerResults,
      ownedProviderNegativeControls: source.negativeControls,
      mismatches,
      scope: {
        originalNameHashAndRigLookupVerified: true,
        originalBothHeightOffsetResultsCompared: true,
        liveModelQueryBoundaryControlled: true,
        nativeLiveModelReady: false,
        suppliedWorldPoseOnly: true,
        activeFamilyAdmission: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    cases: cases.length,
    lanesCompared: lanes,
    mismatches: mismatches.length,
  }),
);
if (mismatches.length) throw Error("Named-bone original comparison failed");
