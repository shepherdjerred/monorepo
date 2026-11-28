import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { LocalScoutTerrainManifestSchema } from "../../../../../packages/scout-for-lol/packages/app/e2e/public-replay/local-scout-terrain-manifest.ts";

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

export async function readLocalRecordedParticles(path, digest, identity) {
  assert.match(digest, /^[a-f0-9]{64}$/);
  const bytes = await readFile(path);
  assert.equal(
    sha256(bytes),
    digest,
    "Recorded particle manifest digest differs",
  );
  const track = JSON.parse(bytes);
  assert.ok([1, 2, 3].includes(track.schema));
  assert.equal(track.kind, "recorded-native-terrain-particles");
  assert.equal(track.build, "16.23.841.8428");
  assert.equal(track.build, identity.build);
  assert.equal(track.replaySha256, identity.replaySha256);
  assert.equal(track.status, "verified-partial-effects");
  assert.equal(track.scope, "native-sampled-cold-remap");
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
  if (track.schema === 1) assert.equal(expectedTextures.size, 3);
  assert.equal(track.textures.files.length, expectedTextures.size);
  assert.equal(declaredTextures.size, expectedTextures.size);
  assert.ok([...expectedTextures].every((file) => declaredTextures.has(file)));
  const shaders = [track.shaders.vertex, track.shaders.fragment];
  if (track.schema === 3) shaders.push(track.shaders.noAlphaTestFragment);
  for (const [file, pattern] of [
    ...[...expectedTextures].map((path) => [
      path,
      /^recorded-particles\/([a-f0-9]{64})\.png$/,
    ]),
    ...shaders.map((path) => [
      path,
      /^recorded-particles\/([a-f0-9]{64})\.glsl$/,
    ]),
  ]) {
    const match = pattern.exec(file);
    assert.ok(
      match && !files.has(file),
      "Invalid recorded particle asset path",
    );
    const asset = await readFile(join(dirname(path), file));
    assert.equal(
      sha256(asset),
      match[1],
      "Recorded particle asset digest differs",
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
  routes,
  threeCore,
  announcerFiles,
  particleFiles,
}) {
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
  for (const [path, bytes] of announcerFiles ?? []) resources.set(path, bytes);
  for (const [path, bytes] of particleFiles ?? []) resources.set(path, bytes);
  for (const [route, [body]] of routes) {
    assert.ok(route.startsWith("/"));
    const path = route.slice(1);
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
    capabilities: {
      mapId: 11,
      gameMode: "CLASSIC",
      teamSizes: [5, 5],
      rosterCoverage: "recorded-replay",
      replaySha256: identity.replaySha256,
      ...(announcerFiles === undefined
        ? {}
        : { announcerPreview: "female1-en-us" }),
      ...(particleFiles === undefined
        ? {}
        : { particlePreview: "verified-partial-effects" }),
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
  return { manifestPath, manifestSha256, ...identity, fileCount: files.length };
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
