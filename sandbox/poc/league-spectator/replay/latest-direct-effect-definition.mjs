import { sha256 } from "./structural-comparison.mjs";
import {
  isLatestDirectNavGroundMaterials,
  DIRECT_NAV_GROUND_OMISSIONS,
} from "./latest-direct-nav-ground-materials.mjs";
import { normalizeDirectPointEmitter } from "./latest-direct-effect-defaults.mjs";
import { compileDirectDepthBiasProgram } from "./latest-direct-effect-depth-bias.mjs";
import {
  compileDirectMultUv,
  directMultUvSourceOmissions,
} from "./latest-direct-effect-mult-uv.mjs";
import {
  compileDirectLegacyOffsetProgram,
  DIRECT_LEGACY_OFFSET_OMISSION,
} from "./latest-direct-effect-legacy-offset.mjs";
import { normalizeDirectSystemAudio } from "./latest-direct-effect-audio.mjs";
import {
  isLatestDirectChildSiblingPrograms,
  directChildFreeSiblingEligible,
} from "./latest-direct-child-siblings.mjs";
import { directConstantEmitterPosition } from "./latest-direct-effect-position.mjs";
import { directZeroBoundFlex } from "./latest-direct-effect-flex.mjs";
import {
  directCameraBasisIndependent,
  DIRECT_CAMERA_ORIENTATION_OMISSION,
} from "./latest-direct-effect-orientation.mjs";
import { compileDirectIntegratedRotation } from "./latest-direct-effect-integrated-rotation.mjs";
import { compileDirectAbsentRotationController } from "./latest-direct-effect-absent-rotation.mjs";
import {
  compileDirectDepthDisabledSoftParticles,
  DIRECT_SOFT_PARTICLE_OMISSIONS,
} from "./latest-direct-effect-soft.mjs";
import {
  compileDirectQuadSprite,
  directQuadSpriteMaterialSubset,
} from "./latest-direct-effect-sprite.mjs";
import { compileDirectParticlePalette } from "./latest-direct-particle-palette.mjs";
import { compileDirectCameraMeshFlags } from "./latest-direct-effect-camera-mesh-flags.mjs";
import {
  compileDirectCameraLocalOffsetProgram,
  DIRECT_CAMERA_LOCAL_OFFSET_OMISSION,
} from "./latest-direct-effect-camera-local.mjs";
import { DIRECT_STATIC_MESH_SCENE_OMISSIONS } from "./latest-direct-static-mesh-scene.mjs";
import {
  compileDirectEmitterLifecycle,
  directEmitterLifecycleOmissions,
} from "./latest-direct-effect-lifecycle.mjs";
import {
  compileDirectEmptySingleResourceProgram,
  directEmptyLinkControllerCount,
} from "./latest-direct-effect-link-controllers.mjs";
import {
  DIRECT_GROUND_POLICY,
  DIRECT_GROUND_OMISSIONS,
} from "./latest-direct-ground-policy.mjs";
import {
  DIRECT_EFFECT_BUILD as build,
  DIRECT_EFFECT_PROTOCOL as protocol,
  DIRECT_EFFECT_PROGRAM_VERSION,
} from "./latest-direct-effect-runtime.mjs";
import { isLatestDirectStaticMeshPrograms } from "./latest-direct-effect-static-mesh-program.mjs";
import { isLatestDirectStaticMeshMaterials } from "./latest-direct-static-mesh-materials.mjs";
import { compileDirectRayProgram } from "./latest-direct-effect-ray-program.mjs";
import {
  isLatestDirectRayMaterialPackage,
  validateDirectRayMaterialSelection,
  DIRECT_RAY_MATERIAL_POLICY,
  DIRECT_RAY_MATERIAL_OMISSIONS,
} from "./latest-direct-ray-material-package.mjs";

// Admission is deliberately independent of the runtime's ability to execute a
// program. Expand this inventory only with a comparison for the new behavior.
const fields = new Set([
  "__type",
  "emitterName",
  "importance",
  "pass",
  "rate",
  "particleLifetime",
  "lifetime",
  "isSingleParticle",
  "birthColor",
  "Color",
  "birthScale0",
  "scale0",
  "birthRotation0",
  "birthRotationalVelocity0",
  "bindWeight",
  "SpawnShape",
  "primitive",
  "blendMode",
  "alphaRef",
  "miscRenderFlags",
  "disableBackfaceCull",
  "isUniformScale",
  "texture",
  "texAddressModeBase",
  "timeBeforeFirstEmission",
  "disabled",
  "particleLinger",
  "emitterLinger",
  "particleLingerType",
  "isLocalOrientation",
  "EmitterPosition",
  "birthVelocity",
  "isGroundLayer",
  "FlexShapeDefinition",
  "particleIsLocalOrientation",
  "rotation0",
  "isRotationEnabled",
  "softParticleParams",
]);
const trailFields = new Set([
  "particleIsLocalOrientation",
  "isRandomStartFrame",
  "numFrames",
  "birthUVOffset",
  "texDiv",
]);
const constant = (value, expected) =>
  !value?.dynamics &&
  JSON.stringify(value?.constantValue) === JSON.stringify(expected);
