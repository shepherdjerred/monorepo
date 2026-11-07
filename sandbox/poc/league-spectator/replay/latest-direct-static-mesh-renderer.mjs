import * as THREE from "three";
import {
  isLatestDirectStaticMeshMaterials,
  DIRECT_STATIC_MESH_INDIVIDUAL_SHADER_PAIR,
} from "./latest-direct-static-mesh-materials.mjs";
import { directStaticMeshDrawParameters } from "./latest-direct-effect-mesh-record.mjs";
import {
  directStaticMeshScene,
  DIRECT_STATIC_MESH_SCENE_OMISSIONS,
} from "./latest-direct-static-mesh-scene.mjs";
import { parentRenderCamera } from "./latest-parent-renderer.mjs";
import { createReplayUniformBlock } from "./latest-vfx-bound-renderer.mjs";
import { replaySamplerUniforms } from "./latest-renderer-samplers.mjs";
import { directNativeMetalRasterToGles } from "./latest-native-raster-conventions.mjs";

function geometry(bound) {
  const result = new THREE.BufferGeometry(),
    view = new DataView(
      bound.vertices.buffer,
      bound.vertices.byteOffset,
      bound.vertices.byteLength,
    ),
    count = bound.vertices.length / 36;
  for (const attr of bound.attributes) {
    const data =
      attr.type === "float32"
        ? new Float32Array(count * attr.components)
        : new Uint8Array(count * attr.components);
    for (let i = 0; i < count; i++)
      for (let j = 0; j < attr.components; j++)
        data[i * attr.components + j] =
          attr.type === "float32"
            ? view.getFloat32(i * 36 + attr.offset + j * 4, true)
            : view.getUint8(i * 36 + attr.offset + j);
    result.setAttribute(
      attr.glslName,
      new THREE.BufferAttribute(data, attr.components, attr.normalized),
    );
  }
  if (!Number.isSafeInteger(count) || count < 1 || count > 65535)
    throw Error("Bounded original static mesh vertex count required");
  result.setIndex(
    new THREE.BufferAttribute(
      Uint16Array.from({ length: count }, (_, i) => i),
      1,
    ),
  );
  return result;
}
function pipeline(material, state, reflectedWorld = false) {
  if (
    state.stencilEnabled ||
    state.polygonOffsetEnabled ||
    !state.colorMask.every(Boolean) ||
    state.blendOperations.some((x) => x !== 32774) ||
    ![2304, 2305].includes(state.frontFace) ||
    ![1028, 1029].includes(state.cullFace)
  )
    throw Error("Unsupported original static mesh pipeline");
  const factors = {
    1: THREE.OneFactor,
    6: THREE.SrcAlphaFactor,
    7: THREE.OneMinusSrcAlphaFactor,
  };
  if (state.blendFactors.some((x) => !Object.hasOwn(factors, x)))
    throw Error("Unsupported static mesh blend factors");
  material.transparent = state.blendEnabled;
  material.blending = state.blendEnabled
    ? THREE.CustomBlending
    : THREE.NoBlending;
  material.blendEquation = material.blendEquationAlpha = THREE.AddEquation;
  [
    material.blendSrc,
    material.blendSrcAlpha,
    material.blendDst,
    material.blendDstAlpha,
  ] = state.blendFactors.map((x) => factors[x]);
  material.depthTest = state.depthEnabled;
  material.depthWrite = state.depthMask;
  const functions = {
    512: THREE.NeverDepth,
    513: THREE.LessDepth,
    514: THREE.EqualDepth,
    515: THREE.LessEqualDepth,
    516: THREE.GreaterDepth,
    517: THREE.NotEqualDepth,
    518: THREE.GreaterEqualDepth,
    519: THREE.AlwaysDepth,
  };
  if (!Object.hasOwn(functions, state.depthFunction))
    throw Error("Unsupported mesh depth function");
  material.depthFunc = functions[state.depthFunction];
  // Raw shader positions already include the game->scene projection. THREE
  // nevertheless flips GL winding for a negative object matrix determinant.
  const back =
    ((state.frontFace === 2304) !== (state.cullFace === 1028)) !==
    reflectedWorld;
  material.side = state.cullEnabled
    ? back
      ? THREE.BackSide
      : THREE.FrontSide
    : THREE.DoubleSide;
}
function texture(metadata, levels) {
  const wrap = {
    10497: THREE.RepeatWrapping,
    33071: THREE.ClampToEdgeWrapping,
    33648: THREE.MirroredRepeatWrapping,
  };
  const filter = {
    9728: THREE.NearestFilter,
    9729: THREE.LinearFilter,
    9984: THREE.NearestMipmapNearestFilter,
    9985: THREE.LinearMipmapNearestFilter,
    9986: THREE.NearestMipmapLinearFilter,
    9987: THREE.LinearMipmapLinearFilter,
  };
  const params = metadata.sampler?.parameters ?? metadata.samplerParameters;
  if (
    !params ||
    ![10240, 10241].every((k) => Object.hasOwn(filter, params[k])) ||
    ![10242, 10243].every((k) => Object.hasOwn(wrap, params[k]))
  )
    throw Error("Exact mesh texture sampler required");
  const data = levels ? levels[0][0] : metadata.rgba;
  const result = new THREE.DataTexture(
    data.slice(),
    metadata.width,
    metadata.height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  if (levels && levels.length > 1)
    result.mipmaps = levels.map((level, i) => ({
      data: level[0].slice(),
      width: Math.max(1, metadata.width >> i),
      height: Math.max(1, metadata.height >> i),
    }));
  result.wrapS = wrap[params[10242]];
  result.wrapT = wrap[params[10243]];
  result.magFilter = filter[params[10240]];
  result.minFilter = filter[params[10241]];
  result.colorSpace = THREE.NoColorSpace;
  result.flipY = false;
  result.generateMipmaps = false;
  result.needsUpdate = true;
  return result;
}
const stagingRecord = () => {
  const bytes = new Uint8Array(176),
    v = new DataView(bytes.buffer);
  for (const i of [0, 5, 10, 15]) v.setFloat32(i * 4, 1, true);
  v.setFloat32(0x60, 1, true);
  v.setFloat32(0x6c, 1, true);
  for (let i = 0; i < 4; i++) v.setFloat32(0x90 + i * 4, 1, true);
  return bytes;
};
// Static assets are prepared at load. Every commit only consumes retained worker
// records; this class neither samples an emitter nor manufactures particle state.
export class LatestDirectStaticMeshRenderer {
  constructor(world, { materials, tokens }, { onSubmit } = {}) {
    if (
      !isLatestDirectStaticMeshMaterials(materials) ||
      !(tokens instanceof Map)
    )
      throw Error("Owned static mesh package required");
    this.world = world;
    this.materials = materials;
    this.tokens = new Map(tokens);
    this.onSubmit = onSubmit;
    this.group = new THREE.Group();
    this.group.name =
      "Original individual static mesh / explicit allvision policy";
    world.add(this.group);
    this.bindings = new Map();
    this.meshes = new Map();
    this.ownership = new Map();
    this.enabled = true;
    this.ready = false;
  }
  bind(program, record, scene) {
    const token = this.tokens.get(program.materialKey);
    if (!token) throw Error("Missing owned static mesh material token");
    return this.materials.bindNonInstanced(token, {
      drawParameters: directStaticMeshDrawParameters({
        record,
        resourceOffset40: program.meshProgram.resourceFields.offset40,
        paletteByte: 0,
        multTexturePresent: false,
      }),
      matrixOrder: "post-1916f70",
      individualMode: 0,
      scene,
    });
  }
  async loadDefinitions(definitions) {
    if (this.ready) throw Error("Static mesh renderer already loaded");
    if (!(definitions instanceof Map))
      throw Error("Compiled static mesh definitions required");
    this.definitions = new Map(
      [...definitions].map(([id, d]) => [id, structuredClone(d)]),
    );
    const scene = directStaticMeshScene({
      projectionRows: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      position: [0, 0, 0],
      forward: [0, 0, -1],
      up: [0, 1, 0],
    });
    for (const definition of definitions.values())
      for (const program of definition.emitters.filter(
        (e) => e.primitive === "static-mesh",
      )) {
        const token = this.tokens.get(program.materialKey),
          selection = this.materials.inspectNonInstanced(token);
        if (
          program.materialKey !== `${definition.id}:${program.index}` ||
          selection.effectId !== definition.id ||
          selection.emitterIndex !== program.index ||
          selection.sourceDefinitionSha256 !== definition.definitionHash ||
          selection.meshPath !== program.meshProgram.resource.path ||
          selection.vertexSha256 !==
            program.meshProgram.resource.vertices.sha256 ||
          this.bindings.has(program.materialKey)
        )
          throw Error("Static mesh definition/material ownership differs");
        const bound = this.bind(program, stagingRecord(), scene);
        if (bound.status !== "bound-noninstanced-static-mesh-inputs")
          throw Error("Unresolved static mesh staging resources");
        const textures = new Map();
        for (const t of bound.textures)
          textures.set(t.metadata.name, texture(t.metadata, t.levels));
        for (const [name, t] of Object.entries(bound.sceneTextures))
          textures.set(name, texture(t));
        // dxbcBufferFetch indexes scalar uint.x; the proven completeness control
        // is52 R32UI texels, never13 RGBA records or recovered game payload.
        const inactive = new THREE.DataTexture(
          new Uint32Array(52),
          52,
          1,
          THREE.RedIntegerFormat,
          THREE.UnsignedIntType,
        );
        inactive.internalFormat = "R32UI";
        inactive.magFilter = inactive.minFilter = THREE.NearestFilter;
        inactive.wrapS = inactive.wrapT = THREE.ClampToEdgeWrapping;
        inactive.generateMipmaps = false;
        inactive.needsUpdate = true;
        textures.set("ParticleMeshInstanceInfo_SharedDataBuffer", inactive);
        const uniforms = replaySamplerUniforms(bound.stages, textures);
        this.bindings.set(program.materialKey, {
          program: structuredClone(program),
          geometry: geometry(bound),
          uniforms,
          stages: bound.stages,
          state: directNativeMetalRasterToGles(bound.pipeline, {
            targetViewportOrigin: "lower-left",
            clipY: "unchanged",
          }).state,
        });
      }
    this.ready = true;
  }
  commit(packet, camera, { preflightOnly = false } = {}) {
    if (
      !this.ready ||
      !Number.isFinite(packet.time) ||
      !Array.isArray(packet.draws)
    )
      throw Error("Prepared static mesh packet required");
    this.group.updateWorldMatrix(true, false);
    const determinant = this.group.matrixWorld.determinant();
    if (!Number.isFinite(determinant) || determinant === 0)
      throw Error("Nonsingular finite static mesh render group required");
    const { view, rows } = parentRenderCamera(camera, this.world),
      scene = directStaticMeshScene({
        projectionRows: rows,
        position: view.position,
        forward: view.axis.map((x) => -x),
        up: view.up,
      });
    const active = new Set(),
      drawKeys = new Set(),
      pending = [],
      newOwners = new Map();
    for (const draw of packet.draws) {
      if (draw.primitive !== "static-mesh") continue;
      const binding = this.bindings.get(draw.materialKey),
        program = binding?.program;
      if (
        !program ||
        program.index !== draw.emitterId ||
        !this.definitions
          .get(draw.definitionId)
          ?.emitters.some(
            (e) =>
              e.materialKey === draw.materialKey && e.index === draw.emitterId,
          ) ||
        !Number.isSafeInteger(draw.particleCount) ||
        draw.particleCount < 0 ||
        !(draw.meshRecords instanceof Uint8Array) ||
        draw.meshRecords.length !== draw.particleCount * 176 ||
        typeof draw.sourceEventId !== "string" ||
        !draw.sourceEventId.length ||
        !Number.isSafeInteger(draw.generation) ||
        draw.generation < 1
      )
        throw Error("Unowned or malformed static mesh draw");
      const owner = {
        sourceEventId: draw.sourceEventId,
        generation: draw.generation,
        definitionId: draw.definitionId,
        ownerId: draw.ownerId ?? null,
        ownershipStatus: draw.ownershipStatus ?? "unresolved",
      };
      const id = `${draw.sourceEventId}:${draw.generation}`,
        prior = this.ownership.get(id) ?? newOwners.get(id);
      if (prior && Object.keys(owner).some((k) => prior[k] !== owner[k]))
        throw Error("Static mesh identity or owner changed");
      newOwners.set(id, owner);
      const drawKey = `${id}:${draw.emitterId}`;
      if (drawKeys.has(drawKey))
        throw Error("Duplicate static mesh component identity");
      drawKeys.add(drawKey);
      for (let i = 0; i < draw.particleCount; i++) {
        const key = `${id}:${draw.emitterId}:${i}`;
        if (active.has(key))
          throw Error("Duplicate static mesh particle identity");
        active.add(key);
        const bound = this.bind(
          program,
          draw.meshRecords.subarray(i * 176, (i + 1) * 176),
          scene,
        );
        if (bound.status !== "bound-noninstanced-static-mesh-inputs")
          throw Error("Static mesh scene inputs unresolved");
        pending.push({
          key,
          binding,
          bound,
          owner,
          time: packet.time,
          emitterId: draw.emitterId,
        });
      }
    }
    // Preflight the complete packet before replacing any previously visible view.
    if (preflightOnly) return;
    for (const [id, owner] of newOwners) this.ownership.set(id, owner);
    for (const p of pending) {
      let mesh = this.meshes.get(p.key);
      if (!mesh) {
        const blocks = p.bound.uniforms.map((b) =>
          createReplayUniformBlock({
            glslName: b.name,
            size: b.bytes.length,
            bytesHex: b.bytes.toHex(),
            sceneMembers: [],
          }),
        );
        const material = new THREE.RawShaderMaterial({
          vertexShader: p.binding.stages[0].glsl.slice(16),
          fragmentShader: p.binding.stages[1].glsl.slice(16),
          glslVersion: THREE.GLSL3,
          uniforms: p.binding.uniforms,
          uniformsGroups: blocks.map((b) => b.group),
          toneMapped: false,
        });
        material.name = `OriginalStaticMesh_${p.binding.program.materialKey}`;
        material.userData.replayMaterial = {
          materialKey: p.binding.program.materialKey,
          shaderPair: { ...DIRECT_STATIC_MESH_INDIVIDUAL_SHADER_PAIR },
        };
        pipeline(material, p.binding.state, determinant < 0);
        mesh = new THREE.Mesh(p.binding.geometry, material);
        mesh.frustumCulled = false;
        mesh.renderOrder = 5;
        mesh.userData.blocks = blocks;
        mesh.onAfterRender = () => {
          if (
            mesh.visible &&
            mesh.geometry.getAttribute("a_POSITION").count > 0
          )
            this.onSubmit?.({
              ...mesh.userData.identity,
              emitterId: p.emitterId,
              time: mesh.userData.time,
            });
        };
        this.meshes.set(p.key, mesh);
        this.group.add(mesh);
      } else {
        pipeline(mesh.material, p.binding.state, determinant < 0);
        p.bound.uniforms.forEach((b, i) =>
          new Uint8Array(mesh.userData.blocks[i].data.buffer).set(b.bytes),
        );
      }
      mesh.userData.identity = p.owner;
      mesh.userData.time = p.time;
      mesh.visible = this.enabled;
    }
    for (const [key, mesh] of this.meshes)
      if (!active.has(key)) {
        this.group.remove(mesh);
        mesh.material.dispose();
        mesh.userData.blocks.forEach((b) => b.group.dispose());
        this.meshes.delete(key);
      }
    return {
      visibleParticles: pending.length,
      omissions: [...DIRECT_STATIC_MESH_SCENE_OMISSIONS],
      gpuExecutionMs: null,
    };
  }
  setEnabled(value) {
    if (typeof value !== "boolean")
      throw Error("Boolean mesh visibility required");
    this.enabled = value;
    for (const mesh of this.meshes.values()) mesh.visible = value;
  }
  dispose() {
    for (const mesh of this.meshes.values()) {
      mesh.material.dispose();
      mesh.userData.blocks.forEach((b) => b.group.dispose());
    }
    for (const b of this.bindings.values()) {
      b.geometry.dispose();
      for (const texture of new Set(
        Object.values(b.uniforms).map((u) => u.value),
      ))
        texture.dispose();
    }
    this.meshes.clear();
    this.bindings.clear();
    this.ownership.clear();
    this.group.clear();
    this.group.removeFromParent();
    this.ready = false;
  }
}
