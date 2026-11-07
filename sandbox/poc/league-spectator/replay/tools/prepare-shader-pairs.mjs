// Reconstruct every boolean define set that the installed particle TOCs declare.
// This inventories available programs; it does not choose a match emitter's defines.
import { resolve } from "node:path";
const [packageArg, outputArg] = process.argv.slice(2);
if (!packageArg || !outputArg || process.argv.length !== 4)
  throw Error("Usage: prepare-shader-pairs.mjs <shader package> <output>");
const root = resolve(packageArg),
  manifestBytes = new Uint8Array(
    await Bun.file(`${root}/package.json`).arrayBuffer(),
  );
const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
const sha = (data) => new Bun.CryptoHasher("sha256").update(data).digest("hex");
if (
  manifest.schema !== 1 ||
  manifest.kind !== "installed-particle-shader-translations" ||
  manifest.build !== "16.21.829.8620" ||
  manifest.compiler.pipelineVersion !== 4
)
  throw Error("Unsupported shader inventory");
const permutationHash = (defines) =>
  Bun.hash
    .xxHash64(
      defines
        .toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .map((d) => `${d.name}=${d.value}`)
        .join(""),
    )
    .toString(16)
    .padStart(16, "0");
for (const stage of manifest.stages) {
  if (
    stage.baseDefines.length > 16 ||
    stage.baseDefines.some((d) => d.value !== "1")
  )
    throw Error("Shader inventory requires declared boolean defines");
  const hashes = new Set(stage.permutations.map((p) => p.hash));
  if (hashes.size !== stage.permutations.length)
    throw Error("Duplicate shader permutation hash");
  const observed = new Set();
  for (let mask = 0; mask < 2 ** stage.baseDefines.length; mask++) {
    const defs = stage.baseDefines.filter((_, i) => mask & (1 << i));
    const hash = permutationHash(defs);
    if (!hashes.has(hash))
      throw Error(`Missing declared subset: ${stage.file}/${hash}`);
    observed.add(hash);
  }
  if (observed.size !== hashes.size)
    throw Error(`Unresolved permutation: ${stage.file}`);
}
const programs = [],
  groups = [];
for (const pair of manifest.pairs) {
  const vertex = manifest.stages.find((s) => s.file === pair.vertex),
    pixel = manifest.stages.find((s) => s.file === pair.pixel);
  if (!vertex || !pixel) throw Error("Missing shader pair stage");
  const declared = new Map();
  for (const d of [...vertex.baseDefines, ...pixel.baseDefines]) {
    if (declared.has(d.name) && declared.get(d.name).value !== d.value)
      throw Error("Conflicting stage defines");
    declared.set(d.name, d);
  }
  const defs = [...declared.values()].toSorted((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  if (defs.length > 16)
    throw Error("Particle pair exceeds bounded define inventory");
  const byHash = (stage) =>
    new Map(
      stage.permutations.map((p) => [
        p.hash,
        stage.records.find((r) => r.id === p.id),
      ]),
    );
  const vertexRows = byHash(vertex),
    pixelRows = byHash(pixel);
  let count = 0;
  for (let mask = 0; mask < 2 ** defs.length; mask++) {
    const active = defs.filter((_, i) => mask & (1 << i));
    const select = (stage, rows) => {
      const kept = active.filter((d) =>
        stage.baseDefines.some((s) => s.name === d.name && s.value === d.value),
      );
      const record = rows.get(permutationHash(kept));
      if (!record) throw Error("Requested shader subset is absent");
      const translation = manifest.translations.find(
        (t) => t.stage === stage.stage && t.dxbcSha256 === record.dxbcSha256,
      );
      if (!translation) throw Error("Missing shader translation");
      return { id: record.id, ...translation };
    };
    programs.push({
      family: pair.name,
      defines: active.map(({ name, value }) => ({ name, value })),
      vertex: select(vertex, vertexRows),
      pixel: select(pixel, pixelRows),
    });
    count++;
  }
  groups.push({
    name: pair.name,
    programs: count,
    declares: defs.map(({ name, value }) => ({ name, value })),
  });
}
const result = {
  schema: 1,
  build: manifest.build,
  shaderPackageSha256: sha(manifestBytes),
  preparerSha256: sha(await Bun.file(import.meta.path).arrayBuffer()),
  groups,
  programs,
};
await Bun.write(outputArg, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ groups, programs: programs.length }));
