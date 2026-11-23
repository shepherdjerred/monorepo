import path from "node:path";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { readAnimationAsset } from "../latest-animation.mjs";
import { compileAnimationPoseTimeDomain } from "../latest-animation-pose-time-domain.mjs";
import {
  validateSceneAnimationAuthority,
  sceneAnimationFilePath,
} from "../scene-animation-authority.mjs";
import { compileSceneEventInventory } from "./scene-animation-inventory.mjs";

const [sourceArg, sceneArg, cacheArg, pythonArg] = process.argv.slice(2);
if (!cacheArg)
  throw Error(
    "Usage: bun prepare-scene-animation-metadata.mjs <approved-source-cache> <closed-common-scene> <archive-cache> [python]",
  );
const { sourceCache, cache, out, work } = await createStaticPreparationOutput(
  sourceArg,
  cacheArg,
  { prefix: "scene-animation-", directory: "scene-animation" },
);
const sceneRoot = path.resolve(sceneArg),
  nativeRoot = path.join(sourceCache, "public/decoder-16.21-macos"),
  python =
    pythonArg ?? path.join(sourceCache, "research/venv/Scripts/python.exe"),
  client = path.join(sourceCache, "research/LeagueofLegends-macos"),
  tools = path.dirname(fileURLToPath(import.meta.url));
const sceneBytes = await Bun.file(
    path.join(sceneRoot, "manifest.json"),
  ).bytes(),
  scene = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(sceneBytes),
  ),
  profileBytes = await Bun.file(path.join(nativeRoot, "profile.json")).bytes(),
  profile = JSON.parse(new TextDecoder().decode(profileBytes)),
  imageBytes = await Bun.file(path.join(nativeRoot, "image.bin")).bytes();
if (
  scene.kind !== "archived-map11-common-runtime-scene" ||
  scene.build !== profile.clientVersion ||
  scene.protocol !== profile.protocolDigest ||
  sha(imageBytes) !== profile.decoderImageSha256 ||
  !Array.isArray(scene.files) ||
  !scene.files.length
)
  throw Error("Exact common scene and unchanged native authority required");
const selected = new Map();
for (const file of scene.files) {
  sceneAnimationFilePath(file.path);
  if (selected.has(file.path)) throw Error("Duplicate selected scene resource");
  selected.set(file.path, file);
}
const consumed = new Map(),
  written = new Map(),
  sourceHashes = {};
for (const file of [
  "prepare-scene-animation-metadata.mjs",
  "scene-animation-inventory.mjs",
  "scene_metadata_output.py",
  "scene_animation_header.py",
  "prepare-animation-clock.py",
  "prepare-animation-rigs.py",
  "../scene-animation-authority.mjs",
  "scene-animation-authority.schema.json",
  "../latest-animation.mjs",
  "../latest-animation-pose-time-domain.mjs",
])
  sourceHashes[file] = sha(
    await Bun.file(new URL(file, import.meta.url)).bytes(),
  );
