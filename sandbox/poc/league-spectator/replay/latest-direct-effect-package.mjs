import { createDirectEffectKernels } from "./latest-direct-effect-worker.mjs";
import { compileLatestDirectEffect } from "./latest-direct-effect-definition.mjs";
import { sha256 } from "./structural-comparison.mjs";
import { copyDirectCompilationInitialization } from "./latest-direct-initialization-ownership.mjs";
import { loadLatestDirectStaticMeshPackage } from "./latest-direct-static-mesh-package.mjs";
import { loadLatestDirectRayPackage } from "./latest-direct-ray-package.mjs";
import { createLatestDirectChildSiblingPrograms } from "./latest-direct-child-siblings.mjs";
import { validateDirectCameraMeshFlags } from "./latest-direct-effect-camera-mesh-flags.mjs";
import { validateDirectCameraLocalOffsetProgram } from "./latest-direct-effect-camera-local.mjs";
import { validateDirectMultUv } from "./latest-direct-effect-mult-uv.mjs";
import {
  loadLatestDirectNavGroundMaterials,
  isLatestDirectNavGroundMaterials,
  validateDirectNavGroundProgram,
} from "./latest-direct-nav-ground-materials.mjs";
import {
  createLatestDirectMultUvMaterials,
  isLatestDirectMultUvMaterials,
} from "./latest-direct-mult-uv-materials.mjs";
import {
  isLatestDirectRayMaterialPackage,
  validateDirectRayMaterialSelection,
} from "./latest-direct-ray-material-package.mjs";
import { createParentRenderFrames } from "./latest-parent-render-frame.mjs";
import {
  loadLatestSelectedMaterialRegistry,
  assertLatestSelectedMaterials,
} from "./latest-selected-materials.mjs";
import {
  assertDirectDepthDisabledSoftMaterial,
  validateDirectDepthDisabledSoftProgram,
} from "./latest-direct-effect-soft.mjs";
import {
  validateDirectQuadSpriteProgram,
  assertDirectQuadSpriteMaterial,
} from "./latest-direct-effect-sprite.mjs";
import {
  validateDirectParticlePaletteProgram,
  assertDirectParticlePaletteMaterial,
} from "./latest-direct-particle-palette.mjs";
import {
  directGroundMaterials,
  DIRECT_GROUND_PACKAGE_SHA,
  DIRECT_GROUND_POLICY,
} from "./latest-direct-ground-policy.mjs";

// A type's simulation support does not establish its material support. Missing
// native pass observations omit that component; a pass0 binding cannot stand
// in for a ground pass5 binding. Corrupt prepared packages still fail upstream.
export function directEmitterMaterialAdmission(
  emitter,
  groundMaterials,
  materials,
  staticMeshPackage = null,
  rayPackage = null,
  multUvMaterials = null,
  navGroundMaterials = null,
) {
  validateDirectDepthDisabledSoftProgram(emitter);
  validateDirectQuadSpriteProgram(emitter);
  validateDirectParticlePaletteProgram(emitter);
  validateDirectCameraMeshFlags(emitter);
  validateDirectCameraLocalOffsetProgram(emitter);
  validateDirectMultUv(emitter);
  if (emitter.navGroundProgram) {
    validateDirectNavGroundProgram(emitter);
    if (
      !isLatestDirectNavGroundMaterials(navGroundMaterials) ||
      !navGroundMaterials.admit(emitter)
    )
      return {
        material: undefined,
        reasons: ["material:owned-navigation-ground-pass5-selection"],
      };
    return {
      material: {
        key: emitter.materialKey,
        primitive: emitter.primitive,
        prepared: navGroundMaterials.inspect(emitter.materialKey).material,
      },
      reasons: [],
    };
  }
  if (emitter.primitive === "ray") {
    const token = rayPackage?.tokens.get(emitter.materialKey);
    if (!token)
      return {
        material: undefined,
        reasons: ["material:owned-ray-selection"],
      };
    if (!isLatestDirectRayMaterialPackage(rayPackage.materials))
      throw Error("Owned Ray material package required");
    const selected = rayPackage.materials.inspect(token);
    validateDirectRayMaterialSelection(emitter, {
      id: selected.effectId,
      definitionHash: selected.sourceDefinitionSha256,
      index: emitter.index,
    });
    if (
      JSON.stringify(selected) !== JSON.stringify(emitter.rayMaterialSelection)
    )
      throw Error(
        "Compiled Ray material selection differs from owned resources",
      );
    return {
      material: {
        key: emitter.materialKey,
        primitive: "ray",
        token,
        prepared: selected,
      },
      reasons: [],
    };
  }
  if (emitter.primitive === "static-mesh") {
    const token = staticMeshPackage?.tokens.get(emitter.materialKey);
    if (!token)
      return {
        material: undefined,
        reasons: ["material:owned-individual-static-mesh-selection"],
      };
    const selected = staticMeshPackage.materials.inspectNonInstanced(token);
    if (
      JSON.stringify(selected) !== JSON.stringify(emitter.meshMaterialSelection)
    )
      throw Error(
        "Compiled static mesh material selection differs from owned resources",
      );
    return {
      material: {
        key: emitter.materialKey,
        primitive: "static-mesh",
        token,
        prepared: selected,
      },
      reasons: [],
    };
  }
  if (emitter.groundLayer && emitter.materialPolicy !== DIRECT_GROUND_POLICY)
    throw Error(
      "Compiled ground component requires exact native pass5 all-vision policy",
    );
  const material = emitter.groundLayer
    ? groundMaterials?.get(emitter.materialKey)
    : materials.get(emitter.materialKey);
  if (material) {
    if (emitter.multUvProgram) {
      if (!isLatestDirectMultUvMaterials(multUvMaterials))
        return {
          material: undefined,
          reasons: ["material:owned-native-mult-selection-unprepared"],
        };
      const admission = multUvMaterials.admit(emitter, material.prepared);
      if (!admission.supported)
        return { material: undefined, reasons: admission.reasons };
    }
    assertDirectDepthDisabledSoftMaterial(emitter, material.prepared);
    assertDirectQuadSpriteMaterial(emitter, material.prepared);
    assertDirectParticlePaletteMaterial(emitter, material.prepared);
  }
  return {
    material,
    reasons: material
      ? []
      : [
          emitter.groundLayer
            ? "material:native-ground-pass5-binding-unprepared"
            : "material:translated-shader-binding",
        ],
  };
}