const probabilities = (value) =>
  value?.dynamics?.probabilityTables?.some((t) => t?.keyTimes?.length);
const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

const hasChildResourceDeclaration = (value) =>
  value !== null &&
  typeof value === "object" &&
  (Object.hasOwn(value, "childParticleSetDefinition") ||
    Object.values(value).some(hasChildResourceDeclaration));

function normalizeSystemIdentity(id, record) {
  const expected = /(?:^|\/)([0-9a-f]{8})$/i.exec(id)?.[1];
  if (
    record.id !== undefined &&
    (typeof record.id !== "string" ||
      !/^[0-9a-f]{8}$/i.test(record.id) ||
      record.id.toLowerCase() !== expected?.toLowerCase())
  )
    throw Error(
      "Direct effect record identity differs from requested definition",
    );
  const authored = Object.hasOwn(record.definition, "objectPath");
  if (!authored)
    // Original root constructor 0x1779c9a stores zero at +0x148. This is
    // distinct from an authored zero HASH, and never substitutes the asset ID.
    return { objectPathHash: 0, authored: false };
  const hash =
    typeof record.definition.objectPath === "string"
      ? /^\{([0-9a-f]{8})\}$/i.exec(record.definition.objectPath)?.[1]
      : undefined;
  if (!hash || !expected || hash.toLowerCase() !== expected.toLowerCase())
    throw Error(
      "Direct effect objectPath HASH differs from requested definition identity",
    );
  return { objectPathHash: Number.parseInt(hash, 16), authored: true };
}

function normalizeSystemFlags(definition) {
  const authored = Object.hasOwn(definition, "flags");
  const value = authored ? definition.flags : 212;
  // The original typed field is UInt16 at root+c2; the constructor default is
  // 0xd4. Do not coerce booleans/strings or truncate unknown high bits.
  if (!Number.isInteger(value) || value < 0 || value > 0xffff)
    throw Error("Direct effect root flags must be an exact uint16");
  return { value, authored };
}

// These exact values preserve the ordinary direct-parent scheduler in native
// differential controls. This is a component slice, not wrapper equivalence:
// full original empty-view controls prove 212/198 skip simulation while
// 213/197 continue. The default receives the same explicit omissions.
const directParentFlagValues = new Set([212, 196, 197, 198, 213, 214]);
const systemOmissions = [
  "system:wrapper-view-dependent-simulation-and-culling",
  "system:provider-death-and-generation-change-lifecycle",
  "system:audio-handle-cleanup-and-offscreen-sound-policy",
];

