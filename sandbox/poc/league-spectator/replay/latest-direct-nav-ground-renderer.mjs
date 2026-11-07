import * as THREE from "three";
import {
  isLatestDirectNavGroundMaterials,
  validateDirectNavGroundProgram,
} from "./latest-direct-nav-ground-materials.mjs";
import { directRayScene } from "./latest-direct-ray-scene.mjs";
import { parentRenderCamera } from "./latest-parent-renderer.mjs";
import { directRenderAttributes } from "./latest-direct-effect-draw.mjs";
import { createReplayUniformBlock } from "./latest-vfx-bound-renderer.mjs";
import { DIRECT_NAV_SCENE_SAMPLER } from "./latest-direct-nav-scene-gpu.mjs";
import {
  validateDirectDepthBiasProgram,
  assertDirectDepthBiasRenderer,
} from "./latest-direct-effect-depth-bias.mjs";
const nativeTexture = (metadata, bytes) => {
  const p = metadata.sampler?.parameters ?? metadata.samplerParameters;
  if (
    !p ||
    p[10240] !== 9729 ||
    p[10241] !== 9729 ||
    ![10497, 33071].includes(p[10242]) ||
    ![10497, 33071].includes(p[10243])
  )
    throw Error("Unsupported exact ground sampler");
  const t = new THREE.DataTexture(
    bytes.slice(),
    metadata.width,
    metadata.height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  t.wrapS =
    p[10242] === 10497 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT =
    p[10243] === 10497 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
};
function geometry(a) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("a_POSITION", new THREE.BufferAttribute(a.a_POSITION, 3));
  g.setAttribute("a_COLOR", new THREE.BufferAttribute(a.a_COLOR, 4, true));
  g.setAttribute(
    "a_TEXCOORD",
    new THREE.Float16BufferAttribute(a.a_TEXCOORD, 4),
  );
  g.setAttribute(
    "a_TEXCOORD1",
    new THREE.Float16BufferAttribute(a.a_TEXCOORD1, 2),
  );
  g.setIndex(new THREE.BufferAttribute(a.index, 1));
  return g;
}
function applyPipeline(m, s, program, descriptorHex) {
  const f = {
    1: THREE.OneFactor,
    770: THREE.SrcAlphaFactor,
    771: THREE.OneMinusSrcAlphaFactor,
  };
  if (
    !s.blendEnabled ||
    s.depthEnabled ||
    s.depthMask ||
    s.cullEnabled ||
    s.stencilEnabled ||
    !s.colorMask.every(Boolean) ||
    s.blendOperations.some((x) => x !== 32774) ||
    s.blendFactors.some((x) => !Object.hasOwn(f, x))
  )
    throw Error("Unsupported original ground pipeline");
  const bias = program.depthBiasProgram
    ? validateDirectDepthBiasProgram(
        program.depthBiasProgram,
        program.source,
        program.primitive,
        descriptorHex,
      )
    : null;
  if (
    !!s.polygonOffsetEnabled !== !!bias?.enabled ||
    (bias?.enabled &&
      (!Object.is(s.polygonOffset[0], bias.slope) ||
        !Object.is(s.polygonOffset[1], bias.constant)))
  )
    throw Error("Original ground pipeline depth bias differs from source");
  m.polygonOffset = !!bias?.enabled;
  m.polygonOffsetFactor = bias?.slope ?? 0;
  m.polygonOffsetUnits = bias?.constant ?? 0;
  m.transparent = true;
  m.blending = THREE.CustomBlending;
  m.blendEquation = m.blendEquationAlpha = THREE.AddEquation;
  [m.blendSrc, m.blendDst, m.blendSrcAlpha, m.blendDstAlpha] =
    s.blendFactors.map((x) => f[x]);
  m.depthTest = false;
  m.depthWrite = false;
  m.side = THREE.DoubleSide;
}
export class LatestDirectNavGroundRenderer {
  constructor(
    world,
    {
      materials,
      provider,
      worldNavScene,
      gpuRenderer,
      onSubmit,
      loaderOnly = false,
    },
  ) {
    if (
      !isLatestDirectNavGroundMaterials(materials) ||
      (!loaderOnly && (!provider || gpuRenderer?.isWebGLRenderer !== true))
    )
      throw Error(
        "Owned ground resources and actual navigation renderer required",
      );
    Object.assign(this, {
      world,
      materials,
      provider,
      worldNavScene,
      gpuRenderer,
      onSubmit,
      loaderOnly,
    });
    this.bindings = new Map();
    this.meshes = new Map();
    this.group = new THREE.Group();
    this.group.name = "Original pass5 / owned selected-scene navigation";
    world.add(this.group);
    this.ready = false;
  }
  frame(time) {
    return this.provider
      ? this.provider.stage(time)
      : this.worldNavScene.inspectFrame(this.worldNavScene.frame({ time }));
  }
  async loadDefinitions(definitions) {
    if (this.ready) throw Error("Navigation ground renderer already loaded");
    this.definitions = definitions;
    const frame = this.frame(0),
      scene = directRayScene({
        projectionRows: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        position: [0, 0, 0],
      });
    scene.uniforms.NAV_GRID_XFORM = frame.transformBytes;
    for (const d of definitions.values())
      for (const e of d.emitters.filter((e) => e.navGroundProgram)) {
        if (!this.materials.admit(e)) throw Error("Unowned ground definition");
        const r = this.materials.inspect(e.materialKey),
          uniforms = {},
          textures = [];
        const samplers = new Map(
          r.stages.flatMap((s) =>
            s.sidecar.textures.flatMap((t) =>
              t.samplers.map((v) => [t.name, v.glslName]),
            ),
          ),
        );
        for (const t of r.textures) {
          if (t.levels.length !== 1 || t.levels[0].length !== 1)
            throw Error("Ground single-mip RGBA ABI required");
          const value = nativeTexture(t.metadata, t.levels[0][0]);
          textures.push(value);
          uniforms[samplers.get(t.metadata.name)] = { value };
        }
        for (const [name, t] of Object.entries(scene.textures)) {
          const value = nativeTexture(t, t.rgba);
          textures.push(value);
          uniforms[samplers.get(name)] = { value };
        }
        const navName = samplers.get("NAVMESH_MASK_TEXTURE_SharedTexture");
        if (typeof navName !== "string" || Object.hasOwn(uniforms, "undefined"))
          throw Error("Ground reflected scene sampler missing");
        uniforms[navName] = { value: null };
        const blocks = this.materials
          .frameUniforms(e.materialKey, scene.uniforms)
          .map((b) =>
            createReplayUniformBlock({
              glslName: b.name,
              size: b.bytes.length,
              bytesHex: b.bytes.toHex(),
              sceneMembers: [],
            }),
          );
        const material = new THREE.RawShaderMaterial({
          vertexShader: r.stages[0].glsl.slice(16),
          fragmentShader: r.stages[1].glsl.slice(16),
          glslVersion: THREE.GLSL3,
          uniforms,
          uniformsGroups: blocks.map((b) => b.group),
          toneMapped: false,
        });
        material.name = `OriginalNavGround_${e.materialKey}`;
        if (e.depthBiasProgram?.enabled && !this.loaderOnly)
          assertDirectDepthBiasRenderer(this.gpuRenderer);
        applyPipeline(
          material,
          r.material.pipeline.state,
          e,
          r.material.pipeline.descriptorHex,
        );
        this.bindings.set(e.materialKey, {
          program: e,
          resource: r,
          uniforms,
          textures,
          blocks,
          material,
          navName,
        });
      }
    if (!this.loaderOnly) {
      for (const b of this.bindings.values())
        for (const texture of b.textures) this.gpuRenderer.initTexture(texture);
      const warm = new THREE.Scene(),
        camera = new THREE.Camera(),
        g = new THREE.BufferGeometry();
      g.setAttribute(
        "a_POSITION",
        new THREE.BufferAttribute(new Float32Array(9), 3),
      );
      g.setAttribute(
        "a_COLOR",
        new THREE.BufferAttribute(new Uint8Array(12), 4, true),
      );
      g.setAttribute(
        "a_TEXCOORD",
        new THREE.Float16BufferAttribute(new Uint16Array(12), 4),
      );
      g.setAttribute(
        "a_TEXCOORD1",
        new THREE.Float16BufferAttribute(new Uint16Array(6), 2),
      );
      try {
        for (const b of this.bindings.values()) {
          const mesh = new THREE.Mesh(g, b.material);
          mesh.frustumCulled = false;
          warm.add(mesh);
          await this.gpuRenderer.compileAsync(warm, camera);
          const p = this.gpuRenderer.properties.get(b.material).currentProgram,
            gl = this.gpuRenderer.getContext();
          if (
            !p ||
            !gl.getProgramParameter(p.program, gl.LINK_STATUS) ||
            gl.getError() !== gl.NO_ERROR
          )
            throw Error("Ground shader readiness/link validation failed");
          warm.remove(mesh);
        }
      } finally {
        g.dispose();
      }
    }
    this.ready = true;
  }
  preflight(packet, camera) {
    if (!this.ready) throw Error("Navigation ground renderer not ready");
    const frame = this.frame(packet.time),
      { view, rows } = parentRenderCamera(camera, this.world),
      scene = directRayScene({ projectionRows: rows, position: view.position });
    scene.uniforms.NAV_GRID_XFORM = frame.transformBytes;
    const pending = [],
      active = new Set();
    for (const draw of packet.draws) {
      const d = this.definitions.get(draw.definitionId),
        e = d?.emitters.find((e) => e.index === draw.emitterId);
      if (!e?.navGroundProgram) continue;
      validateDirectNavGroundProgram(e, {
        id: d.id,
        index: e.index,
        definitionHash: d.definitionHash,
      });
      const b = this.bindings.get(draw.materialKey);
      if (
        !b ||
        b.program !== e ||
        !this.materials.admit(e) ||
        (draw.primitive !== undefined && draw.primitive !== e.primitive) ||
        typeof draw.sourceEventId !== "string" ||
        !draw.sourceEventId ||
        !Number.isSafeInteger(draw.generation) ||
        draw.generation < 1
      )
        throw Error("Unowned ground draw");
      const key = `${draw.sourceEventId}:${draw.generation}:${draw.emitterId}`;
      if (active.has(key)) throw Error("Duplicate ground component");
      active.add(key);
      pending.push({
        key,
        b,
        draw,
        attributes: directRenderAttributes(draw),
        blocks: this.materials.frameUniforms(draw.materialKey, scene.uniforms),
      });
    }
    return { time: packet.time, frame, pending, active };
  }
  commit(staged, binding, enabled) {
    if (this.loaderOnly)
      throw Error("Loader-only control cannot submit navigation combat");
    const inputs = this.provider.materialInputs({
      requiredScene: staged.pending[0]?.b.resource.material.requiredScene ?? {
        blocks: [],
        textures: [],
      },
      binding,
      replayTime: staged.time,
    });
    const t = inputs.inputs?.textures.NAVMESH_MASK_TEXTURE_SharedTexture;
    if (
      staged.pending.length &&
      (!t ||
        t.texture?.isTexture !== true ||
        t.samplerDescriptorHex !== DIRECT_NAV_SCENE_SAMPLER.descriptorHex)
    )
      throw Error("Current actual navigation GPU texture required");
    // Resource and geometry validation precedes every visible mesh mutation.
    for (const p of staged.pending) {
      p.b.uniforms[p.b.navName].value = t.texture;
      p.blocks.forEach((b, i) =>
        new Uint8Array(p.b.blocks[i].data.buffer).set(b.bytes),
      );
      let mesh = this.meshes.get(p.key);
      if (!mesh) {
        mesh = new THREE.Mesh(geometry(p.attributes), p.b.material);
        mesh.frustumCulled = false;
        mesh.renderOrder = p.b.program.source.pass ?? 0;
        mesh.onAfterRender = () => {
          if (mesh.visible && mesh.geometry.index.count > 0)
            this.onSubmit?.({
              ...mesh.userData.identity,
              time: mesh.userData.time,
            });
        };
        this.meshes.set(p.key, mesh);
        this.group.add(mesh);
      } else {
        mesh.geometry.dispose();
        mesh.geometry = geometry(p.attributes);
      }
      mesh.userData.identity = {
        sourceEventId: p.draw.sourceEventId,
        generation: p.draw.generation,
        definitionId: p.draw.definitionId,
        emitterId: p.draw.emitterId,
        ownerId: p.draw.ownerId ?? null,
        ownershipStatus: p.draw.ownershipStatus ?? "unresolved",
      };
      mesh.userData.time = staged.time;
      mesh.visible = enabled && p.attributes.index.length > 0;
    }
    for (const [key, m] of this.meshes)
      if (!staged.active.has(key)) {
        m.geometry.dispose();
        m.removeFromParent();
        this.meshes.delete(key);
      }
  }
  commitEmpty() {
    for (const m of this.meshes.values()) {
      m.geometry.dispose();
      m.removeFromParent();
    }
    this.meshes.clear();
  }
  dispose() {
    for (const m of this.meshes.values()) m.geometry.dispose();
    for (const b of this.bindings.values()) {
      b.material.dispose();
      b.blocks.forEach((b) => b.group.dispose());
      b.textures.forEach((t) => t.dispose());
    }
    this.meshes.clear();
    this.bindings.clear();
    this.group.removeFromParent();
    this.ready = false;
  }
}
