import { sha256 } from "./structural-comparison.mjs";
import { assertLatestStaticCatalogSelection } from "./latest-static-catalog.mjs";
import { assertLatestSelectedMaterials } from "./latest-selected-materials.mjs";
import { sameDirectCompiledData } from "./latest-direct-compiled-restore.mjs";
import {
  decodeLatestRgba8Png,
  SELECTED_RGBA8_PNG_POLICY,
} from "./latest-rgba8-png.mjs";

const parse = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
const need = (value, message) => {
  if (!value) throw Error(message);
};
const hex = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const directory = "latest-selected-material-textures";
const scope = Object.freeze({
  containsReplayData: false,
  selection: "selected-quad-package-declared-texture-closure",
  nativeMaterialAdmissionEstablished: false,
  pixelFormat: "RGBA8",
  rowOrder: "source-top-to-bottom",
  premultiplied: false,
  colorSpaceConversion: false,
  mipmaps: false,
  sourcePngPixelsCompared: true,
  unsupportedFamiliesPrepared: false,
});

// This validates the entire static pixel inventory, not native material eligibility.
export function assertSelectedMaterialTextureInventory({
  metadata,
  manifest,
  quad,
  manifestSha256,
  quadSha256,
  catalogFiles,
}) {
  need(
    metadata.schema === 1 &&
      metadata.kind === "prepared-selected-material-rgba8-textures" &&
      metadata.build === manifest.build &&
      metadata.protocol === manifest.protocol &&
      metadata.effectsManifestSha256 === manifestSha256 &&
      metadata.quadGpuSha256 === quadSha256 &&
      quad.effectsManifestSha256 === manifestSha256 &&
      metadata.pngPolicy === SELECTED_RGBA8_PNG_POLICY &&
      sameDirectCompiledData(metadata.scope, scope),
    "Selected RGBA format/source contract differs",
  );
  const expected = new Map(),
    uses = {},
    files = {};
  for (const emitter of quad.emitters) {
    need(
      manifest.definitions[emitter.effectId]?.sha256 ===
        emitter.sourceDefinitionSha256,
      "Selected RGBA definition parent differs",
    );
    for (const [uniform, binding] of Object.entries(emitter.textures)) {
      if (binding.kind !== "prepared-texture") {
        need(
          ["supplied-white-lookup", "supplied-transparent-remap"].includes(
            binding.kind,
          ),
          "Unknown selected material texture kind",
        );
        continue;
      }
      need(
        hex(binding.sha256) &&
          /^textures\/[a-f0-9]{24,64}\.png$/.test(binding.file),
        "Exact selected PNG identity required",
      );
      need(
        !expected.has(binding.sha256) ||
          expected.get(binding.sha256) === binding.file,
        "Ambiguous selected PNG identity",
      );
      expected.set(binding.sha256, binding.file);
      (uses[binding.sha256] ??= []).push({
        effectId: emitter.effectId,
        emitterIndex: emitter.emitterIndex,
        uniform,
      });
    }
  }
  need(
    sameDirectCompiledData(
      Object.keys(metadata.textures).sort(),
      [...expected.keys()].sort(),
    ) && sameDirectCompiledData(metadata.uses, uses),
    "Selected RGBA texture/use inventory differs",
  );
  const assets = new Map();
  for (const asset of Object.values(manifest.assets))
    if (asset.status === "prepared" && asset.kind === "texture") {
      const list = assets.get(asset.file) ?? [];
      list.push(asset);
      assets.set(asset.file, list);
    }
  for (const [key, sourceFile] of expected) {
    const ref = metadata.textures[key],
      sources = assets.get(sourceFile),
      source = catalogFiles[`latest-effects/${sourceFile}`],
      raw = catalogFiles[`${directory}/${ref.file}`];
    need(
      ref.sourceFile === sourceFile &&
        ref.sourceSha256 === key &&
        hex(ref.sha256) &&
        ref.file === `rgba-${ref.sha256}.bin` &&
        Number.isSafeInteger(ref.width) &&
        Number.isSafeInteger(ref.height) &&
        ref.width > 0 &&
        ref.height > 0 &&
        ref.width <= 16384 &&
        ref.height <= 16384 &&
        ref.width * ref.height <= 16777216 &&
        ref.bytes === ref.width * ref.height * 4 &&
        sources?.length &&
        sources.every(
          (asset) =>
            asset.sha256 === key &&
            asset.width === ref.width &&
            asset.height === ref.height &&
            asset.bytes === ref.sourceBytes,
        ) &&
        source?.sha256 === key &&
        source.bytes === ref.sourceBytes &&
        raw?.sha256 === ref.sha256 &&
        raw.bytes === ref.bytes,
      "Selected RGBA resource closure differs",
    );
    files[ref.file] = { sha256: ref.sha256, bytes: ref.bytes };
  }
  need(
    sameDirectCompiledData(metadata.files, files),
    "Selected RGBA file inventory differs",
  );
}

