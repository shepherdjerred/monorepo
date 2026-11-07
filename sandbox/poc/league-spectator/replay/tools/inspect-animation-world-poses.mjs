import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createLatestAnimationWorldPoses } from "../latest-animation-world-poses.mjs";
import { createLatestAnimationRigBindings } from "../latest-animation-rigs.mjs";
import { readAnimationAsset } from "../latest-animation.mjs";
const [packagePath, scenePath, nativePath, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-animation-world-poses.mjs <decoder> <scene> <native> <comparison>",
  );
const root = resolve(packagePath),
  scene = resolve(scenePath),
  hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  profile = await Bun.file(`${root}/profile.json`).json(),
  raw = await Bun.file(`${root}/animation-world-poses.json`).arrayBuffer(),
  meta = JSON.parse(new TextDecoder().decode(raw)),
  nativeRaw = await Bun.file(nativePath).arrayBuffer(),
  native = JSON.parse(new TextDecoder().decode(nativeRaw)),
  image = new Uint8Array(await Bun.file(`${root}/image.bin`).arrayBuffer()),
  vendor = resolve(dirname(root), "vendor/unicorn_x86_candidate.mjs"),
  rigFactory = await createLatestAnimationRigBindings(
    profile,
    await Bun.file(`${root}/animation-rigs.json`).arrayBuffer(),
  );
if (
  native.definitionSha256 !== hash(raw) ||
  native.build !== meta.build ||
  native.protocol !== meta.protocol ||
  hash(await Bun.file(vendor).arrayBuffer()) !== meta.runtimeSha256
)
  throw Error("World-pose observation mismatch");
for (const [name, digest] of Object.entries({
  ...meta.compilerSources,
  ...native.compilerSources,
}))
  if (
    hash(await Bun.file(new URL(name, import.meta.url)).arrayBuffer()) !==
    digest
  )
    throw Error(`Stale world-pose compiler ${name}`);
for (const b of native.executedOriginalBlocks)
  if (hash(image.subarray(b.rva, b.rva + b.size)) !== b.sha256)
    throw Error("Observed world-pose block changed");
const poseRoot = resolve(dirname(root), "latest-animation-poses"),
  poseManifestRaw = await Bun.file(`${poseRoot}/manifest.json`).arrayBuffer(),
  poseManifest = JSON.parse(new TextDecoder().decode(poseManifestRaw)),
  clips = new Map();
if (hash(poseManifestRaw) !== meta.animationPosesSha256)
  throw Error("World-pose animation package changed");
for (const [file, digest] of Object.entries(meta.poseFiles)) {
  const raw = await Bun.file(`${poseRoot}/${file}`).arrayBuffer();
  if (hash(raw) !== digest)
    throw Error("World-pose local animation source changed");
  clips.set(file, readAnimationAsset(raw));
}
const hex = (raw) =>
  Array.from(raw, (b) => b.toString(16).padStart(2, "0")).join("");
function observedLocal(c, source) {
  const local = source.bindLocalHex.map((h) =>
    Uint8Array.from(h.match(/../g), (b) => parseInt(b, 16)),
  );
  if (c.clipFile) {
    const clip = clips.get(c.clipFile),
      sourceClip = poseManifest.graphs[c.input.graph].catalog.clips[c.label],
      directory = poseManifest.graphs[c.input.graph].directory;
    if (
      !clip ||
      !sourceClip ||
      `${directory}/${sourceClip.file}` !== c.clipFile ||
      sourceClip.sha256 !== meta.poseFiles[c.clipFile] ||
      !Number.isInteger(c.frame) ||
      c.frame < 0 ||
      c.frame >= clip.frames
    )
      throw Error("Invalid asset-bound world-pose observation");
    for (const track of clip.tracks) {
      if (source.joints[track.jointId] !== track.bone)
        throw Error("World-pose local joint mismatch");
      const view = new DataView(local[track.jointId].buffer),
        offset = { position: 0, scale: 12, quaternion: 24 }[track.channel],
        start = (track.count === 1 ? 0 : c.frame) * track.width;
      for (let i = 0; i < track.width; i++)
        view.setFloat32(offset + i * 4, track.values[start + i], true);
    }
  }
  return local.map(hex);
}
const { default: createUnicorn } = await import(pathToFileURL(vendor).href),
  uc = await createUnicorn(),
  kernel = await createLatestAnimationWorldPoses(
    uc,
    profile,
    image,
    await Bun.file(`${root}/vfx-spawn.json`).arrayBuffer(),
    raw,
  ),
  bindings = new Map(),
  rigBindings = new Map(),
  mismatches = [];
