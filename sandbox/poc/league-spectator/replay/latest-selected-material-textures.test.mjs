import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { sha256 } from "./structural-comparison.mjs";
import {
  assertSelectedMaterialTextureInventory,
  loadLatestSelectedMaterialTextures,
} from "./latest-selected-material-textures.mjs";

const fixtureCache = process.env.SCOUT_REPLAY_LINEUP_FIXTURE_CACHE;
if (fixtureCache !== undefined && !fixtureCache.trim())
  throw Error("Explicit selected lineup fixture cache must be nonempty");
test("selected static RGBA inventory retains every original PNG/material use and resource parent", async () => {
  const root = resolve(
      fixtureCache ?? ".cache/replay-lineup-5667809143",
      "public",
    ),
    bytes = await Bun.file(`${root}/latest-effects/manifest.json`).bytes(),
    quadBytes = await Bun.file(
      `${root}/latest-complete-quad-gpu/package.json`,
    ).bytes(),
    metadata = await Bun.file(
      `${root}/latest-selected-material-textures/package.json`,
    ).json(),
    manifest = JSON.parse(new TextDecoder().decode(bytes)),
    quad = JSON.parse(new TextDecoder().decode(quadBytes)),
    catalogFiles = {};
  for (const ref of Object.values(metadata.textures)) {
    catalogFiles[`latest-effects/${ref.sourceFile}`] = {
      sha256: ref.sourceSha256,
      bytes: ref.sourceBytes,
    };
    catalogFiles[`latest-selected-material-textures/${ref.file}`] = {
      sha256: ref.sha256,
      bytes: ref.bytes,
    };
  }
  const input = {
    metadata,
    manifest,
    quad,
    catalogFiles,
    manifestSha256: await sha256(bytes),
    quadSha256: await sha256(quadBytes),
  };
  expect(() => assertSelectedMaterialTextureInventory(input)).not.toThrow();
  expect(Object.keys(metadata.textures)).toHaveLength(528);
  const key = Object.keys(metadata.textures)[0],
    file = metadata.textures[key].file;
  for (const edit of [
    (x) => delete x.metadata.textures[key],
    (x) =>
      (x.metadata.textures.extra = structuredClone(x.metadata.textures[key])),
    (x) => (x.metadata.textures[key].sourceFile = "textures/forged.png"),
    (x) => x.metadata.textures[key].width++,
    (x) => (x.metadata.textures[key].file = "../foreign.bin"),
    (x) => x.metadata.files[file].bytes++,
    (x) => (x.metadata.scope.colorSpaceConversion = true),
    (x) => (x.metadata.scope.nativeMaterialAdmissionEstablished = true),
    (x) => (x.metadata.pngPolicy = "automatic-color-conversion"),
    (x) => (x.metadata.quadGpuSha256 = "0".repeat(64)),
    (x) =>
      (x.catalogFiles[`latest-selected-material-textures/${file}`].sha256 =
        "0".repeat(64)),
    (x) => x.metadata.uses[key].reverse(),
  ]) {
    const changed = structuredClone(input);
    edit(changed);
    expect(() => assertSelectedMaterialTextureInventory(changed)).toThrow();
  }
  // Pixel inventory alone does not admit a native default: schema2 binds its
  // separate authority, and the material registry validates the native proof.
  const controlled = structuredClone(input);
  controlled.quad.schema = 2;
  controlled.quad.originalColdDefaultAuthoritySha256 = "a".repeat(64);
  let firstCold = null;
  for (const emitter of controlled.quad.emitters)
    for (const binding of Object.values(emitter.textures))
      if (
        ["supplied-white-lookup", "supplied-transparent-remap"].includes(
          binding.kind,
        )
      ) {
        binding.kind = "original-cold-default-texture";
        binding.authoritySha256 =
          controlled.quad.originalColdDefaultAuthoritySha256;
        firstCold ??= binding;
      }
  expect(firstCold).not.toBeNull();
  controlled.quadSha256 = await sha256(
    new TextEncoder().encode(JSON.stringify(controlled.quad)),
  );
  controlled.metadata.quadGpuSha256 = controlled.quadSha256;
  expect(() =>
    assertSelectedMaterialTextureInventory(controlled),
  ).not.toThrow();
  firstCold.authoritySha256 = "b".repeat(64);
  expect(() => assertSelectedMaterialTextureInventory(controlled)).toThrow(
    "Unknown selected material texture kind",
  );
  firstCold.authoritySha256 =
    controlled.quad.originalColdDefaultAuthoritySha256;
  controlled.quad.schema = 1;
  expect(() => assertSelectedMaterialTextureInventory(controlled)).toThrow(
    "Unknown selected material texture kind",
  );
  // Schema3 has a separate all-vision resource parent. It cannot inherit the
  // cold-default route, lose its perspective, or appear in an older schema.
  controlled.quad.schema = 3;
  controlled.quad.perspective = "all";
  controlled.quad.originalAllVisionFogAuthoritySha256 = "c".repeat(64);
  firstCold.kind = "original-all-vision-fog-texture";
  firstCold.perspective = "all";
  firstCold.authoritySha256 =
    controlled.quad.originalAllVisionFogAuthoritySha256;
  controlled.quadSha256 = await sha256(
    new TextEncoder().encode(JSON.stringify(controlled.quad)),
  );
  controlled.metadata.quadGpuSha256 = controlled.quadSha256;
  expect(() =>
    assertSelectedMaterialTextureInventory(controlled),
  ).not.toThrow();
  for (const edit of [
    (value) => {
      value.quad.schema = 2;
    },
    (value) => {
      value.quad.perspective = "blue";
    },
    (value) => {
      value.quad.originalAllVisionFogAuthoritySha256 = "d".repeat(64);
    },
    (value) => {
      for (const emitter of value.quad.emitters)
        for (const binding of Object.values(emitter.textures))
          if (binding.kind === "original-all-vision-fog-texture")
            binding.perspective = "red";
    },
  ]) {
    const changed = structuredClone(controlled);
    edit(changed);
    expect(() => assertSelectedMaterialTextureInventory(changed)).toThrow(
      "Unknown selected material texture kind",
    );
  }
});
test("selected texture loader cannot be minted from catalog or material lookalikes", async () => {
  await expect(
    loadLatestSelectedMaterialTextures({
      staticCatalog: {},
      selectedMaterials: {},
    }),
  ).rejects.toThrow("Owned selected static catalog");
});
