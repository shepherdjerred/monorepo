// Copy only closed, hash-verified shader artifact inputs into a fresh cache.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const [sourceArg, outputArg] = process.argv.slice(2);
if (!sourceArg || !outputArg)
  throw Error(
    "Usage: seed-isolated-shader-cache.mjs <original-cache> <new-cache>",
  );
const source = resolve(sourceArg),
  output = resolve(outputArg);
const relation = relative(source, output);
if (!relation || (!relation.startsWith("..") && !isAbsolute(relation)))
  throw Error(
    "An isolated cache outside the immutable original cache is required",
  );
const sha = (data) => new Bun.CryptoHasher("sha256").update(data).digest("hex");
const inputs = new Map(),
  copied = [];
let authority;
for (const name of ["latest-shaders", "latest-shared-shaders"]) {
  const sourceRoot = resolve(source, "public", name);
  const outputRoot = resolve(output, "public", name);
  if (await Bun.file(resolve(outputRoot, "package.json")).exists())
    throw Error("Isolated shader seed package already exists");
  const raw = await readFile(resolve(sourceRoot, "package.json"));
  const manifest = JSON.parse(raw);
  if (
    manifest.schema !== 1 ||
    manifest.kind !== "installed-particle-shader-translations" ||
    manifest.build !== "16.21.829.8620" ||
    manifest.compiler.pipelineVersion !== 4
  )
    throw Error("Exact original shader seed package required");
  const identity = JSON.stringify([
    manifest.build,
    manifest.compiler,
    manifest.archive,
    manifest.archiveSha256,
    manifest.executableSha256,
  ]);
  if (authority !== undefined && identity !== authority)
    throw Error("Shader seed packages have different build/compiler authority");
  authority = identity;
  const references = new Map();
  for (const entry of manifest.translations) {
    if (
      !/^stages\/[a-f0-9]{64}\.json$/.test(entry.file) ||
      !/^blobs\/[a-f0-9]{64}\.dxbc$/.test(entry.dxbc)
    )
      throw Error("Shader artifact reference escaped its closed package");
    for (const [file, digest, bytes] of [
      [entry.file, entry.sha256, entry.bytes],
      [entry.dxbc, entry.dxbcSha256, entry.dxbcBytes],
    ]) {
      const previous = references.get(file);
      if (previous && (previous.sha256 !== digest || previous.bytes !== bytes))
        throw Error("Conflicting shader artifact references");
      references.set(file, { sha256: digest, bytes });
    }
  }
  await mkdir(outputRoot, { recursive: true });
  for (const [file, expected] of references) {
    const input = resolve(sourceRoot, file),
      target = resolve(outputRoot, file);
    const data = await readFile(input);
    if (sha(data) !== expected.sha256 || data.length !== expected.bytes)
      throw Error("Original shader artifact bytes differ: " + file);
    inputs.set(input, expected.sha256);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, data, { flag: "wx" });
    const actual = await readFile(target);
    if (sha(actual) !== expected.sha256 || actual.length !== expected.bytes)
      throw Error("Isolated shader artifact readback differs");
  }
  const manifestSha256 = sha(raw);
  inputs.set(resolve(sourceRoot, "package.json"), manifestSha256);
  await writeFile(resolve(outputRoot, "package.json"), raw, { flag: "wx" });
  if (
    sha(await readFile(resolve(outputRoot, "package.json"))) !== manifestSha256
  )
    throw Error("Isolated shader package manifest readback differs");
  copied.push({ name, manifestSha256, files: references.size });
}
const vendor = resolve(source, "public/vendor/fzstd.mjs");
const vendorRaw = await readFile(vendor),
  vendorSha256 = sha(vendorRaw);
inputs.set(vendor, vendorSha256);
await mkdir(resolve(output, "public/vendor"), { recursive: true });
await writeFile(resolve(output, "public/vendor/fzstd.mjs"), vendorRaw, {
  flag: "wx",
});
if (
  sha(await readFile(resolve(output, "public/vendor/fzstd.mjs"))) !==
  vendorSha256
)
  throw Error("Isolated decompressor readback differs");
for (const [path, digest] of inputs)
  if (sha(await readFile(path)) !== digest)
    throw Error("Original shader seed changed during copying");
const receipt = {
  schema: 1,
  kind: "isolated-original-shader-cache-seed",
  source,
  output,
  packages: copied,
  vendorSha256,
  inputs: Object.fromEntries(inputs),
};
await writeFile(
  resolve(output, "seed.json"),
  JSON.stringify(receipt, null, 2),
  { flag: "wx" },
);
console.log(JSON.stringify({ output, packages: copied, vendorSha256 }));
