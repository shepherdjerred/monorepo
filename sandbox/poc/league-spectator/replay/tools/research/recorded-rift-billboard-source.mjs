import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve, toNamespacedPath } from "node:path";
import { gunzipSync } from "node:zlib";
import { readLocalRecordedParticleResources } from "../build-local-scout-terrain-package.mjs";

const build = "16.23.841.8428";
const replaySha256 =
  "a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1";
const envelopeSha256 =
  "55f6c5da1be9e0ad9bf51abdf8b5bed1e6d1f5325d25d40a7fce8d23809ffac3";
const trackSha256 =
  "a33cab26aa67969d564319e47549a172c5d3679aa864de6d2adb0a0e69b99dda";
const trackBytes = 50_579_529;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// These native captures supply reusable local geometry and material only.
// Replay lifecycles and placement must be derived separately on every upload.
const reviewedFamilies = [
  "senna-w-ground-impact-flare",
  "heimerdinger-w-impact",
  "heimerdinger-q-ammo-spend",
  "kaisa-e-activation",
  "senna-soul-death",
];

export async function readBuildScopedRiftBillboardAssets(
  source,
  { ribbon = false } = {},
) {
  const path = toNamespacedPath(resolve(source));
  const directory = dirname(path);
  const manifest = await readFile(path);
  const packed = sha256(manifest) === envelopeSha256;
  const bytes = packed
    ? gunzipSync(
        await readFile(join(directory, "recorded-particles.json.gz")),
        { maxOutputLength: trackBytes },
      )
    : manifest;
  assert.equal(bytes.length, trackBytes, "Rift billboard source size differs");
  assert.equal(
    sha256(bytes),
    trackSha256,
    "Rift billboard source digest differs",
  );
  const assets = await readLocalRecordedParticleResources(directory, bytes, {
    build,
    replaySha256,
  });
  const track = JSON.parse(bytes);
  const families = reviewedFamilies.map((familyId) => {
    const family = track.families.find(({ id }) => id === familyId);
    assert.ok(family, `Missing reviewed Rift billboard family ${familyId}`);
    return family;
  });
  const textures = [
    ...new Set(
      families.flatMap(({ components }) =>
        components.flatMap(({ texture, palette }) => [texture, palette]),
      ),
    ),
  ];
  const { vertex, fragment, noAlphaTestFragment } = track.shaders;
  const shaders = { vertex, fragment, noAlphaTestFragment };
  const files = new Map(
    [...textures, ...Object.values(shaders)].map((path) => [
      path,
      assets.get(path),
    ]),
  );
  files.set(
    "rift-billboards.json",
    JSON.stringify({
      schema: 1,
      kind: "recorded-rift-billboard-resources",
      build,
      mapId: 11,
      families,
      textures: { files: textures },
      shaders,
    }),
  );
  if (ribbon) {
    const { texture, palette } = track.worldRibbon;
    for (const path of [texture, palette]) files.set(path, assets.get(path));
    files.set(
      "rift-ribbon.json",
      JSON.stringify({
        schema: 1,
        kind: "recorded-rift-ribbon-resource",
        build,
        mapId: 11,
        texture,
        palette,
      }),
    );
  }
  return files;
}
