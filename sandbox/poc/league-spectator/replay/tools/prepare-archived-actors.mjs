// Original archived static assets only. Requests come from independent replay
// decoding; this tool never opens a replay or invents a match entity.
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import {
  openArchivedActorSources,
  actorSha256,
} from "./archived-actor-sources.mjs";
import {
  validateActorRequest,
  actorObjectHash,
  ACTOR_TOOLKIT_REVISION,
} from "./archived-actor-bin.mjs";
import { createActorBinClosure } from "./archived-actor-closure.mjs";
import {
  selectActorSkin,
  selectActorTexture,
  selectActorAnimations,
  actorReferenceKey,
} from "./archived-actor-plan.mjs";
import { buildActorSpellCatalog } from "./archived-actor-spells.mjs";
import { createArchivedAnimationExporter } from "./archived-animation-export.mjs";
import { createOrdinalModelExporter } from "./ordinal-model-export.mjs";
import {
  MAP11_RELEASE_URL,
  MAP11_RELEASE_SHA256,
} from "./map-scene-assets.mjs";

const [
  parserCheckout,
  sourceCacheArg,
  archiveCacheArg,
  requestFile,
  dotnet = "dotnet",
] = process.argv.slice(2);
if (!requestFile || process.argv.length > 7)
  throw Error(
    "Usage: bun prepare-archived-actors.mjs <parser-checkout> <approved-source-cache> <archive-cache> <static-actor-request.json> [dotnet]",
  );
const requestBytes = await Bun.file(requestFile).bytes(),
  request = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(requestBytes),
  );
const actors = validateActorRequest(request);
const nativeMapObservations = [],
  nativeMapProofSources = new Map();
for (const entry of request.nativeMapObservations ?? []) {
  if (typeof entry.file !== "string" || !/^[a-f\d]{64}$/.test(entry.sha256))
    throw Error("Source-bound native actor map observation reference required");
  const bytes = await Bun.file(entry.file).bytes();
  if (actorSha256(bytes) !== entry.sha256)
    throw Error("Native actor map observation digest differs");
  const proof = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (!proof.sources || !Object.keys(proof.sources).length)
    throw Error("Native actor map observation has no source closure");
  for (const [file, digest] of Object.entries(proof.sources))
    if (actorSha256(await Bun.file(file).bytes()) !== digest)
      throw Error(`Native map proof implementation changed: ${file}`);
    else nativeMapProofSources.set(file, digest);
  nativeMapObservations.push(bytes);
}
const { sourceCache, cache, out, work } = await createStaticPreparationOutput(
  sourceCacheArg,
  archiveCacheArg,
  { prefix: "actors-", directory: "latest-scene" },
);
const sources = await openArchivedActorSources({
  parserCheckout,
  sourceCache,
  archiveCache: cache,
  nativeMapObservations,
});
const exporter = path.join(
  sourceCache,
  "exporter-build/bin/Debug/net10.0/Exporter.dll",
);
const exporterSha256 = actorSha256(await Bun.file(exporter).bytes());
const approvedScene = await Bun.file(
  path.join(sourceCache, "public/latest-scene/manifest.json"),
).json();
if (
  approvedScene.build !== request.build ||
  approvedScene.toolchain.exporterSha256 !== exporterSha256 ||
  approvedScene.toolchain.leagueToolkitRevision !== ACTOR_TOOLKIT_REVISION
)
  throw Error("Pinned original exporter receipt changed");
const profile = await Bun.file(
  path.join(sourceCache, "public/decoder-16.21-macos/profile.json"),
).json();
const namingBytes = await Bun.file(
  path.join(sourceCache, "public/decoder-16.21-macos/attack-names.json"),
).bytes();
const attackNaming = JSON.parse(new TextDecoder().decode(namingBytes));
if (
  actorSha256(namingBytes) !== profile.attackNamingSha256 ||
  profile.clientVersion !== request.build ||
  attackNaming.clientVersion !== request.build ||
  attackNaming.decoderImageSha256 !== profile.decoderImageSha256 ||
  attackNaming.sliceSha256 !==
    "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b"
)
  throw Error("Pinned original attack-name resource differs");
const capturedTools = new Map();
for (const file of [
  "prepare-archived-actors.mjs",
  "archived-actor-bin.mjs",
  "archived-actor-sources.mjs",
  "archived-actor-closure.mjs",
  "archived-actor-plan.mjs",
  "archived-actor-spells.mjs",
  "archived-actor-native-maps.mjs",
  "native-actor-map-bridge.mjs",
  "native-clip-map-policy.mjs",
  "native-event-map-policy.mjs",
  "exact-map-bin.mjs",
  "wad.mjs",
  "rman-chunks.mjs",
  "map-scene-output.mjs",
  "map-scene-assets.mjs",
  "animation-single-flight.mjs",
  "ordinal-model-export.mjs",
  "ordinal-model-layout.mjs",
  "ordinal-model/Program.cs",
  "ordinal-model/OrdinalModelExporter.csproj",
  "archived-animation-export.mjs",
  "archived-animation-format.mjs",
  "animation-pack/Program.cs",
  "animation-pack/AnimationPack.csproj",
])
  capturedTools.set(
    file,
    actorSha256(await Bun.file(new URL(file, import.meta.url)).bytes()),
  );
