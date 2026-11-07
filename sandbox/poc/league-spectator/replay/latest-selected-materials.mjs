// The same-origin bootstrap is the static authenticity root. Native material
// observations are trusted offline producer outputs; this owner checks exact
// build/source/package closure and bounded independently derived numeric fields.
import {
  PARENT_QUAD_GPU_SHA,
  PARENT_TRAIL_GPU_SHA,
  PARENT_EROSION_GPU_SHA,
} from "./latest-parent-material-contract.mjs";
import { sha256 } from "./structural-comparison.mjs";
import { assertLatestStaticCatalogSelection } from "./latest-static-catalog.mjs";
import { sameDirectCompiledData } from "./latest-direct-compiled-restore.mjs";
import {
  createSelectedNativeMaterialInventory,
  APPROVED_NATIVE_MATERIAL_REFERENCE_SHA,
} from "./latest-selected-vfx-material-inventory.mjs";
import { createLatestVfxMaterials } from "./latest-vfx-materials.mjs";
import { deriveSelectedParticleColorEntry } from "./latest-selected-particle-color-record.mjs";
import { prepareNativeParticleGpuBinding } from "./latest-native-particle-gpu-binding.mjs";
import {
  assertSelectedMaterialParameterInputSpans,
  deriveAuthoredSelectedMaterialSourceVectors,
} from "./latest-selected-material-parameter-inputs.mjs";
export const SELECTED_MATERIAL_POLICY =
  "owned-native-quad-materials-with-explicit-unprepared-families-v1";
export const SELECTED_MATERIAL_FAMILIES = Object.freeze({
  quad: "prepared-native-observations",
  trail: "unprepared-native-gpu",
  erosion: "unprepared-native-gpu",
  ground: "unprepared-native-gpu",
  navigation: "unprepared-native-gpu",
  staticMesh: "unprepared-native-gpu",
  ray: "unprepared-native-gpu",
  children: "unprepared-native-capability",
});
const COLOR_REFERENCE =
    "ba06d3700bc3835496ab14811d9b6db1f3acab620afdeef73e8c4a23c15000a3",
  owned = new WeakSet();
const parse = (b) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b)),
  need = (v, m) => {
    if (!v) throw Error(m);
  };
