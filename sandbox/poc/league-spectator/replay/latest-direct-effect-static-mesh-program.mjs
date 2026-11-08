import { sha256 } from "./structural-comparison.mjs";
import {
  directStaticMeshGeometry,
  directStaticMeshResourceFields,
} from "./latest-direct-effect-mesh.mjs";
import {
  DIRECT_STATIC_MESH_INDIVIDUAL_POLICY,
  DIRECT_STATIC_MESH_INDIVIDUAL_SHADER_PAIR,
} from "./latest-direct-static-mesh-materials.mjs";

export const DIRECT_STATIC_MESH_MATERIAL_POLICY =
  DIRECT_STATIC_MESH_INDIVIDUAL_POLICY;
export const DIRECT_STATIC_MESH_RESOURCE_PACKAGE_SHA =
  "87587b2708d642f9eaa68c0eb8f1cb84339cc42e80c7f50e96fe74c400039eb4";
const factories = new WeakSet();
export const isLatestDirectStaticMeshPrograms = (value) => factories.has(value);
const digest = (value) =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value, expected) =>
  object(value) &&
  Reflect.ownKeys(value).length === expected.length &&
  expected.every((key) => Object.hasOwn(value, key));
const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
function normalizedPath(value) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 4096 ||
    value.includes("\0") ||
    value.includes("\\") ||
    !/^assets\/[a-z0-9_./-]+\.scb$/i.test(value) ||
    value
      .split("/")
      .some((part) => part === "." || part === ".." || part === "")
  )
    return null;
  return value.toLowerCase();
}
function blob(value, expectedBytes) {
  return (
    keys(value, ["file", "sha256", "bytes"]) &&
    digest(value.sha256) &&
    value.file === `blobs/${value.sha256}.bin` &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    (expectedBytes === null || value.bytes === expectedBytes)
  );
}
const forbiddenInputs = [
  "textureMult",
  "particleColorTexture",
  "colorLookUpTypeX",
  "colorLookUpTypeY",
  "colorLookUpScales",
  "colorLookUpOffsets",
  "paletteDefinition",
  "birthUVOffset",
  "birthUvScrollRate",
  "birthUvRotateRate",
  "uvRotation",
  "particleUVScrollRate",
  "particleUVRotateRate",
  "flexBirthUVScrollRate",
  "flexBirthUVOffset",
  "TextureFlipU",
  "TextureFlipV",
  "texDiv",
  "numFrames",
  "startFrame",
  "isRandomStartFrame",
  "FlexShapeDefinition",
  "childParticleSetDefinition",
  "softParticleParams",
  "birthRotation0",
  "rotation0",
  "birthRotationalVelocity0",
  "birthVelocity",
  "EmitterPosition",
  "SpawnShape",
  "isRotationEnabled",
  "isLocalOrientation",
  "particleIsLocalOrientation",
  "direction",
  "birthDirection",
];

