import * as THREE from "three";
import { assertReplayRendererPolicy } from "./latest-renderer-policy.mjs";
import { LatestVfxRenderer } from "./latest-vfx-renderer.mjs";
import {
  createLatestVfxBoundPlayback,
  sampleLatestBoundVfxDraws,
} from "./latest-vfx-bound-playback.mjs";
import { createLatestVfxSamplers } from "./latest-vfx-samplers.mjs";
import { compileLatestVfxDefinition } from "./latest-vfx-simulation.mjs";
import { sha256 } from "./structural-comparison.mjs";

const PACKAGE_SHA =
  "1b19ff3277ca3977f9909049233450d47236dfb6fe57eeaf7a78a047ea608619";
const fromHex = (value) => {
  if (typeof value !== "string" || !/^(?:[a-f0-9]{2})*$/.test(value))
    throw Error("Invalid replay GPU bytes");
  return Uint8Array.from(value.match(/../g) ?? [], (n) => parseInt(n, 16));
};
const shaderBody = (source) => {
  if (!source.startsWith("#version 300 es\n"))
    throw Error("Unexpected replay GLSL version");
  // THREE supplies this same directive before its material-name defines.
  return source.slice("#version 300 es\n".length);
};
export function replayQuadAttributes(geometry) {
  const bytes = fromHex(geometry.verticesHex),
    indices = fromHex(geometry.indicesHex);
  if (bytes.length !== 112 || indices.length !== 12)
    throw Error("Replay GPU requires one native 28-byte quad");
  const view = new DataView(bytes.buffer),
    iv = new DataView(indices.buffer);
  const position = new Float32Array(12),
    color = new Uint8Array(16),
    uv = new Uint16Array(16),
    multUv = new Uint16Array(8);
  for (let vertex = 0; vertex < 4; vertex++) {
    for (let lane = 0; lane < 3; lane++)
      position[vertex * 3 + lane] = view.getFloat32(
        vertex * 28 + lane * 4,
        true,
      );
    color.set(bytes.subarray(vertex * 28 + 12, vertex * 28 + 16), vertex * 4);
    for (let lane = 0; lane < 4; lane++)
      uv[vertex * 4 + lane] = view.getUint16(vertex * 28 + 16 + lane * 2, true);
    for (let lane = 0; lane < 2; lane++)
      multUv[vertex * 2 + lane] = view.getUint16(
        vertex * 28 + 24 + lane * 2,
        true,
      );
  }
  const index = Uint16Array.from({ length: 6 }, (_, at) =>
    iv.getUint16(at * 2, true),
  );
  if (![...position].every(Number.isFinite) || [...index].some((n) => n > 3))
    throw Error("Invalid native replay quad attribute/index");
  return {
    a_POSITION: position,
    a_COLOR: color,
    a_TEXCOORD: uv,
    a_TEXCOORD1: multUv,
    index,
  };
}

export function writeReplayCameraBlocks(
  blocks,
  projectionRows,
  cameraPosition,
) {
  if (
    projectionRows.length !== 16 ||
    cameraPosition.length !== 3 ||
    ![...projectionRows, ...cameraPosition].every(Number.isFinite)
  )
    throw Error("Finite supplied replay camera required");
  for (const block of blocks) {
    const view = new DataView(
      block.data.buffer,
      block.data.byteOffset,
      block.data.byteLength,
    );
    for (const member of block.sceneMembers) {
      const values =
        member.name === "mProj"
          ? projectionRows
          : member.name === "vCamera"
            ? cameraPosition
            : null;
      if (!values || values.length * 4 !== member.size)
        throw Error("Unprovided replay camera uniform");
      values.forEach((number, index) =>
        view.setFloat32(member.offset + index * 4, number, true),
      );
    }
  }
}

export function createReplayUniformBlock(block) {
  assertReplayRendererPolicy(THREE);
  const bytes = fromHex(block.bytesHex);
  if (bytes.length !== block.size || bytes.length % 16)
    throw Error("Malformed replay std140 buffer");
  const data = new Float32Array(bytes.buffer);
  const group = new THREE.UniformsGroup()
    .setName(block.glslName)
    .setUsage(THREE.DynamicDrawUsage);
  group.add(new THREE.Uniform(data));
  return { ...block, data, group };
}

