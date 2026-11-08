import * as THREE from "three";
import {
  LatestBoundVfxRenderer,
  createReplayUniformBlock,
  writeReplayCameraBlocks,
} from "./latest-vfx-bound-renderer.mjs";
import { TRAIL_CONTROL_SHA } from "./latest-trail-playback.mjs";
import { TRAIL_PARTICLES_SHA } from "./latest-trail-particles.mjs";
import { sha256 } from "./structural-comparison.mjs";
import { UNICORN_BULK_PACKAGE_SHA } from "./latest-unicorn-bulk.mjs";
import { LatestParticleWorkerClient } from "./latest-particle-worker-client.mjs";

export const TRAIL_GPU_SHA =
  "b4dee053c3721792cb019c6433e53c303abd036effa2f783db80deeb8aeb156a";
const fromHex = (s) => {
  if (typeof s !== "string" || !/^(?:[a-f0-9]{2})*$/.test(s))
    throw Error("Invalid trail geometry bytes");
  return Uint8Array.from(s.match(/../g) ?? [], (n) => parseInt(n, 16));
};
export function replayTrailAttributes(geometry, maximumVertices = 2048) {
  const bytes = fromHex(geometry.verticesHex),
    indices = fromHex(geometry.indicesHex),
    count = bytes.length / 28;
  if (!Number.isInteger(count) || count > maximumVertices || indices.length % 2)
    throw Error("Trail vertex/index buffer bound");
  const view = new DataView(bytes.buffer),
    iv = new DataView(indices.buffer),
    position = new Float32Array(count * 3),
    color = new Uint8Array(count * 4),
    uv = new Uint16Array(count * 4),
    mult = new Uint16Array(count * 2);
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < 3; j++)
      position[i * 3 + j] = view.getFloat32(i * 28 + j * 4, true);
    color.set(bytes.subarray(i * 28 + 12, i * 28 + 16), i * 4);
    for (let j = 0; j < 4; j++)
      uv[i * 4 + j] = view.getUint16(i * 28 + 16 + j * 2, true);
    for (let j = 0; j < 2; j++)
      mult[i * 2 + j] = view.getUint16(i * 28 + 24 + j * 2, true);
  }
  const index = Uint16Array.from({ length: indices.length / 2 }, (_, i) =>
    iv.getUint16(i * 2, true),
  );
  if (
    [...position].some((n) => !Number.isFinite(n)) ||
    [...index].some((n) => n >= count)
  )
    throw Error("Non-finite/out-of-range native trail geometry");
  return {
    a_POSITION: position,
    a_COLOR: color,
    a_TEXCOORD: uv,
    a_TEXCOORD1: mult,
    index,
  };
}

