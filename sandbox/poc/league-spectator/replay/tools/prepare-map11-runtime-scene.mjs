// Assemble the existing runtime's scene layout from independently closed inputs.
// No event is synthesized and this does not grant native spectator admission.
import path from "node:path";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
const [
  geometryArg,
  catalogArg,
  worldActorsArg,
  approvedArg,
  archiveArg,
  scaleArg,
  ...actorArgs
] = process.argv.slice(2);
if (!scaleArg)
  throw Error(
    "Usage: bun prepare-map11-runtime-scene.mjs <geometry-scene> <world-catalog> <world-actors> <approved-source-cache> <archive-cache> <native-scale-proof> [champion-actors...] [--neutral <neutral-actors> <native-policy>]",
  );
const championArgs = [];
let neutralArgs = null;
for (let index = 0; index < actorArgs.length; index++) {
  if (actorArgs[index] === "--neutral") {
    if (neutralArgs || !actorArgs[index + 1] || !actorArgs[index + 2])
      throw Error(
        "One explicit neutral actor package and native policy required",
      );
    neutralArgs = actorArgs.slice(index + 1, index + 3);
    index += 2;
  } else {
    if (actorArgs[index].startsWith("--"))
      throw Error("Unknown scene preparation option");
    championArgs.push(actorArgs[index]);
  }
}
const sha = (bytes) =>
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  inputs = {};
async function raw(file) {
  const bytes = await Bun.file(file).bytes(),
    key = path.resolve(file),
    digest = sha(bytes);
  if (inputs[key] !== undefined && inputs[key] !== digest)
    throw Error(`Scene input changed ${file}`);
  inputs[key] = digest;
  return bytes;
}
const json = async (file) =>
  JSON.parse(new TextDecoder().decode(await raw(file)));
