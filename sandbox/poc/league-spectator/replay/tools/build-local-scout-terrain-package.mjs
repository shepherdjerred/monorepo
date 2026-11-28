import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { LocalScoutTerrainManifestSchema } from "../../../../../packages/scout-for-lol/packages/app/e2e/public-replay/local-scout-terrain-manifest.ts";
import { mayhemFlowMapAsset } from "./research/mayhem-flowmap-control-contract.mjs";

const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const entrypoint = "engine.mjs";
const sceneFiles = new Set([
  "map.json",
  "map.bin",
  "scene.json",
  "heights.bin",
  "minimap.png",
  "replay-motion-worker.mjs",
  "replay-motion-decoder.bin",
]);
const assetPath =
  /^(?:map-textures|champion-models|champion-animations|structure-models|structure-animations|nexus-models|inhibitor-models|world-unit-models|item-icons)\//;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function packageLocalRecordedParticles(files) {
  const track = files.get("recorded-particles.json");
  assert.ok(Buffer.isBuffer(track), "Expected validated particle track bytes");
  if (track.length <= 16 * 1024 * 1024) return files;
  assert.ok(
    track.length <= 64 * 1024 * 1024,
    "Recorded particle track exceeds the compact format limit",
  );
  const gzip = gzipSync(track, { level: 6 });
  const envelope = Buffer.from(
    JSON.stringify({
      kind: "gzip-recorded-native-terrain-particles",
      schema: 1,
      bytes: track.length,
      sha256: sha256(track),
    }),
  );
  if (gzip.length + envelope.length >= track.length) return files;
  const packed = new Map(files);
  assert.ok(!packed.has("recorded-particles.json.gz"));
  packed.set("recorded-particles.json", envelope);
  packed.set("recorded-particles.json.gz", gzip);
  return packed;
}

export async function readLocalRecordedParticles(path, digest, identity) {
  assert.match(digest, /^[a-f0-9]{64}$/);
  const bytes = await readFile(path);
  assert.equal(
    sha256(bytes),
    digest,
    "Recorded particle manifest digest differs",
  );
  return readLocalRecordedParticleResources(dirname(path), bytes, identity);
}