export class LatestTrailVfxRenderer extends LatestBoundVfxRenderer {
  runtimeConfiguration() {
    return {
      kind: "trail",
      directory: "/assets/latest-trail-particles",
      packageUrl: "/assets/latest-trail-particles/package.json",
      packageSha256: TRAIL_PARTICLES_SHA,
      gpuUrl: "/assets/latest-trail-particles/gpu.json",
      gpuSha256: TRAIL_GPU_SHA,
    };
  }
  validateRuntimeGpu(gpu) {
    if (gpu.trailPackageSha256 !== TRAIL_PARTICLES_SHA)
      throw Error("Trail GPU/runtime package mismatch");
  }
  async createPlayback(options) {
    this.trails = new LatestParticleWorkerClient();
    return this.trails.initialize({
      kind: this.runtimeConfiguration().kind,
      traces: this.playback.traces,
      assetBase: new URL("/assets/", location.href).href,
      options,
      transferImage: true,
    });
  }
  decodeGeometry(geometry) {
    return replayTrailAttributes(geometry);
  }
  async load(playback) {
    this.playback = playback;
    const configuration = this.runtimeConfiguration();
    const decoder = "/assets/decoder-16.21-macos",
      [profile, packageBytes, gpuBytes] = await Promise.all([
        this.checked(`${decoder}/profile.json`).then((b) =>
          JSON.parse(new TextDecoder().decode(b)),
        ),
        this.checked(configuration.packageUrl, configuration.packageSha256),
        this.checked(configuration.gpuUrl, configuration.gpuSha256),
      ]),
      gpu = JSON.parse(new TextDecoder().decode(gpuBytes)),
      [image, spawnBytes, emitterBytes, boundBytes, controlBytes] =
        await Promise.all([
          this.checked(`${decoder}/image.bin`, profile.decoderImageSha256),
          this.checked(`${decoder}/vfx-spawn.json`, profile.vfxSpawnSha256),
          this.checked(`${decoder}/vfx-emitter.json`, profile.vfxEmitterSha256),
          this.checked(
            `${decoder}/vfx-bound-quads.json`,
            profile.vfxBoundQuadsSha256,
          ),
          this.checked(
            "/assets/latest-vfx-control/package.json",
            TRAIL_CONTROL_SHA,
          ),
        ]);
    if (
      gpu.build !== profile.clientVersion ||
      gpu.protocol !== profile.protocolDigest ||
      gpu.effectsManifestSha256 !== (await sha256(this.effectsManifestBytes))
    )
      throw Error("Trail GPU/runtime build mismatch");
    this.validateRuntimeGpu(gpu, profile);
    const runtimeBytes = await this.checked(
      "/assets/vendor/unicorn_x86_candidate.mjs",
      "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716",
    );
    const bulkPackageBytes = await this.checked(
      "/assets/latest-unicorn-bulk/package.json",
      UNICORN_BULK_PACKAGE_SHA,
    );
    const bulkPackage = JSON.parse(new TextDecoder().decode(bulkPackageBytes));
    const bulkWasmBytes = await this.checked(
      `/assets/latest-unicorn-bulk/${bulkPackage.file}`,
      bulkPackage.wasmSha256,
    );
    this.trails = await this.createPlayback({
      runtimeBytes,
      bulkPackageBytes,
      bulkWasmBytes,
      profile,
      image,
      spawnBytes,
      emitterBytes,
      boundBytes,
      packageBytes,
      controlBytes,
    });
    const effects = new Map(
        playback.traces.map((t) => [t.effectId, t.effect.definitionSha256]),
      ),
      stages = new Map(),
      bindings = [];
    for (const prepared of gpu.emitters) {
      if (!effects.has(prepared.effectId)) continue;
      if (prepared.sourceDefinitionSha256 !== effects.get(prepared.effectId))
        throw Error("Trail effect identity changed");
      await this.trails.bindEmitter(
        prepared.effectId,
        prepared.emitterIndex,
        prepared.sourceDefinitionSha256,
      );
      for (const stage of ["vertex", "pixel"]) {
        const ref = prepared.shaders[stage];
        if (!stages.has(ref.sha256))
          stages.set(
            ref.sha256,
            JSON.parse(
              new TextDecoder().decode(
                await this.checked(
                  `/assets/latest-shaders/${ref.file}`,
                  ref.sha256,
                ),
              ),
            ),
          );
      }
      const uniforms = {};
      for (const [name, t] of Object.entries(prepared.textures))
        uniforms[name] = { value: await this.gpuTexture(t) };
      const blocks = prepared.blocks.map((b) => {
          const key = JSON.stringify(b);
          if (!this.uniformGroups.has(key)) {
            const value = createReplayUniformBlock(b);
            this.uniformGroups.set(key, value);
            if (b.sceneMembers.length) this.cameraBlocks.add(value);
          }
          return this.uniformGroups.get(key);
        }),
        factors = {
          1: THREE.OneFactor,
          6: THREE.SrcAlphaFactor,
          7: THREE.OneMinusSrcAlphaFactor,
        },
        blend = prepared.nativeBlendFactors,
        body = (s) => {
          if (!s.startsWith("#version 300 es\n"))
            throw Error("Unexpected trail GLSL version");
          return s.slice("#version 300 es\n".length);
        },
        material = new THREE.RawShaderMaterial({
          vertexShader: body(stages.get(prepared.shaders.vertex.sha256).glsl),
          fragmentShader: body(stages.get(prepared.shaders.pixel.sha256).glsl),
          glslVersion: THREE.GLSL3,
          uniforms,
          uniformsGroups: blocks.map((b) => b.group),
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
      material.name = `NativeReplayTrail_${prepared.emitterIndex}`;
      this.gpuMaterials.set(`${prepared.effectId}:${prepared.emitterIndex}`, {
        prepared,
        material,
      });
      bindings.push({
        effectId: prepared.effectId,
        emitterIndex: prepared.emitterIndex,
      });
    }
    this.bindings = bindings;
    this.gpuDefinition = gpu;
    this.ready = true;
    this.summary = {
      supportedEmitters: bindings.length,
      gpuPackageSha256: configuration.gpuSha256,
      policy: this.trails.summary.policy,
    };
  }
  applyGeometry(mesh, geometry) {
    const a = this.decodeGeometry(geometry),
      g = mesh.geometry;
    for (const [name, width] of [
      ["a_POSITION", 3],
      ["a_COLOR", 4],
      ["a_TEXCOORD", 4],
      ["a_TEXCOORD1", 2],
    ]) {
      if (
        !g.index ||
        g.index.array.length !== a.index.length ||
        !g.attributes[name] ||
        g.attributes[name].array.length !== a[name].length
      ) {
        // WebGL buffers cannot resize. Dispose the old geometry as one unit
        // when particle count changes, then bind all exact native attributes.
        const next = new THREE.BufferGeometry();
        next.setAttribute(
          "a_POSITION",
          new THREE.BufferAttribute(a.a_POSITION.slice(), 3),
        );
        next.setAttribute(
          "a_COLOR",
          new THREE.BufferAttribute(a.a_COLOR.slice(), 4, true),
        );
        next.setAttribute(
          "a_TEXCOORD",
          new THREE.Float16BufferAttribute(a.a_TEXCOORD.slice(), 4),
        );
        next.setAttribute(
          "a_TEXCOORD1",
          new THREE.Float16BufferAttribute(a.a_TEXCOORD1.slice(), 2),
        );
        // Retained staged frames own these arrays. GPU updates must never
        // overwrite an earlier frame when the next pool has the same count.
        next.setIndex(new THREE.BufferAttribute(a.index.slice(), 1));
        g.dispose();
        mesh.geometry = next;
        return;
      }
      if (g.attributes[name].itemSize !== width)
        throw Error("Trail attribute width changed");
      g.attributes[name].array.set(a[name]);
      g.attributes[name].needsUpdate = true;
      // Cached geometry bounds describe the previous vertex positions. THREE
      // also consumes them for draw sorting when frustum culling is disabled.
      if (name === "a_POSITION") g.boundingSphere = null;
    }
    if (!g.index || g.index.array.length !== a.index.length) {
      g.setIndex(new THREE.BufferAttribute(a.index, 1));
    } else {
      g.index.array.set(a.index);
      g.index.needsUpdate = true;
    }
  }
  async prepareFrame(time, camera) {
    if (!this.enabled || !this.ready) {
      return { time, disabled: true };
    }
    camera.updateWorldMatrix(true, false);
    this.world.updateWorldMatrix(true, false);
    const inverse = new THREE.Matrix4().copy(this.world.matrixWorld).invert(),
      elements = camera.matrixWorld.elements,
      axis = (offset) =>
        new THREE.Vector3(
          elements[offset],
          elements[offset + 1],
          elements[offset + 2],
        )
          .transformDirection(inverse)
          .toArray(),
      position = new THREE.Vector3()
        .setFromMatrixPosition(camera.matrixWorld)
        .applyMatrix4(inverse)
        .toArray(),
      view = { position, right: axis(0), up: axis(4), axis: axis(8) },
      projection = new THREE.Matrix4()
        .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
        .multiply(this.world.matrixWorld).elements,
      rows = Array.from(
        { length: 16 },
        (_, i) => projection[(i % 4) * 4 + Math.floor(i / 4)],
      );
    for (let c = 0; c < 4; c++)
      rows[8 + c] = 0.5 * (rows[8 + c] + rows[12 + c]);
    const frameKey = JSON.stringify([time, view, rows]);
    if (frameKey === this.lastFrameKey) return this.lastFrame;
    const packet = await this.trails.frame(time, view);
    if (
      packet.time !== time ||
      JSON.stringify(packet.view) !== JSON.stringify(view) ||
      !Array.isArray(packet.draws)
    )
      throw Error(
        "Particle worker frame inputs differ from the requested presentation",
      );
    return { time, frameKey, view, rows, packet };
  }
  commitFrame(frame) {
    for (const mesh of this.meshes.values()) mesh.visible = false;
    if (frame.disabled) {
      this.stats = { visibleParticles: 0, visibleMissiles: 0 };
      this.lastFrameKey = null;
      this.lastFrame = null;
      return;
    }
    writeReplayCameraBlocks(
      [...this.cameraBlocks],
      frame.rows,
      frame.view.position,
    );
    let particles = 0;
    const missiles = new Set(),
      visibleKeys = [];
    for (const sample of frame.packet.draws) {
      if (sample.geometry.indicesHex.length === 0) continue;
      const key = `${sample.sequence}:${sample.emitterIndex}`,
        binding = this.gpuMaterials.get(
          `${sample.effectId}:${sample.emitterIndex}`,
        );
      if (!binding) throw Error("Particle worker returned an unbound material");
      if (sample.graphSha256 !== binding.prepared.graphSha256)
        throw Error("Trail material/geometry graph differs");
      let mesh = this.meshes.get(key);
      if (!mesh) {
        mesh = new THREE.Mesh(new THREE.BufferGeometry(), binding.material);
        mesh.frustumCulled = false;
        mesh.renderOrder = binding.prepared.suppliedSortPass;
        this.meshes.set(key, mesh);
        this.group.add(mesh);
      }
      this.applyGeometry(mesh, sample.geometry);
      mesh.visible = true;
      visibleKeys.push(key);
      particles += sample.particleCount;
      missiles.add(sample.entityId);
    }
    this.visibleKeys = visibleKeys;
    this.lastFrameKey = frame.frameKey;
    this.lastFrame = frame;
    this.stats = {
      visibleParticles: particles,
      visibleMissiles: missiles.size,
    };
  }
  async update(time, camera) {
    this.commitFrame(await this.prepareFrame(time, camera));
  }
  dispose() {
    this.trails?.close();
    super.dispose();
  }
}
