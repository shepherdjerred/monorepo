import { expect, test } from "bun:test";
import { sha256 } from "./structural-comparison.mjs";
import {
  assertSelectedMaterialTextureInventory,
  loadLatestSelectedMaterialTextures,
} from "./latest-selected-material-textures.mjs";

test("selected static RGBA inventory retains every original PNG/material use and resource parent", async () => {
  const root = ".cache/replay-lineup-5667809143/public",
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
});
test("selected texture loader cannot be minted from catalog or material lookalikes", async () => {
  await expect(
    loadLatestSelectedMaterialTextures({
      staticCatalog: {},
      selectedMaterials: {},
    }),
  ).rejects.toThrow("Owned selected static catalog");
});
