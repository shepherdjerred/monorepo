import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compareStructural } from "../structural-comparison.mjs";

const [packagePath, runtimePath, samplesPath, oraclePath, outputPath] =
  process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun tools/verify-structural.mjs <package-dir> <runtime.mjs> <samples.json> <oracle.json> <output.json>",
  );
const { default: createUnicorn } = await import(
  pathToFileURL(resolve(runtimePath))
);
const source = await Bun.file(samplesPath).json();
const samples = source.packets
  ? source
  : {
      build: source.replay.build,
      protocol: source.replay.protocol,
      packets: source.packetSamples,
    };
const report = await compareStructural({
  uc: await createUnicorn(),
  profile: await Bun.file(resolve(packagePath, "profile.json")).json(),
  image: new Uint8Array(
    await Bun.file(resolve(packagePath, "image.bin")).arrayBuffer(),
  ),
  constructors: new Uint8Array(
    await Bun.file(resolve(packagePath, "constructors.bin")).arrayBuffer(),
  ),
  samples,
  oracle: await Bun.file(oraclePath).json(),
});
await Bun.write(outputPath, JSON.stringify(report, null, 2));
const { results, ...summary } = report;
console.log(JSON.stringify(summary));
// Exit 2 means incomplete coverage; an unexpected disagreement is exit 1.
process.exitCode = report.mismatches ? 1 : report.unresolved ? 2 : 0;