async function readScene(relative) {
  sceneAnimationFilePath(relative);
  const expected = selected.get(relative);
  if (!expected)
    throw Error(
      `Scene animation source absent from closed inventory: ${relative}`,
    );
  const bytes = await Bun.file(path.join(sceneRoot, relative)).bytes();
  if (bytes.length !== expected.bytes || sha(bytes) !== expected.sha256)
    throw Error(`Scene animation source differs: ${relative}`);
  consumed.set(relative, {
    authority: "scene",
    file: relative,
    bytes: bytes.length,
    sha256: expected.sha256,
  });
  return bytes;
}
async function write(relative, bytes) {
  sceneAnimationFilePath(relative);
  await mkdir(path.dirname(path.join(out, relative)), { recursive: true });
  await Bun.write(path.join(out, relative), bytes);
  const entry = { file: relative, bytes: bytes.length, sha256: sha(bytes) };
  written.set(relative, entry);
  return entry;
}
const nativeDependencies = [
  {
    authority: "native",
    file: "profile.json",
    bytes: profileBytes.length,
    sha256: sha(profileBytes),
  },
  {
    authority: "native",
    file: "image.bin",
    bytes: imageBytes.length,
    sha256: sha(imageBytes),
  },
];
async function runProducer(script, args) {
  console.log(JSON.stringify({ sceneMetadata: script, status: "preparing" }));
  const child = Bun.spawn(
    [python, path.join(tools, script), ...args, "--output-package", out],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw Error(
      `Scene metadata ${script} failed(${code}): ${stdout}\n${stderr}`,
    );
  console.log(stdout.trim());
}
const world = JSON.parse(
  new TextDecoder().decode(await readScene(scene.world)),
);
await runProducer("prepare-animation-clock.py", [
  nativeRoot,
  client,
  sceneRoot,
  path.join(out, "evidence/clock.json"),
]);
await runProducer("prepare-animation-rigs.py", [
  nativeRoot,
  client,
  sceneRoot,
  path.join(
    sourceCache,
    "research/emsdk/upstream/emscripten/system/lib/libcxx/src/hash.cpp",
  ),
  path.join(out, "evidence/rig.json"),
]);
const clockBytes = await Bun.file(
    path.join(out, "animation-clock.json"),
  ).bytes(),
  clock = JSON.parse(new TextDecoder().decode(clockBytes)),
  rigBytes = await Bun.file(path.join(out, "animation-rigs.json")).bytes(),
  rigs = JSON.parse(new TextDecoder().decode(rigBytes));
if (
  clock.sceneManifestSha256 !== sha(sceneBytes) ||
  rigs.sceneManifestSha256 !== sha(sceneBytes)
)
  throw Error("Derived metadata scene authority differs");
const graphs = {},
  eventGraphs = [],
  identities = [];
const assets = [
  ...Object.entries(scene.champions).map(([key, value]) => ({
    actor: `champions/${key}`,
    asset: value,
  })),
  ...Object.entries(world.assets)
    .filter(([, asset]) => asset.animationGraph && asset.animationCatalog)
    .map(([key, value]) => ({ actor: `world/${key}`, asset: value })),
];
for (const { actor, asset } of assets) {
  const graphBytes = await readScene(asset.animationGraph),
    catalogBytes = await readScene(asset.animationCatalog),
    catalog = JSON.parse(new TextDecoder().decode(catalogBytes)),
    reference = clock.graphs[asset.animationGraph],
    rig = rigs.graphs[asset.animationGraph];
  if (
    !reference ||
    !rig ||
    reference.graphSha256 !== sha(graphBytes) ||
    reference.catalogSha256 !== sha(catalogBytes) ||
    rig.catalogSha256 !== sha(catalogBytes)
  )
    throw Error("Required matching clock/rig graph identity absent");
  const rigFile = rig.rigFile,
    rigSource = await readScene(rigFile);
  if (sha(rigSource) !== rig.rigSha256)
    throw Error("Original scene rig identity differs");
  const directory = path.posix.dirname(asset.animationGraph),
    clips = {},
    uniqueFiles = new Map();
  for (const [name, source] of Object.entries(reference.clips)) {
    const entry = catalog.clips[name];
    if (source.status !== "prepared" || !entry)
      throw Error(
        `Required original leaf clock is unsupported: ${actor}/${name}`,
      );
    const relative = path.posix.join(
        path.posix.dirname(asset.animationCatalog),
        entry.file,
      ),
      bytes = await readScene(relative),
      parsed = readAnimationAsset(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
      );
    if (
      parsed.frames !== source.clock.resourceFrames ||
      parsed.frames !== entry.frames ||
      parsed.fps !== entry.fps ||
      parsed.duration !== entry.duration ||
      parsed.tracks.some(
        (track) => catalog.joints[track.jointId] !== track.bone,
      )
    )
      throw Error(
        `Required leaf pose/clock/rig coverage differs: ${actor}/${name}`,
      );
    const evaluator =
      source.resourceKind === "compressed" && source.resourceVersion === 1
        ? "original-native-compressed-v1"
        : source.resourceKind === "uncompressed" &&
            [3, 4, 5].includes(source.resourceVersion)
          ? "pinned-toolkit-uncompressed"
          : null;
    if (!evaluator || entry.evaluator !== evaluator)
      throw Error(`Required leaf evaluator contract differs: ${actor}/${name}`);
    const digest = sha(bytes);
    if (!uniqueFiles.has(digest))
      uniqueFiles.set(digest, `clips/${uniqueFiles.size}.clip`);
    const file = uniqueFiles.get(digest),
      target = `leaf-poses/${directory}/${file}`;
    if (!written.has(target)) await write(target, bytes);
    const poseTimeDomain = compileAnimationPoseTimeDomain(source, parsed.fps);
    clips[name] = {
      file,
      frames: parsed.frames,
      fps: parsed.fps,
      duration: parsed.duration,
      sha256: sha(bytes),
      sourceSha256: source.source.sha256,
      evaluator,
      ...(poseTimeDomain === null ? {} : { poseTimeDomain }),
    };
  }
  const nativeMapEvidence = asset.nativeMapEvidence
    ? {
        file: asset.nativeMapEvidence,
        sha256: sha(await readScene(asset.nativeMapEvidence)),
      }
    : null;
  eventGraphs.push({
    file: asset.animationGraph,
    sha256: sha(graphBytes),
    value: JSON.parse(new TextDecoder().decode(graphBytes)),
    nativeMapEvidence,
  });
  identities.push({
    actor,
    graph: asset.animationGraph,
    graphSha256: sha(graphBytes),
    catalog: asset.animationCatalog,
    catalogSha256: sha(catalogBytes),
    rig: rigFile,
    rigSha256: rig.rigSha256,
    leafIds: Object.keys(clips),
  });
  graphs[asset.animationGraph] = {
    actor,
    directory,
    rigFile,
    rigSha256: rig.rigSha256,
    graphSha256: sha(graphBytes),
    sourceCatalogSha256: sha(catalogBytes),
    catalog: { schema: 1, joints: catalog.joints, clips },
  };
}
const eventInventory = compileSceneEventInventory(eventGraphs),
  eventBytes = new TextEncoder().encode(JSON.stringify(eventInventory)),
  eventRole = await write("animation-event-inventory.json", eventBytes);
const poses = {
  schema: 1,
  kind: "original-scene-leaf-poses",
  build: scene.build,
  protocol: scene.protocol,
  animationClockSha256: sha(clockBytes),
  sceneManifestSha256: sha(sceneBytes),
  graphs,
  scope:
    "Closed original source leaf frames, exact constructed rig and atomic clock identities; no selected dynamic animation state or blending admitted",
};
const poseRole = await write(
  "leaf-poses/manifest.json",
  new TextEncoder().encode(JSON.stringify(poses)),
);
const preparation = await write(
  "preparation.json",
  new TextEncoder().encode(
    JSON.stringify({
      schema: 1,
      sources: sourceHashes,
      sourceSceneManifestSha256: sha(sceneBytes),
      baseProfileSha256: sha(profileBytes),
      approvedProfileModified: false,
      nativeSpectatorAdmitted: false,
    }),
  ),
);
const roleDependencies = [
  ...nativeDependencies,
  ...consumed.values(),
  { authority: "derived", ...preparation },
];
const roles = {};
for (const [name, file, bytes] of [
  ["clock", "animation-clock.json", clockBytes],
  ["rig", "animation-rigs.json", rigBytes],
]) {
  const definition = await write(file, bytes),
    receiptFile = `${file}.authority.json`,
    receipt = await Bun.file(path.join(out, receiptFile)).bytes(),
    receiptEntry = await write(receiptFile, receipt),
    authority = JSON.parse(new TextDecoder().decode(receipt));
  if (
    authority.baseProfileSha256 !== sha(profileBytes) ||
    authority.imageSha256 !== sha(imageBytes) ||
    authority.sceneManifestSha256 !== sha(sceneBytes) ||
    authority.definition.sha256 !== definition.sha256
  )
    throw Error("Native derived definition receipt differs");
  roles[name] = {
    ...definition,
    dependsOn: [...roleDependencies, { authority: "derived", ...receiptEntry }],
    identities,
  };
}
roles.eventInventory = {
  ...eventRole,
  dependsOn: roleDependencies,
  identities: eventInventory.maps.map(({ entries, ...map }) => ({
    ...map,
    eventIds: entries.map((entry) => entry.id),
  })),
};
roles.leafPoses = {
  ...poseRole,
  dependsOn: [
    ...roleDependencies,
    {
      authority: "derived",
      file: roles.clock.file,
      bytes: roles.clock.bytes,
      sha256: roles.clock.sha256,
    },
    ...[...written.values()]
      .filter(
        (file) =>
          file.file.startsWith("leaf-poses/") && file.file !== poseRole.file,
      )
      .map((file) => ({ authority: "derived", ...file })),
  ],
  identities,
};
for (const [file, expected] of Object.entries(sourceHashes))
  if (sha(await Bun.file(new URL(file, import.meta.url)).bytes()) !== expected)
    throw Error(`Scene animation preparation source changed: ${file}`);
if (
  sha(await Bun.file(path.join(nativeRoot, "profile.json")).bytes()) !==
    sha(profileBytes) ||
  sha(await Bun.file(path.join(nativeRoot, "image.bin")).bytes()) !==
    sha(imageBytes) ||
  sha(await Bun.file(path.join(sceneRoot, "manifest.json")).bytes()) !==
    sha(sceneBytes)
)
  throw Error("Original native/scene authority changed during preparation");
for (const resource of consumed.values()) await readScene(resource.file);
const authority = validateSceneAnimationAuthority({
  schema: 1,
  kind: "scene-animation-authority",
  build: scene.build,
  protocol: scene.protocol,
  baseProfileSha256: sha(profileBytes),
  imageSha256: sha(imageBytes),
  sceneManifestSha256: sha(sceneBytes),
  roles,
  capabilities: {
    dynamicStateProgram: "unadmitted",
    eventScheduling: eventInventory.maps.some((map) =>
      map.entries.some((entry) => entry.value.__type !== "ParticleEventData"),
    )
      ? "unsupported-native-event-classes"
      : "unsupported-matching-effects-required",
  },
  nativeSpectatorAdmitted: false,
});
await write(
  "manifest.json",
  new TextEncoder().encode(JSON.stringify(authority, null, 2)),
);
console.log(
  JSON.stringify({
    output: out,
    authoritySha256: sha(
      await Bun.file(path.join(out, "manifest.json")).bytes(),
    ),
    graphs: identities.length,
    leafIdentities: identities.reduce(
      (sum, value) => sum + value.leafIds.length,
      0,
    ),
    eventMaps: eventInventory.maps.length,
    nativeSpectatorAdmitted: false,
  }),
);
