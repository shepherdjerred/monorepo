import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { reconstructLatest } from "../latest-reconstruction.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const [
  cacheArg = ".cache/replay-spike",
  mapElevenReplay = "C:/Users/Jerred/Documents/League of Legends/Replays/NA1-5669251769.rofl",
] = process.argv.slice(2);
const cache = resolve(cacheArg),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Startup input changed: ${path}`);
  inputs[path] = digest;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const baselinePath = `${cache}/research/viewer-root-reconstruction-v35-pre-startup.json`,
  baselineBytes = await raw(baselinePath);
if (
  (await sha256(baselineBytes)) !==
  "ecf27e0bdea9dca4a048d5c46aca7c6c0a1401e89bb8c9c59f436877f581d681"
)
  throw Error("Exact preserved pre-startup report required");
const before = JSON.parse(new TextDecoder().decode(baselineBytes)).report,
  exported = await read(`${cache}/research/viewer-root-reconstruction.json`),
  after = exported.report;
// This is historical semantic equality, not reuse of historical source currentness.
const comparable = structuredClone(after);
delete comparable.startup;
delete comparable.decodedPackets[728];
if (!isDeepStrictEqual(before, comparable))
  throw Error(
    "Ordinary semantics or stream1/2 event identities changed after startup decoding",
  );
if (
  after.startup?.configuredMapId !== 12 ||
  after.startup.mode !== "KIWI" ||
  after.decodedPackets[728] !== 1 ||
  after.startup.source.stream !== 3 ||
  after.startup.source.opcode !== 728 ||
  after.startup.source.time !== 0 ||
  after.startup.source.param !== 0
)
  throw Error("Current ordinary report lacks actual startup provenance");
for (const [path, digest] of Object.entries(exported.inputs))
  if ((await sha256(await raw(path))) !== digest)
    throw Error(`Stale ordinary startup proof input: ${path}`);
const assets = `${cache}/public`,
  decoderRoot = `${assets}/decoder-16.21-macos`,
  runtimePath = `${assets}/vendor/unicorn_x86_candidate.mjs`,
  runtimeManifest = await read(runtimePath.replace(/\.mjs$/, ".json"));
if ((await sha256(await raw(runtimePath))) !== runtimeManifest.sha256)
  throw Error("Original WASM runtime mismatch");
const compressionPath = `${assets}/vendor/fzstd.mjs`;
await raw(compressionPath);
const { default: createUnicorn } = await import(pathToFileURL(runtimePath)),
  { decompress } = await import(pathToFileURL(compressionPath)),
  uc = await createUnicorn(),
  bytes = await raw(mapElevenReplay),
  sceneBytes = await raw(`${assets}/latest-scene/manifest.json`),
  minimalInputs = {
    buffer: bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ),
    decompress,
    uc,
    profile: await read(`${decoderRoot}/profile.json`),
    image: await raw(`${decoderRoot}/image.bin`),
    constructors: await raw(`${decoderRoot}/constructors.bin`),
    fieldCodecBytes: await raw(`${decoderRoot}/field-codecs.json`),
    startupConfigBytes: await raw(
      `${assets}/latest-startup-config/package.json`,
    ),
    worldSceneBytes: sceneBytes,
    endTime: 99,
    deltaMode: "signed8",
  };
const started = performance.now();
let mismatchError = null;
try {
  await reconstructLatest(minimalInputs);
} catch (error) {
  mismatchError = error.message;
}
const mapMismatchRejectionElapsedMs = performance.now() - started;
if (mismatchError !== "Recorded map 11 differs from selected scene map 12")
  throw Error(
    `Actual Map11 replay must reject before missing scene-bound inputs: ${mismatchError}`,
  );
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error(
      `Startup verification input changed before publication: ${path}`,
    );
const result = {
  schema: 1,
  kind: "ordinary-startup-map-integration-control",
  artifactVersion: 35,
  status: "PASS",
  inputs,
  primaryStartup: after.startup,
  historicalBaseline: {
    path: resolve(baselinePath),
    sha256: inputs[resolve(baselinePath)],
    scope:
      "Exact semantic/event comparison; historical source inputs intentionally not called current",
  },
  primarySemanticEquality: {
    exact: true,
    excludedNewFields: ["startup", "decodedPackets.728"],
    streamOneAndTwoEventIdentitiesUnchanged: true,
    allOtherReportFieldsUnchanged: true,
  },
  realMapMismatch: {
    replay: resolve(mapElevenReplay),
    replaySha256: inputs[resolve(mapElevenReplay)],
    recordedMapId: 11,
    selectedSceneMapId: 12,
    error: mismatchError,
    resourceReaderInputsOmitted: true,
    rejectedBeforeSceneBoundReaders: true,
  },
  initializationMeasurement: {
    mapMismatchRejectionElapsedMs,
    boundary:
      "Bun reconstruction entry through package verification and owned startup decoder creation/decode/close; no world readers or per-frame work",
    browserMeasurement: false,
  },
  scope: {
    startupPacketOnly: true,
    mapIdentityVerified: true,
    modeVariantCompatibilityEstablished: false,
    newMapRenderingAdded: false,
    activeMissileEligibilityChanged: false,
    browserAcceptance: false,
  },
};
const output = `${cache}/research/startup-reconstruction-integration-v35.json`;
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    status: result.status,
    primaryStartup: after.startup,
    exactPrimarySemantics: true,
    mismatchError,
    mapMismatchRejectionElapsedMs,
    inputs: Object.keys(inputs).length,
  }),
);
