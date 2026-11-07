import { resolve } from "node:path";
import { createLatestAnimationRigBindings } from "../latest-animation-rigs.mjs";

const [packagePath, scenePath, nativePath, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-animation-rigs.mjs <decoder> <scene> <native> <comparison>",
  );
const root = resolve(packagePath),
  scene = resolve(scenePath),
  hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  profile = await Bun.file(`${root}/profile.json`).json(),
  raw = await Bun.file(`${root}/animation-rigs.json`).arrayBuffer(),
  meta = JSON.parse(new TextDecoder().decode(raw)),
  nativeRaw = await Bun.file(nativePath).arrayBuffer(),
  native = JSON.parse(new TextDecoder().decode(nativeRaw)),
  factory = await createLatestAnimationRigBindings(profile, raw),
  image = new Uint8Array(await Bun.file(`${root}/image.bin`).arrayBuffer()),
  mismatches = [],
  aliases = [];
if (
  native.definitionSha256 !== hash(raw) ||
  native.build !== meta.build ||
  native.protocol !== meta.protocol ||
  hash(image) !== meta.decoderImageSha256
)
  throw Error("Rig observation source mismatch");
for (const [name, digest] of Object.entries({
  ...native.compilerSources,
  ...meta.compilerSources,
}))
  if (
    hash(await Bun.file(new URL(name, import.meta.url)).arrayBuffer()) !==
    digest
  )
    throw Error(`Stale rig compiler ${name}`);
for (const block of native.executedOriginalBlocks)
  if (hash(image.subarray(block.rva, block.rva + block.size)) !== block.sha256)
    throw Error("Observed rig code differs from package");
let lookups = 0,
  poseSelections = 0,
  joints = 0;
for (const observation of native.observations) {
  const source = meta.graphs[observation.graph],
    binding = await factory.bind(
      observation.graph,
      await Bun.file(`${scene}/${source.rigFile}`).arrayBuffer(),
      await Bun.file(`${scene}/${source.catalogFile}`).arrayBuffer(),
    ),
    transforms = source.joints.map((j) => {
      const i = j.nativePoseIndex,
        raw = new Uint8Array(40),
        view = new DataView(raw.buffer),
        values = [i + 0.125, i * 2 + 0.25, -i - 0.5, 0, 0, 0, 1, 1, 1, 1];
      values.forEach((v, k) => view.setFloat32(k * 4, v, true));
      return Array.from(raw, (n) => n.toString(16).padStart(2, "0")).join("");
    }),
    prepared = binding.attachmentJoints(transforms),
    byHash = new Map(prepared.map((j) => [j.hash, j]));
  joints += source.joints.length;
  for (const query of observation.queries) {
    const actual = binding.resolve(query.fnvHash),
      named = binding.resolve(query.name),
      prepared = byHash.get(query.fnvHash);
    lookups += 2;
    if (
      actual.status !== "rig-joint" ||
      actual.resolvedBoneKey !== query.resolvedBoneKey ||
      actual.poseJointIndex !== query.poseJointIndex ||
      actual.nativePoseIndex !== query.nativePoseIndex ||
      actual.keyPoseIndex !== query.keyPoseIndex ||
      JSON.stringify(actual) !== JSON.stringify(named)
    )
      mismatches.push({ actor: observation.actor, query, actual, named });
    for (const output of query.outputs) {
      poseSelections++;
      if (!output.found || output.transformHex !== prepared.transformHex)
        mismatches.push({
          actor: observation.actor,
          hash: query.fnvHash,
          output,
          prepared,
        });
    }
    if (query.sourceJointIndices.length > 1)
      aliases.push({
        actor: observation.actor,
        name: query.name,
        candidates: query.sourceJointIndices,
        selected: query.poseJointIndex,
      });
  }
}
const result = {
  schema: 1,
  build: meta.build,
  protocol: meta.protocol,
  definitionSha256: hash(raw),
  nativeEvidenceSha256: hash(nativeRaw),
  moduleSha256: hash(
    await Bun.file(
      new URL("../latest-animation-rigs.mjs", import.meta.url),
    ).arrayBuffer(),
  ),
  inspectorSha256: hash(await Bun.file(import.meta.path).arrayBuffer()),
  rigs: native.observations.length,
  joints,
  lookups,
  poseSelections,
  aliases,
  originalBlocks: native.executedOriginalBlocks.length,
  primeCalls: native.nextPrimeCalls.length,
  mismatchCount: mismatches.length,
  mismatches: mismatches.slice(0, 20),
  scope: meta.scope,
};
await Bun.write(outputPath, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    rigs: result.rigs,
    joints,
    lookups,
    poseSelections,
    aliases,
    originalBlocks: result.originalBlocks,
    mismatches: mismatches.length,
  }),
);
if (mismatches.length) process.exitCode = 1;