export async function readLocalRecordedParticleResources(
  directory,
  bytes,
  identity,
) {
  const track = JSON.parse(bytes);
  const impactComparison = identity.mayhemImpactComparison === true;
  assert.ok(
    (impactComparison ? [8] : [1, 2, 3, 4, 5, 6, 7]).includes(track.schema),
  );
  assert.equal(track.kind, "recorded-native-terrain-particles");
  assert.equal(track.build, "16.23.841.8428");
  assert.equal(track.build, identity.build);
  assert.equal(track.replaySha256, identity.replaySha256);
  assert.equal(
    track.status,
    impactComparison
      ? "controlled-mayhem-impact-comparison"
      : "verified-partial-effects",
  );
  assert.equal(
    track.scope,
    impactComparison
      ? "native-sampled-supplied-random"
      : "native-sampled-cold-remap",
  );
  const files = new Map([["recorded-particles.json", bytes]]);
  const declaredTextures = new Set(track.textures.files);
  const expectedTextures = new Set(
    track.schema === 1
      ? [
          track.textures.palette,
          ...track.components.map(({ texture }) => texture),
        ]
      : track.families.flatMap(({ components }) =>
          components.flatMap(({ texture, palette }) => [texture, palette]),
        ),
  );
  if (track.schema >= 4 && track.schema <= 6) {
    expectedTextures.add(track.worldRibbon.texture);
    expectedTextures.add(track.worldRibbon.palette);
  }
  if (track.schema >= 5)
    for (const { components } of track.families)
      for (const { depthTest } of components)
        assert.equal(
          typeof depthTest,
          "boolean",
          "Missing particle depth test state",
        );
  const maskedQuad = track.schema === 6 ? track.worldMaskedQuad : undefined;
  if (track.schema === 6) {
    assert.ok(maskedQuad, "Missing masked ground particle track");
    const { width, height } = maskedQuad.mask;
    assert.ok(
      [width, height].every(
        (size) => Number.isInteger(size) && size >= 1 && size <= 4096,
      ),
    );
    expectedTextures.add(maskedQuad.texture);
    expectedTextures.add(maskedQuad.palette);
  }
  if (track.worldUnmaskedQuad !== undefined) {
    const { texture, palette, depthTest } = track.worldUnmaskedQuad;
    assert.equal(track.schema, 6, "Unsupported unmasked ground particle track");
    assert.equal(depthTest, false, "Unexpected unmasked quad depth test state");
    expectedTextures.add(texture);
    expectedTextures.add(palette);
  }
  const packedWorldImpact = track.packedWorldImpacts?.[0];
  if (track.packedWorldImpacts !== undefined) {
    assert.equal(track.schema, 8, "Unsupported packed world impact");
    assert.equal(track.packedWorldImpacts.length, 1);
    assert.ok(packedWorldImpact && track.worldImpact === undefined);
    assert.ok(
      Number.isSafeInteger(packedWorldImpact.bytes) &&
        packedWorldImpact.bytes >= 4 &&
        packedWorldImpact.bytes <= 16 * 1024 * 1024,
      "Packed world impact exceeds the geometry limit",
    );
  }
  if (impactComparison) {
    const reviewed = new Map([
      ["heimerdinger-w-impact", { components: 2, effects: 210 }],
      ["heimerdinger-q-ammo-spend", { components: 1, effects: 84 }],
    ]);
    const declared = new Set();
    let effects = 0;
    for (const { id, components } of track.families) {
      const expected = reviewed.get(id);
      assert.ok(
        expected && !declared.has(id),
        "Unreviewed Mayhem effect family",
      );
      declared.add(id);
      assert.equal(components.length, expected.components);
      assert.equal(
        track.effects.filter(({ family }) => family === id).length,
        expected.effects,
      );
      effects += expected.effects;
    }
    assert.equal(track.effects.length, effects);
    for (const { texture, palette } of [
      packedWorldImpact ?? track.worldImpact,
      ...(track.additionalWorldImpacts ?? []),
    ]) {
      expectedTextures.add(texture);
      expectedTextures.add(palette);
    }
  }
  if (track.schema === 1) assert.equal(expectedTextures.size, 3);
  assert.equal(track.textures.files.length, expectedTextures.size);
  assert.equal(declaredTextures.size, expectedTextures.size);
  assert.ok([...expectedTextures].every((file) => declaredTextures.has(file)));
  const shaders = [track.shaders.vertex, track.shaders.fragment];
  if (
    (track.schema >= 3 && track.schema <= 6) ||
    (track.schema === 7 && track.shaders.noAlphaTestFragment !== undefined)
  )
    shaders.push(track.shaders.noAlphaTestFragment);
  if (maskedQuad !== undefined)
    shaders.push(maskedQuad.vertexShader, maskedQuad.fragmentShader);
  for (const [file, pattern] of [
    ...[...expectedTextures].map((path) => [
      path,
      /^recorded-particles\/([a-f0-9]{64})\.png$/,
    ]),
    ...shaders.map((path) => [
      path,
      /^recorded-particles\/([a-f0-9]{64})\.glsl$/,
    ]),
    ...(maskedQuad === undefined
      ? []
      : [[maskedQuad.mask.path, /^recorded-particles\/([a-f0-9]{64})\.r8$/]]),
    ...(packedWorldImpact === undefined
      ? []
      : [
          [packedWorldImpact.path, /^recorded-particles\/([a-f0-9]{64})\.bin$/],
        ]),
  ]) {
    const match = pattern.exec(file);
    assert.ok(
      match && !files.has(file),
      "Invalid recorded particle asset path",
    );
    const asset = await readFile(join(directory, file));
    assert.equal(
      sha256(asset),
      match[1],
      "Recorded particle asset digest differs",
    );
    if (maskedQuad?.mask.path === file)
      assert.equal(
        asset.length,
        maskedQuad.mask.width * maskedQuad.mask.height,
        "Recorded particle mask byte length differs",
      );
    if (packedWorldImpact?.path === file)
      assert.equal(
        asset.length,
        packedWorldImpact.bytes,
        "Packed world impact byte length differs",
      );
    files.set(file, asset);
  }
  return files;
}

