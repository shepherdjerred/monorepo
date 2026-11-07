// Original sound enqueue/visual independence evidence; no match playback input.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import {
  normalizeDirectSystemAudio,
  validateDirectSystemAudio,
} from "../latest-direct-effect-audio.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Input drift: ${path}`);
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)));
const native = await read(`${cache}/research/direct-root-audio-native.json`);
if (
  native.kind !== "native-root-audio-parent-differential" ||
  native.build !== "16.21.829.8620" ||
  native.protocol !== "20e09df23c66b85e" ||
  native.boundary ||
  native.cases.length !== 6 ||
  native.scope.audioDeviceActivated !== false ||
  native.scope.soundPlaybackVerified !== false ||
  native.scope.audioQueueConsumptionExecuted !== false ||
  native.scope.originalAudioEnqueueHooksExecutedExplicitly !== true ||
  native.scope.wrapperVisibilityAndAudioAdmissionConditionsRecovered !== false
)
  throw Error("Exact bounded original root sound/parent controls required");
for (const [path, hash] of Object.entries(native.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error(`Stale original input: ${path}`);
for (const [name, hash] of Object.entries(native.sources))
  if ((await sha256(await raw(resolve(import.meta.dir, name)))) !== hash)
    throw Error(`Stale original producer: ${name}`);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`);
if ((await sha256(image)) !== profile.decoderImageSha256)
  throw Error("Exact instruction image required");
for (const block of native.originalBlocks)
  if (
    (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
    block.sha256
  )
    throw Error("Original root sound instruction bytes differ");
for (const [key, offset] of [
  ["soundOnCreateDefault", 0x78],
  ["soundPersistentDefault", 0x98],
])
  if (
    native.typedFields[key]?.offset !== offset ||
    native.typedFields[key]?.type !== 16
  )
    throw Error(
      "Original sound declaration is not the verified String property",
    );
let frames = 0,
  vertices = 0,
  soundEnqueues = 0;
const expected = native.cases[0].frames;
if (expected.length !== 61 || expected.some((f) => f.actors.length !== 11))
  throw Error("Complete eleven-emitter 61-frame parent control required");
for (const c of native.cases) {
  const normalized = normalizeDirectSystemAudio(c.supplied);
  validateDirectSystemAudio(normalized);
  if (
    JSON.stringify(c.frames) !== JSON.stringify(expected) ||
    c.differences.length ||
    c.audioRegistry.count !== 0 ||
    !c.audioService.guardIntact ||
    c.audioService.scope.deviceActivated !== false
  )
    throw Error(
      "Authored audio changed exact particle state/RNG/clocks/geometry or CPU service scope",
    );
  const expectedCalls = [];
  if (c.supplied.soundOnCreateDefault)
    expectedCalls.push([0x173a820, c.supplied.soundOnCreateDefault]);
  if (c.supplied.soundPersistentDefault)
    expectedCalls.push([0x173ab20, c.supplied.soundPersistentDefault]);
  const actualCalls = c.audioCalls.map((a) => [a.rva, a.soundName]);
  if (
    JSON.stringify(expectedCalls.sort()) !== JSON.stringify(actualCalls.sort())
  )
    throw Error("Exact authored enqueue functions/names differ");
  frames += c.frames.length;
  soundEnqueues += actualCalls.length;
  vertices += c.frames.reduce(
    (sum, f) =>
      sum + f.draws.reduce((n, d) => n + d.verticesHex.length / 56, 0),
    0,
  );
}
for (const c of native.inventory) {
  const normalized = normalizeDirectSystemAudio(c.sounds);
  validateDirectSystemAudio(normalized);
  for (const [key, value] of Object.entries(c.sounds))
    if (normalized[key].value !== value || normalized[key].authored !== true)
      throw Error(
        "Authored root sound identity changed in shared metadata translation",
      );
}
for (const name of [
  "inspect-direct-root-audio.mjs",
  "../latest-direct-effect-audio.mjs",
  "../latest-direct-effect-audio.test.mjs",
  "../latest-direct-effect-definition.mjs",
  "../latest-direct-effect-runtime.mjs",
  "../latest-direct-effect-session.mjs",
])
  await raw(resolve(import.meta.dir, name));
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error(`Final source drift: ${path}`);
const output = `${cache}/research/direct-root-audio-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "verified-root-audio-visual-slice-comparison",
      build: native.build,
      protocol: native.protocol,
      inputs,
      mismatches: [],
      counts: {
        cases: native.cases.length,
        frames,
        originalSoundEnqueues: soundEnqueues,
        originalGeometryVerticesCompared: vertices,
        authoredDefinitions: native.inventory.length,
        originalInstructionBlocks: native.originalBlocks.length,
      },
      scope: {
        exactParticleVectorsIncludingPointers: true,
        exactRngClocksAndGeometry: true,
        explicitOriginalAudioEnqueueHooks: true,
        originalCpuAudioService: true,
        wrapperAudioConditionsRecovered: false,
        audioQueueConsumed: false,
        audioDeviceActivated: false,
        soundPlaybackVerified: false,
        actualMatchCoverage: false,
        gpuSubmission: false,
        runtimePlaybackInput: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    frames,
    vertices,
    soundEnqueues,
    authoredDefinitions: native.inventory.length,
    fingerprints: Object.keys(inputs).length,
  }),
);
