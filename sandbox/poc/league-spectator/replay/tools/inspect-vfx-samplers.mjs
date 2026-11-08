import { resolve } from "node:path";
import { createLatestVfxSamplers } from "../latest-vfx-samplers.mjs";

const [packagePath, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error("Usage: bun inspect-vfx-samplers.mjs <decoder> <comparison>");
const root = resolve(packagePath),
  hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
const profile = await Bun.file(`${root}/profile.json`).json(),
  bytes = await Bun.file(`${root}/vfx-samplers.json`).arrayBuffer();
const meta = JSON.parse(new TextDecoder().decode(bytes));
if (
  hash(bytes) !== profile.vfxSamplersSha256 ||
  meta.decoderImageSha256 !== profile.decoderImageSha256
)
  throw Error("Sampler evidence identity mismatch");
for (const [name, digest] of Object.entries(meta.compilerSources))
  if (
    hash(await Bun.file(new URL(name, import.meta.url)).arrayBuffer()) !==
    digest
  )
    throw Error(`Stale sampler compiler ${name}`);
const sampler = createLatestVfxSamplers(meta),
  mismatches = [];
for (const sample of meta.nativeCases) {
  const actual = sampler.describe(
    {
      texAddressModeBase: sample.base,
      isTexturePixelated: sample.pixelated,
      textureMult: {
        __type: "VfxTextureMultDefinitionData",
        texAddressModeMult: sample.mult,
      },
    },
    sample.layer,
  );
  if (
    actual.descriptorHex !== sample.descriptorHex ||
    actual.engine !== sample.engineAddress ||
    actual.metal !== sample.metalAddress
  )
    mismatches.push({ sample, actual });
}
const result = {
  schema: 1,
  build: meta.build,
  protocol: meta.protocol,
  definitionSha256: hash(bytes),
  moduleSha256: hash(
    await Bun.file(
      new URL("../latest-vfx-samplers.mjs", import.meta.url),
    ).arrayBuffer(),
  ),
  inspectorSha256: hash(await Bun.file(import.meta.path).arrayBuffer()),
  nativeCases: meta.nativeCases.length,
  originalBlocks: meta.executedOriginalBlocks.length,
  modes: meta.addressModes,
  appleSource: meta.appleSource,
  mismatches,
  scope: meta.scope,
};
await Bun.write(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(
  JSON.stringify({
    nativeCases: result.nativeCases,
    originalBlocks: result.originalBlocks,
    mismatches: mismatches.length,
  }),
);
if (mismatches.length) throw Error("Native/JavaScript sampler mismatch");