async function buildEngine(threeCore) {
  const result = await Bun.build({
    entrypoints: [
      fileURLToPath(new URL("../scout-terrain-engine.ts", import.meta.url)),
    ],
    format: "esm",
    target: "browser",
    plugins: [
      {
        name: "local-scout-terrain-three",
        setup(builder) {
          builder.onResolve({ filter: /^\/three\.core\.js$/ }, () => ({
            path: resolve(threeCore),
          }));
          builder.onResolve(
            { filter: /^(?:zod$|@scout-for-lol\/replay\/)/ },
            (args) => ({
              path: Bun.resolveSync(
                args.path,
                join(repoRoot, "packages/scout-for-lol/packages/app"),
              ),
            }),
          );
        },
      },
    ],
  });
  if (!result.success || result.outputs.length !== 1)
    throw new AggregateError(result.logs, "Scout terrain engine bundle failed");
  return result.outputs[0];
}

export async function writeLocalScoutTerrainPackage({
  output,
  identity,
  buildScoped = false,
  map = { mapId: 11, gameMode: "CLASSIC" },
  routes,
  threeCore,
  announcerFiles,
  combatAudioFiles,
  particleFiles,
  impactComparisonFiles,
  riftStartupFiles,
  riftCombatFiles,
}) {
  assert.ok(
    riftStartupFiles === undefined || buildScoped,
    "The original startup worker requires a build-scoped Rift package",
  );
  assert.ok(
    riftCombatFiles === undefined || riftStartupFiles !== undefined,
    "Replay-decoded combat requires the original Rift startup worker",
  );
  if (buildScoped) {
    assert.deepEqual(map, { mapId: 11, gameMode: "CLASSIC" });
    assert.ok(
      [combatAudioFiles, particleFiles, impactComparisonFiles].every(
        (files) => files === undefined,
      ),
      "Replay-bound resources are unavailable in build-scoped packages",
    );
    const { validateBuildScopedRiftScene } =
      await import("./research/build-scoped-rift-scene.mjs");
    const scene = routes.get("/scene.json")?.[0];
    assert.equal(typeof scene, "string");
    const staticScene = JSON.parse(scene);
    validateBuildScopedRiftScene(staticScene);
    assert.equal(
      announcerFiles !== undefined,
      staticScene.workerMotion.announcerEvents !== undefined,
      "Build-scoped announcer audio requires the authored worker event catalog",
    );
    assert.ok(
      !announcerFiles?.has("announcer-preview/cues.json"),
      "Build-scoped announcer audio cannot include replay-bound cues",
    );
  }
  const cache = join(await realpath(repoRoot), ".cache");
  const outputRoot = resolve(output);
  assert.equal(
    dirname(outputRoot),
    cache,
    "Choose a new direct child of the repository's ignored .cache directory",
  );
  await mkdir(cache, { recursive: true });
  assert.equal(
    relative(await realpath(repoRoot), await realpath(cache)),
    ".cache",
    "Private package cache must stay inside this repository",
  );
  const resources = new Map([[entrypoint, await buildEngine(threeCore)]]);
  for (const [path, bytes] of riftStartupFiles ?? [])
    resources.set(path, bytes);
  for (const [path, bytes] of riftCombatFiles ?? []) resources.set(path, bytes);
  if (impactComparisonFiles !== undefined) {
    assert.equal(particleFiles, undefined);
    assert.equal(map.mapId, 12);
    assert.equal(map.gameMode, "KIWI");
    assert.equal(map.mayhemMapSkin, "Bloom");
  }
  for (const [path, bytes] of announcerFiles ?? []) resources.set(path, bytes);
  if (combatAudioFiles !== undefined) {
    assert.equal(map.mapId, 11);
    for (const [path, bytes] of combatAudioFiles) resources.set(path, bytes);
  }
  const recordedParticleFiles = particleFiles ?? impactComparisonFiles;
  if (recordedParticleFiles !== undefined)
    for (const [path, bytes] of packageLocalRecordedParticles(
      recordedParticleFiles,
    ))
      resources.set(path, bytes);
  for (const [route, [body]] of routes) {
    assert.ok(route.startsWith("/"));
    const path = route.slice(1);
    if (path.startsWith("flowmap-control/")) {
      assert.equal(map.mapId, 12);
      assert.equal(map.gameMode, "KIWI");
      assert.equal(map.mayhemMapSkin, "Bloom");
      assert.match(path.slice("flowmap-control/".length), mayhemFlowMapAsset);
      resources.set(path, body);
    }
    if (sceneFiles.has(path) || assetPath.test(path)) resources.set(path, body);
  }
  for (const path of sceneFiles)
    assert.ok(
      resources.has(path),
      `Required terrain resource missing: ${path}`,
    );

  const files = [];
  for (const path of [...resources.keys()].sort()) {
    const bytes = Buffer.from(
      await new Response(resources.get(path)).arrayBuffer(),
    );
    resources.set(path, bytes);
    files.push({ path, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  const manifest = LocalScoutTerrainManifestSchema.parse({
    schemaVersion: 1,
    gameBuild: identity.build,
    protocol: identity.protocol,
    entrypoint,
    capabilities: buildScoped
      ? {
          ...map,
          teamSizes: [5, 5],
          rosterCoverage: "build-scoped-archive",
          ...(riftStartupFiles === undefined
            ? {}
            : { mapModeSource: "original-startup" }),
          ...(announcerFiles === undefined
            ? {}
            : { announcerPreview: "female1-en-us" }),
          ...(riftCombatFiles?.has("combat-audio/329446178.wav")
            ? { combatAudioComparison: "replay-decoded-dry-source" }
            : {}),
          ...(riftCombatFiles?.has("rift-billboards.json")
            ? { particlePreview: "replay-decoded-billboards" }
            : {}),
        }
      : {
          ...map,
          teamSizes: [5, 5],
          rosterCoverage: "recorded-replay",
          replaySha256: identity.replaySha256,
          ...(announcerFiles === undefined
            ? {}
            : { announcerPreview: "female1-en-us" }),
          ...(combatAudioFiles === undefined
            ? {}
            : { combatAudioComparison: "packet-clock-dry-source" }),
          ...(particleFiles === undefined
            ? {}
            : { particlePreview: "verified-partial-effects" }),
          ...(impactComparisonFiles === undefined
            ? {}
            : { mayhemImpactComparison: "supplied-random-world-quad" }),
        },
    files,
  });
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const manifestSha256 = sha256(manifestBytes);
  const packageDirectory = join(outputRoot, manifestSha256);
  await mkdir(outputRoot);
  await mkdir(packageDirectory);
  for (const [path, bytes] of resources) {
    const file = join(packageDirectory, ...path.split("/"));
    assert.ok(file.startsWith(packageDirectory + sep));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes, { flag: "wx" });
  }
  const manifestPath = join(packageDirectory, "manifest.json");
  await writeFile(manifestPath, manifestBytes, { flag: "wx" });
  return {
    manifestPath,
    manifestSha256,
    ...(buildScoped
      ? { build: identity.build, protocol: identity.protocol }
      : identity),
    fileCount: files.length,
  };
}

if (import.meta.main) {
  const [output, ...args] = process.argv.slice(2);
  assert.ok(
    output && args.length >= 3,
    "Usage: bun build-local-scout-terrain-package.mjs <new .cache child> <terrain directory> <three.core.js> <replay.rofl> --position-decoder <prepared decoder> --worker-decompressor <fzstd.mjs> --terrain-materials <materials.json> --champion-models <models manifest> [--turret-placements <receipt> --structure-models <structures manifest>] [--nexus-models <nexus manifest>] [--inhibitor-models <manifest> --inhibitor-models-sha256 <sha256>] [--announcer-preview <verified timing directory>]",
  );
  const server = fileURLToPath(
    new URL("./serve-native-terrain.mjs", import.meta.url),
  );
  const result = Bun.spawnSync(
    [process.execPath, server, ...args, "--private-package-output", output],
    { stdout: "inherit", stderr: "inherit" },
  );
  process.exitCode = result.exitCode;
}