// Only static exact-build inputs are loaded here. Replay events are compiled in
// the browser after decoding, and no process state is prepared per effect window.
export async function loadLatestDirectEffectPackage({
  load,
  manifestBytes,
  effectIds,
  captureCompilationInputs = true,
  staticCatalog = null,
  selectedMaterials = null,
  viewerPoseInitialization = null,
}) {
  if (
    typeof load !== "function" ||
    !(manifestBytes instanceof Uint8Array) ||
    typeof captureCompilationInputs !== "boolean"
  )
    throw Error("Owned static compiler input loader required");
  manifestBytes = manifestBytes.slice();
  const sourceLoad = load,
    compilationInputs = new Map([
      ["latest-effects/manifest.json", manifestBytes.slice()],
    ]);
  load = async (path) => {
    if (
      typeof path !== "string" ||
      path.length > 512 ||
      !/^[-A-Za-z0-9_./]+$/.test(path) ||
      path.startsWith("/") ||
      path.split("/").some((p) => p === ".." || p === "")
    )
      throw Error("Bounded exact static compiler input path required");
    const bytes = await sourceLoad(path);
    if (!(bytes instanceof Uint8Array))
      throw Error("Static compiler loader must return Uint8Array bytes");
    const prior = compilationInputs.get(path);
    if (
      prior &&
      (prior.length !== bytes.length || !prior.every((v, i) => v === bytes[i]))
    )
      throw Error(`Static compiler input changed: ${path}`);
    if (!prior) compilationInputs.set(path, bytes.slice());
    return bytes.slice();
  };
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  const profile = JSON.parse(
    new TextDecoder().decode(await load("decoder-16.21-macos/profile.json")),
  );
  const packages = Object.fromEntries(
    await Promise.all(
      ["values", "birth", "emission", "samplers"].map(async (name) => [
        name,
        await load(`decoder-16.21-macos/vfx-${name}.json`),
      ]),
    ),
  );
  packages.placement = await load("latest-world-descriptor-abi/package.json");
  const kernels = await createDirectEffectKernels({ profile, packages });
  if (staticCatalog !== null)
    selectedMaterials = await loadLatestSelectedMaterialRegistry({
      staticCatalog,
      load,
    });
  else if (selectedMaterials !== null)
    assertLatestSelectedMaterials(selectedMaterials);
  if (selectedMaterials !== null)
    await selectedMaterials.bindDefinitions([...new Set(effectIds)]);
  const quadPackageBytes =
    selectedMaterials === null
      ? await load("latest-complete-quad-gpu/package.json")
      : selectedMaterials.packageBytes("quad");
  const bridge = await createParentRenderFrames({
    effectsManifestBytes: manifestBytes,
    quadPackageBytes,
    trailPackageBytes:
      selectedMaterials === null
        ? await load("latest-trail-particles/gpu.json")
        : selectedMaterials.packageBytes("trail"),
    erosionPackageBytes:
      selectedMaterials === null
        ? await load("latest-quad-erosion-gpu/package.json")
        : selectedMaterials.packageBytes("erosion"),
    selectedMaterials,
  });
  const multUvMaterials = await createLatestDirectMultUvMaterials({
    effectsManifestBytes: manifestBytes,
    quadPackageBytes,
    selectedMaterials,
  });
  const groundBytes =
    selectedMaterials?.mode !== "native-quad-partial"
      ? await load("latest-direct-ground-materials/package.json")
      : null;
  if (
    groundBytes !== null &&
    (await sha256(groundBytes)) !== DIRECT_GROUND_PACKAGE_SHA
  )
    throw Error("Direct native ground material package hash differs");
  const groundMaterials =
    groundBytes === null
      ? null
      : directGroundMaterials(
          JSON.parse(new TextDecoder().decode(groundBytes)),
          manifest,
          await sha256(manifestBytes),
        );
  const definitions = new Map();
  const sources = await Promise.all(
    [...new Set(effectIds)].map(async (id) => {
      const ref = manifest.definitions[id];
      if (!ref || ref.file.startsWith("/") || ref.file.includes(".."))
        throw Error("Invalid direct static definition path");
      const bytes = await load(`latest-effects/${ref.file}`);
      return {
        ...JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
        id,
        bytes,
      };
    }),
  );
  const childSiblingBytes =
    selectedMaterials?.mode === "native-quad-partial"
      ? null
      : await load("latest-child-sibling-capabilities/package.json");
  const navGroundMaterials =
    selectedMaterials?.mode !== "native-quad-partial" &&
    sources.some((record) =>
      record.definition?.complexEmitterDefinitionData?.some(
        (e) => e.useNavmeshMask,
      ),
    )
      ? await loadLatestDirectNavGroundMaterials({
          load,
          profile,
          manifestBytes,
          records: sources,
        })
      : null;
  const childSiblingPrograms =
    childSiblingBytes === null
      ? undefined
      : await createLatestDirectChildSiblingPrograms({
          profile,
          packageBytes: childSiblingBytes,
        });
  if (childSiblingBytes !== null) packages.childSiblings = childSiblingBytes;
  packages.childSiblingDefinitions = [];
  packages.effectsManifest = manifestBytes;
  const staticMeshPackage =
    selectedMaterials?.mode !== "native-quad-partial" &&
    sources.some((record) =>
      record.definition?.complexEmitterDefinitionData?.some(
        (e) => e.primitive?.__type === "VfxPrimitiveMesh",
      ),
    )
      ? await loadLatestDirectStaticMeshPackage({
          load,
          profile,
          manifestBytes,
          records: sources,
        })
      : null;
  const rayPackage =
    selectedMaterials?.mode !== "native-quad-partial" &&
    sources.some((record) =>
      record.definition?.complexEmitterDefinitionData?.some(
        (e) => e?.primitive?.__type === "VfxPrimitiveRay",
      ),
    )
      ? await loadLatestDirectRayPackage({
          load,
          profile,
          manifestBytes,
          records: sources,
        })
      : null;
  for (const { id, bytes } of sources) {
    const compiled = await compileLatestDirectEffect({
      id,
      definitionBytes: bytes,
      manifest,
      manifestBytes,
      kernels,
      meshPrograms: staticMeshPackage?.programs,
      meshMaterialAdmission: staticMeshPackage ?? undefined,
      rayMaterialAdmission: rayPackage ?? undefined,
      navGroundMaterials: navGroundMaterials ?? undefined,
      childSiblingPrograms,
    });
    const materialOmissions = [];
    const emitters = compiled.emitters.filter((e) => {
      const { material, reasons } = directEmitterMaterialAdmission(
        e,
        groundMaterials,
        bridge.materials,
        staticMeshPackage,
        rayPackage,
        multUvMaterials,
        navGroundMaterials,
      );
      if (!material) {
        const selectedOmission = selectedMaterials?.omission(e.materialKey);
        materialOmissions.push({
          index: e.index,
          name: e.name,
          reasons: [
            ...reasons,
            ...(selectedOmission?.reasons ?? []).map(
              (reason) => `material:selected-quad-package:${reason}`,
            ),
          ],
        });
        return false;
      }
      if (["static-mesh", "ray"].includes(e.primitive) || e.navGroundProgram)
        return true;
      if (e.groundLayer) bridge.materials.set(e.materialKey, material);
      if (
        material &&
        e.source.alphaRef === 0 &&
        material.prepared.nativeDefines.some((d) => d.name === "ALPHA_TEST")
      )
        throw Error(
          "Zero alpha-ref material differs from its native alpha-test observation",
        );
      return !!material;
    });
    const unsupported = [...compiled.unsupported, ...materialOmissions];
    definitions.set(id, { ...compiled, emitters, unsupported });
    if (compiled.childSiblingProgram)
      packages.childSiblingDefinitions.push([id, bytes]);
  }
  const initializationCompilationInputs = captureCompilationInputs
    ? copyDirectCompilationInitialization(
        [...compilationInputs].sort(([a], [b]) => a.localeCompare(b)),
        { viewerPoseInitialization },
      )
    : null;
  if (initializationCompilationInputs)
    packages.compilationInputs = initializationCompilationInputs.value;
  return {
    profile,
    packages,
    kernels,
    definitions,
    contract: {
      build: manifest.build,
      protocol: manifest.protocol,
      contentHash: await sha256(manifestBytes),
    },
    materials: bridge.materials,
    selectedMaterials,
    staticMeshPackage,
    rayPackage,
    multUvMaterials,
    navGroundMaterials,
    initializationCompilationInputs:
      initializationCompilationInputs?.ownership ?? null,
  };
}