function relative(value) {
  if (
    typeof value !== "string" ||
    !/^[-A-Za-z\d_./]+$/.test(value) ||
    path.isAbsolute(value) ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw Error("Bounded scene resource path required");
  return value;
}
const geometry = await json(path.join(geometryArg, "manifest.json"));
const catalog = await json(path.join(catalogArg, "catalog-manifest.json"));
const contract = await json(path.join(catalogArg, "scene-contract.json"));
const inventory = await json(path.join(catalogArg, "placeables.json"));
const binding = await json(path.join(catalogArg, "recorded-binding.json"));
const worldActors = await json(path.join(worldActorsArg, "manifest.json"));
const scale = await json(scaleArg),
  profile = await json(
    path.join(approvedArg, "public/decoder-16.21-macos/profile.json"),
  );
const image = await raw(
  path.join(approvedArg, "public/decoder-16.21-macos/image.bin"),
);
if (
  geometry.build !== "16.21.829.8620" ||
  geometry.protocol !== "20e09df23c66b85e" ||
  geometry.map.id !== 11 ||
  contract.geometryManifestSha256 !==
    inputs[path.resolve(geometryArg, "manifest.json")] ||
  catalog.kind !== "recorded-map11-world-catalog" ||
  binding.kind !== "recorded-map11-registration-binding" ||
  worldActors.kind !== "archived-original-actor-assets" ||
  scale.kind !== "original-skin-scale-default" ||
  !scale.scope.originalConstructorExecuted ||
  scale.scope.authoredOverrideSupplied ||
  scale.build !== geometry.build ||
  scale.protocol !== geometry.protocol ||
  scale.decoderImageSha256 !== profile.decoderImageSha256 ||
  sha(image) !== profile.decoderImageSha256 ||
  !Number.isFinite(scale.value) ||
  scale.value <= 0
)
  throw Error(
    "Original Map11 geometry/catalog/actor/default contracts do not agree",
  );
for (const block of scale.originalBlocks)
  if (sha(image.subarray(block.rva, block.rva + block.size)) !== block.sha256)
    throw Error("Original scale instructions changed");
for (const [file, digest] of Object.entries(scale.sources))
  if (sha(await raw(file)) !== digest)
    throw Error("Native scale producer changed");
const { out, runRoot } = await createStaticPreparationOutput(
  approvedArg,
  archiveArg,
  { prefix: "runtime-", directory: "latest-scene" },
);
const outputs = new Map();
async function put(name, bytes) {
  relative(name);
  const digest = sha(bytes);
  if (outputs.has(name)) {
    if (outputs.get(name).sha256 !== digest)
      throw Error(`Conflicting prepared scene resource ${name}`);
    return;
  }
  await Bun.write(path.join(out, name), bytes);
  outputs.set(name, { path: name, sha256: digest, bytes: bytes.length });
}
async function copyInventory(root, manifest, prefix = "") {
  const seen = new Set();
  for (const file of manifest.files) {
    relative(file.path);
    if (seen.has(file.path)) throw Error("Duplicate input inventory path");
    seen.add(file.path);
    const bytes = await raw(path.join(root, file.path));
    if (sha(bytes) !== file.sha256 || bytes.length !== file.bytes)
      throw Error(`Prepared scene source changed ${file.path}`);
    await put(prefix + file.path, bytes);
  }
}
// Catalog resources are verified too, without copying a second scene manifest.
for (const file of catalog.files) {
  relative(file.path);
  const bytes = await raw(path.join(catalogArg, file.path));
  if (bytes.length !== file.bytes || sha(bytes) !== file.sha256)
    throw Error("Prepared Map11 catalog changed");
}
await copyInventory(geometryArg, geometry);
await copyInventory(worldActorsArg, worldActors);
const champions = {},
  worldAssets = structuredClone(worldActors.worldAssets);
const packages = [
  {
    path: path.resolve(worldActorsArg),
    sha256: inputs[path.resolve(worldActorsArg, "manifest.json")],
  },
];
for (const root of championArgs) {
  const manifest = await json(path.join(root, "manifest.json"));
  if (
    manifest.kind !== "archived-original-actor-assets" ||
    manifest.build !== geometry.build ||
    manifest.protocol !== geometry.protocol
  )
    throw Error("Exact archived champion actor package required");
  await copyInventory(root, manifest);
  for (const [key, asset] of Object.entries(manifest.champions)) {
    if (
      Object.hasOwn(champions, key) &&
      JSON.stringify(champions[key]) !== JSON.stringify(asset)
    )
      throw Error(`Conflicting champion asset ${key}`);
    champions[key] = structuredClone(asset);
  }
  packages.push({
    path: path.resolve(root),
    sha256: inputs[path.resolve(root, "manifest.json")],
  });
}
let neutralCreation = null;
if (neutralArgs !== null) {
  const [root, policyFile] = neutralArgs,
    manifest = await json(path.join(root, "manifest.json")),
    policy = await json(policyFile);
  if (
    manifest.kind !== "archived-original-actor-assets" ||
    manifest.build !== geometry.build ||
    manifest.protocol !== geometry.protocol ||
    policy.kind !== "original-default-map11-neutral-candidates" ||
    policy.build !== geometry.build ||
    policy.protocol !== geometry.protocol ||
    policy.mapId !== 11 ||
    policy.mapSkin !== contract.recordedMapSkin ||
    policy.scope.nativeFactoryAccepted !== false ||
    policy.scope.containsReplayEvents !== false ||
    policy.scope.snapshotsCreateEntities !== false ||
    policy.provenance.preparerSha256 !==
      sha(
        await raw(
          path.join(import.meta.dir, "prepare-neutral-world-policy.mjs"),
        ),
      )
  )
    throw Error(
      "Source-bound exact Default Map11 neutral assets and native policy required",
    );
  const declared = Object.entries(policy.bindings),
    actual = Object.entries(manifest.worldAssets);
  if (
    declared.length !== actual.length ||
    Object.keys(manifest.champions).length
  )
    throw Error(
      "Neutral native policy must cover its entire world actor package",
    );
  await copyInventory(root, manifest, "neutral/");
  const pathFields = [
    "model",
    "skinDefinition",
    "spellCatalog",
    "animationGraph",
    "animationCatalog",
    "animationSourceIndex",
    "materialEvidence",
    "animationEvidence",
    "rigJointBindings",
  ];
  for (const [key, binding] of declared) {
    const original = manifest.worldAssets[key];
    if (
      !original ||
      binding.asset !== `neutral/${key}` ||
      Object.hasOwn(worldAssets, binding.asset) ||
      original.character.toLowerCase() !== binding.character.toLowerCase() ||
      original.skinId !== binding.resourceSkinId ||
      !original.source.bins.some(
        (bin) => bin.sha256 === binding.characterSourceSha256,
      ) ||
      binding.characterRecords.some(
        (record) => !original.characterRecords.includes(record),
      )
    )
      throw Error(
        "Neutral native resource identity/CharacterRecord differs: " + key,
      );
    const asset = structuredClone(original);
    for (const field of pathFields)
      if (asset[field] !== undefined)
        asset[field] = "neutral/" + relative(asset[field]);
    worldAssets[binding.asset] = asset;
  }
  neutralCreation = policy;
  await put(
    "neutral-creation-policy.json",
    new TextEncoder().encode(JSON.stringify(policy, null, 2)),
  );
  packages.push({
    path: path.resolve(root),
    sha256: inputs[path.resolve(root, "manifest.json")],
    neutralPolicySha256: inputs[path.resolve(policyFile)],
  });
}
for (const asset of [
  ...Object.values(worldAssets),
  ...Object.values(champions),
]) {
  if (asset.scale === undefined) {
    if (!asset.scaleStatus)
      throw Error("Missing original scale declaration/default boundary");
    asset.scale = scale.value;
    asset.scaleStatus =
      "Absent authored skinScale uses its original registered constructor value";
    asset.scaleDefaultProofSha256 = inputs[path.resolve(scaleArg)];
  }
  if (
    !Number.isFinite(asset.scale) ||
    asset.scale <= 0 ||
    !outputs.has(relative(asset.model)) ||
    !outputs.has(relative(asset.spellCatalog))
  )
    throw Error("Actual actor model/scale/character resources required");
}
const objects = {};
for (const entry of binding.registration.filter(
  (entry) => entry.attackableType === 0,
)) {
  if (!worldAssets[entry.asset])
    throw Error(`Missing recorded tower actor ${entry.asset}`);
  objects[entry.mapNameHash] = {
    mapNameHash: entry.mapNameHash,
    asset: entry.asset,
    transform: entry.transform,
    characterRecord: entry.characterRecord,
    explicitTeam: entry.explicitTeam,
    sourceChunk: entry.sourceChunk,
    sourceName: `{${entry.mapNameHash.toString(16).padStart(8, "0")}}`,
    replicationClass: "turret",
    classSource:
      "Original decoded1005 factory initializes the turret replication class; asset character names are independent",
  };
}
for (const entry of binding.registration.filter(
  (entry) => entry.kind === "barracks",
))
  for (const unit of Object.values(entry.units))
    if (!worldAssets[unit.asset])
      throw Error(`Missing original lane-minion actor ${unit.asset}`);
const world = {
  schema: 1,
  build: geometry.build,
  protocol: geometry.protocol,
  mapId: 11,
  objects,
  assets: worldAssets,
  registration: binding.registration,
  registrationStatus: binding.status,
  ...(neutralCreation === null ? {} : { neutralCreation }),
  sourceMaterialsSha256: inventory.sourceSha256,
  sourceMapDefinitionSha256: inventory.mapDefinitionSha256,
  limitations: [
    "Recorded tower anchors/minion references constrain the authored registration chunk; full native map initialization remains separate",
    neutralCreation === null
      ? "Only recorded tower/minion creation paths are bound; inhibitor/nexus/neutral entity creation and lifecycle admission remain separate"
      : "Neutral745 gameplay candidates have original type/placement/Default-resource proofs; full native factory, snapshot restoration and other NPC849 paths remain separate",
    "Native world material, controller, effects, visibility and audio parity remain unverified",
  ],
};
await put(
  "world.json",
  new TextEncoder().encode(JSON.stringify(world, null, 2)),
);
await put(
  "native-skin-scale-default.json",
  new TextEncoder().encode(JSON.stringify(scale)),
);
const manifest = {
  schema: 1,
  build: geometry.build,
  protocol: geometry.protocol,
  kind: "archived-map11-common-runtime-scene",
  spectatorAdmission: false,
  toolchain: {
    ...geometry.toolchain,
    sceneAssemblerSha256: sha(await Bun.file(import.meta.path).bytes()),
  },
  map: {
    ...geometry.map,
    recordedMapSkin: contract.recordedMapSkin,
    selection:
      "Recorded original Default MapSkin selects Base_SRX; original MapNavGrid getter and complete height loader verified",
  },
  champions,
  world: "world.json",
  provenance: {
    geometryManifestSha256: inputs[path.resolve(geometryArg, "manifest.json")],
    catalogManifestSha256:
      inputs[path.resolve(catalogArg, "catalog-manifest.json")],
    actorPackages: packages,
    scaleDefaultProofSha256: inputs[path.resolve(scaleArg)],
  },
  files: [...outputs.values()].sort((a, b) => a.path.localeCompare(b.path)),
};
for (const [file, digest] of Object.entries(inputs))
  if (sha(await Bun.file(file).bytes()) !== digest)
    throw Error(`Scene input changed before publication ${file}`);
await Bun.write(
  path.join(out, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
const replication = await raw(
  path.join(approvedArg, "public/latest-replication/package.json"),
);
await Bun.write(
  path.join(runRoot, "public/latest-replication/package.json"),
  replication,
);
console.log(
  JSON.stringify({
    output: out,
    cache: runRoot,
    champions: Object.keys(champions).length,
    worldAssets: Object.keys(worldAssets).length,
    towers: Object.keys(objects).length,
    neutralAssets:
      neutralCreation === null
        ? 0
        : Object.keys(neutralCreation.bindings).length,
    files: outputs.size,
    spectatorAdmission: false,
  }),
);
