import * as THREE from "three";
import { sha256 } from "./structural-comparison.mjs";
import { createLatestVfxUvPlayback } from "./latest-vfx-uv-playback.mjs";
import { createLatestVfxLifecyclePlayback } from "./latest-vfx-lifecycle-playback.mjs";
import {
  createLatestVfxSamplers,
  latestVfxTextureKey,
} from "./latest-vfx-samplers.mjs";
import {
  compileLatestVfxDefinition,
  sampleLatestVfxDraws,
} from "./latest-vfx-simulation.mjs";

const root = "/assets/latest-effects";
const vertexShader = `precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
in vec3 position;
in vec2 uv;
in vec2 uvMult;
out vec2 vUv;
out vec2 vMultUv;
void main(){vUv=uv;vMultUv=uvMult;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const fragmentShader = `precision highp float;
uniform sampler2D baseTexture;
uniform sampler2D multiplyTexture;
uniform bool hasMultiply;
uniform vec4 tint;
in vec2 vUv;
in vec2 vMultUv;
out vec4 fragColor;
void main(){
 vec4 color=texture(baseTexture,vUv)*tint;
 if(hasMultiply) color*=texture(multiplyTexture,vMultUv);
 fragColor=color;
}`;

export class LatestVfxRenderer {
  constructor(world, manifest, effectsManifestBytes) {
    this.world = world;
    this.manifest = manifest;
    this.effectsManifestBytes = effectsManifestBytes;
    this.group = new THREE.Group();
    this.group.name = "Experimental replay particles";
    world.add(this.group);
    this.definitions = new Map();
    this.textures = new Map();
    this.meshes = new Map();
    this.enabled = true;
    this.ready = false;
    this.stats = { visibleParticles: 0, visibleMissiles: 0 };
  }
  async bytes(path, expected) {
    if (typeof path !== "string" || path.includes("..") || path.startsWith("/"))
      throw Error("Invalid prepared VFX path");
    const response = await fetch(`${root}/${path}`);
    if (!response.ok) throw Error(`VFX asset HTTP ${response.status}: ${path}`);
    const bytes = await response.arrayBuffer();
    if ((await sha256(bytes)) !== expected)
      throw Error(`VFX asset hash mismatch: ${path}`);
    return bytes;
  }
  async texture(asset, sampler) {
    const key = latestVfxTextureKey(asset, sampler);
    if (this.textures.has(key)) return this.textures.get(key);
    const bitmap = await createImageBitmap(
      new Blob([await this.bytes(asset.file, asset.sha256)], {
        type: "image/png",
      }),
      {
        imageOrientation: "none",
        premultiplyAlpha: "none",
        colorSpaceConversion: "none",
      },
    );
    const texture = new THREE.Texture(bitmap);
    texture.colorSpace = THREE.NoColorSpace;
    texture.flipY = false;
    const wrap = {
      repeat: THREE.RepeatWrapping,
      mirror: THREE.MirroredRepeatWrapping,
      clamp: THREE.ClampToEdgeWrapping,
    }[sampler.name];
    if (wrap === undefined) throw Error("Unknown particle texture wrap mode");
    texture.wrapS = texture.wrapT = wrap;
    texture.magFilter = sampler.pixelated
      ? THREE.NearestFilter
      : THREE.LinearFilter;
    texture.needsUpdate = true;
    this.textures.set(key, texture);
    return texture;
  }
  async load(playback) {
    this.playback = playback;
    const decoderRoot = "/assets/decoder-16.21-macos";
    const loadBytes = async (path) => {
      const response = await fetch(path);
      if (!response.ok)
        throw Error(`UV resource HTTP ${response.status}: ${path}`);
      return response.arrayBuffer();
    };
    const [
      profileBytes,
      imageBytes,
      definitionBytes,
      runtimeBytes,
      samplerBytes,
      spawnBytes,
      emitterBytes,
      lifecycleBytes,
    ] = await Promise.all([
      loadBytes(`${decoderRoot}/profile.json`),
      loadBytes(`${decoderRoot}/image.bin`),
      loadBytes(`${decoderRoot}/vfx-uv-animation.json`),
      loadBytes("/assets/vendor/unicorn_x86_candidate.mjs"),
      loadBytes(`${decoderRoot}/vfx-samplers.json`),
      loadBytes(`${decoderRoot}/vfx-spawn.json`),
      loadBytes(`${decoderRoot}/vfx-emitter.json`),
      loadBytes(`${decoderRoot}/vfx-legacy-quads.json`),
    ]);
    if (
      (await sha256(runtimeBytes)) !==
      "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716"
    )
      throw Error("UV WASM runtime integrity mismatch");
    const profile = JSON.parse(new TextDecoder().decode(profileBytes));
    if ((await sha256(samplerBytes)) !== profile.vfxSamplersSha256)
      throw Error("Particle sampler package hash mismatch");
    const samplerDefinition = JSON.parse(
      new TextDecoder().decode(samplerBytes),
    );
    if (samplerDefinition.decoderImageSha256 !== profile.decoderImageSha256)
      throw Error("Particle sampler image mismatch");
    this.samplers = createLatestVfxSamplers(samplerDefinition);
    const { default: createUnicorn } =
      await import("/assets/vendor/unicorn_x86_candidate.mjs");
    const uc = await createUnicorn(),
      image = new Uint8Array(imageBytes);
    const loadGraphBytes = (path) => {
      if (path.includes("..") || path.startsWith("/"))
        throw Error("Invalid particle graph path");
      return loadBytes(`${decoderRoot}/${path}`);
    };
    this.lifecyclePlayback = await createLatestVfxLifecyclePlayback({
      uc,
      profile,
      image,
      spawnBytes,
      emitterBytes,
      definitionBytes: lifecycleBytes,
      effectsManifestBytes: this.effectsManifestBytes,
      loadGraphBytes,
    });
    this.uvPlayback = await createLatestVfxUvPlayback({
      uc,
      profile,
      image,
      definitionBytes,
      effectsManifestBytes: this.effectsManifestBytes,
      loadGraphBytes,
    });
    for (const trace of playback.traces) {
      if (this.definitions.has(trace.effectId)) continue;
      const entry = this.manifest.definitions[trace.effectId];
      if (!entry || entry.sha256 !== trace.effect.definitionSha256)
        throw Error("Missile/VFX definition mismatch");
      const record = JSON.parse(
        new TextDecoder().decode(await this.bytes(entry.file, entry.sha256)),
      );
      if (record.actor !== entry.actor) throw Error("VFX appearance mismatch");
      const compiled = compileLatestVfxDefinition(
        record,
        this.manifest,
        this.samplers,
      );
      this.definitions.set(trace.effectId, compiled);
      for (const emitter of compiled.supported) {
        await this.lifecyclePlayback.bindEmitter(
          trace.effectId,
          emitter,
          entry.sha256,
        );
        await this.uvPlayback.bindEmitter(
          trace.effectId,
          emitter,
          entry.sha256,
        );
        await this.texture(emitter.texture, emitter.baseSampler);
        if (emitter.multTexture)
          await this.texture(emitter.multTexture, emitter.multSampler);
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
      limitations: [
        ...new Set(
          [...this.definitions.values()].flatMap((d) => d.limitations),
        ),
      ],
      nativeUv: this.uvPlayback.summary,
      nativeQuad: { definitionSha256: profile.vfxQuadVerticesSha256 },
      nativeLifecycle: this.lifecyclePlayback.summary,
    };
    this.ready = true;
  }
  create(draw) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(12), 3),
    );
    geometry.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute(draw.uv.flat(), 2),
    );
    geometry.setAttribute(
      "uvMult",
      new THREE.Float32BufferAttribute(draw.multUv.flat(), 2),
    );
    geometry.setIndex(draw.indices);
    const material = new THREE.RawShaderMaterial({
      vertexShader,
      fragmentShader,
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      depthTest: draw.depthTest,
      toneMapped: false,
      side: draw.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst:
        draw.blend === 4 ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      uniforms: {
        baseTexture: {
          value: this.textures.get(
            latestVfxTextureKey(draw.texture, draw.baseSampler),
          ),
        },
        multiplyTexture: {
          value: draw.multTexture
            ? this.textures.get(
                latestVfxTextureKey(draw.multTexture, draw.multSampler),
              )
            : this.textures.get(
                latestVfxTextureKey(draw.texture, draw.baseSampler),
              ),
        },
        hasMultiply: { value: !!draw.multTexture },
        tint: { value: new THREE.Vector4() },
      },
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = draw.pass;
    this.group.add(mesh);
    this.meshes.set(draw.key, mesh);
    return mesh;
  }
  update(time) {
    for (const mesh of this.meshes.values()) mesh.visible = false;
    if (!this.enabled || !this.ready || !this.playback) {
      this.stats = { visibleParticles: 0, visibleMissiles: 0 };
      return;
    }
    const draws = sampleLatestVfxDraws(
        this.playback,
        this.definitions,
        time,
        this.uvPlayback,
        this.lifecyclePlayback,
      ),
      visible = new Set();
    for (const draw of draws) {
      const mesh = this.meshes.get(draw.key) ?? this.create(draw);
      mesh.visible = true;
      mesh.geometry.attributes.position.array.set(draw.positions.flat());
      mesh.geometry.attributes.position.needsUpdate = true;
      mesh.geometry.attributes.uv.array.set(draw.uv.flat());
      mesh.geometry.attributes.uv.needsUpdate = true;
      mesh.geometry.attributes.uvMult.array.set(draw.multUv.flat());
      mesh.geometry.attributes.uvMult.needsUpdate = true;
      const uniforms = mesh.material.uniforms;
      uniforms.tint.value.set(...draw.color);
      visible.add(draw.entityId);
    }
    this.stats = {
      visibleParticles: draws.length,
      visibleMissiles: visible.size,
    };
  }
  dispose() {
    this.uvPlayback?.close();
    this.lifecyclePlayback?.close();
    this.world.remove(this.group);
    for (const mesh of this.meshes.values()) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    for (const texture of this.textures.values()) {
      texture.image.close?.();
      texture.dispose();
    }
    this.meshes.clear();
    this.textures.clear();
    this.definitions.clear();
  }
}
