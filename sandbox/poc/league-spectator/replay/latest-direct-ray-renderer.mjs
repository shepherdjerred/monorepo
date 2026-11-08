import * as THREE from "three";
import {
  isLatestDirectRayMaterialPackage,
  validateDirectRayMaterialSelection,
} from "./latest-direct-ray-material-package.mjs";
import {
  directRayScene,
  DIRECT_RAY_SCENE_OMISSIONS,
} from "./latest-direct-ray-scene.mjs";
import { directRenderAttributes } from "./latest-direct-effect-draw.mjs";
import { parentRenderCamera } from "./latest-parent-renderer.mjs";
import { createReplayUniformBlock } from "./latest-vfx-bound-renderer.mjs";
import { directNativeMetalRasterToGles } from "./latest-native-raster-conventions.mjs";

function texture(metadata, levels) {
  const p = metadata.sampler?.parameters ?? metadata.samplerParameters;
  if (
    !p ||
    p[10240] !== 9729 ||
    p[10241] !== 9729 ||
    ![10497, 33071].includes(p[10242]) ||
    ![10497, 33071].includes(p[10243]) ||
    (levels && levels.length !== 1)
  )
    throw Error("Unsupported Ray sampler");
  const t = new THREE.DataTexture(
    (levels ? levels[0][0] : metadata.rgba).slice(),
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
  t.colorSpace = THREE.NoColorSpace;
  t.flipY = false;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}
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
  g.setIndex(new THREE.BufferAttribute(a.index.slice(), 1));
  return g;
}
function pipeline(m, s) {
  if (
    !s.blendEnabled ||
    s.depthEnabled ||
    s.depthMask ||
    s.cullEnabled ||
    s.stencilEnabled ||
    s.polygonOffsetEnabled ||
    !s.colorMask.every(Boolean) ||
    s.blendOperations.some((x) => x !== 32774)
  )
    throw Error("Unsupported Ray native pipeline");
  const factors = {
    1: THREE.OneFactor,
    770: THREE.SrcAlphaFactor,
    771: THREE.OneMinusSrcAlphaFactor,
  };
  if (s.blendFactors.some((x) => !Object.hasOwn(factors, x)))
    throw Error("Unsupported Ray blend factors");
  m.transparent = true;
  m.blending = THREE.CustomBlending;
  m.blendEquation = m.blendEquationAlpha = THREE.AddEquation;
  // Captured GL order: srcRGB,dstRGB,srcAlpha,dstAlpha.
  [m.blendSrc, m.blendDst, m.blendSrcAlpha, m.blendDstAlpha] =
    s.blendFactors.map((x) => factors[x]);
  m.depthTest = false;
  m.depthWrite = false;
  m.side = THREE.DoubleSide;
}
export class LatestDirectRayRenderer {
  constructor(world, { materials, tokens }, { onSubmit } = {}) {
    if (
      !isLatestDirectRayMaterialPackage(materials) ||
      !(tokens instanceof Map)
    )
      throw Error("Owned Ray material package required");
    this.world = world;
    this.materials = materials;
    this.tokens = new Map(tokens);
    this.onSubmit = onSubmit;
    this.group = new THREE.Group();
    this.group.name = "Original Ray / explicit allvision policy";
    world.add(this.group);
    this.bindings = new Map();
    this.meshes = new Map();
    this.ownership = new Map();
    this.enabled = true;
    this.ready = false;
  }
  async loadDefinitions(definitions) {
    if (this.ready || !(definitions instanceof Map))
      throw Error("Unloaded Ray definitions required");
    const owned = new Map(
      [...definitions].map(([id, d]) => [id, structuredClone(d)]),
    );
    const scene = directRayScene({
      projectionRows: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      position: [0, 0, 0],
    });
    for (const d of owned.values())
      for (const e of d.emitters.filter((e) => e.primitive === "ray")) {
        validateDirectRayMaterialSelection(e, {
          id: d.id,
          definitionHash: d.definitionHash,
          index: e.index,
        });
        const token = this.tokens.get(e.materialKey),
          selection = this.materials.inspect(token);
        if (
          e.materialKey !== `${d.id}:${e.index}` ||
          JSON.stringify(selection) !==
            JSON.stringify(e.rayMaterialSelection) ||
          this.bindings.has(e.materialKey)
        )
          throw Error("Ray material ownership differs");
        const b = this.materials.bind(token, scene);
        if (b.status !== "bound-explicit-scene-ray-material")
          throw Error("Ray staging scene unresolved");
        const uniforms = {},
          textures = [];
        const names = new Map(
          b.stages.flatMap((s) =>
            s.sidecar.textures.flatMap((t) =>
              t.samplers.map((v) => [t.name, v.glslName]),
            ),
          ),
        );
        for (const t of b.textures) {
          const value = texture(t.metadata, t.levels);
          textures.push(value);
          uniforms[names.get(t.metadata.name)] = { value };
        }
        for (const [name, t] of Object.entries(b.sceneTextures)) {
          const value = texture(t);
          textures.push(value);
          uniforms[names.get(name)] = { value };
        }
        if (Object.hasOwn(uniforms, "undefined"))
          throw Error("Missing Ray reflected sampler name");
        this.bindings.set(e.materialKey, {
          program: e,
          token,
          stages: b.stages,
          uniforms,
          textures,
          raster: directNativeMetalRasterToGles(b.pipeline, {
            targetViewportOrigin: "lower-left",
            clipY: "unchanged",
          }),
        });
      }
    this.definitions = owned;
    this.ready = true;
  }
  commit(packet, camera, { preflightOnly = false } = {}) {
    if (
      !this.ready ||
      !Number.isFinite(packet.time) ||
      !Array.isArray(packet.draws)
    )
      throw Error("Prepared Ray packet required");
    const { view, rows } = parentRenderCamera(camera, this.world),
      scene = directRayScene({ projectionRows: rows, position: view.position }),
      active = new Set(),
      newOwners = new Map(),
      pending = [],
      blocksByMaterial = new Map();
    for (const draw of packet.draws) {
      if (draw.primitive !== "ray") continue;
      const b = this.bindings.get(draw.materialKey),
        d = this.definitions.get(draw.definitionId);
      if (
        !b ||
        !d ||
        b.program.index !== draw.emitterId ||
        !d.emitters.some(
          (e) =>
            e.materialKey === draw.materialKey && e.index === draw.emitterId,
        ) ||
        typeof draw.sourceEventId !== "string" ||
        !draw.sourceEventId ||
        !Number.isSafeInteger(draw.generation) ||
        draw.generation < 1
      )
        throw Error("Unowned Ray draw");
      const owner = {
          sourceEventId: draw.sourceEventId,
          generation: draw.generation,
          definitionId: draw.definitionId,
          ownerId: draw.ownerId ?? null,
          ownershipStatus: draw.ownershipStatus ?? "unresolved",
        },
        id = `${draw.sourceEventId}:${draw.generation}`,
        key = `${id}:${draw.emitterId}`,
        prior = this.ownership.get(id) ?? newOwners.get(id);
      if (prior && Object.keys(owner).some((k) => prior[k] !== owner[k]))
        throw Error("Ray identity or owner changed");
      if (active.has(key)) throw Error("Duplicate Ray component identity");
      const attributes = directRenderAttributes(draw);
      if (!blocksByMaterial.has(draw.materialKey))
        blocksByMaterial.set(
          draw.materialKey,
          this.materials.frameUniforms(b.token, scene),
        );
      pending.push({
        key,
        b,
        attributes,
        owner,
        time: packet.time,
        emitterId: draw.emitterId,
        blocks: blocksByMaterial.get(draw.materialKey),
      });
      active.add(key);
      newOwners.set(id, owner);
    }
    // Entire packet is checked before visible geometry or ownership changes.
    if (preflightOnly) return;
    for (const [id, o] of newOwners) this.ownership.set(id, o);
    for (const p of pending) {
      let mesh = this.meshes.get(p.key);
      if (!mesh) {
        const blocks = p.blocks.map((b) =>
          createReplayUniformBlock({
            glslName: b.name,
            size: b.bytes.length,
            bytesHex: b.bytes.toHex(),
            sceneMembers: [],
          }),
        );
        const material = new THREE.RawShaderMaterial({
          vertexShader: p.b.stages[0].glsl.slice(16),
          fragmentShader: p.b.stages[1].glsl.slice(16),
          glslVersion: THREE.GLSL3,
          uniforms: p.b.uniforms,
          uniformsGroups: blocks.map((b) => b.group),
          toneMapped: false,
        });
        pipeline(material, p.b.raster.state);
        mesh = new THREE.Mesh(geometry(p.attributes), material);
        mesh.frustumCulled = false;
        mesh.renderOrder = p.b.program.source.pass ?? 0;
        mesh.userData.blocks = blocks;
        mesh.onAfterRender = () => {
          if (mesh.visible && mesh.geometry.index?.count > 0)
            this.onSubmit?.({
              ...mesh.userData.identity,
              emitterId: p.emitterId,
              time: mesh.userData.time,
            });
        };
        this.meshes.set(p.key, mesh);
        this.group.add(mesh);
      } else {
        mesh.geometry.dispose();
        mesh.geometry = geometry(p.attributes);
        p.blocks.forEach((b, i) =>
          new Uint8Array(mesh.userData.blocks[i].data.buffer).set(b.bytes),
        );
      }
      mesh.userData.identity = p.owner;
      mesh.userData.time = p.time;
      mesh.visible = this.enabled && p.attributes.index.length > 0;
    }
    for (const [key, mesh] of this.meshes)
      if (!active.has(key)) {
        mesh.geometry.dispose();
        mesh.material.dispose();
        mesh.userData.blocks.forEach((b) => b.group.dispose());
        mesh.removeFromParent();
        this.meshes.delete(key);
      }
    return {
      visibleParticles: pending.reduce(
        (n, p) => n + p.attributes.a_POSITION.length / 12,
        0,
      ),
      omissions: [...DIRECT_RAY_SCENE_OMISSIONS],
      gpuExecutionMs: null,
    };
  }
  setEnabled(value) {
    if (typeof value !== "boolean")
      throw Error("Boolean Ray visibility required");
    this.enabled = value;
    for (const m of this.meshes.values())
      m.visible = value && m.geometry.index.count > 0;
  }
  dispose() {
    for (const m of this.meshes.values()) {
      m.geometry.dispose();
      m.material.dispose();
      m.userData.blocks.forEach((b) => b.group.dispose());
    }
    for (const b of this.bindings.values())
      b.textures.forEach((t) => t.dispose());
    this.meshes.clear();
    this.bindings.clear();
    this.ownership.clear();
    this.group.clear();
    this.group.removeFromParent();
    this.ready = false;
  }
}
