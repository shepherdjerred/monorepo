import { sha256 } from "./structural-comparison.mjs";

// Match existing prepared pose-file IDs to original ANM resources by the raw
// source's hash. This does not select a recorded animation or blend layers.
export async function bindLatestNativeAnimationCatalog({
  profile,
  poseManifestBytes,
  graphFile,
  runtime,
}) {
  if (
    (await sha256(poseManifestBytes)) !== profile.animationPosesSha256 ||
    runtime.build !== profile.clientVersion ||
    runtime.protocol !== profile.protocolDigest
  )
    throw Error("Matching pinned native/cached animation packages required");
  const manifest = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(poseManifestBytes),
  );
  const graph = manifest.graphs?.[graphFile];
  if (
    manifest.schema !== 1 ||
    manifest.build !== runtime.build ||
    manifest.protocol !== runtime.protocol ||
    manifest.animationClockSha256 !== profile.animationClockSha256 ||
    !graph ||
    graph.actor !== runtime.actor ||
    JSON.stringify(graph.catalog.joints) !== JSON.stringify(runtime.jointNames)
  )
    throw Error("Exact native/cached animation actor and rig required");
  const bySource = new Map();
  for (const resource of runtime.resources) {
    const entries = bySource.get(resource.sourceSha256) ?? [];
    entries.push(resource);
    bySource.set(resource.sourceSha256, entries);
  }
  const files = new Map(),
    names = new Map();
  for (const [name, clip] of Object.entries(graph.catalog.clips)) {
    const matches = bySource.get(clip.sourceSha256);
    if (
      !/^clips\/\d+\.clip$/.test(clip.file) ||
      !matches ||
      matches.length !== 1
    )
      throw Error(`Unbound or ambiguous original ANM source: ${name}`);
    const resource = matches[0];
    if (
      clip.frames !== resource.frames ||
      Math.fround(clip.fps) !== resource.fps ||
      (files.has(clip.file) && files.get(clip.file).keyHex !== resource.keyHex)
    )
      throw Error("Cached/native animation file identity or timing differs");
    const binding = Object.freeze({
      keyHex: resource.keyHex,
      sourceSha256: resource.sourceSha256,
      frames: resource.frames,
      fps: resource.fps,
      kind: resource.kind,
    });
    files.set(clip.file, binding);
    names.set(name, clip.file);
  }
  return Object.freeze({
    actor: runtime.actor,
    graphFile,
    files: Object.freeze([...files.keys()]),
    clipNames: Object.freeze([...names.keys()]),
    resourceForFile(file) {
      const binding = files.get(file);
      if (!binding) throw Error("Unadmitted cached pose file");
      return binding;
    },
    fileForClip(name) {
      const file = names.get(name);
      if (!file) throw Error("Unadmitted graph clip name");
      return file;
    },
    createClipSampler(file) {
      const binding = files.get(file);
      if (!binding) throw Error("Unadmitted cached pose file");
      return runtime.createClipSampler(binding.keyHex);
    },
  });
}