export async function compileLatestDirectEffect({
  id,
  definitionBytes,
  manifest,
  manifestBytes,
  kernels,
  meshPrograms,
  meshMaterialAdmission,
  rayMaterialAdmission,
  navGroundMaterials,
  childSiblingPrograms,
}) {
  if (
    childSiblingPrograms !== undefined &&
    !isLatestDirectChildSiblingPrograms(childSiblingPrograms)
  )
    throw Error("Owned child sibling capability factory required");
  if (
    meshPrograms !== undefined &&
    !isLatestDirectStaticMeshPrograms(meshPrograms)
  )
    throw Error("Owned static mesh capability factory required");
  if (
    meshMaterialAdmission !== undefined &&
    (!meshMaterialAdmission ||
      !isLatestDirectStaticMeshMaterials(meshMaterialAdmission.materials) ||
      !(meshMaterialAdmission.tokens instanceof Map))
  )
    throw Error("Owned static mesh material factory and token map required");
  if (
    rayMaterialAdmission !== undefined &&
    (!rayMaterialAdmission ||
      !isLatestDirectRayMaterialPackage(rayMaterialAdmission.materials) ||
      !(rayMaterialAdmission.tokens instanceof Map))
  )
    throw Error("Owned Ray material factory and token map required");
  const decodedManifest = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes),
  );
  if (
    navGroundMaterials !== undefined &&
    !isLatestDirectNavGroundMaterials(navGroundMaterials)
  )
    throw Error("Owned navigation ground material admission required");
  if (JSON.stringify(manifest) !== JSON.stringify(decodedManifest))
    throw Error("Direct effect manifest object differs from its content bytes");
  const reference = manifest.definitions[id];
  const contentHash = await sha256(manifestBytes);
  if (
    manifest.build !== build ||
    manifest.protocol !== protocol ||
    !reference ||
    (await sha256(definitionBytes)) !== reference.sha256
  )
    throw Error("Direct effect definition build/content differs");
  const record = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(definitionBytes),
  );
  if (record.definition?.__type !== "VfxSystemDefinitionData")
    throw Error("Invalid direct effect definition class");
  const systemIdentity = normalizeSystemIdentity(id, record);
  const systemFlags = normalizeSystemFlags(record.definition);
  const systemAudio = normalizeDirectSystemAudio(record.definition);
  const rootFields = new Set([
    "__type",
    "complexEmitterDefinitionData",
    "simpleEmitterDefinitionData",
    "particleName",
    "particlePath",
    "objectPath",
    "flags",
    "soundOnCreateDefault",
    "soundPersistentDefault",
  ]);
  const blockers = Object.keys(record.definition)
    .filter((k) => !rootFields.has(k))
    .map((k) => `system:${k}`);
  if (!directParentFlagValues.has(systemFlags.value))
    blockers.unshift("system:flags");
  // Native child resource factories consume this HASH as parent ancestry.
  // The no-child parent differential proves its identity-only behavior for
  // child-free roots; it does not establish child resource acquisition/order.
  // Presence includes null/empty declarations, whose semantics are unverified.
  const childResourceAncestryRequired = hasChildResourceDeclaration(
    record.definition,
  );
  const childSiblingProgram =
    childResourceAncestryRequired && childSiblingPrograms
      ? await childSiblingPrograms.compile({
          id,
          definition: record.definition,
          systemIdentity,
        })
      : null;
  if (childResourceAncestryRequired && !childSiblingProgram)
    blockers.push("system:child-resource-ancestry");
  const emitters = [],
    unsupported = [];
  for (const [index, authored] of (
    record.definition.complexEmitterDefinitionData ?? []
  ).entries()) {
    const source = normalizeDirectPointEmitter(authored);
    const cameraTrail = source.primitive?.__type === "VfxPrimitiveCameraTrail";
    const primitive = source.primitive?.__type;
    const staticMesh = primitive === "VfxPrimitiveMesh";
    const ray = primitive === "VfxPrimitiveRay";
    const rayProgram = ray ? compileDirectRayProgram(source) : null;
    const meshCapability =
      staticMesh && meshPrograms ? meshPrograms.compile(source) : null;
    const meshProgram =
      meshCapability?.status === "prepared-static-mesh-primitive-program"
        ? meshCapability.program
        : null;
    const cameraQuad =
      source.primitive === undefined || primitive === "VfxPrimitiveCameraQuad";
    const primitiveKind = staticMesh
      ? "static-mesh"
      : ray
        ? "ray"
        : cameraTrail
          ? "camera-trail"
          : cameraQuad
            ? "camera-quad"
            : "arbitrary-quad";
    const spriteProgram = compileDirectQuadSprite(source, primitiveKind);
    const multUvProgram = compileDirectMultUv(source, primitiveKind);
    const depthBiasProgram = compileDirectDepthBiasProgram(
      source,
      primitiveKind,
    );
    const navGroundProgram =
      source.useNavmeshMask && navGroundMaterials
        ? navGroundMaterials.compile({
            id,
            index,
            definitionHash: reference.sha256,
            source,
            multUvProgram,
          })
        : null;
    const cameraLocalOffsetProgram = compileDirectCameraLocalOffsetProgram(
      source,
      primitiveKind,
    );
    const meshRenderFlagsPolicy = compileDirectCameraMeshFlags(
      source,
      primitiveKind,
    );
    const isGroundLayer =
      source.isGroundLayer === 1 || source.isGroundLayer === true;
    const paletteProgram = compileDirectParticlePalette(
      source,
      primitiveKind,
      isGroundLayer,
    );
    const paletteTexture = paletteProgram
      ? manifest.assets[paletteProgram.texture.toLowerCase()]
      : null;
    const rayPaletteTexture = rayProgram
      ? manifest.assets[rayProgram.palette.texture.toLowerCase()]
      : null;
    const zeroBoundFlex = directZeroBoundFlex(source.FlexShapeDefinition);
    const reasons = Object.keys(source)
      .filter(
        (k) =>
          !fields.has(k) &&
          !(
            k === "materialOverrideDefinitions" &&
            directEmptyLinkControllerCount(source) === 0
          ) &&
          !(cameraTrail && trailFields.has(k)) &&
          !(spriteProgram && ["isRandomStartFrame", "numFrames"].includes(k)) &&
          !(paletteProgram && k === "particleColorTexture") &&
          !(multUvProgram && k === "textureMult") &&
          !(depthBiasProgram && k === "depthBiasFactors") &&
          !(navGroundProgram && k === "useNavmeshMask") &&
          !(meshRenderFlagsPolicy && k === "meshRenderFlags") &&
          !(
            rayProgram &&
            [
              "isRandomStartFrame",
              "numFrames",
              "texDiv",
              "particleColorTexture",
            ].includes(k)
          ) &&
          !(meshProgram && k === "uvScale"),
      )
      .map((k) => `field:${k}`);
    reasons.push(...directMultUvSourceOmissions(source, primitiveKind));
    if (
      childSiblingProgram &&
      !directChildFreeSiblingEligible(source, childSiblingProgram)
    )
      reasons.push(
        hasChildResourceDeclaration(source)
          ? "child:source-emitter-simulation-and-request-clock-untranslated"
          : "child:sibling-primitive-not-native-proven",
      );
    if (staticMesh) {
      if (!meshPrograms) reasons.push("mesh:capability-package-unprepared");
      else if (!meshProgram) reasons.push(...meshCapability.reasons);
    }
    if (ray) {
      if (!rayProgram) reasons.push("ray:particle-controller-subset");
      else {
        if (
          rayPaletteTexture?.kind !== "texture" ||
          rayPaletteTexture.status !== "prepared"
        )
          reasons.push("material:ray-palette-texture");
      }
    }
    if (spriteProgram && !directQuadSpriteMaterialSubset(source, isGroundLayer))
      reasons.push("material:sprite-native-ground-subset");
    if (
      paletteProgram &&
      (paletteTexture?.kind !== "texture" ||
        paletteTexture.status !== "prepared")
    )
      reasons.push("material:palette-texture");
    if (source.FlexShapeDefinition !== undefined && !zeroBoundFlex)
      reasons.push("flex:untranslated-shape-or-bound-coefficient");
    if (
      source.isGroundLayer !== undefined &&
      ![0, 1, false, true].includes(source.isGroundLayer)
    )
      reasons.push("material:ground-layer-type");
    const groundLayer =
      source.isGroundLayer === 1 || source.isGroundLayer === true;
    if (source.disabled) {
      unsupported.push({
        index,
        name: source.emitterName,
        reasons: ["authored-disabled"],
      });
      continue;
    }
    let meshMaterialSelection = null;
    if (meshProgram) {
      const token = meshMaterialAdmission?.tokens.get(`${id}:${index}`);
      if (token === undefined)
        reasons.push("material:static-mesh-individual-selection-unprepared");
      else {
        meshMaterialSelection =
          meshMaterialAdmission.materials.inspectNonInstanced(token);
        if (
          meshMaterialSelection.status !==
            "owned-static-mesh-individual-material-selection" ||
          meshMaterialSelection.effectId !== id ||
          meshMaterialSelection.emitterIndex !== index ||
          meshMaterialSelection.sourceDefinitionSha256 !== reference.sha256 ||
          meshMaterialSelection.meshPath !== meshProgram.resource.path ||
          meshMaterialSelection.vertexSha256 !==
            meshProgram.resource.vertices.sha256 ||
          meshMaterialSelection.policy?.policy !== meshProgram.materialPolicy ||
          meshMaterialSelection.policy.instanceDraw !== 0 ||
          meshMaterialSelection.policy.matrixOrder !==
            meshProgram.worldUniformOrder
        )
          throw Error(
            "Owned static mesh material selection differs from source/program",
          );
      }
    }
    let rayMaterialSelection = null;
    if (rayProgram) {
      const token = rayMaterialAdmission?.tokens.get(`${id}:${index}`);
      if (token === undefined)
        reasons.push("material:ray-native-selection-unprepared");
      else {
        rayMaterialSelection = rayMaterialAdmission.materials.inspect(token);
        validateDirectRayMaterialSelection(
          {
            primitive: "ray",
            source,
            rayProgram,
            rayMaterialSelection,
            rayPaletteTexture,
            texture: manifest.assets[source.texture?.toLowerCase()],
            materialKey: `${id}:${index}`,
            materialPolicy: DIRECT_RAY_MATERIAL_POLICY,
          },
          { id, definitionHash: reference.sha256, index },
        );
      }
    }
    // Complete native post-load graphs establish that an absent authored
    // primitive selects the camera-quad class, not an arbitrary-quad default.
    if (
      primitive !== "VfxPrimitiveArbitraryQuad" &&
      !cameraQuad &&
      !cameraTrail &&
      !meshProgram &&
      !rayProgram
    )
      reasons.push(`primitive:${primitive ?? "unprepared-default"}`);
    if (
      Object.keys(source.primitive ?? {}).some(
        (k) =>
          k !== "__type" &&
          !(cameraTrail && k === "mTrail") &&
          !(meshProgram && k === "mMesh"),
      )
    )
      reasons.push("primitive-properties");
    const trail = cameraTrail ? source.primitive.mTrail : null;
    if (cameraTrail) {
      if (groundLayer) reasons.push("trail:ground-material");
      if (
        !trail ||
        trail.__type !== "VfxTrailDefinitionData" ||
        Object.keys(trail).some(
          (k) =>
            ![
              "__type",
              "mMode",
              "mCutoff",
              "mBirthTilingSize",
              "mSmoothingMode",
            ].includes(k),
        ) ||
        ![0, 1].includes(trail.mMode) ||
        ![0, 1].includes(trail.mSmoothingMode) ||
        typeof trail.mCutoff !== "number" ||
        !Number.isFinite(Math.fround(trail.mCutoff)) ||
        trail.mCutoff < 0
      )
        reasons.push("trail:mode-cutoff-or-smoothing");
      for (const key of ["particleIsLocalOrientation", "isRandomStartFrame"])
        if (
          source[key] !== undefined &&
          ![0, 1, false, true].includes(source[key])
        )
          reasons.push(`trail:boolean:${key}`);
      if (
        source.numFrames !== undefined &&
        (!Number.isInteger(source.numFrames) ||
          source.numFrames < 1 ||
          source.numFrames > 65535)
      )
        reasons.push("trail:frame-count");
      if (
        source.birthUVOffset?.dynamics &&
        source.birthUVOffset.dynamics.times?.length !== 1
      )
        reasons.push("trail:birth-uv-clock");
      for (const [field, fallback] of [
        [source.birthUVOffset, [0, 0]],
        [trail?.mBirthTilingSize, [0, 0, 0]],
      ]) {
        try {
          for (const age of [0, 0.5, 1])
            kernels.birth.sampleValue(
              field,
              age,
              fallback,
              kernels.birth.createRandom(1n),
              0.5,
            );
        } catch {
          reasons.push("trail:birth-uv-or-tiling-value");
        }
      }
      if (
        source.texDiv !== undefined &&
        (!Array.isArray(source.texDiv) ||
          source.texDiv.length !== 2 ||
          !source.texDiv.every(
            (v) =>
              typeof v === "number" && Number.isFinite(Math.fround(v)) && v > 0,
          ))
      )
        reasons.push("trail:atlas-divisions");
      if (source.birthVelocity !== undefined)
        reasons.push("trail:moving-particle-odometer");
    }
    const noShape = source.SpawnShape === undefined;
    const legacyOffsetProgram = compileDirectLegacyOffsetProgram(
      source.SpawnShape,
      primitiveKind,
    );
    if (
      !noShape &&
      source.SpawnShape?.__type !== "{ee39916f}" &&
      !legacyOffsetProgram
    )
      reasons.push(
        `shape:${source.SpawnShape?.__type ?? "unprepared-default"}`,
      );
    if (
      Object.keys(source.SpawnShape ?? {}).some(
        (k) => !["__type", "emitOffset"].includes(k),
      )
    )
      reasons.push("shape-properties");
    // The original constructor leaves an absent shape null. Its birth branch
    // skips the shape callback with the initialized zero offset unchanged.
    let offset = noShape ? [0, 0, 0] : null;
    if (source.SpawnShape?.__type === "{ee39916f}") {
      try {
        offset = kernels.birth.pointOffset(source.SpawnShape);
      } catch {
        reasons.push("shape:point-offset");
      }
    }
    for (const key of ["rate", "particleLifetime", "birthScale0", "bindWeight"])
      if (!source[key]) reasons.push(`unprepared-default:${key}`);
    if (
      source.isLocalOrientation !== undefined &&
      ![0, 1, false, true].includes(source.isLocalOrientation)
    )
      reasons.push("binding:local-orientation-type");
    if (source.isLocalOrientation) reasons.push("binding:local-orientation");
    // Original constructor 0x1700202 initializes +0x2d0 to 0x202000;
    // isLocalOrientation's bit 0x200000 is therefore set when absent. Explicit
    // false uses an identity birth transform. Authored true remains excluded
    // until its authored placement path has its own admission evidence.
    const inheritSystemBasis =
      source.isLocalOrientation !== 0 && source.isLocalOrientation !== false;
    const velocity = source.birthVelocity;
    if (
      velocity !== undefined &&
      (velocity?.__type !== "ValueVector3" ||
        Object.keys(velocity).some(
          (key) => !["__type", "constantValue"].includes(key),
        ) ||
        !Array.isArray(velocity.constantValue) ||
        velocity.constantValue.length !== 3 ||
        !velocity.constantValue.every(
          (value) =>
            typeof value === "number" && Number.isFinite(Math.fround(value)),
        ))
    )
      reasons.push("motion:birth-velocity-constant");
    if (velocity !== undefined && !source.isSingleParticle)
      reasons.push("motion:velocity-continuous-birth-clock");
    const emitterPosition = directConstantEmitterPosition(
      source.EmitterPosition,
    );
    if (emitterPosition === null) reasons.push("position:emitter-constant");
    const softParticlePolicy = compileDirectDepthDisabledSoftParticles(
      source,
      primitiveKind,
      groundLayer,
    );
    if (source.softParticleParams !== undefined && !softParticlePolicy)
      reasons.push("material:soft-particle-depth-disabled-subset");
    let integratedRotation = null;
    const absentRotationControllerProgram =
      compileDirectAbsentRotationController(source, primitiveKind);
    if (
      source.rotation0 !== undefined ||
      source.isRotationEnabled !== undefined
    ) {
      const rotation = compileDirectIntegratedRotation(source.rotation0);
      if (![0, 1, false, true].includes(source.isRotationEnabled))
        reasons.push("rotation:explicit-typed-enable-required");
      if (!absentRotationControllerProgram) {
        if (!cameraQuad) reasons.push("rotation:camera-controller-only");
        if (!rotation) reasons.push("rotation:flat-integrated-controller");
        if (source.isRotationEnabled) integratedRotation = rotation;
      }
    }
    const basisIndependent = directCameraBasisIndependent({
      primitive: cameraQuad ? "camera-quad" : null,
      offset,
      emitterPosition,
      velocity:
        velocity === undefined
          ? undefined
          : Array.isArray(velocity?.constantValue)
            ? velocity.constantValue.map(Math.fround)
            : null,
    });
    if (!cameraTrail && source.particleIsLocalOrientation !== undefined) {
      if (![0, 1, false, true].includes(source.particleIsLocalOrientation))
        reasons.push("binding:particle-local-orientation-type");
      else if (!basisIndependent && !cameraLocalOffsetProgram)
        reasons.push(
          "binding:particle-local-orientation-root-basis-untranslated",
        );
    }
    const angularVelocity = source.birthRotationalVelocity0;
    if (
      angularVelocity !== undefined &&
      (angularVelocity?.__type !== "ValueVector3" ||
        Object.keys(angularVelocity).some(
          (key) => !["__type", "constantValue"].includes(key),
        ) ||
        !Array.isArray(angularVelocity.constantValue) ||
        angularVelocity.constantValue.length !== 3 ||
        !angularVelocity.constantValue.every(
          (value) =>
            typeof value === "number" && Number.isFinite(Math.fround(value)),
        ))
    )
      reasons.push("birth:angular-velocity-constant");
    if (angularVelocity !== undefined && cameraQuad)
      reasons.push("birth:angular-velocity-camera-basis");
    if (![0, 1].some((v) => constant(source.bindWeight, v)))
      reasons.push("binding:nonconstant-weight");
    if (!(source.lifetime > 0) || !Number.isFinite(source.lifetime))
      reasons.push("clock:emitter-lifetime");
    const life = source.particleLifetime;
    if (life?.dynamics && life.dynamics.times?.length !== 1)
      reasons.push("birth:lifetime-curve-clock");
    try {
      for (const chance of [
        0,
        1,
        ...(life?.dynamics?.probabilityTables?.[0]?.keyTimes ?? []),
      ])
        if (
          !(kernels.birth.sampleValue(life, 0, 0, { next: () => chance }) > 0)
        )
          reasons.push("birth:lifetime");
    } catch {
      reasons.push("birth:lifetime");
    }
    // Native point observations verify the lifetime/scale/rotation draw order
    // for single-key birth curves. Animated random birth clocks, random birth
    // color and particle-age random controllers remain separate dependencies.
    for (const key of ["particleLifetime", "birthScale0", "birthRotation0"])
      if (
        probabilities(source[key]) &&
        source[key].dynamics.times?.length !== 1
      )
        reasons.push(`rng:birth-curve-clock:${key}`);
    for (const key of ["birthColor", "Color", "scale0"])
      if (probabilities(source[key])) reasons.push(`rng:call-order:${key}`);
    if (
      source.timeBeforeFirstEmission !== undefined &&
      (!Number.isFinite(source.timeBeforeFirstEmission) ||
        source.timeBeforeFirstEmission < 0)
    )
      reasons.push("clock:emission-delay");
    const admission = kernels.emission.eligibility(source);
    reasons.push(...admission.reasons.map((r) => `emission:${r}`));
    // Original UInt8 +0x14 defaults to zero. Mode0's prepared native material
    // retains additive ONE/ONE factors, shader ALPHA_TEST defines and actual
    // threshold constant blocks; the renderer consumes those exact bindings.
    if (![0, 1, 4].includes(source.blendMode))
      reasons.push(
        `material:blend:${source.blendMode ?? "unprepared-default"}`,
      );
    // Preserve explicit zero or absent threshold fields. The exact prepared
    // material supplies its actual ALPHA_TEST define and threshold block;
    // absence does not mean a zero threshold or disabled alpha test. Active
    // authored nonzero thresholds remain a separate admission dependency.
    if (source.alphaRef !== undefined && source.alphaRef !== 0)
      reasons.push("material:alpha-ref-threshold");
    const texture = manifest.assets[source.texture?.toLowerCase()];
    if (texture?.status !== "prepared" || texture.kind !== "texture")
      reasons.push("material:base-texture");
    const sampler = kernels.samplers.describe(source, "base");
    if (!sampler.previewSupported)
      reasons.push(`material:sampler:${sampler.name}`);
    // Compile-time curve validation uses the same translated sampler as runtime.
    // Unsupported evaluation modes are never deferred to a combat frame.
    for (const [key, fallback] of [
      ["birthColor", [1, 1, 1, 1]],
      ["Color", [1, 1, 1, 1]],
      ["birthScale0", [1, 1, 1]],
      ["scale0", [1, 1, 1]],
      ["particleLifetime", 0],
    ]) {
      try {
        for (const t of [0, 0.5, 1])
          kernels.birth.sampleValue(
            source[key],
            t,
            fallback,
            kernels.birth.createRandom(0n),
          );
      } catch {
        reasons.push(`value:${key}`);
      }
    }
    if (source.birthRotation0) {
      try {
        kernels.birth.sampleValue(
          source.birthRotation0,
          0,
          [0, 0, 0],
          kernels.birth.createRandom(0n),
        );
      } catch {
        reasons.push("value:birthRotation0");
      }
    }
    if (reasons.length) {
      unsupported.push({
        index,
        name: source.emitterName,
        reasons: [...new Set(reasons)],
      });
      continue;
    }
    const lifecycleCandidate = compileDirectEmitterLifecycle(
      source,
      primitiveKind,
    );
    const singleResourceProgram = compileDirectEmptySingleResourceProgram(
      source,
      primitiveKind,
    );
    // Resource postload calculates link timers before shortening a single's
    // emitter clock. Keep the authored source and both clocks identifiable.
    const lifecycleProgram = lifecycleCandidate?.requiresLinkControllerCount
      ? singleResourceProgram
        ? {
            ...lifecycleCandidate,
            lifetime: singleResourceProgram.effectiveLifetime,
          }
        : null
      : lifecycleCandidate;
    emitters.push({
      index,
      name: source.emitterName,
      source,
      placementRequirements: {
        rootBasis: !basisIndependent,
        boundObjectSize: zeroBoundFlex
          ? ["camera-quad", "arbitrary-quad"].includes(primitiveKind)
            ? "finite-nonnegative"
            : 0
          : null,
      },
      primitive: meshProgram
        ? "static-mesh"
        : rayProgram
          ? "ray"
          : cameraTrail
            ? "camera-trail"
            : cameraQuad
              ? "camera-quad"
              : "arbitrary-quad",
      ...(cameraTrail ? { trail } : {}),
      ...(meshProgram ? { meshProgram, meshMaterialSelection } : {}),
      ...(rayProgram
        ? { rayProgram, rayMaterialSelection, rayPaletteTexture }
        : {}),
      basis: [
        [1, 0, 0],
        [0, 1, 0],
      ],
      offset,
      emitterPosition,
      velocity: velocity?.constantValue?.map(Math.fround),
      inheritSystemBasis,
      bound: source.bindWeight.constantValue === 1,
      delay: source.timeBeforeFirstEmission ?? 0,
      lifetime: Math.fround(
        singleResourceProgram?.effectiveLifetime ?? source.lifetime,
      ),
      single: !!source.isSingleParticle,
      uniformScale: !!source.isUniformScale,
      angularVelocity: angularVelocity?.constantValue?.map(Math.fround),
      integratedRotation,
      absentRotationControllerProgram,
      softParticlePolicy,
      spriteProgram,
      multUvProgram,
      depthBiasProgram,
      navGroundProgram,
      paletteProgram,
      paletteTexture,
      meshRenderFlagsPolicy,
      cameraLocalOffsetProgram,
      legacyOffsetProgram,
      lifecycleProgram,
      singleResourceProgram,
      materialKey: `${id}:${index}`,
      groundLayer,
      materialPolicy: meshProgram
        ? meshProgram.materialPolicy
        : rayProgram
          ? DIRECT_RAY_MATERIAL_POLICY
          : groundLayer
            ? navGroundProgram
              ? navGroundProgram.policy
              : DIRECT_GROUND_POLICY
            : null,
      omissions: [
        ...(!lifecycleProgram
          ? lifecycleCandidate?.requiresLinkControllerCount
            ? ["lifecycle:single-link-controller-count-unresolved"]
            : directEmitterLifecycleOmissions(source, primitiveKind)
          : []),
        ...(basisIndependent ? [DIRECT_CAMERA_ORIENTATION_OMISSION] : []),
        ...(cameraLocalOffsetProgram
          ? [DIRECT_CAMERA_LOCAL_OFFSET_OMISSION]
          : []),
        ...(legacyOffsetProgram ? [DIRECT_LEGACY_OFFSET_OMISSION] : []),
        ...(navGroundProgram
          ? DIRECT_NAV_GROUND_OMISSIONS
          : groundLayer
            ? DIRECT_GROUND_OMISSIONS
            : []),
        ...(cameraTrail ? ["trail:supplied-smoothing-quality-zero"] : []),
        ...(softParticlePolicy ? DIRECT_SOFT_PARTICLE_OMISSIONS : []),
        ...(meshCapability?.omissions ?? []),
        ...(meshProgram ? DIRECT_STATIC_MESH_SCENE_OMISSIONS : []),
        ...(rayProgram ? DIRECT_RAY_MATERIAL_OMISSIONS : []),
      ],
      texture,
      sampler,
      blend: source.blendMode,
      depthTest: !(source.miscRenderFlags & 1),
      doubleSide: !!source.disableBackfaceCull,
      pass: source.pass ?? 0,
    });
    if (
      !lifecycleProgram &&
      (source.particleLinger !== undefined ||
        source.emitterLinger !== undefined ||
        source.particleLingerType !== undefined)
    )
      unsupported.push({
        index,
        name: source.emitterName,
        reasons: ["lifecycle:particle-linger-after-stop"],
      });
  }
  for (const [index, e] of (
    record.definition.simpleEmitterDefinitionData ?? []
  ).entries())
    unsupported.push({
      index: `simple:${index}`,
      name: e.emitterName,
      reasons: ["simple-emitter"],
    });
  return freeze({
    schema: 1,
    programVersion: DIRECT_EFFECT_PROGRAM_VERSION,
    id,
    build,
    protocol,
    contentHash,
    definitionHash: reference.sha256,
    systemIdentity,
    systemFlags,
    systemAudio,
    systemOmissions: [
      ...systemOmissions,
      ...(childSiblingProgram?.omissions ?? []),
      ...Object.entries(systemAudio)
        .filter(([, field]) => field.authored)
        .map(
          ([key]) =>
            `system:audio:${key}:enqueue-playback-device-and-handle-lifecycle`,
        ),
    ],
    childResourceAncestryRequired,
    childSiblingProgram,
    emitters,
    unsupported,
    blockers,
    policy:
      "provisional 60 Hz clock and explicit seed; point camera/arbitrary unlit quad slice; native parent activation and complete material fidelity unverified",
  });
}
