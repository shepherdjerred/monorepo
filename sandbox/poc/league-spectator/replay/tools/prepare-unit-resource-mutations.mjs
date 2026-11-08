// Static mutation semantics only; no observed unit pointers or replay events.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const root = resolve(import.meta.dir, "..");
const observationBytes = await Bun.file(
  `${cache}/research/resource-stack-producers-native.json`,
).bytes();
const observation = JSON.parse(new TextDecoder().decode(observationBytes));
const image = await Bun.file(
  `${cache}/public/decoder-16.21-macos/image.bin`,
).bytes();
if (
  observation.build !== "16.21.829.8620" ||
  observation.protocol !== "20e09df23c66b85e" ||
  observation.decoderImageSha256 !== (await sha256(image)) ||
  observation.counts.typedMutationControls !== 11 ||
  !observation.scope.originalMutationFunctionsExecuted ||
  !observation.scope.suppliedTypedEmptyResolvers ||
  observation.scope.acceptedReplayState
)
  throw Error("Original typed mutation controls required");
for (const [name, expected] of Object.entries(observation.sources))
  if (
    (await sha256(await Bun.file(`${root}/tools/${name}`).bytes())) !== expected
  )
    throw Error(`Native mutation producer changed: ${name}`);
for (const block of observation.originalBlocks)
  if (
    (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
    block.sha256
  )
    throw Error("Original executed mutation instructions differ");
const ranges = [
  [0x548bf0, 0x548c2f],
  [0x377380, 0x37738a],
  [0x377390, 0x3774e6],
  [0x3774f0, 0x37754c],
  [0x353f70, 0x353f80],
];
const program = {
  schema: 1,
  kind: "prepared-unit-resource-mutations",
  build: observation.build,
  protocol: observation.protocol,
  decoderImageSha256: observation.decoderImageSha256,
  observationSha256: await sha256(observationBytes),
  preparerSha256: await sha256(await Bun.file(import.meta.path).bytes()),
  operations: {
    assignContext: 0x548bf0,
    setBase: 0x377380,
    pushOverlay: 0x377390,
    removeOverlay: 0x3774f0,
  },
  semantics: {
    identity: "resolver-handle-id",
    nullContext: "retain-prior-base",
    nonnullContext: "replace-base-with-explicit-resolver-including-null",
    contextAssignmentOverlays: "unchanged",
    push: "remove-first-identical-then-append",
    remove: "remove-first-identical",
    nullOverlay: "retained-as-identity",
  },
  sourceBlocks: await Promise.all(
    ranges.map(async ([startRva, endRva]) => ({
      startRva,
      endRva,
      sha256: await sha256(image.subarray(startRva, endRva)),
    })),
  ),
  scope: {
    staticBuildDataOnly: true,
    containsUnitInstances: false,
    containsReplayEvents: false,
    typedNativeControls: 11,
    liveProducerAcceptanceVerified: false,
  },
};
const bytes = new TextEncoder().encode(JSON.stringify(program, null, 2));
const output = `${cache}/public/latest-unit-resource-mutations/package.json`;
await Bun.write(output, bytes);
console.log(
  JSON.stringify({
    output,
    sha256: await sha256(bytes),
    sourceBlocks: ranges.length,
  }),
);