async function command(args) {
  const child = Bun.spawn([dotnet, exporter, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw Error(`Archived actor exporter failed: ${stdout}\n${stderr}`);
  console.log(stdout.trim());
}
async function write(relative, bytes) {
  const file = path.resolve(out, relative);
  if (!file.startsWith(path.resolve(out) + path.sep))
    throw Error("Archived actor output escaped isolated root");
  await mkdir(path.dirname(file), { recursive: true });
  await Bun.write(file, bytes);
}
const textureJobs = {},
  textureReferences = new Map(),
  prepared = {},
  unsupported = {};
async function texture(wadName, reference) {
  const identity = `${wadName.toLowerCase()}:${actorReferenceKey(reference)}`;
  if (!textureReferences.has(identity)) {
    const key = actorSha256(new TextEncoder().encode(identity));
    const raw = path.join(work, `${key}.texture`),
      relative = `textures/${key}.png`;
    await Bun.write(raw, await sources.read(wadName, reference));
    await mkdir(path.join(out, "textures"), { recursive: true });
    textureJobs[raw] = path.join(out, relative);
    textureReferences.set(identity, relative);
  }
  return textureReferences.get(identity);
}
for (const actor of actors) {
  const prefix = actor.role === "champion" ? "champions" : "world";
  const directory = `${prefix}/${actor.key}`,
    folder = path.join(out, directory);
  const wadName =
    actor.wad ??
    (actor.role === "champion"
      ? `DATA/FINAL/Champions/${actor.character}.wad.client`
      : "DATA/FINAL/Maps/Shipping/Map11.wad.client");
  const closure = createActorBinClosure(sources, wadName);
  const skinFile = `data/characters/${actor.character.toLowerCase()}/skins/skin${actor.skinId}.bin`;
  const skinBin = await closure.load(skinFile, [
    `Characters/${actor.character}/Skins/Skin${actor.skinId}`,
  ]);
  const selected = selectActorSkin(skinBin.normalized, actor),
    { skin, mesh, hidden } = selected;
  await write(
    `${directory}/model.skn`,
    await sources.read(wadName, mesh.simpleSkin),
  );
  await write(
    `${directory}/model.skl`,
    await sources.read(wadName, mesh.skeleton),
  );
  await command([
    "skin-info",
    path.join(folder, "model.skn"),
    path.join(folder, "ranges.json"),
  ]);
  const ranges = await Bun.file(path.join(folder, "ranges.json")).json();
  if (
    !Array.isArray(ranges) ||
    !ranges.length ||
    ranges.some((range) => typeof range !== "string" || !range.length) ||
    new Set(ranges).size !== ranges.length
  )
    throw Error("Invalid original mesh material ranges");
  const graphReference = skin.skinAnimationProperties?.animationGraphData;
  let animationPlan = null;
  if (graphReference) {
    const graph = await closure.resolve(graphReference);
    if (graph.value.__type !== "AnimationGraphData")
      throw Error("Skin animation link is not an original graph");
    const normalizedGraph = { [graph.path]: graph.value };
    await write(`${directory}/graph.json`, JSON.stringify(normalizedGraph));
    const clipDeclaration = closure
      .files()
      .flatMap((bin) => bin.nativeMapDeclarations)
      .find(
        (value) =>
          value.kind === "clip" &&
          value.ownerPath === actorObjectHash(graph.path) &&
          value.trail.length === 0,
      );
    animationPlan = selectActorAnimations(normalizedGraph, clipDeclaration);
    await write(
      `${directory}/animation-source-index.json`,
      JSON.stringify({
        lookupStatus: animationPlan.lookupStatus,
        sources: animationPlan.clipSources,
      }),
    );
    for (const animation of animationPlan.files)
      await write(
        `${directory}/${animation.file}`,
        await sources.read(wadName, animation.reference),
      );
    if (clipDeclaration) {
      const inventory = [],
        selectedEntries = new Set(
          clipDeclaration.rows.map((row) => row.sourceEntry),
        );
      for (const entry of clipDeclaration.originalNormalizedEntries) {
        if (entry.value.__type !== "AtomicClipData") continue;
        const reference =
            entry.value.mAnimationResourceData?.mAnimationFilePath,
          identity = actorReferenceKey(reference);
        const existing = animationPlan.files.find(
          (value) => actorReferenceKey(value.reference) === identity,
        );
        const file =
            existing?.file ??
            `animations/original-only-${entry.sourceEntry}.anm`,
          bytes = await sources.read(wadName, reference);
        if (!existing) await write(`${directory}/${file}`, bytes);
        inventory.push({
          originalKey: entry.key,
          sourceEntry: entry.sourceEntry,
          lookupSelected: selectedEntries.has(entry.sourceEntry),
          file,
          reference,
          sourceSha256: actorSha256(bytes),
        });
      }
      await write(
        `${directory}/original-animation-inventory.json`,
        JSON.stringify({
          schema: 1,
          resources: inventory,
          scope:
            "Original declarations retained; lookupSelected false resources do not select an active native clip",
        }),
      );
    }
  }
  const bindings = {},
    materialEvidence = {};
  for (const range of ranges) {
    const override = mesh.materialOverride?.find(
      (entry) => entry.submesh?.toLowerCase() === range.toLowerCase(),
    );
    const materialReference = override?.Material ?? mesh.Material;
    if (materialReference) await closure.resolve(materialReference);
    try {
      const binding = selectActorTexture({
        skin,
        mesh,
        range,
        objects: closure.objects(),
      });
      const file = await texture(wadName, binding.reference);
      bindings[range] = path
        .relative(folder, path.join(out, file))
        .replaceAll("\\", "/");
      materialEvidence[range] = binding;
    } catch (error) {
      if (!String(error.message).startsWith("Unsupported original material"))
        throw error;
      unsupported[actor.key] = {
        reason: error.message,
        range,
        materialReference,
      };
    }
  }
  if (unsupported[actor.key]) {
    console.log(
      JSON.stringify({
        actor: actor.key,
        status: "unsupported",
        ...unsupported[actor.key],
      }),
    );
    continue;
  }
  await write(`${directory}/texture-bindings.json`, JSON.stringify(bindings));
  await write(
    `${directory}/material-evidence.json`,
    JSON.stringify(materialEvidence),
  );
  const characterFile = `data/characters/${actor.character.toLowerCase()}/${actor.character.toLowerCase()}.bin`;
  await closure.load(characterFile, actor.characterRecords);
  for (const record of actor.characterRecords) await closure.resolve(record);
  const spellCatalog = buildActorSpellCatalog({
    actor,
    objects: closure.objects(),
    attackNaming,
    attackNamingSha256: profile.attackNamingSha256,
  });
  await write(`${directory}/spells.json`, JSON.stringify(spellCatalog));
  await write(
    `${directory}/skin.json`,
    JSON.stringify(Object.fromEntries(closure.objects())),
  );
  const nativeMapDeclarations = closure
    .files()
    .flatMap((bin) =>
      bin.nativeMapDeclarations.map((value) => ({ file: bin.file, ...value })),
    );
  if (nativeMapDeclarations.length)
    await write(
      `${directory}/native-map-evidence.json`,
      JSON.stringify({ schema: 1, declarations: nativeMapDeclarations }),
    );
  await write(
    `${directory}/selected-clips.json`,
    JSON.stringify(animationPlan?.selected ?? {}),
  );
  await write(
    `${directory}/runtime-clips.json`,
    JSON.stringify(
      animationPlan
        ? [
            ...new Set(
              [
                animationPlan.previewClips.idle,
                animationPlan.previewClips.run,
              ].filter((name) => name !== null),
            ),
          ]
        : [],
    ),
  );
  prepared[actor.key] = {
    role: actor.role,
    character: actor.character,
    champion: actor.character,
    skinId: actor.skinId,
    model: `${directory}/model.glb`,
    skinDefinition: `${directory}/skin.json`,
    spellCatalog: `${directory}/spells.json`,
    characterRecords: actor.characterRecords,
    hidden,
    ...(mesh.skinScale === undefined
      ? {
          scaleStatus:
            "Original scale property absent; runtime default must be proved",
        }
      : { scale: mesh.skinScale }),
    ...(animationPlan
      ? {
          animationGraph: `${directory}/graph.json`,
          animationCatalog: `${directory}/animation-catalog.json`,
          animationSourceIndex: `${directory}/animation-source-index.json`,
          animationGraphStatus: animationPlan.lookupStatus,
          clips: Object.keys(animationPlan.selected),
          previewClips: animationPlan.previewClips,
        }
      : {
          poseStatus:
            "Original skin declares no animation graph; only skeleton bind pose is prepared",
        }),
    materialEvidence: `${directory}/material-evidence.json`,
    ...(nativeMapDeclarations.length
      ? { nativeMapEvidence: `${directory}/native-map-evidence.json` }
      : {}),
    unsupportedMaterials: {},
    shaderStatus:
      "Original albedo textures only; native material shaders/compositing remain unimplemented",
    source: {
      wad: wadName,
      skinFile,
      skinSha256: actorSha256(skinBin.bytes),
      bins: closure
        .files()
        .map((bin) => ({ path: bin.file, sha256: bin.tree.sourceSha256 })),
    },
    unsupportedDeclarations: closure.files().flatMap((bin) =>
      bin.unsupportedDeclarations.map((declaration) => ({
        file: bin.file,
        sourceSha256: bin.tree.sourceSha256,
        ...declaration,
      })),
    ),
  };
  console.log(
    JSON.stringify({
      actor: actor.key,
      status: "sources-prepared",
      materialRanges: ranges.length,
      atomicClips: Object.keys(animationPlan?.selected ?? {}).length,
    }),
  );
}
await Bun.write(
  path.join(work, "texture-jobs.json"),
  JSON.stringify(textureJobs),
);
if (Object.keys(textureJobs).length)
  await command(["textures", path.join(work, "texture-jobs.json")]);
let animationExporter;
const modelExporter = await createOrdinalModelExporter({
  sourceCache,
  work,
  dotnet,
});
for (const asset of Object.values(prepared)) {
  const folder = path.dirname(path.join(out, asset.model));
  const exported = await modelExporter.exportModel(folder);
  await Bun.write(path.join(out, asset.model), exported.modelBytes);
  asset.rigJointBindings = path.posix.join(
    path.posix.dirname(asset.model),
    "joint-bindings.json",
  );
  asset.rigJointBindingKind = "original-rig-ordinal-model-bindings";
  await Bun.write(
    path.join(out, asset.rigJointBindings),
    exported.bindingBytes,
  );
  if (asset.animationCatalog) {
    animationExporter ??= await createArchivedAnimationExporter({
      sourceCache,
      cache,
      work,
      dotnet,
    });
    asset.animationPreparation = await animationExporter(folder);
    asset.animationEvidence = path
      .relative(out, path.join(folder, "animation-evidence.json"))
      .replaceAll("\\", "/");
  }
}
await modelExporter.verify();
if (actorSha256(await Bun.file(exporter).bytes()) !== exporterSha256)
  throw Error("Exporter changed during archived actor preparation");
for (const [file, sha256] of capturedTools)
  if (
    actorSha256(await Bun.file(new URL(file, import.meta.url)).bytes()) !==
    sha256
  )
    throw Error(`Actor preparation source changed during run: ${file}`);
for (const [file, sha256] of nativeMapProofSources)
  if (actorSha256(await Bun.file(file).bytes()) !== sha256)
    throw Error(`Native actor map proof source changed during run: ${file}`);
const files = [];
for (const file of new Bun.Glob("**/*").scanSync({
  cwd: out,
  onlyFiles: true,
})) {
  const bytes = await Bun.file(path.join(out, file)).bytes();
  files.push({
    path: file.replaceAll("\\", "/"),
    bytes: bytes.length,
    sha256: actorSha256(bytes),
  });
}
const manifest = {
  schema: 1,
  kind: "archived-original-actor-assets",
  build: request.build,
  protocol: request.protocol,
  spectatorAdmission: false,
  request: {
    sha256: actorSha256(requestBytes),
    provenance: request.provenance ?? null,
  },
  release: {
    url: MAP11_RELEASE_URL,
    sha256: MAP11_RELEASE_SHA256,
    manifestId: "B499FB04B1158CF6",
  },
  toolchain: {
    ...sources.toolchain,
    exporterSha256,
    ordinalModelExporter: modelExporter.toolchain,
    attackNamingSha256: profile.attackNamingSha256,
    preparationSources: Object.fromEntries(capturedTools),
  },
  champions: Object.fromEntries(
    Object.entries(prepared).filter(([, value]) => value.role === "champion"),
  ),
  worldAssets: Object.fromEntries(
    Object.entries(prepared).filter(([, value]) => value.role === "world"),
  ),
  unsupported,
  provenance: sources.provenance(),
  rmanReceipts: sources.receipts(),
  files: files.sort((a, b) => a.path.localeCompare(b.path)),
  limitations: [
    "Original static actor meshes, rigs, textures and animation files only; no match existence or placement inferred",
    "Native material/shader, animation-controller, forms, particles and audio fidelity remain unproved",
    "Absent metadata and unsupported assets remain explicit; this package cannot grant native viewer admission",
  ],
};
await write("manifest.json", JSON.stringify(manifest, null, 2));
console.log(
  JSON.stringify({
    output: out,
    prepared: Object.keys(prepared).length,
    unsupported: Object.keys(unsupported).length,
    textures: textureReferences.size,
    spectatorAdmission: false,
  }),
);