export async function loadLatestSelectedMaterialTextures({
  staticCatalog,
  selectedMaterials,
}) {
  assertLatestStaticCatalogSelection(staticCatalog);
  assertLatestSelectedMaterials(selectedMaterials).assertSelection(
    staticCatalog,
  );
  need(
    selectedMaterials.mode === "native-quad-partial",
    "Selected quad texture mode required",
  );
  const metadata = parse(
      await staticCatalog.readRole("selectedMaterialTextures"),
    ),
    manifestBytes = await staticCatalog.readRole("effects"),
    quadBytes = selectedMaterials.packageBytes("quad"),
    manifest = parse(manifestBytes),
    quad = parse(quadBytes),
    catalog = staticCatalog.describe();
  await staticCatalog.assertRole("quadGpu", quadBytes);
  assertSelectedMaterialTextureInventory({
    metadata,
    manifest,
    quad,
    manifestSha256: await sha256(manifestBytes),
    quadSha256: await sha256(quadBytes),
    catalogFiles: catalog.files,
  });
  const allowed = new Map(
      selectedMaterials
        .materialTextureReferences()
        .map((ref) => [ref.pngSha256, ref]),
    ),
    loaded = new Map();
  let rgbaBytes = 0;
  return Object.freeze({
    async readTexture(binding) {
      const approved = allowed.get(binding.sha256),
        ref = metadata.textures[binding.sha256];
      need(
        binding.kind === "prepared-texture" &&
          approved &&
          ref &&
          approved.file === binding.file &&
          approved.path === `latest-effects/${binding.file}` &&
          approved.width === ref.width &&
          approved.height === ref.height &&
          ref.sourceFile === binding.file,
        "Texture is not referenced by a bound native selected material",
      );
      if (!loaded.has(binding.sha256)) {
        const promise = (async () => {
          const png = await staticCatalog.read(approved.path),
            raw = await staticCatalog.read(`${directory}/${ref.file}`),
            decoded = await decodeLatestRgba8Png(png);
          need(
            (await sha256(png)) === binding.sha256 &&
              raw.length === ref.bytes &&
              (await sha256(raw)) === ref.sha256 &&
              decoded.width === ref.width &&
              decoded.height === ref.height &&
              decoded.data.length === raw.length &&
              decoded.data.every((value, index) => value === raw[index]),
            "Selected PNG/raw RGBA pixel bytes differ",
          );
          rgbaBytes += raw.length;
          return raw;
        })();
        loaded.set(binding.sha256, promise);
      }
      return {
        data: (await loaded.get(binding.sha256)).slice(),
        width: ref.width,
        height: ref.height,
      };
    },
    describe: () => ({
      staticTextures: Object.keys(metadata.textures).length,
      boundNativeTextures: allowed.size,
      loadedTextures: loaded.size,
      rgbaBytes,
      pixelFormat: "RGBA8",
      nativeMaterialAdmissionEstablished: false,
    }),
  });
}
