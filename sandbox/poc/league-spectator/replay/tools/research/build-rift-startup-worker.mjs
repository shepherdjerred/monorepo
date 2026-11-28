import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readReviewedCombatAudioWav } from "./read-local-combat-audio-comparison.mjs";
import { readBuildScopedRiftBillboardAssets } from "./recorded-rift-billboard-source.mjs";
import { readBuildScopedRiftGroundGlowAssets } from "./recorded-rift-ground-glow-source.mjs";

const pins = {
  profile: "7edb0da20ea01e1617201cd12e038d8647b53761520634cc98feffacca3b2ee0",
  pages: "087dce77eb40947cedccbb8a8263ab7e0b8156897b6356236cba706350d44f9b",
};
const runtimePin =
  "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716";
const combatAudioPins = {
  profile: "c4389d7964e2f70a7f7e0194b640b0657744ae1b4698d74d44d0940d4846378b",
  pages: "cbb5494db63fd39a1956c5946f4c20c0ebdd76ea2fece2056703fb01bfe9faa8",
};
const combatBillboardPins = {
  profile: "8c2492c6a68cac9dbb504ac9ce4ce1214a73158ecc4d84f3ba583d257de26690",
  pages: "f6a17c9a7ae0d999ba708709fd2459125fa775a5c6884a8d9c5e602e4332622e",
};

async function readPinned(path, digest) {
  const bytes = await Bun.file(path).bytes();
  assert.equal(
    Bun.CryptoHasher.hash("sha256", bytes, "hex"),
    digest,
    "Rift native replay resource digest differs",
  );
  return bytes;
}

async function buildRiftWorker(name, profile, runtime, decompress, proofPins) {
  const [profileBytes, runtimeBytes, pages] = await Promise.all([
    readPinned(profile, proofPins.profile),
    readPinned(runtime, runtimePin),
    readPinned(join(dirname(profile), "pages.bin"), proofPins.pages),
  ]);
  const sources = new Map([
    [`/${name}-profile.json`, { contents: profileBytes, loader: "json" }],
    [`/${name}-emulator.mjs`, { contents: runtimeBytes, loader: "js" }],
  ]);
  const build = await Bun.build({
    entrypoints: [
      fileURLToPath(new URL(`./native-${name}-worker.mjs`, import.meta.url)),
    ],
    target: "browser",
    format: "esm",
    plugins: [
      {
        name: `verified-${name}-sources`,
        setup(plugin) {
          plugin.onResolve({ filter: /^\/fzstd\.mjs$/u }, () => ({
            path: resolve(decompress),
          }));
          plugin.onResolve(
            {
              filter:
                /^\/rift-(startup|combat-audio)-(profile\.json|emulator\.mjs)$/u,
            },
            ({ path }) => ({
              path,
              namespace: name,
            }),
          );
          plugin.onLoad({ filter: /.*/, namespace: name }, ({ path }) =>
            sources.get(path),
          );
        },
      },
    ],
  });
  if (!build.success || build.outputs.length !== 1)
    throw new AggregateError(build.logs, `Could not bundle ${name}`);
  return new Map([
    [`${name}-worker.mjs`, build.outputs[0]],
    [`${name}-pages.bin`, pages],
  ]);
}

export function buildRiftStartupWorker(profile, runtime, decompress) {
  return buildRiftWorker("rift-startup", profile, runtime, decompress, pins);
}

export async function buildRiftCombatWorker(
  profile,
  runtime,
  decompress,
  { wav, billboardSource, worldQuadSource },
) {
  assert.ok(
    worldQuadSource === undefined || billboardSource !== undefined,
    "Rift world quads require the reviewed billboard resources",
  );
  const [files, sound, billboards, worldQuad] = await Promise.all([
    buildRiftWorker(
      "rift-combat-audio",
      profile,
      runtime,
      decompress,
      billboardSource === undefined ? combatAudioPins : combatBillboardPins,
    ),
    wav === undefined ? undefined : readReviewedCombatAudioWav(wav),
    billboardSource === undefined
      ? undefined
      : readBuildScopedRiftBillboardAssets(billboardSource),
    worldQuadSource === undefined
      ? undefined
      : readBuildScopedRiftGroundGlowAssets(worldQuadSource, billboardSource),
  ]);
  if (sound !== undefined) files.set("combat-audio/329446178.wav", sound);
  for (const [path, bytes] of billboards ?? []) files.set(path, bytes);
  if (worldQuad !== undefined) {
    const { build, mapId, shaders } = JSON.parse(
      files.get("rift-billboards.json"),
    );
    assert.deepEqual(worldQuad.shaders, shaders);
    for (const [path, bytes] of worldQuad.files) {
      const existing = files.get(path);
      if (existing !== undefined) assert.deepEqual(existing, bytes);
      else files.set(path, bytes);
    }
    files.set(
      "rift-world-quads.json",
      JSON.stringify({
        schema: 1,
        kind: "recorded-rift-world-quad-resources",
        build,
        mapId,
        family: worldQuad.family,
        shaders,
      }),
    );
  }
  return files;
}