export const isLatestSelectedMaterialRegistry = (value) => owned.has(value);
export function assertLatestSelectedMaterials(value) {
  need(owned.has(value), "Owned selected material registry required");
  return value;
}
export async function loadLatestSelectedMaterialRegistry({
  staticCatalog,
  load,
}) {
  assertLatestStaticCatalogSelection(staticCatalog);
  need(
    typeof load === "function",
    "Captured selected material loader required",
  );
  const catalog = staticCatalog.describe(),
    roles = catalog.roles,
    profile = staticCatalog.profile(),
    inputs = {};
  async function raw(path) {
    const ref = catalog.files[path];
    need(ref, "Selected material input outside owned catalog: " + path);
    const b = await load(path);
    need(
      b instanceof Uint8Array &&
        b.length === ref.bytes &&
        (await sha256(b)) === ref.sha256,
      "Selected material input differs: " + path,
    );
    inputs[path] = ref.sha256;
    return b.slice();
  }
  const role = async (name) => {
    need(
      Object.hasOwn(roles, name),
      "Required selected material role missing: " + name,
    );
    return raw(roles[name]);
  };
  const inventory = parse(await role("selectedMaterials")),
    manifestBytes = await role("effects"),
    manifest = parse(manifestBytes),
    quadBytes = await role("quadGpu"),
    quad = parse(quadBytes),
    mode = inventory.mode;
  if (mode === "fixed-original-complete") {
    const trailBytes = await role("trailGpu"),
      erosionBytes = await role("erosionGpu"),
      trail = parse(trailBytes),
      erosion = parse(erosionBytes),
      manifestHash = await sha256(manifestBytes);
    need(
      inventory.schema === 1 &&
        inventory.kind === "selected-original-material-capability-inventory" &&
        inventory.policy === SELECTED_MATERIAL_POLICY &&
        inventory.build === profile.clientVersion &&
        inventory.protocol === profile.protocolDigest &&
        inventory.effectsManifestSha256 === manifestHash &&
        inventory.quadGpuSha256 === PARENT_QUAD_GPU_SHA &&
        inventory.trailGpuSha256 === PARENT_TRAIL_GPU_SHA &&
        inventory.erosionGpuSha256 === PARENT_EROSION_GPU_SHA &&
        (await sha256(quadBytes)) === PARENT_QUAD_GPU_SHA &&
        (await sha256(trailBytes)) === PARENT_TRAIL_GPU_SHA &&
        (await sha256(erosionBytes)) === PARENT_EROSION_GPU_SHA &&
        [quad, trail, erosion].every(
          (p) =>
            p.effectsManifestSha256 === manifestHash &&
            p.build === inventory.build &&
            p.protocol === inventory.protocol,
        ),
      "Exact original complete material package closure required",
    );
    const registry = Object.freeze({
      policy: SELECTED_MATERIAL_POLICY,
      mode,
      staticCatalog,
      assertSelection(selection) {
        need(
          selection === staticCatalog,
          "Selected material registry belongs to a different owned catalog",
        );
      },
      async bindDefinitions(ids) {
        need(
          Array.isArray(ids) &&
            new Set(ids).size === ids.length &&
            ids.every((id) => Object.hasOwn(manifest.definitions, id)),
          "Unique selected definition identities required",
        );
      },
      packageBytes(family) {
        const b = { quad: quadBytes, trail: trailBytes, erosion: erosionBytes }[
          family
        ];
        need(b, "Known complete material family required");
        return b.slice();
      },
      familyStatus(family) {
        need(
          Object.hasOwn(SELECTED_MATERIAL_FAMILIES, family),
          "Known selected family required",
        );
        return "fixed-original-complete";
      },
      materials() {
        throw Error(
          "Complete original materials must use the unchanged parent material validator",
        );
      },
      capabilityPackages() {
        return [
          ["quad", structuredClone(quad)],
          ["trail", structuredClone(trail)],
        ];
      },
      omission() {
        return null;
      },
      materialTextureReferences() {
        throw Error(
          "Complete original materials must use the original texture owner",
        );
      },
      async assertPackages({
        effectsManifestBytes,
        quadPackageBytes,
        trailPackageBytes,
        erosionPackageBytes,
      }) {
        need(
          (await sha256(effectsManifestBytes)) === manifestHash &&
            (await sha256(quadPackageBytes)) === PARENT_QUAD_GPU_SHA &&
            (await sha256(trailPackageBytes)) === PARENT_TRAIL_GPU_SHA &&
            (await sha256(erosionPackageBytes)) === PARENT_EROSION_GPU_SHA,
          "Complete original material bytes differ",
        );
      },
      describe() {
        return {
          mode,
          families: Object.fromEntries(
            Object.keys(SELECTED_MATERIAL_FAMILIES).map((k) => [
              k,
              "fixed-original-complete",
            ]),
          ),
          prepared:
            quad.emitters.length +
            trail.emitters.length +
            erosion.emitters.length,
        };
      },
    });
    owned.add(registry);
    return registry;
  }
  need(
    mode === "native-quad-partial",
    "Explicit supported material inventory mode required",
  );
  const boundBytes = await role("boundQuads"),
    bound = parse(boundBytes);
  need(
    inventory.schema === 1 &&
      inventory.kind === "selected-original-material-capability-inventory" &&
      inventory.policy === SELECTED_MATERIAL_POLICY &&
      inventory.build === profile.clientVersion &&
      inventory.protocol === profile.protocolDigest &&
      inventory.effectsManifestSha256 === (await sha256(manifestBytes)) &&
      inventory.quadGpuSha256 === (await sha256(quadBytes)) &&
      inventory.boundQuadsSha256 === (await sha256(boundBytes)) &&
      sameDirectCompiledData(inventory.families, SELECTED_MATERIAL_FAMILIES),
    "Unsupported selected material capability contract",
  );
  need(
    quad.kind === "prepared-complete-quad-gpu-bindings" &&
      quad.build === inventory.build &&
      quad.protocol === inventory.protocol &&
      quad.effectsManifestSha256 === inventory.effectsManifestSha256 &&
      quad.quadPackageSha256 === profile.vfxBoundQuadsSha256 &&
      inventory.boundQuadsSha256 === profile.vfxBoundQuadsSha256 &&
      quad.counts.emitters === quad.emitters.length &&
      quad.counts.omitted === quad.omitted.length,
    "Selected quad GPU/source parents differ",
  );
  const byKey = new Map(),
    omissions = new Map();
  for (const row of quad.emitters) {
    const key = `${row.effectId}:${row.emitterIndex}`;
    need(!byKey.has(key), "Duplicate selected material binding");
    byKey.set(key, row);
  }
  for (const row of quad.omitted) {
    const key = `${row.effectId}:${row.emitterIndex}`;
    need(
      !byKey.has(key) &&
        !omissions.has(key) &&
        Array.isArray(row.reasons) &&
        row.reasons.length > 0,
      "Duplicate or unexplained selected material omission",
    );
    omissions.set(key, row);
  }
  let count = 0;
  for (const [id, ref] of Object.entries(manifest.definitions))
    for (let index = 0; index < ref.complexEmitters; index++) {
      const key = `${id}:${index}`,
        row = byKey.get(key) ?? omissions.get(key);
      need(
        row && (!byKey.has(key) || row.sourceDefinitionSha256 === ref.sha256),
        "Selected material component inventory is incomplete",
      );
      count++;
    }
  need(
    count === byKey.size + omissions.size &&
      sameDirectCompiledData(inventory.omitted, quad.omitted),
    "Selected capability inventory omits or adds source components",
  );
  const materialBytes = await role("nativeQuadMaterials"),
    referenceBytes = await role("nativeMaterialReference"),
    image = await raw("decoder-16.21-macos/image.bin"),
    shaderPackage = parse(await role("shaderPackage")),
    pairs = parse(await role("shaderPairs")),
    color = parse(await role("particleColor")),
    colorReference = await role("particleColorReference");
  need(
    (await sha256(referenceBytes)) === APPROVED_NATIVE_MATERIAL_REFERENCE_SHA &&
      (await sha256(materialBytes)) === quad.nativeMaterialSha256 &&
      (await sha256(colorReference)) === COLOR_REFERENCE &&
      (await sha256(await role("shaderPackage"))) ===
        quad.shaderPackageSha256 &&
      pairs.shaderPackageSha256 === quad.shaderPackageSha256,
    "Selected original material/color/shader approval differs",
  );
  const approvedColor = parse(colorReference);
  for (const key of [
    "schema",
    "kind",
    "build",
    "protocol",
    "sources",
    "decoderImageSha256",
    "sourceBlocks",
    "scope",
  ])
    need(
      sameDirectCompiledData(color[key], approvedColor[key]),
      "Selected original color algorithm approval differs",
    );
  await staticCatalog.verifyNativeImageBlocks(
    color.sourceBlocks.map((b) => ({
      rva: b.startRva,
      size: b.endRva - b.startRva,
      sha256: b.sha256,
    })),
  );
  const colorByKey = new Map();
  for (const row of color.entries) {
    const key = `${row.effectId}:${row.emitterIndex}`;
    need(!colorByKey.has(key), "Duplicate selected color observation");
    colorByKey.set(key, row);
  }
  const nativeRows = new Map(
    parse(materialBytes).emitters.map((row) => [
      `${row.effectId}:${row.emitterIndex}`,
      row,
    ]),
  );
  const admitted = new Map(),
    boundIds = new Set(),
    graphs = new Map(),
    definitions = new Map(),
    textures = new Map();
  let binding = Promise.resolve();
  async function bind(ids) {
    need(
      Array.isArray(ids) &&
        new Set(ids).size === ids.length &&
        ids.every((id) => Object.hasOwn(manifest.definitions, id)),
      "Unique selected material definition identities required",
    );
    const requested = ids.filter((id) => !boundIds.has(id));
    if (!requested.length) return;
    const token = await createSelectedNativeMaterialInventory({
        approvedReferenceBytes: referenceBytes,
        materialBytes,
        boundQuadBytes: boundBytes,
        imageBytes: image,
        profile,
        effectIds: requested,
        loadGraph: async (file) => {
          const bytes = await raw(`decoder-16.21-macos/${file}`);
          graphs.set(file, parse(bytes));
          return bytes;
        },
      }),
      api = await createLatestVfxMaterials(
        materialBytes,
        await sha256(materialBytes),
        profile,
        token,
      ),
      stages = new Map();
    for (const id of requested) {
      const def = manifest.definitions[id],
        bytes = await raw(`latest-effects/${def.file}`);
      need(
        (await sha256(bytes)) === def.sha256,
        "Selected material source definition changed",
      );
      definitions.set(id, parse(bytes));
    }
    for (const ref of bound.templates) {
      if (!requested.includes(ref.effectId)) continue;
      const key = `${ref.effectId}:${ref.emitterIndex}`,
        prepared = byKey.get(key);
      if (!prepared) continue;
      const record = definitions.get(ref.effectId),
        source =
          record.definition.complexEmitterDefinitionData[ref.emitterIndex],
        colorBinding = colorByKey.get(key),
        colorBindings = new Map();
      const graph = graphs.get(ref.file),
        nativeRow = nativeRows.get(key);
      need(nativeRow, "Owned native material observation missing");
      assertSelectedMaterialParameterInputSpans(source, graph);
      const numeric = deriveAuthoredSelectedMaterialSourceVectors(source);
      for (const name of [
        "parameters",
        "samplers",
        "erosionAtSuppliedDrive",
        "erosionParameters",
      ])
        need(
          sameDirectCompiledData(numeric[name], nativeRow[name]),
          "Native material producer numeric field differs from authored source: " +
            name,
        );
      if (source.particleColorTexture) {
        need(colorBinding, "Authored selected color observation missing");
        const expected = deriveSelectedParticleColorEntry({
          reference: ref,
          graph: graphs.get(ref.file),
          emitter: source,
          asset: manifest.assets[source.particleColorTexture.toLowerCase()],
        });
        need(
          sameDirectCompiledData(expected, colorBinding),
          "Selected native color observation differs from original serialized source",
        );
        colorBindings.set(key, colorBinding);
      }
      const environment = {
          pass: 0,
          featuresEnabled: true,
          resourceMask: Number(ref.hasMultDefinition),
          systemFogMode: 1,
          graphics34b: false,
          graphics29c: 0,
        },
        material = api.describe(ref.effectId, ref.emitterIndex, environment, {
          erosionDrive: null,
        }),
        n = {
          ...ref,
          environment,
          selection: { vertex: material.vertex, pixel: material.pixel },
          renderState: {
            bytesHex: material.renderStateHex,
            defines: material.defines,
            uniforms: [],
          },
          parameters: [...material.parameters].map(([name, value]) => ({
            name,
            bytesHex: [
              ...new Uint8Array(
                value.buffer,
                value.byteOffset,
                value.byteLength,
              ),
            ]
              .map((b) => b.toString(16).padStart(2, "0"))
              .join(""),
          })),
          samplers: material.samplers,
          needsErosionDrive: false,
        };
      const virtualRaw = async (path) => {
          need(
            path.startsWith("assets/"),
            "Bounded selected GPU path required",
          );
          const bytes = await raw(path.slice(7));
          inputs[path] = await sha256(bytes);
          return bytes;
        },
        result = await prepareNativeParticleGpuBinding(n, record, {
          effects: manifest,
          shaderPackage,
          pairs,
          assets: "assets",
          read: async (path) => parse(await virtualRaw(path)),
          raw: virtualRaw,
          sha: sha256,
          inputs,
          stages,
          colorBindings,
        });
      need(
        result.binding && sameDirectCompiledData(result.binding, prepared),
        "Selected prepared material differs from original native/source/shader reconstruction",
      );
      admitted.set(key, {
        key,
        prepared: structuredClone(prepared),
        primitive: "quad",
      });
      for (const [uniform, resource] of Object.entries(prepared.textures))
        if (resource.kind === "prepared-texture") {
          const asset = Object.values(manifest.assets).find(
            (a) =>
              a.kind === "texture" &&
              a.sha256 === resource.sha256 &&
              a.file === resource.file,
          );
          need(asset, "Selected material texture source missing");
          textures.set(resource.sha256, {
            textureKey: resource.sha256,
            path: `latest-effects/${asset.file}`,
            file: asset.file,
            sourceSha256: asset.sourceSha256,
            pngSha256: asset.sha256,
            width: asset.width,
            height: asset.height,
            uniformAliases: [
              ...new Set([
                ...(textures.get(resource.sha256)?.uniformAliases ?? []),
                uniform,
              ]),
            ],
          });
        }
    }
    for (const id of requested) boundIds.add(id);
  }
  const registry = Object.freeze({
    policy: SELECTED_MATERIAL_POLICY,
    mode,
    staticCatalog,
    assertSelection(selection) {
      assertLatestStaticCatalogSelection(selection);
      need(
        selection === staticCatalog,
        "Selected material registry belongs to a different owned catalog",
      );
    },
    async bindDefinitions(ids) {
      binding = binding.then(() => bind(ids));
      await binding;
    },
    packageBytes(family) {
      need(
        ["quad", "trail", "erosion"].includes(family),
        "Known selected material family required",
      );
      return family === "quad" ? quadBytes.slice() : undefined;
    },
    familyStatus(family) {
      need(
        Object.hasOwn(inventory.families, family),
        "Known selected family required",
      );
      return inventory.families[family];
    },
    materials() {
      return new Map([...admitted].map(([k, v]) => [k, structuredClone(v)]));
    },
    capabilityPackages() {
      return [["quad", structuredClone(quad)]];
    },
    omission(key) {
      return structuredClone(omissions.get(key) ?? null);
    },
    materialTextureReferences() {
      return [...textures.values()].map((v) => structuredClone(v));
    },
    async assertPackages({
      effectsManifestBytes,
      quadPackageBytes,
      trailPackageBytes,
      erosionPackageBytes,
    }) {
      need(
        (await sha256(effectsManifestBytes)) ===
          inventory.effectsManifestSha256 &&
          (await sha256(quadPackageBytes)) === inventory.quadGpuSha256 &&
          trailPackageBytes === undefined &&
          erosionPackageBytes === undefined,
        "Selected material bytes/family availability differ from owned registry",
      );
    },
    describe() {
      return structuredClone({
        mode,
        families: inventory.families,
        prepared: byKey.size,
        omitted: omissions.size,
        boundDefinitions: [...boundIds],
        admittedMaterials: admitted.size,
      });
    },
  });
  owned.add(registry);
  return registry;
}