let jointPoses = 0,
  attachments = 0;
try {
  for (const [i, c] of native.cases.entries()) {
    const graph = c.input.graph,
      source = meta.graphs[graph];
    if (
      JSON.stringify(observedLocal(c, source)) !==
      JSON.stringify(c.input.localHex)
    )
      throw Error(
        "Native local-pose inputs differ from prepared animation sources",
      );
    if (!bindings.has(graph)) {
      const rig = await Bun.file(`${scene}/${source.rigFile}`).arrayBuffer(),
        catalog = await Bun.file(
          `${scene}/${source.catalogFile}`,
        ).arrayBuffer();
      bindings.set(graph, await kernel.bind(graph, rig, catalog));
      rigBindings.set(graph, await rigFactory.bind(graph, rig, catalog));
    }
    const actual = bindings
      .get(graph)
      .sample(c.input.localHex, c.input.rootHex, c.input.inheritScale);
    jointPoses += actual.worldHex.length;
    if (JSON.stringify(actual) !== JSON.stringify(c.output))
      mismatches.push({
        case: i,
        label: c.label,
        graph,
        actual,
        expected: c.output,
      });
    const joined = rigBindings.get(graph).attachmentJoints(actual.worldHex);
    attachments += joined.length;
    if (joined.some((j) => !actual.worldHex.includes(j.transformHex)))
      throw Error("Attachment join lost native world pose");
  }
  // Revisit earlier rigs after other actors used the shared native component.
  for (const [i, c] of [...native.cases.entries()].reverse()) {
    const actual = bindings
      .get(c.input.graph)
      .sample(c.input.localHex, c.input.rootHex, c.input.inheritScale);
    if (JSON.stringify(actual) !== JSON.stringify(c.output))
      mismatches.push({ restoredCase: i, label: c.label });
  }
} finally {
  kernel.close();
}
const result = {
  schema: 1,
  build: meta.build,
  protocol: meta.protocol,
  definitionSha256: hash(raw),
  nativeEvidenceSha256: hash(nativeRaw),
  moduleSha256: hash(
    await Bun.file(
      new URL("../latest-animation-world-poses.mjs", import.meta.url),
    ).arrayBuffer(),
  ),
  rigModuleSha256: hash(
    await Bun.file(
      new URL("../latest-animation-rigs.mjs", import.meta.url),
    ).arrayBuffer(),
  ),
  inspectorSha256: hash(await Bun.file(import.meta.path).arrayBuffer()),
  sources: Object.fromEntries(
    await Promise.all(
      [
        "latest-animation-world-poses.mjs",
        "latest-animation-rigs.mjs",
        "latest-animation.mjs",
        "latest-vfx-spawn.mjs",
        "native-decoder.mjs",
      ].map(async (name) => [
        name,
        hash(
          await Bun.file(new URL(`../${name}`, import.meta.url)).arrayBuffer(),
        ),
      ]),
    ),
  ),
  rigs: bindings.size,
  cases: native.cases.length,
  animationFiles: clips.size,
  jointPoses,
  comparedFloatLanes: jointPoses * 10,
  attachmentJoins: attachments,
  reversedCases: native.cases.length,
  originalBlocks: native.executedOriginalBlocks.length,
  mismatchCount: mismatches.length,
  mismatches: mismatches.slice(0, 3),
  scope: meta.scope,
};
await Bun.write(outputPath, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({ ...result, mismatches: undefined, scope: undefined }),
);
if (mismatches.length) process.exitCode = 1;
