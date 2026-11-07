// Inspect other exact-build replays using the shared transport, original packet
// decoder and startup field reader. This prepares no assets or match traces.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openReplay } from "../transport.mjs";
import { StructuralDecoder } from "../structural-decoder.mjs";
import { createLatestStartupConfig } from "../latest-startup-config.mjs";
import { readLatestReplayStartup } from "../latest-replay-startup.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const [cacheArg, outputArg, ...replayArgs] = process.argv.slice(2);
if (!cacheArg || !outputArg || !replayArgs.length)
  throw Error(
    "Usage: bun inspect-replay-startups.mjs <cache> <output.json> <replay.rofl> [...replays]",
  );
const cache = resolve(cacheArg),
  output = resolve(outputArg),
  paths = replayArgs.map((path) => resolve(path)),
  inputs = {},
  hash = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
if (new Set(paths).size !== paths.length || paths.includes(output))
  throw Error("Distinct replay inputs and a separate report output required");
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = hash(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Startup inspection input changed: ${path}`);
  inputs[path] = digest;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const assets = `${cache}/public`,
  profile = await read(`${assets}/decoder-16.21-macos/profile.json`),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`),
  constructors = await raw(`${assets}/decoder-16.21-macos/constructors.bin`),
  runtimePath = `${assets}/vendor/unicorn_x86_candidate.mjs`,
  runtimeManifest = await read(runtimePath.replace(/\.mjs$/, ".json"));
if (
  hash(image) !== profile.decoderImageSha256 ||
  hash(constructors) !== profile.constructorImageSha256 ||
  hash(await raw(runtimePath)) !== runtimeManifest.sha256
)
  throw Error("Exact original decoder inputs required");
const reader = await createLatestStartupConfig({
  profile,
  image,
  packageBytes: await raw(`${assets}/latest-startup-config/package.json`),
});
const compressionPath = `${assets}/vendor/fzstd.mjs`;
await raw(compressionPath);
const { decompress } = await import(pathToFileURL(compressionPath).href),
  { default: createUnicorn } = await import(pathToFileURL(runtimePath).href),
  decoder = new StructuralDecoder(
    await createUnicorn(),
    profile,
    image,
    constructors,
  ),
  replays = [];
try {
  for (const path of paths) {
    const bytes = await raw(path),
      replay = openReplay(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
      );
    if (
      replay.build !== profile.clientVersion ||
      replay.protocol !== profile.protocolDigest
    )
      throw Error(`Replay does not match the exact decoder build: ${path}`);
    const startup = await readLatestReplayStartup({
      replay,
      decompress,
      decoder,
      reader,
    });
    replays.push({
      path,
      replaySha256: inputs[path],
      build: replay.build,
      protocol: replay.protocol,
      duration: replay.duration,
      roster: replay.roster,
      startup,
    });
  }
} finally {
  decoder.close();
}
if (Object.hasOwn(inputs, output))
  throw Error("Startup report must not overwrite a source input");
for (const [path, expected] of Object.entries(inputs))
  if (hash(await Bun.file(path).bytes()) !== expected)
    throw Error(
      `Startup inspection input changed before report publication: ${path}`,
    );
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "exact-build-multiple-replay-startup-inspection",
      inputs,
      replays,
      scope: {
        sharedTransportAndOriginalPacketDecoder: true,
        originalStartupFieldReader: true,
        gameplayDecoded: false,
        assetCompatibilityEstablished: false,
        effectsRendered: false,
        browserAcceptance: false,
        nativeMatchAcceptance: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    replays: replays.map(({ path, startup, roster }) => ({
      path,
      mapId: startup.configuredMapId,
      mode: startup.mode,
      champions: roster.map((row) => row.champion),
    })),
  }),
);