export class LatestBoundVfxRenderer extends LatestVfxRenderer {
  constructor(...args) {
    super(...args);
    this.group.name = "Complete native quad assets / translated game shaders";
    this.gpuMaterials = new Map();
    this.uniformGroups = new Map();
    this.cameraBlocks = new Set();
  }
  async checked(path, expected) {
    const response = await fetch(path);
    if (!response.ok)
      throw Error(`Replay particle HTTP ${response.status}: ${path}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (expected && (await sha256(bytes)) !== expected)
      throw Error(`Replay particle integrity mismatch: ${path}`);
    return bytes;
  }
  async gpuTexture(binding) {
    const key = JSON.stringify(binding);
    if (this.textures.has(key)) return this.textures.get(key);
    let texture;
    if (
      binding.kind === "supplied-white-lookup" ||
      binding.kind === "supplied-transparent-remap"
    ) {
      const values =
        binding.kind === "supplied-white-lookup"
          ? [255, 255, 255, 255]
          : [0, 0, 0, 0];
      texture = new THREE.DataTexture(
        Uint8Array.from(values),
        1,
        1,
        THREE.RGBAFormat,
        THREE.UnsignedByteType,
      );
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.magFilter = texture.minFilter = THREE.NearestFilter;
    } else if (binding.kind === "prepared-texture") {
      const bitmap = await createImageBitmap(
        new Blob([await this.bytes(binding.file, binding.sha256)], {
          type: "image/png",
        }),
        {
          imageOrientation: "none",
          premultiplyAlpha: "none",
          colorSpaceConversion: "none",
        },
      );
      texture = new THREE.Texture(bitmap);
      const wrap = {
        repeat: THREE.RepeatWrapping,
        clamp: THREE.ClampToEdgeWrapping,
        mirror: THREE.MirroredRepeatWrapping,
      }[binding.sampler.name];
      if (wrap === undefined)
        throw Error("Unimplemented native replay texture wrap");
      texture.wrapS = texture.wrapT = wrap;
      texture.minFilter = texture.magFilter = binding.sampler.pixelated
        ? THREE.NearestFilter
        : THREE.LinearFilter;
    } else throw Error("Unprovided replay GPU texture");
    texture.colorSpace = THREE.NoColorSpace;
    texture.flipY = false;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    this.textures.set(key, texture);
    return texture;
  }
  async load(playback) {
    this.playback = playback;
    const decoder = "/assets/decoder-16.21-macos";
    const [profileBytes, packageBytes] = await Promise.all([
      this.checked(`${decoder}/profile.json`),
      this.checked("/assets/latest-replay-particles/package.json", PACKAGE_SHA),
    ]);
    const profile = JSON.parse(new TextDecoder().decode(profileBytes)),
      gpu = JSON.parse(new TextDecoder().decode(packageBytes));
    if (
      gpu.build !== profile.clientVersion ||
      gpu.protocol !== profile.protocolDigest ||
      gpu.quadPackageSha256 !== profile.vfxBoundQuadsSha256 ||
      gpu.effectsManifestSha256 !== (await sha256(this.effectsManifestBytes)) ||
      gpu.counts.emitters !== gpu.emitters.length ||
      gpu.counts.shaderStages !== 4
    )
      throw Error("Prepared replay particle GPU package mismatch");
    const [
      image,
      spawnBytes,
      emitterBytes,
      postloadBytes,
      definitionBytes,
      samplerBytes,
    ] = await Promise.all([
      this.checked(`${decoder}/image.bin`, profile.decoderImageSha256),
      this.checked(`${decoder}/vfx-spawn.json`, profile.vfxSpawnSha256),
      this.checked(`${decoder}/vfx-emitter.json`, profile.vfxEmitterSha256),
      this.checked(`${decoder}/vfx-postload.json`, profile.vfxPostloadSha256),
      this.checked(
        `${decoder}/vfx-bound-quads.json`,
        profile.vfxBoundQuadsSha256,
      ),
      this.checked(`${decoder}/vfx-samplers.json`, profile.vfxSamplersSha256),
    ]);
    await this.checked(
      "/assets/vendor/unicorn_x86_candidate.mjs",
      "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716",
    );
    const { default: createUnicorn } =
      await import("/assets/vendor/unicorn_x86_candidate.mjs");
    this.boundPlayback = await createLatestVfxBoundPlayback({
      uc: await createUnicorn(),
      profile,
      image,
      spawnBytes,
      emitterBytes,
      postloadBytes,
      definitionBytes,
      effectsManifestBytes: this.effectsManifestBytes,
      loadGraphBytes: (path) => {
        if (path.startsWith("/") || path.includes(".."))
          throw Error("Invalid complete particle graph path");
        return this.checked(`${decoder}/${path}`);
      },
    });
    const samplers = createLatestVfxSamplers(
        JSON.parse(new TextDecoder().decode(samplerBytes)),
      ),
      stages = new Map();
    for (const trace of playback.traces) {
      if (this.definitions.has(trace.effectId)) continue;
      const ref = this.manifest.definitions[trace.effectId];
      if (!ref || ref.sha256 !== trace.effect.definitionSha256)
        throw Error("Replay particle definition mismatch");
      const record = JSON.parse(
        new TextDecoder().decode(await this.bytes(ref.file, ref.sha256)),
      );
      const compiled = compileLatestVfxDefinition(
        record,
        this.manifest,
        samplers,
      );
      this.definitions.set(trace.effectId, compiled);
      for (const emitter of compiled.supported) {
        await this.boundPlayback.bindEmitter(
          trace.effectId,
          emitter,
          ref.sha256,
        );
        const prepared = gpu.emitters.find(
          (entry) =>
            entry.effectId === trace.effectId &&
            entry.emitterIndex === emitter.index,
        );
        if (!prepared || prepared.sourceDefinitionSha256 !== ref.sha256)
          throw Error("Unprepared replay GPU emitter");
        for (const stage of ["vertex", "pixel"]) {
          const shader = prepared.shaders[stage];
          if (!stages.has(shader.sha256))
            stages.set(
              shader.sha256,
              JSON.parse(
                new TextDecoder().decode(
                  await this.checked(
                    `/assets/latest-shaders/${shader.file}`,
                    shader.sha256,
                  ),
                ),
              ),
            );
        }
        const uniforms = {};
        for (const [name, texture] of Object.entries(prepared.textures))
          uniforms[name] = { value: await this.gpuTexture(texture) };
        const blocks = prepared.blocks.map((block) => {
          const key = JSON.stringify(block);
          if (!this.uniformGroups.has(key)) {
            const value = createReplayUniformBlock(block);
            this.uniformGroups.set(key, value);
            if (block.sceneMembers.length) this.cameraBlocks.add(value);
          }
          return this.uniformGroups.get(key);
        });
        const factors = {
            1: THREE.OneFactor,
            6: THREE.SrcAlphaFactor,
            7: THREE.OneMinusSrcAlphaFactor,
          },
          blend = prepared.nativeBlendFactors;
        const material = new THREE.RawShaderMaterial({
          vertexShader: shaderBody(
            stages.get(prepared.shaders.vertex.sha256).glsl,
          ),
          fragmentShader: shaderBody(
            stages.get(prepared.shaders.pixel.sha256).glsl,
          ),
          glslVersion: THREE.GLSL3,
          uniforms,
          uniformsGroups: blocks.map((block) => block.group),
          transparent: true,
          toneMapped: false,
          depthWrite: false,
          depthTest: prepared.suppliedDepthTest,
          side: prepared.suppliedDoubleSide
            ? THREE.DoubleSide
            : THREE.FrontSide,
          blending: THREE.CustomBlending,
          blendEquation: THREE.AddEquation,
          blendEquationAlpha: THREE.AddEquation,
          blendSrc: factors[blend[0]],
          blendSrcAlpha: factors[blend[1]],
          blendDst: factors[blend[2]],
          blendDstAlpha: factors[blend[3]],
        });
        material.name = `NativeReplayQuad_${emitter.index}`;
        this.gpuMaterials.set(`${trace.effectId}:${emitter.index}`, {
          material,
          prepared,
        });
      }
    }
    this.summary = {
      effects: this.definitions.size,
      supportedEmitters: [...this.definitions.values()].reduce(
        (n, d) => n + d.supported.length,
        0,
      ),
      omittedEmitters: [...this.definitions.values()].reduce(
        (n, d) => n + d.omitted.length,
        0,
      ),
      nativeLifecycle: this.boundPlayback.summary,
      shaderPackageSha256: gpu.shaderPackageSha256,
      gpuPackageSha256: PACKAGE_SHA,
      limitations: [
        "Original shaders and native static/alpha/blend/sampler values with complete native quad assets. Supplied camera, omniscient fog mode, neutral lookup/remap, linear target and authored depth/cull/sort inputs. Postprocess and actual scene resources remain unrecovered.",
      ],
    };
    this.ready = true;
  }
  create(draw) {
    const binding = this.gpuMaterials.get(`${draw.effectId}:${draw.emitter}`);
    if (!binding || binding.prepared.graphSha256 !== draw.graphSha256)
      throw Error("Native replay material/geometry graph mismatch");
    const attributes = replayQuadAttributes(draw.nativeGeometry),
      geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "a_POSITION",
      new THREE.BufferAttribute(attributes.a_POSITION, 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    geometry.setAttribute(
      "a_COLOR",
      new THREE.BufferAttribute(attributes.a_COLOR, 4, true).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    geometry.setAttribute(
      "a_TEXCOORD",
      new THREE.Float16BufferAttribute(attributes.a_TEXCOORD, 4).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    geometry.setAttribute(
      "a_TEXCOORD1",
      new THREE.Float16BufferAttribute(attributes.a_TEXCOORD1, 2).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    geometry.setIndex(new THREE.BufferAttribute(attributes.index, 1));
    const mesh = new THREE.Mesh(geometry, binding.material);
    mesh.frustumCulled = false;
    mesh.renderOrder = binding.prepared.suppliedSortPass;
    this.group.add(mesh);
    this.meshes.set(draw.key, mesh);
    return mesh;
  }
  update(time, camera) {
    if (!this.enabled || !this.ready || !this.playback) {
      for (const mesh of this.meshes.values()) mesh.visible = false;
      this.lastFrameKey = null;
      this.stats = { visibleParticles: 0, visibleMissiles: 0 };
      return;
    }
    camera.updateWorldMatrix(true, false);
    this.world.updateWorldMatrix(true, false);
    const inverse = new THREE.Matrix4().copy(this.world.matrixWorld).invert(),
      elements = camera.matrixWorld.elements;
    const axis = (offset) =>
      new THREE.Vector3(
        elements[offset],
        elements[offset + 1],
        elements[offset + 2],
      )
        .transformDirection(inverse)
        .toArray();
    const position = new THREE.Vector3()
      .setFromMatrixPosition(camera.matrixWorld)
      .applyMatrix4(inverse)
      .toArray();
    const view = { position, right: axis(0), up: axis(4), axis: axis(8) };
    const projection = new THREE.Matrix4()
      .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .multiply(this.world.matrixWorld).elements;
    const rows = Array.from(
      { length: 16 },
      (_, at) => projection[(at % 4) * 4 + Math.floor(at / 4)],
    );
    // Native shaders consume D3D clip Z, then perform their own 2*z-w fixup.
    for (let column = 0; column < 4; column++)
      rows[8 + column] = 0.5 * (rows[8 + column] + rows[12 + column]);
    const frameKey = JSON.stringify([time, view, rows]);
    if (frameKey === this.lastFrameKey) return;
    for (const mesh of this.meshes.values()) mesh.visible = false;
    writeReplayCameraBlocks([...this.cameraBlocks], rows, position);
    const draws = sampleLatestBoundVfxDraws(
        this.playback,
        this.definitions,
        time,
        this.boundPlayback,
        view,
      ),
      visible = new Set();
    for (const draw of draws) {
      const mesh = this.meshes.get(draw.key) ?? this.create(draw),
        attributes = replayQuadAttributes(draw.nativeGeometry);
      const binding = this.gpuMaterials.get(`${draw.effectId}:${draw.emitter}`);
      if (binding.prepared.graphSha256 !== draw.graphSha256)
        throw Error("Replayed native graph changed");
      for (const name of [
        "a_POSITION",
        "a_COLOR",
        "a_TEXCOORD",
        "a_TEXCOORD1",
      ]) {
        mesh.geometry.attributes[name].array.set(attributes[name]);
        mesh.geometry.attributes[name].needsUpdate = true;
      }
      mesh.geometry.index.array.set(attributes.index);
      mesh.geometry.index.needsUpdate = true;
      mesh.visible = true;
      visible.add(draw.entityId);
    }
    this.stats = {
      visibleParticles: draws.length,
      visibleMissiles: visible.size,
    };
    this.lastFrameKey = frameKey;
  }
  dispose() {
    this.boundPlayback?.close();
    for (const block of this.uniformGroups.values()) block.group.dispose();
    this.uniformGroups.clear();
    this.cameraBlocks.clear();
    this.gpuMaterials.clear();
    super.dispose();
  }
}
