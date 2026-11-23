// Counterpart to the preserved legacy selected-material registry. Every new
// package has explicit scene authorities; no build-profile hashes are changed.
import { sha256 } from "./structural-comparison.mjs";
import { sameDirectCompiledData as same } from "./latest-direct-compiled-restore.mjs";
import { sceneAnimationFilePath } from "./scene-animation-authority.mjs";
import { createSceneVfxMaterialBindings } from "./scene-vfx-material-bindings.mjs";
import { prepareNativeParticleGpuBinding } from "./latest-native-particle-gpu-binding.mjs";
import { createSceneColdDefaultTextures } from "./scene-cold-default-textures.mjs";
import { resolveSceneColdMaterialBindings } from "./scene-cold-material-bindings.mjs";
import { createSceneAllVisionFog } from "./scene-all-vision-fog.mjs";
import {
  assertSelectedMaterialParameterInputSpans,
  deriveAuthoredSelectedMaterialSourceVectors,
} from "./latest-selected-material-parameter-inputs.mjs";
const decode = (bytes) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  need = (value, message) => {
    if (!value) throw Error(message);
  };
export async function loadSceneSelectedMaterialRegistry({
  staticCatalog,
  load,
  inventory,
  quadBytes,
  perspective,
}) {
  const catalog = staticCatalog.describe(),
    roles = catalog.roles,
    profile = staticCatalog.profile(),
    inputs = {};
  async function raw(file) {
    sceneAnimationFilePath(file);
    const ref = catalog.files[file];
    need(ref, "Scene material resource outside owned catalog: " + file);
    const bytes = await load(file);
    need(
      bytes instanceof Uint8Array &&
        bytes.length === ref.bytes &&
        (await sha256(bytes)) === ref.sha256,
      "Selected scene material resource differs: " + file,
    );
    inputs[file] = ref.sha256;
    return bytes.slice();
  }
  async function role(name) {
    need(
      Object.hasOwn(roles, name),
      "Explicit scene material role required: " + name,
    );
    return raw(roles[name]);
  }
  function relative(roleName, file) {
    sceneAnimationFilePath(file);
    const target = roles[roleName];
    need(
      typeof target === "string" && target.endsWith("manifest.json"),
      "Scene material authority role must name its manifest",
    );
    return target.slice(0, -"manifest.json".length) + file;
  }
  const effectsBytes = await role("effects"),
    effects = decode(effectsBytes),
    sceneBytes = await role("scene"),
    nativeBytes = await role("sceneVfxNativeAuthority"),
    materialBytes = await role("sceneVfxMaterialAuthority"),
    quad = decode(quadBytes),
    native = decode(nativeBytes),
    materials = decode(materialBytes),
    imageBytes = await raw("decoder-16.21-macos/image.bin"),
    baseProfileBytes = staticCatalog.readProfile(),
    controlBytes = await role("sceneMaterialEnvironment"),
    control = decode(controlBytes),
    shaderBytes = await role("shaderPackage"),
    shaderPackage = decode(shaderBytes),
    pairsBytes = await role("shaderPairs"),
    pairs = decode(pairsBytes);
  need(
    [1, 2, 3].includes(inventory.schema) &&
      inventory.kind === "prepared-scene-controlled-material-package" &&
      inventory.nativeSpectatorAdmitted === false &&
      inventory.build === profile.clientVersion &&
      inventory.protocol === profile.protocolDigest &&
      inventory.sceneManifestSha256 === (await sha256(sceneBytes)) &&
      inventory.effectsManifestSha256 === (await sha256(effectsBytes)) &&
      inventory.nativeAuthoritySha256 === (await sha256(nativeBytes)) &&
      inventory.nativeMaterialAuthoritySha256 ===
        (await sha256(materialBytes)) &&
      inventory.shaderPackageSha256 === (await sha256(shaderBytes)),
    "Explicit scene material package parent identities differ",
  );
  const packageRef = inventory.files.find(
    (ref) => ref.file === inventory.roles.quadGpu,
  );
  need(
    packageRef &&
      packageRef.bytes === quadBytes.length &&
      packageRef.sha256 === (await sha256(quadBytes)),
    "Scene quad role differs from its package authority",
  );
  for (const key of [
    "build",
    "protocol",
    "sceneManifestSha256",
    "effectsManifestSha256",
    "nativeAuthoritySha256",
    "nativeMaterialAuthoritySha256",
    "shaderPackageSha256",
  ])
    need(quad[key] === inventory[key], "Scene quad parent differs: " + key);
  need(quad.schema === inventory.schema, "Scene GPU authority schema differs");
  let defaults = null;
  if (inventory.schema >= 2) {
    const bytes = await role("sceneColdDefaultTextures"),
      digest = await sha256(bytes);
    need(
      inventory.originalColdDefaultAuthoritySha256 === digest &&
        quad.originalColdDefaultAuthoritySha256 === digest &&
        quad.scope.originalColdDefaultsOnly === true,
      "Original cold-default authority parent differs",
    );
    defaults = await createSceneColdDefaultTextures({
      manifestBytes: bytes,
      readResource: (file) => raw(relative("sceneColdDefaultTextures", file)),
    });
  } else
    need(
      (inventory.originalColdDefaultAuthoritySha256 ?? null) === null &&
        (quad.originalColdDefaultAuthoritySha256 ?? null) === null,
      "Schema1 scene materials cannot carry a cold-default authority",
    );
  let allVisionFog = null;
  if (inventory.schema === 3) {
    const bytes = await role("sceneAllVisionFog"),
      digest = await sha256(bytes),
      scene = decode(sceneBytes);
    need(
      perspective === "all" &&
        inventory.perspective === "all" &&
        quad.perspective === "all" &&
        inventory.originalAllVisionFogAuthoritySha256 === digest &&
        quad.originalAllVisionFogAuthoritySha256 === digest &&
        control.systemFogMode === 0,
      "Explicit all-vision material perspective/authority differs",
    );
    allVisionFog = await createSceneAllVisionFog({
      manifestBytes: bytes,
      readResource: (file) => raw(relative("sceneAllVisionFog", file)),
      sceneBytes,
      worldBytes: await raw(relative("scene", scene.world)),
      baseProfileBytes,
      imageBytes,
      perspective,
    });
  } else
    need(
      (inventory.originalAllVisionFogAuthoritySha256 ?? null) === null &&
        (quad.originalAllVisionFogAuthoritySha256 ?? null) === null,
      "Earlier scene materials cannot carry an all-vision fog authority",
    );
  need(
    quad.kind === "prepared-scene-controlled-quad-gpu-bindings" &&
      quad.controlledEnvironmentSha256 === (await sha256(controlBytes)) &&
      quad.scope.actualScenePredicates === false &&
      quad.scope.defaultTextureSubstitutions === false &&
      quad.scope.shaderSubmission === false &&
      quad.scope.nativeRendererAdmitted === false &&
      quad.counts.emitters === quad.emitters.length &&
      quad.counts.omitted === quad.omitted.length &&
      quad.counts.unsupportedSimpleEmitters ===
        quad.unsupportedSimpleEmitters.length &&
      pairs.shaderPackageSha256 === (await sha256(shaderBytes)),
    "Scene controlled quad capability contract differs",
  );
  need(
    Object.keys(control).sort().join("|") ===
      "featuresEnabled|graphics29c|graphics34b|pass|resourceMask|systemFogMode" &&
      control.resourceMask === "original-defined-pointers" &&
      control.pass === 0 &&
      control.featuresEnabled === true &&
      [0, 1].includes(control.systemFogMode) &&
      control.graphics34b === false &&
      control.graphics29c === 0,
    "Explicit observed control environment required",
  );
  const api = await createSceneVfxMaterialBindings({
    baseProfileBytes,
    imageBytes,
    sceneBytes,
    effectsManifestBytes: effectsBytes,
    nativeAuthorityBytes: nativeBytes,
    materialAuthorityBytes: materialBytes,
    readResource: ({ authority, file }) =>
      raw(
        relative(
          authority === "native"
            ? "sceneVfxNativeAuthority"
            : "sceneVfxMaterialAuthority",
          file,
        ),
      ),
  });
  const byKey = new Map(),
    omissions = new Map(),
    simple = new Map(),
    admitted = new Map(),
    textures = new Map(),
    boundIds = new Set(),
    coldTextures = [],
    fogTextures = [];
  for (const row of quad.emitters) {
    const key = `${row.effectId}:${row.emitterIndex}`;
    need(!byKey.has(key), "Duplicate scene quad material");
    byKey.set(key, row);
    need(
      Object.values(row.textures).every(
        (texture) =>
          texture.kind === "prepared-texture" ||
          (inventory.schema >= 2 &&
            texture.kind === "original-cold-default-texture") ||
          (inventory.schema === 3 &&
            texture.kind === "original-all-vision-fog-texture"),
      ),
      "Unproved scene default texture substitution",
    );
  }
  for (const row of quad.omitted) {
    const key = `${row.effectId}:${row.emitterIndex}`;
    need(
      !byKey.has(key) &&
        !omissions.has(key) &&
        row.kind === "complex" &&
        Array.isArray(row.reasons) &&
        row.reasons.length > 0,
      "Unknown or duplicate scene material omission",
    );
    omissions.set(key, row);
  }
  for (const row of quad.unsupportedSimpleEmitters) {
    const key = `${row.effectId}:${row.emitterIndex}`;
    need(
      row.kind === "simple" && !simple.has(key),
      "Duplicate original simple emitter disposition",
    );
    simple.set(key, row);
  }
  for (const body of native.emitters) {
    const key = `${body.effectId}:${body.emitterIndex}`;
    need(
      body.kind === "simple"
        ? simple.has(key)
        : byKey.has(key) || omissions.has(key),
      "Scene material capability inventory omits an original emitter",
    );
  }
  need(
    byKey.size + omissions.size + simple.size === native.emitters.length,
    "Scene material capability inventory adds original emitters",
  );
  const families = Object.freeze({
    quad: "prepared-native-observations",
    trail: "unprepared-native-gpu",
    erosion: "unprepared-native-gpu",
    ground: "unprepared-native-gpu",
    navigation: "unprepared-native-gpu",
    staticMesh: "unprepared-native-gpu",
    ray: "unprepared-native-gpu",
    children: "unprepared-native-capability",
  });
  let binding = Promise.resolve();
  async function bind(ids) {
    need(
      Array.isArray(ids) &&
        new Set(ids).size === ids.length &&
        ids.every(
          (id) =>
            typeof id === "string" && Object.hasOwn(effects.definitions, id),
        ),
      "Unique selected scene material definitions required",
    );
    for (const id of ids) {
      if (boundIds.has(id)) continue;
      const def = effects.definitions[id],
        bytes = await raw("latest-effects/" + def.file);
      need(
        (await sha256(bytes)) === def.sha256,
        "Scene material authored definition changed",
      );
      const record = decode(bytes);
      for (const prepared of quad.emitters) {
        if (prepared.effectId !== id) continue;
        const body = native.emitters.find(
            (row) =>
              row.kind === "complex" &&
              row.effectId === id &&
              row.emitterIndex === prepared.emitterIndex,
          ),
          source =
            record.definition.complexEmitterDefinitionData[
              prepared.emitterIndex
            ],
          row = materials.emitters.find(
            (row) =>
              row.effectId === id && row.emitterIndex === prepared.emitterIndex,
          ),
          graph = decode(
            await raw(
              relative(
                "sceneVfxNativeAuthority",
                body.resources.boundQuad.file,
              ),
            ),
          );
        assertSelectedMaterialParameterInputSpans(source, graph);
        const derived = deriveAuthoredSelectedMaterialSourceVectors(source);
        for (const name of [
          "parameters",
          "samplers",
          "erosionAtSuppliedDrive",
          "erosionParameters",
        ])
          need(
            same(derived[name], row[name]),
            "Scene material source numeric field differs: " + name,
          );
        const environment = { ...control, resourceMask: row.definedObjectMask };
        need(
          same(prepared.environment, environment),
          "Prepared scene material controlled predicates differ",
        );
        const description = await api.describe(
            id,
            prepared.emitterIndex,
            environment,
            { erosionDrive: null },
          ),
          reference = {
            ...graph,
            sha256: body.resources.boundQuad.sha256,
            environment,
            selection: { vertex: description.vertex, pixel: description.pixel },
            renderState: {
              bytesHex: description.renderStateHex,
              defines: description.defines,
              uniforms: [],
            },
            parameters: [...description.parameters].map(([name, value]) => ({
              name,
              bytesHex: Array.from(
                new Uint8Array(
                  value.buffer,
                  value.byteOffset,
                  value.byteLength,
                ),
                (byte) => byte.toString(16).padStart(2, "0"),
              ).join(""),
            })),
            samplers: description.samplers,
            needsErosionDrive: false,
          };
        const virtual = async (file) => {
          need(
            file.startsWith("assets/"),
            "Explicit selected scene GPU resource path required",
          );
          const bytes = await raw(file.slice(7));
          inputs[file] = await sha256(bytes);
          return bytes;
        };
        const result = await prepareNativeParticleGpuBinding(
          reference,
          record,
          {
            effects,
            shaderPackage,
            pairs,
            assets: "assets",
            read: async (file) => decode(await virtual(file)),
            raw: virtual,
            sha: sha256,
            inputs,
            stages: new Map(),
            colorBindings: new Map(),
            allVisionFog,
          },
        );
        const resolved = result.binding
          ? resolveSceneColdMaterialBindings(result.binding, defaults, {
              emitter: source,
              nativeSamplers: description.samplers,
              allVisionFog,
            })
          : result;
        need(
          resolved.binding && same(resolved.binding, prepared),
          "Scene GPU material differs from original native/shader/source reconstruction",
        );
        admitted.set(`${id}:${prepared.emitterIndex}`, {
          key: `${id}:${prepared.emitterIndex}`,
          prepared: structuredClone(prepared),
          primitive: "quad",
        });
        for (const [uniform, texture] of Object.entries(prepared.textures)) {
          if (texture.kind === "original-all-vision-fog-texture") {
            need(
              allVisionFog && same(texture, allVisionFog.binding()),
              "Unowned all-vision native fog texture",
            );
            fogTextures.push(structuredClone(texture));
            continue;
          }
          if (texture.kind === "original-cold-default-texture") {
            need(
              defaults &&
                texture.authoritySha256 === defaults.describe().authoritySha256,
              "Unowned original cold default",
            );
            coldTextures.push(structuredClone(texture));
            continue;
          }
          const asset = Object.values(effects.assets).find(
            (asset) =>
              asset.kind === "texture" &&
              asset.file === texture.file &&
              asset.sha256 === texture.sha256,
          );
          need(asset, "Scene material original texture absent");
          textures.set(texture.sha256, {
            textureKey: texture.sha256,
            path: `latest-effects/${asset.file}`,
            file: asset.file,
            sourceSha256: asset.sourceSha256,
            pngSha256: asset.sha256,
            width: asset.width,
            height: asset.height,
            uniformAliases: [
              ...new Set([
                ...(textures.get(texture.sha256)?.uniformAliases ?? []),
                uniform,
              ]),
            ],
          });
        }
      }
      boundIds.add(id);
    }
  }
  return Object.freeze({
    policy: "explicit-scene-native-materials-with-unprepared-families-v1",
    mode: "native-quad-partial",
    staticCatalog,
    assertSelection(selection) {
      need(
        selection === staticCatalog,
        "Scene material registry belongs to a different selected catalog",
      );
    },
    async bindDefinitions(ids) {
      binding = binding.then(() => bind(ids));
      await binding;
    },
    packageBytes(family) {
      need(
        ["quad", "trail", "erosion"].includes(family),
        "Known scene material family required",
      );
      return family === "quad" ? quadBytes.slice() : undefined;
    },
    familyStatus(family) {
      need(
        Object.hasOwn(families, family),
        "Known scene material family required",
      );
      return families[family];
    },
    materials() {
      return new Map(
        [...admitted].map(([key, value]) => [key, structuredClone(value)]),
      );
    },
    capabilityPackages() {
      return [["quad", structuredClone(quad)]];
    },
    omission(key) {
      return structuredClone(omissions.get(key) ?? null);
    },
    materialTextureReferences() {
      return [...textures.values()].map((value) => structuredClone(value));
    },
    readColdDefaultTexture(binding) {
      const owned = coldTextures.find((value) => same(value, binding));
      need(owned, "Cold texture is not referenced by a bound native material");
      return {
        data: Uint8Array.from(owned.rgba),
        width: owned.width,
        height: owned.height,
      };
    },
    assertPerspective(value) {
      need(
        allVisionFog === null || value === "all",
        "All-vision material registry cannot render another perspective",
      );
    },
    readAllVisionFogTexture(binding, value) {
      need(
        value === "all" &&
          allVisionFog &&
          fogTextures.some((texture) => same(texture, binding)),
        "Fog texture is not referenced by an owned all-vision material",
      );
      return {
        data: Uint8Array.from(binding.rgba),
        width: binding.width,
        height: binding.height,
      };
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
          (await sha256(quadPackageBytes)) === packageRef.sha256 &&
          trailPackageBytes === undefined &&
          erosionPackageBytes === undefined,
        "Scene material bytes/family availability differ",
      );
    },
    describe() {
      return {
        mode: "native-quad-partial",
        authority: "explicit-scene",
        prepared: byKey.size,
        omitted: omissions.size,
        unsupportedSimple: simple.size,
        admittedMaterials: admitted.size,
        boundDefinitions: [...boundIds],
        families: { ...families },
        actualScenePredicates: false,
        defaultTextureSubstitutions: false,
        originalColdDefaultAuthority:
          defaults?.describe().authoritySha256 ?? null,
        ...(allVisionFog
          ? {
              perspective: "all",
              originalAllVisionFogAuthority:
                allVisionFog.describe().authoritySha256,
            }
          : {}),
        nativeRendererAdmitted: false,
      };
    },
  });
}
