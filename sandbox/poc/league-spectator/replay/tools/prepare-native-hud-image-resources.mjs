import path from "node:path";
import { sha256 } from "../structural-comparison.mjs";

const [
  decoderRoot,
  resourcePath,
  baseLinksPath,
  atlasPath,
  directPath,
  indirectPath,
  output,
] = process.argv.slice(2);
if (!output)
  throw Error(
    "Usage: bun prepare-native-hud-image-resources.mjs <decoder-directory> <resource-links.json> <base-links.json> <native-atlas-observations.json> <direct-textures.json> <indirect-textures.json> <output.json>",
  );
async function read(file) {
  const bytes = await Bun.file(file).bytes();
  return {
    value: JSON.parse(new TextDecoder().decode(bytes)),
    sha256: await sha256(bytes),
  };
}
const [resources, bases, native, direct, indirect] = await Promise.all(
  [resourcePath, baseLinksPath, atlasPath, directPath, indirectPath].map(read),
);
const image = await Bun.file(path.join(decoderRoot, "image.bin")).bytes();
if (
  resources.value.baseLinksSha256 !== bases.sha256 ||
  native.value.linksSha256 !== bases.sha256 ||
  native.value.kind !== "original-archived-image-atlas-reader-observations" ||
  native.value.observations.length !== 3
)
  throw Error("Original HUD resource/native-atlas receipt lineage changed");
for (const [source, expected] of Object.entries(native.value.sources))
  if ((await sha256(await Bun.file(source).bytes())) !== expected)
    throw Error(`Stale original image-atlas producer: ${source}`);
const textures = new Map();
for (const receipt of [direct, indirect]) {
  if (
    receipt.value.schema !== 1 ||
    receipt.value.build !== "16.21.829.8620" ||
    receipt.value.protocol !== "20e09df23c66b85e" ||
    receipt.value.exporterSha256 !==
      "fa498afc3f81fafa9d7a39027700bd439d99c7a2b13fd3112f1f8437596d67c3"
  )
    throw Error("Original HUD texture conversion lineage changed");
  for (const texture of receipt.value.textures) {
    const raw = await Bun.file(texture.raw).bytes(),
      png = await Bun.file(texture.file).bytes();
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    if (
      (await sha256(raw)) !== texture.sourceSha256 ||
      (await sha256(png)) !== texture.pngSha256 ||
      new TextDecoder().decode(raw.subarray(0, 4)) !== "TEX\0" ||
      view.getUint16(4, true) !== texture.width ||
      view.getUint16(6, true) !== texture.height ||
      textures.has(texture.reference)
    )
      throw Error("Original HUD texture identity changed or became ambiguous");
    textures.set(texture.reference, texture);
  }
}
const indirectImages = new Map();
for (const atlas of native.value.observations) {
  if (
    atlas.boundary !== null ||
    (await sha256(image)) !== atlas.imageSha256 ||
    atlas.originalImageLookups.length !== atlas.imageRecords.length ||
    atlas.missingKeyRejectedByAtlasBranch !== "0"
  )
    throw Error("Original image-atlas native controls incomplete");
  for (const block of atlas.originalBlocks)
    if (
      (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
      block.sha256
    )
      throw Error("Original image-atlas program changed");
  const source = await Bun.file(
    path.join(path.dirname(baseLinksPath), atlas.source.filename),
  ).bytes();
  if (
    source.length !== atlas.source.bytes ||
    (await sha256(source)) !== atlas.source.sha256 ||
    atlas.stream.position !== source.length
  )
    throw Error("Original image-atlas WAD bytes changed");
  for (const lookup of atlas.originalImageLookups) {
    const row = atlas.imageRecords[lookup.rowIndex],
      texture = textures.get(lookup.header64);
    if (
      !row ||
      row.key64 !== lookup.key64 ||
      row.indexedHeaderWord64 !== lookup.header64 ||
      JSON.stringify(row.valuesF32) !== JSON.stringify(lookup.uvValuesF32) ||
      !texture ||
      indirectImages.has(lookup.key64)
    )
      throw Error(
        "Original atlas lookup no longer joins its exact image/texture bytes",
      );
    const view = new DataView(
      new Uint8Array(Buffer.from(lookup.uvHex, "hex")).buffer,
    );
    if (
      view.byteLength !== 16 ||
      lookup.uvValuesF32.some(
        (value, index) => !Object.is(value, view.getFloat32(index * 4, true)),
      )
    )
      throw Error("Original image UV float bytes changed");
    indirectImages.set(lookup.key64, {
      texture,
      atlas: {
        reference: atlas.reference,
        sourceSha256: atlas.source.sha256,
        rowIndex: lookup.rowIndex,
        uvHex: lookup.uvHex,
        uv: lookup.uvValuesF32,
      },
    });
  }
}
const images = resources.value.rows.map((row) => {
  const directTexture = textures.get(row.reference.value),
    indirectImage = indirectImages.get(row.reference.value);
  if (!!directTexture === !!indirectImage)
    throw Error(
      "Original HUD image must have one unambiguous original resolution",
    );
  if (
    directTexture &&
    (!row.textureLocations.length ||
      !row.textureLocations.some(
        (location) => location.sha256 === directTexture.sourceSha256,
      ))
  )
    throw Error("Original direct image reference differs from its WAD source");
  const found = indirectImage ?? { texture: directTexture, atlas: null };
  return {
    baseHash: row.baseHash,
    sourceSha256: row.sourceSha256,
    objectHash: row.objectHash,
    objectType: row.objectType,
    fields: row.fields,
    reference: row.reference,
    ...found,
  };
});
const manifest = {
  schema: 1,
  kind: "native-hud-original-image-resources",
  build: "16.21.829.8620",
  protocol: "20e09df23c66b85e",
  sourceReceipts: {
    resourceLinks: resources.sha256,
    baseLinks: bases.sha256,
    nativeAtlas: native.sha256,
    directTextures: direct.sha256,
    indirectTextures: indirect.sha256,
  },
  scenes: resources.value.scenes,
  images,
  scope: {
    originalWadImagesResolved: true,
    originalAtlasLookupExecuted: true,
    originalImageUvCopyExecuted: true,
    uvCompositionExecuted: false,
    controllerStateExecuted: false,
    nativeTextLayoutExecuted: false,
    renderedHud: false,
  },
};
await Bun.write(output, JSON.stringify(manifest, null, 2));
console.log(
  JSON.stringify({
    output,
    sha256: await sha256(await Bun.file(output).bytes()),
    scenes: manifest.scenes.length,
    images: images.length,
    direct: images.filter((image) => image.atlas === null).length,
    indirect: images.filter((image) => image.atlas !== null).length,
    textures: textures.size,
  }),
);
