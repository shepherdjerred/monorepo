import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";

const [packagePath, inputPath, oraclePath] = process.argv.slice(2);
if (!oraclePath)
  throw Error(
    "Usage: bun tools/prepare-structural-comparison.mjs <package-dir> <inspection.json> <native-oracle.json>",
  );
const profile = await Bun.file(resolve(packagePath, "profile.json")).json();
const input = await Bun.file(inputPath).json(),
  oracle = await Bun.file(oraclePath).json();
const samples = input.packets
  ? input
  : {
      build: input.replay.build,
      protocol: input.replay.protocol,
      replaySha256: input.replay.sha256,
      packets: input.packetSamples,
    };
if (
  samples.build !== profile.clientVersion ||
  samples.protocol !== profile.protocolDigest ||
  (!input.packets && input.executable.sha256 !== profile.windowsClientSha256) ||
  oracle.decoderImageSha256 !== profile.decoderImageSha256 ||
  oracle.constructorImageSha256 !== profile.constructorImageSha256
)
  throw Error("Comparison package mismatch");
const sampleBytes = new TextEncoder().encode(JSON.stringify(samples));
await Bun.write(resolve(packagePath, "samples.json"), sampleBytes);
await Bun.write(resolve(packagePath, "oracle.json"), JSON.stringify(oracle));
console.log(
  JSON.stringify({
    samples: Object.keys(samples.packets).length,
    samplesSha256: await sha256(sampleBytes),
  }),
);
