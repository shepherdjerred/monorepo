// Asset and event binding inspection, with no browser or game UI.
import { resolve } from "node:path";
import { bindLatestMissileEffects } from "../latest-effects.mjs";

const [reportPath, scenePath, effectsPath, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-latest-effects.mjs <semantics.json> <scene-dir> <effects-dir> <evidence.json>",
  );
const root = resolve(effectsPath),
  sceneBytes = await Bun.file(
    resolve(scenePath, "manifest.json"),
  ).arrayBuffer(),
  bytes = await Bun.file(`${root}/manifest.json`).arrayBuffer(),
  manifest = JSON.parse(new TextDecoder().decode(bytes)),
  report = await Bun.file(reportPath).json(),
  hash = (value) => new Bun.CryptoHasher("sha256").update(value).digest("hex");
if (hash(sceneBytes) !== manifest.sceneManifestSha256)
  throw Error("Effects were prepared from a different scene manifest");
const analysis = bindLatestMissileEffects(report, manifest),
  files = new Map(),
  unresolvedAssets = [];
for (const [id, definition] of Object.entries(manifest.definitions)) {
  const file = await Bun.file(`${root}/${definition.file}`).arrayBuffer();
  if (hash(file) !== definition.sha256)
    throw Error(`Effect definition changed ${id}`);
  const data = JSON.parse(new TextDecoder().decode(file));
  if (data.actor !== definition.actor)
    throw Error(`Effect appearance mismatch ${id}`);
  files.set(definition.file, definition.sha256);
  for (const ref of definition.references)
    if (!manifest.definitions[ref.effectId])
      throw Error(`Missing prepared effect reference ${ref.effectId}`);
  for (const dependency of definition.dependencies)
    if (!manifest.assets[dependency.path])
      throw Error(`Missing effect asset descriptor ${dependency.path}`);
}
for (const [path, asset] of Object.entries(manifest.assets)) {
  if (asset.file && !files.has(asset.file)) {
    if (
      hash(await Bun.file(`${root}/${asset.file}`).arrayBuffer()) !==
      asset.sha256
    )
      throw Error(`Converted effect asset changed ${path}`);
    files.set(asset.file, asset.sha256);
  }
  if (asset.rawFile && !files.has(asset.rawFile)) {
    if (
      hash(await Bun.file(`${root}/${asset.rawFile}`).arrayBuffer()) !==
      asset.sourceSha256
    )
      throw Error(`Native effect asset changed ${path}`);
    files.set(asset.rawFile, asset.sourceSha256);
  }
  if (asset.status === "unprepared")
    unresolvedAssets.push({ path, kind: asset.kind, reason: asset.reason });
}
const result = {
  schema: 1,
  build: report.build,
  protocol: report.protocol,
  replaySha256: report.replaySha256,
  manifestSha256: hash(bytes),
  staticPackage: manifest.summary,
  ...analysis,
  verifiedFiles: files.size,
  unresolvedAssets,
  scope:
    "Static assets, integrity and event/appearance binding only; no activation, particle rendering, audio or native A/V comparison",
};
await Bun.write(outputPath, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    staticPackage: result.staticPackage,
    binding: result.summary,
    verifiedFiles: files.size,
  }),
);
