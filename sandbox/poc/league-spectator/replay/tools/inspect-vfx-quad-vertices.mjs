import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createLatestVfxQuadVertices,
  decodeLatestVfxQuadVertices,
} from "../latest-vfx-quad-vertices.mjs";
const [packagePath, nativePath, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-vfx-quad-vertices.mjs <decoder> <native> <comparison>",
  );
const root = resolve(packagePath),
  vendor = resolve(dirname(root), "vendor"),
  hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
const profile = await Bun.file(`${root}/profile.json`).json(),
  metaBytes = await Bun.file(`${root}/vfx-quad-vertices.json`).arrayBuffer();
const meta = JSON.parse(new TextDecoder().decode(metaBytes)),
  nativeBytes = await Bun.file(nativePath).arrayBuffer(),
  native = JSON.parse(new TextDecoder().decode(nativeBytes));
if (
  hash(metaBytes) !== profile.vfxQuadVerticesSha256 ||
  native.definitionSha256 !== profile.vfxQuadVerticesSha256 ||
  native.decoderImageSha256 !== profile.decoderImageSha256 ||
  hash(await Bun.file(`${vendor}/unicorn_x86_candidate.mjs`).arrayBuffer()) !==
    meta.runtimeSha256
)
  throw Error("Quad evidence identity mismatch");
for (const group of [meta.compilerSources, native.observerSources])
  for (const [name, digest] of Object.entries(group))
    if (
      hash(await Bun.file(new URL(name, import.meta.url)).arrayBuffer()) !==
      digest
    )
      throw Error(`Stale quad source ${name}`);
const { default: createUnicorn } = await import(
  pathToFileURL(`${vendor}/unicorn_x86_candidate.mjs`).href
);
const kernel = await createLatestVfxQuadVertices(
  await createUnicorn(),
  profile,
  new Uint8Array(await Bun.file(`${root}/image.bin`).arrayBuffer()),
  metaBytes,
);
const canonical = (v) =>
  JSON.stringify(v, (_key, item) =>
    Object.is(item, -0) ? "__negative_zero__" : item,
  );
const mismatches = [];
let decodedVertices = 0;
try {
  for (const item of native.cases) {
    const actual = kernel.render(item.input);
    if (canonical(actual) !== canonical(item.output))
      mismatches.push({ id: item.id, expected: item.output, actual });
    decodedVertices += decodeLatestVfxQuadVertices(
      actual,
      item.input.vertexFormat,
    ).vertices.length;
  }
} finally {
  kernel.close();
}
const result = {
  schema: 1,
  build: meta.build,
  protocol: meta.protocol,
  definitionSha256: hash(metaBytes),
  nativeSha256: hash(nativeBytes),
  moduleSha256: hash(
    await Bun.file(
      new URL("../latest-vfx-quad-vertices.mjs", import.meta.url),
    ).arrayBuffer(),
  ),
  inspectorSha256: hash(await Bun.file(import.meta.path).arrayBuffer()),
  ...native.summary,
  decodedVertices,
  originalBlocks: native.originalBlocks.length,
  mismatches,
  scope: meta.scope,
};
await Bun.write(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(
  JSON.stringify({
    ...native.summary,
    decodedVertices,
    originalBlocks: result.originalBlocks,
    mismatches: mismatches.length,
  }),
);
if (mismatches.length) throw Error("Native/WASM quad vertex mismatch");