function equalOwnedData(a, b) {
  if (Object.is(a, b)) return true;
  if (
    !a ||
    !b ||
    typeof a !== "object" ||
    typeof b !== "object" ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const aa = Reflect.ownKeys(a),
    bb = Reflect.ownKeys(b);
  return (
    aa.length === bb.length &&
    aa.every((key) => Object.hasOwn(b, key) && equalOwnedData(a[key], b[key]))
  );
}

function individualPolicy(value) {
  const name = "ParticleMeshInstanceInfo_SharedDataBuffer";
  return (
    keys(value, [
      "schema",
      "policy",
      "instanceDraw",
      "matrixOrder",
      "shaderPair",
      "inactiveResource",
    ]) &&
    value.schema === 1 &&
    value.policy === DIRECT_STATIC_MESH_MATERIAL_POLICY &&
    value.instanceDraw === 0 &&
    value.matrixOrder === "post-1916f70" &&
    equalOwnedData(
      value.shaderPair,
      DIRECT_STATIC_MESH_INDIVIDUAL_SHADER_PAIR,
    ) &&
    equalOwnedData(value.inactiveResource, {
      stage: "vertex",
      name,
      glslName: name,
      unit: 0,
      elementBytes: 208,
      members: [
        {
          columns: 52,
          elements: 0,
          name: "$Element",
          offset: 0,
          rowMajor: false,
          rows: 1,
          scalar: "float",
          size: 208,
          used: true,
        },
      ],
      adapter: "uint-data-texture",
      activePayloadRequired: false,
      inactiveApiBindingRequired: true,
      payloadRecovered: false,
    })
  );
}

function meshSourceReasons(source, prepared) {
  const reasons = [];
  const primitive = source.primitive,
    mesh = primitive?.mMesh;
  if (
    !keys(primitive, ["__type", "mMesh"]) ||
    primitive.__type !== "VfxPrimitiveMesh"
  )
    reasons.push("mesh:primitive-class-or-properties");
  if (
    !keys(mesh, ["__type", "mSimpleMeshName"]) ||
    mesh.__type !== "VfxMeshDefinitionData"
  )
    reasons.push("mesh:definition-bone-facing-animated-or-properties");
  if (
    !keys(source.bindWeight, ["__type", "constantValue"]) ||
    source.bindWeight.__type !== "ValueFloat" ||
    source.bindWeight.constantValue !== 1
  )
    reasons.push("mesh:constant-bound-root-weight-one");
  if (![1, true].includes(source.isUniformScale))
    reasons.push("mesh:uniform-particle-scale-required");
  if (![1, true].includes(source.isSingleParticle))
    reasons.push("mesh:single-particle-required");
  const path = normalizedPath(mesh?.mSimpleMeshName),
    resource = path ? prepared?.get(path) : null;
  if (!path) reasons.push("mesh:authored-static-scb-path");
  else if (prepared && !resource)
    reasons.push(`mesh:unprepared-static-resource:${path}`);
  if (resource && resource.fields.flag94 !== 0)
    reasons.push("mesh:resource-pivot-provider");
  for (const field of forbiddenInputs)
    if (Object.hasOwn(source, field))
      reasons.push(`mesh:unsupported-source:${field}`);
  const scale = source.uvScale;
  if (
    !keys(scale, ["__type", "constantValue"]) ||
    scale.__type !== "ValueVector2" ||
    !Array.isArray(scale.constantValue) ||
    scale.constantValue.length !== 2 ||
    Reflect.ownKeys(scale.constantValue).length !== 3 ||
    ![0, 1].every((i) => Object.hasOwn(scale.constantValue, i)) ||
    scale.constantValue[0] !== 2 ||
    scale.constantValue[1] !== 1
  )
    reasons.push("mesh:constant-centered-base-uv-scale");
  return { reasons, path, resource };
}

// Synchronous worker boundary validation binds serialized metadata to its
// retained source and content identities. Blob bytes are verified by the static
// loader; this cannot rehash resources absent from the simulation worker.
export function validateDirectStaticMeshProgram(emitter, expected = {}) {
  if (emitter?.primitive !== "static-mesh") {
    if (
      emitter?.meshProgram !== undefined ||
      emitter?.meshMaterialSelection !== undefined
    )
      throw Error("Unexpected compiled static mesh metadata");
    return null;
  }
  const program = emitter.meshProgram,
    selection = emitter.meshMaterialSelection,
    source = emitter.source;
  const uint = (value) =>
    Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
  const finiteVector = (value) =>
    Array.isArray(value) &&
    Array.from(value).every(
      (v) => typeof v === "number" && Number.isFinite(Math.fround(v)),
    );
  if (
    !object(source) ||
    source.__type !== "VfxEmitterDefinitionData" ||
    meshSourceReasons(source).reasons.length ||
    !keys(program, [
      "schema",
      "policy",
      "primitive",
      "materialPolicy",
      "resourcePackageSha256",
      "resource",
      "resourceFields",
      "placementRequirements",
      "facingFlags",
      "paletteByte",
      "multTexturePresent",
      "uv",
      "worldUniformOrder",
      "source",
    ]) ||
    program.schema !== 1 ||
    program.policy !== "ordinary-static-mesh-individual-particle-v1" ||
    program.primitive !== "static-mesh" ||
    program.materialPolicy !== DIRECT_STATIC_MESH_MATERIAL_POLICY ||
    program.resourcePackageSha256 !== DIRECT_STATIC_MESH_RESOURCE_PACKAGE_SHA ||
    program.worldUniformOrder !== "post-1916f70" ||
    !equalOwnedData(program.source, source) ||
    !equalOwnedData(program.placementRequirements, {
      rootBasis: true,
      boundObjectSize: null,
    }) ||
    !equalOwnedData(
      emitter.placementRequirements,
      program.placementRequirements,
    ) ||
    !equalOwnedData(program.facingFlags, [false, false, false]) ||
    program.paletteByte !== 0 ||
    program.multTexturePresent !== false ||
    !equalOwnedData(program.uv, {
      schema: 1,
      policy: "original-constant-centered-base-mesh-uv-v1",
      textureDivisions: [1, 1],
      linkFlags: [true, false],
      baseMatrix: [2, 0, 0, 1, -0.5, 0],
      multMatrix: null,
    })
  )
    throw Error(
      "Compiled static mesh program differs from verified source/capabilities",
    );
  const resource = program.resource,
    fields = program.resourceFields;
  if (
    !keys(resource, [
      "path",
      "source",
      "resourceHeader",
      "vertices",
      "triangles",
      "vertexStride",
      "primitiveVtableRva",
    ]) ||
    normalizedPath(resource.path) !== resource.path ||
    resource.path !== normalizedPath(source.primitive.mMesh.mSimpleMeshName) ||
    !Number.isSafeInteger(resource.triangles) ||
    resource.triangles < 1 ||
    resource.triangles * 108 >= 0x100000 ||
    resource.vertexStride !== 36 ||
    resource.primitiveVtableRva !== 0x23f6a80 ||
    !blob(resource.source, null) ||
    !blob(resource.resourceHeader, 224) ||
    !blob(resource.vertices, resource.triangles * 108) ||
    !keys(fields, ["offset40", "offset4c", "offset58", "vector88", "flag94"]) ||
    fields.flag94 !== 0 ||
    ![fields.offset40, fields.offset4c, fields.offset58, fields.vector88].every(
      (v) =>
        finiteVector(v) && v.length === 3 && v.every((n) => Object.is(n, 0)),
    )
  )
    throw Error("Compiled static mesh resource identity/transform differs");
  if (
    !object(selection) ||
    selection.status !== "owned-static-mesh-individual-material-selection" ||
    typeof selection.effectId !== "string" ||
    !selection.effectId.length ||
    !uint(emitter.index) ||
    selection.emitterIndex !== emitter.index ||
    emitter.materialKey !== `${selection.effectId}:${emitter.index}` ||
    !digest(selection.sourceDefinitionSha256) ||
    selection.meshPath !== resource.path ||
    selection.vertexSha256 !== resource.vertices.sha256 ||
    !uint(selection.passHash) ||
    !uint(selection.variantIndex) ||
    !individualPolicy(selection.policy) ||
    emitter.materialPolicy !== program.materialPolicy ||
    (expected.id !== undefined && selection.effectId !== expected.id) ||
    (expected.definitionHash !== undefined &&
      selection.sourceDefinitionSha256 !== expected.definitionHash) ||
    (expected.index !== undefined && emitter.index !== expected.index)
  )
    throw Error("Compiled static mesh material identity/policy differs");
  return program;
}

// This validates only the mesh-specific capability slice. The main compiler
// must independently admit every shared birth/curve/point/binding/lifecycle field
// and the selected native material before activating a component.
export async function createLatestDirectStaticMeshPrograms({
  profile,
  packageBytes,
  expectedPackageSha256,
  effectsManifestBytes,
  loadBytes,
}) {
  if (
    !(packageBytes instanceof Uint8Array) ||
    !(effectsManifestBytes instanceof Uint8Array) ||
    !digest(expectedPackageSha256) ||
    typeof loadBytes !== "function" ||
    (await sha256(packageBytes)) !== expectedPackageSha256
  )
    throw Error("Pinned static mesh program resource package required");
  const data = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(packageBytes),
  );
  const manifest = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(effectsManifestBytes),
  );
  if (
    data.schema !== 1 ||
    data.kind !== "prepared-direct-static-mesh-resources" ||
    data.build !== profile?.clientVersion ||
    data.protocol !== profile?.protocolDigest ||
    data.decoderImageSha256 !== profile?.decoderImageSha256 ||
    data.build !== manifest.build ||
    data.protocol !== manifest.protocol ||
    data.effectsManifestSha256 !== (await sha256(effectsManifestBytes)) ||
    !Array.isArray(data.resources) ||
    data.resources.length < 1 ||
    data.resources.length > 4096 ||
    !Array.isArray(data.sourceProofs) ||
    data.sourceProofs.length !== 3 ||
    !data.sourceProofs.every((proof) => object(proof) && digest(proof.sha256))
  )
    throw Error("Exact-build original static mesh resource package differs");
  const prepared = new Map();
  for (const entry of data.resources) {
    if (
      !object(entry) ||
      normalizedPath(entry.path) !== entry.path ||
      prepared.has(entry.path) ||
      entry.primitiveVtableRva !== 0x23f6a80 ||
      entry.vertexStride !== 36 ||
      !Number.isSafeInteger(entry.triangles) ||
      entry.triangles < 1 ||
      entry.triangles * 108 >= 0x100000 ||
      !blob(entry.source, null) ||
      !blob(entry.resourceHeader, 224) ||
      !blob(entry.vertices, entry.triangles * 108)
    )
      throw Error("Malformed/duplicate original static mesh resource");
    const asset = manifest.assets?.[entry.path];
    if (
      asset?.kind !== "static-mesh" ||
      asset.status !== "prepared" ||
      asset.sourceSha256 !== entry.source.sha256
    )
      throw Error(
        "Static mesh resource does not match the authored asset catalog",
      );
    const loaded = {};
    for (const key of ["source", "resourceHeader", "vertices"]) {
      const ref = entry[key],
        value = await loadBytes(ref.file);
      if (
        !(value instanceof Uint8Array) ||
        value.length !== ref.bytes ||
        (await sha256(value)) !== ref.sha256
      )
        throw Error(`Static mesh ${key} content hash/length differs`);
      loaded[key] = value.slice();
    }
    const fields = directStaticMeshResourceFields(loaded.resourceHeader);
    directStaticMeshGeometry(loaded.vertices, entry.triangles);
    prepared.set(entry.path, {
      metadata: freeze(structuredClone(entry)),
      fields: freeze(fields),
      vertices: loaded.vertices,
    });
  }
  const factory = Object.freeze({
    packageSha256: expectedPackageSha256,
    inventory: () =>
      [...prepared.values()].map((entry) => structuredClone(entry.metadata)),
    geometry(path) {
      const value = prepared.get(normalizedPath(path));
      if (!value) throw Error("Unprepared original static mesh geometry");
      return directStaticMeshGeometry(value.vertices, value.metadata.triangles);
    },
    compile(source) {
      if (!object(source) || source.__type !== "VfxEmitterDefinitionData")
        throw Error(
          "Typed source emitter required for static mesh capability compilation",
        );
      const { reasons, resource } = meshSourceReasons(source, prepared);
      if (reasons.length)
        return freeze({
          status: "unsupported-static-mesh-component",
          reasons,
          source: structuredClone(source),
          sharedParticleAdmissionRequired: true,
          materialAdmissionRequired: true,
        });
      return freeze({
        status: "prepared-static-mesh-primitive-program",
        sharedParticleAdmissionRequired: true,
        materialAdmissionRequired: true,
        program: {
          schema: 1,
          policy: "ordinary-static-mesh-individual-particle-v1",
          primitive: "static-mesh",
          materialPolicy: DIRECT_STATIC_MESH_MATERIAL_POLICY,
          resourcePackageSha256: expectedPackageSha256,
          resource: structuredClone(resource.metadata),
          resourceFields: structuredClone(resource.fields),
          placementRequirements: { rootBasis: true, boundObjectSize: null },
          facingFlags: [false, false, false],
          paletteByte: 0,
          multTexturePresent: false,
          uv: {
            schema: 1,
            policy: "original-constant-centered-base-mesh-uv-v1",
            textureDivisions: [1, 1],
            linkFlags: [true, false],
            baseMatrix: [2, 0, 0, 1, -0.5, 0],
            multMatrix: null,
          },
          worldUniformOrder: "post-1916f70",
          source: structuredClone(source),
        },
        remainingRequirements: [
          "shared-particle-birth-curve-point-binding-lifecycle-admission",
          "owned-original-individual-material-selection",
          "explicit-camera-fow-and-scene-policy",
          "verified-inactive-instance-buffer-api-binding",
        ],
        omissions: ["mesh:native-match-acceptance-and-pose-parity-unrecovered"],
      });
    },
  });
  factories.add(factory);
  return factory;
}
