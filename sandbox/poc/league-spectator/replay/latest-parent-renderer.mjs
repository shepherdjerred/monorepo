import * as THREE from "three";
import {
  LatestBoundVfxRenderer,
  createReplayUniformBlock,
  writeReplayCameraBlocks,
} from "./latest-vfx-bound-renderer.mjs";
import { LatestTrailVfxRenderer } from "./latest-trail-renderer.mjs";
import {
  createParentRenderFrames,
  PARENT_QUAD_GPU_SHA,
  PARENT_TRAIL_GPU_SHA,
  PARENT_EROSION_GPU_SHA,
} from "./latest-parent-render-frame.mjs";
import { PARENT_REQUESTED_CACHES_SHA } from "./latest-parent-frames.mjs";
import { sha256 } from "./structural-comparison.mjs";
import { assertLatestSelectedMaterials } from "./latest-selected-materials.mjs";
import { loadLatestSelectedMaterialTextures } from "./latest-selected-material-textures.mjs";

export const PARENT_TEXTURES_SHA =
  "adaf719b62250cb94415a08f81d0aa7e7b45d624edbdbdeb0e5b76606d0eec4f";
export const PARENT_REQUESTED_TEXTURES_SHA =
  "16a39fb69a43826f9053549df037df0d1356b4b516ab1c58b3003e7c3590add1";

// Shared material/geometry consumer. Its owner supplies complete worker frames
// and replay lifecycle; this class never simulates an emitter independently.
export class LatestParentVfxRenderer extends LatestBoundVfxRenderer {
  constructor(
    world,
    manifest,
    effectsManifestBytes,
    { assetBase, staticCatalog = null, selectedMaterials = null } = {},
  ) {
    if (selectedMaterials !== null) {
      assertLatestSelectedMaterials(selectedMaterials).assertSelection(
        staticCatalog,
      );
      if (
        !["fixed-original-complete", "native-quad-partial"].includes(
          selectedMaterials.mode,
        )
      )
        throw Error("Explicit selected renderer material mode required");
    }
    super(world, manifest, effectsManifestBytes);
    this.selectedMaterials = selectedMaterials;
    this.staticCatalog = staticCatalog;
    this.selectedQuadMaterials =
      selectedMaterials?.mode === "native-quad-partial";
    this.assetBase =
      assetBase ??
      (globalThis.location ? new URL("/assets/", location.href).href : null);
    this.abort = new AbortController();
    this.disposed = false;
    this.parentMeshes = new Map();
    this.loadedEffects = new Set();
    this.group.name =
      "Complete native effect parents / translated game shaders";
  }
  async checked(path, expected) {
    if (this.disposed)
      throw new DOMException("Parent renderer disposed", "AbortError");
    if (this.selectedQuadMaterials) {
      if (!path.startsWith("/assets/"))
        throw Error("Selected renderer asset path required");
      const bytes = await this.staticCatalog.read(
        path.slice("/assets/".length),
      );
      if (expected && (await sha256(bytes)) !== expected)
        throw Error(`Selected render asset hash differs: ${path}`);
      if (this.disposed)
        throw new DOMException("Parent renderer disposed", "AbortError");
      return bytes;
    }
    if (!this.assetBase)
      throw Error("Explicit parent renderer asset base required");
    const response = await fetch(new URL(path, this.assetBase), {
      signal: this.abort.signal,
    });
    if (response.status !== 200)
      throw Error(`Parent render asset HTTP ${response.status}: ${path}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (expected && (await sha256(bytes)) !== expected)
      throw Error(`Parent render asset hash differs: ${path}`);
    if (this.disposed)
      throw new DOMException("Parent renderer disposed", "AbortError");
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
      texture = new THREE.DataTexture(
        Uint8Array.from(
          binding.kind === "supplied-white-lookup"
            ? [255, 255, 255, 255]
            : [0, 0, 0, 0],
        ),
        1,
        1,
        THREE.RGBAFormat,
        THREE.UnsignedByteType,
      );
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.magFilter = texture.minFilter = THREE.NearestFilter;
    } else if (binding.kind === "prepared-texture") {
      if (this.selectedQuadMaterials) {
        const ref = await this.selectedTextureOwner.readTexture(binding),
          wrap = {
            repeat: THREE.RepeatWrapping,
            clamp: THREE.ClampToEdgeWrapping,
            mirror: THREE.MirroredRepeatWrapping,
          }[binding.sampler.name];
        if (this.disposed)
          throw new DOMException("Parent renderer disposed", "AbortError");
        if (wrap === undefined)
          throw Error("Unimplemented parent texture wrap");
        texture = new THREE.DataTexture(
          ref.data,
          ref.width,
          ref.height,
          THREE.RGBAFormat,
          THREE.UnsignedByteType,
        );
        texture.wrapS = texture.wrapT = wrap;
        texture.minFilter = texture.magFilter = binding.sampler.pixelated
          ? THREE.NearestFilter
          : THREE.LinearFilter;
      } else {
        const resource = this.rgbaResources.get(binding.sha256),
          ref = resource?.ref;
        if (
          !ref ||
          ref.sourceFile !== binding.file ||
          !/^rgba-[a-f0-9]{64}\.bin$/.test(ref.file) ||
          !Number.isSafeInteger(ref.width) ||
          !Number.isSafeInteger(ref.height) ||
          ref.width < 1 ||
          ref.height < 1 ||
          ref.bytes !== ref.width * ref.height * 4
        )
          throw Error("Unprepared parent RGBA texture binding");
        const data = await this.checked(
          `/assets/${resource.directory}/${ref.file}`,
          ref.sha256,
        );
        if (data.length !== ref.bytes)
          throw Error("Parent RGBA texture length differs");
        const wrap = {
          repeat: THREE.RepeatWrapping,
          clamp: THREE.ClampToEdgeWrapping,
          mirror: THREE.MirroredRepeatWrapping,
        }[binding.sampler.name];
        if (wrap === undefined)
          throw Error("Unimplemented parent texture wrap");
        texture = new THREE.DataTexture(
          data,
          ref.width,
          ref.height,
          THREE.RGBAFormat,
          THREE.UnsignedByteType,
        );
        texture.wrapS = texture.wrapT = wrap;
        texture.minFilter = texture.magFilter = binding.sampler.pixelated
          ? THREE.NearestFilter
          : THREE.LinearFilter;
      }
    } else throw Error("Unprovided parent texture kind");
    texture.colorSpace = THREE.NoColorSpace;
    texture.flipY = false;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    this.textures.set(key, texture);
    return texture;
  }
  async load(
    effectIds,
    {
      materialKeys = null,
      additionalRgbaCatalogs = [],
      materialOverrides = null,
    } = {},
  ) {
    if (
      this.ready ||
      this.disposed ||
      !Array.isArray(effectIds) ||
      new Set(effectIds).size !== effectIds.length
    )
      throw Error("Explicit unique parent renderer effects required");
    if (
      materialKeys !== null &&
      (!Array.isArray(materialKeys) ||
        materialKeys.some((key) => typeof key !== "string") ||
        new Set(materialKeys).size !== materialKeys.length)
    )
      throw Error("Explicit unique renderer material keys required");
    if (
      !Array.isArray(additionalRgbaCatalogs) ||
      additionalRgbaCatalogs.length > 16 ||
      new Set(additionalRgbaCatalogs.map((c) => c?.directory)).size !==
        additionalRgbaCatalogs.length ||
      additionalRgbaCatalogs.some(
        (c) =>
          !/^latest-[a-z0-9-]{1,96}$/.test(c?.directory) ||
          !/^[a-f0-9]{64}$/.test(c?.sha256),
      )
    )
      throw Error("Bounded pinned additional RGBA catalogs required");
    if (
      this.selectedQuadMaterials &&
      (additionalRgbaCatalogs.length || materialOverrides !== null)
    )
      throw Error(
        "Selected quad renderer cannot accept unprepared material/RGBA overrides",
      );
    if (this.selectedQuadMaterials)
      await this.selectedMaterials.bindDefinitions(effectIds);
    const [quadPackageBytes, trailPackageBytes, erosionPackageBytes] = this
      .selectedQuadMaterials
      ? [this.selectedMaterials.packageBytes("quad"), undefined, undefined]
      : await Promise.all([
          this.checked(
            "/assets/latest-complete-quad-gpu/package.json",
            PARENT_QUAD_GPU_SHA,
          ),
          this.checked(
            "/assets/latest-trail-particles/gpu.json",
            PARENT_TRAIL_GPU_SHA,
          ),
          this.checked(
            "/assets/latest-quad-erosion-gpu/package.json",
            PARENT_EROSION_GPU_SHA,
          ),
        ]);
    this.bridge = await createParentRenderFrames({
      effectsManifestBytes: this.effectsManifestBytes,
      quadPackageBytes,
      trailPackageBytes,
      erosionPackageBytes,
      selectedMaterials: this.selectedQuadMaterials
        ? this.selectedMaterials
        : null,
    });
    if (materialOverrides !== null) {
      if (!(materialOverrides instanceof Map))
        throw Error("Explicit renderer material override map required");
      for (const [key, binding] of materialOverrides) {
        if (
          key !== binding.key ||
          key !==
            `${binding.prepared.effectId}:${binding.prepared.emitterIndex}` ||
          !effectIds.includes(binding.prepared.effectId) ||
          this.manifest.definitions[binding.prepared.effectId]?.sha256 !==
            binding.prepared.sourceDefinitionSha256 ||
          binding.prepared.environment?.pass !== 5 ||
          binding.prepared.materialPolicy !==
            "native-ground-pass5-all-vision-diagnostic"
        )
          throw Error("Invalid explicit native ground material override");
        this.bridge.materials.set(key, binding);
      }
    }
    const selectedMaterials =
      materialKeys === null ? null : new Set(materialKeys);
    if (selectedMaterials)
      for (const key of selectedMaterials) {
        const binding = this.bridge.materials.get(key);
        if (!binding || !effectIds.includes(binding.prepared.effectId))
          throw Error(
            "Requested renderer material is absent or belongs to another effect",
          );
      }
    if (this.selectedQuadMaterials) {
      this.selectedTextureOwner = await loadLatestSelectedMaterialTextures({
        staticCatalog: this.staticCatalog,
        selectedMaterials: this.selectedMaterials,
      });
    } else {
      this.rgbaCatalog = JSON.parse(
        new TextDecoder().decode(
          await this.checked(
            "/assets/latest-parent-textures/package.json",
            PARENT_TEXTURES_SHA,
          ),
        ),
      );
      if (
        this.rgbaCatalog.kind !== "prepared-parent-rgba8-textures" ||
        this.rgbaCatalog.build !== "16.21.829.8620" ||
        this.rgbaCatalog.protocol !== "20e09df23c66b85e" ||
        this.rgbaCatalog.packages["latest-complete-quad-gpu/package.json"] !==
          PARENT_QUAD_GPU_SHA ||
        this.rgbaCatalog.packages["latest-trail-particles/gpu.json"] !==
          PARENT_TRAIL_GPU_SHA ||
        this.rgbaCatalog.scope.containsReplayData ||
        this.rgbaCatalog.scope.pixelFormat !== "RGBA8" ||
        this.rgbaCatalog.scope.premultiplied ||
        this.rgbaCatalog.scope.colorSpaceConversion
      )
        throw Error("Unsupported parent RGBA package");
      const requestedRgba = JSON.parse(
        new TextDecoder().decode(
          await this.checked(
            "/assets/latest-effect-root-textures/package.json",
            PARENT_REQUESTED_TEXTURES_SHA,
          ),
        ),
      );
      if (
        requestedRgba.kind !== "prepared-effect-root-rgba8-textures" ||
        requestedRgba.build !== this.rgbaCatalog.build ||
        requestedRgba.protocol !== this.rgbaCatalog.protocol ||
        requestedRgba.packages[
          "latest-effect-root-frame-caches/package.json"
        ] !== PARENT_REQUESTED_CACHES_SHA ||
        requestedRgba.packages["latest-complete-quad-gpu/package.json"] !==
          PARENT_QUAD_GPU_SHA ||
        requestedRgba.packages["latest-trail-particles/gpu.json"] !==
          PARENT_TRAIL_GPU_SHA ||
        requestedRgba.packages["latest-quad-erosion-gpu/package.json"] !==
          PARENT_EROSION_GPU_SHA ||
        requestedRgba.scope.containsReplayData ||
        requestedRgba.scope.pixelFormat !== "RGBA8" ||
        requestedRgba.scope.premultiplied ||
        requestedRgba.scope.colorSpaceConversion
      )
        throw Error("Unsupported additional parent RGBA package");
      const catalogs = [
        [this.rgbaCatalog, "latest-parent-textures"],
        [requestedRgba, "latest-effect-root-textures"],
      ];
      for (const reference of additionalRgbaCatalogs) {
        const catalog = JSON.parse(
          new TextDecoder().decode(
            await this.checked(
              `/assets/${reference.directory}/package.json`,
              reference.sha256,
            ),
          ),
        );
        if (
          catalog.schema !== 1 ||
          catalog.kind !== "prepared-component-rgba8-textures" ||
          catalog.build !== this.rgbaCatalog.build ||
          catalog.protocol !== this.rgbaCatalog.protocol ||
          catalog.effectsManifestSha256 !==
            (await sha256(this.effectsManifestBytes)) ||
          catalog.packages["latest-complete-quad-gpu/package.json"] !==
            PARENT_QUAD_GPU_SHA ||
          catalog.packages["latest-trail-particles/gpu.json"] !==
            PARENT_TRAIL_GPU_SHA ||
          catalog.packages["latest-quad-erosion-gpu/package.json"] !==
            PARENT_EROSION_GPU_SHA ||
          catalog.scope.containsReplayData !== false ||
          catalog.scope.pixelFormat !== "RGBA8" ||
          catalog.scope.rowOrder !== "source-top-to-bottom" ||
          catalog.scope.premultiplied !== false ||
          catalog.scope.colorSpaceConversion !== false ||
          catalog.scope.mipmaps !== false
        )
          throw Error("Incompatible component RGBA catalog");
        catalogs.push([catalog, reference.directory]);
      }
      this.rgbaResources = new Map();
      for (const [catalog, directory] of catalogs)
        for (const [key, ref] of Object.entries(catalog.textures)) {
          const previous = this.rgbaResources.get(key);
          if (previous && JSON.stringify(previous.ref) !== JSON.stringify(ref))
            throw Error("Ambiguous parent RGBA texture catalog");
          if (!previous) this.rgbaResources.set(key, { ref, directory });
        }
    }
    const stages = new Map();
    for (const effectId of effectIds) {
      if (!this.manifest.definitions[effectId])
        throw Error("Unknown parent renderer effect");
      const bindings = [...this.bridge.materials.values()].filter(
        (b) =>
          b.prepared.effectId === effectId &&
          (selectedMaterials === null || selectedMaterials.has(b.key)),
      );
      if (!bindings.length)
        throw Error("Parent effect has no prepared material bindings");
      for (const binding of bindings) {
        const p = binding.prepared;
        for (const stage of ["vertex", "pixel"]) {
          const ref = p.shaders[stage];
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
        for (const [name, texture] of Object.entries(p.textures))
          uniforms[name] = { value: await this.gpuTexture(texture) };
        const blocks = p.blocks.map((block) => {
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
        };
        const body = (shader) => {
          if (!shader.glsl.startsWith("#version 300 es\n"))
            throw Error("Unsupported parent GLSL version");
          return shader.glsl.slice("#version 300 es\n".length);
        };
        const material = new THREE.RawShaderMaterial({
          vertexShader: body(stages.get(p.shaders.vertex.sha256)),
          fragmentShader: body(stages.get(p.shaders.pixel.sha256)),
          glslVersion: THREE.GLSL3,
          uniforms,
          uniformsGroups: blocks.map((b) => b.group),
          transparent: true,
          toneMapped: false,
          depthWrite: false,
          depthTest: p.suppliedDepthTest,
          side: p.suppliedDoubleSide ? THREE.DoubleSide : THREE.FrontSide,
          blending: THREE.CustomBlending,
          blendEquation: THREE.AddEquation,
          blendEquationAlpha: THREE.AddEquation,
          blendSrc: factors[p.nativeBlendFactors[0]],
          blendSrcAlpha: factors[p.nativeBlendFactors[1]],
          blendDst: factors[p.nativeBlendFactors[2]],
          blendDstAlpha: factors[p.nativeBlendFactors[3]],
        });
        material.name = `NativeParent_${effectId}_${p.emitterIndex}`;
        this.gpuMaterials.set(binding.key, { prepared: p, material });
      }
      this.loadedEffects.add(effectId);
    }
    this.ready = true;
  }
  bindParent(key, effectId, ownership) {
    if (!this.ready || !this.loadedEffects.has(effectId))
      throw Error("Parent renderer effect is not loaded");
    for (const actor of ownership.actors)
      if (!this.gpuMaterials.has(`${effectId}:${actor.emitterIndex}`))
        throw Error("Unbound parent renderer actor material");
    this.bridge.bindParent(key, effectId, ownership);
    this.parentMeshes.set(key, new Map());
  }
  unbindParent(key) {
    this.bridge.unbindParent(key);
    for (const mesh of this.parentMeshes.get(key).values()) {
      mesh.geometry.dispose();
      this.group.remove(mesh);
      this.meshes.delete(mesh);
    }
    this.parentMeshes.delete(key);
  }
  stageFrame(packet) {
    if (!this.ready) throw Error("Parent renderer is not ready");
    return this.bridge.stage(packet);
  }
  decodeGeometry(draw) {
    return draw.attributes;
  }
  applyGeometry(mesh, draw) {
    return LatestTrailVfxRenderer.prototype.applyGeometry.call(
      this,
      mesh,
      draw,
    );
  }
  commitFrame(frame, projectionRows) {
    this.bridge.assertCurrent(frame);
    writeReplayCameraBlocks(
      [...this.cameraBlocks],
      projectionRows,
      frame.camera.position,
    );
    for (const mesh of this.meshes.values()) mesh.visible = false;
    const visible = new Set();
    let quads = 0,
      trails = 0;
    for (const draw of frame.draws) {
      if (!draw.attributes.index.length) continue;
      const binding = this.gpuMaterials.get(draw.materialKey),
        meshes = this.parentMeshes.get(draw.key);
      if (!binding || !meshes)
        throw Error("Unowned complete-parent render material/mesh");
      let mesh = meshes.get(draw.emitterIndex);
      if (!mesh) {
        mesh = new THREE.Mesh(new THREE.BufferGeometry(), binding.material);
        mesh.frustumCulled = false;
        mesh.renderOrder = binding.prepared.suppliedSortPass;
        meshes.set(draw.emitterIndex, mesh);
        this.meshes.set(mesh, mesh);
        this.group.add(mesh);
      }
      this.applyGeometry(mesh, draw);
      mesh.visible = this.enabled;
      if (this.enabled) {
        visible.add(draw.key);
        if (draw.kind === "camera-trail") trails += draw.particleCount;
        else quads += draw.particleCount;
      }
    }
    this.stats = {
      visibleParticles: quads + trails,
      visibleQuads: quads,
      visibleTrailPoints: trails,
      visibleMissiles: visible.size,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    this.bridge?.clear();
    this.ready = false;
    this.world.remove(this.group);
    for (const mesh of this.meshes.values()) mesh.geometry.dispose();
    for (const { material } of this.gpuMaterials.values()) material.dispose();
    for (const texture of this.textures.values()) {
      texture.image.close?.();
      texture.dispose();
    }
    for (const block of this.uniformGroups.values()) block.group.dispose();
    for (const map of [
      this.parentMeshes,
      this.meshes,
      this.gpuMaterials,
      this.textures,
      this.uniformGroups,
      this.definitions,
    ])
      map.clear();
    this.cameraBlocks.clear();
    this.rgbaResources?.clear();
    this.selectedTextureOwner = null;
    this.loadedEffects.clear();
    this.group.clear();
  }
}

export function parentRenderCamera(camera, world) {
  camera.updateWorldMatrix(true, false);
  world.updateWorldMatrix(true, false);
  const inverse = new THREE.Matrix4().copy(world.matrixWorld).invert(),
    e = camera.matrixWorld.elements;
  const axis = (offset) =>
    new THREE.Vector3(e[offset], e[offset + 1], e[offset + 2])
      .transformDirection(inverse)
      .toArray();
  const position = new THREE.Vector3()
    .setFromMatrixPosition(camera.matrixWorld)
    .applyMatrix4(inverse)
    .toArray();
  const projection = new THREE.Matrix4()
    .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    .multiply(world.matrixWorld).elements;
  const rows = Array.from(
    { length: 16 },
    (_, i) => projection[(i % 4) * 4 + Math.floor(i / 4)],
  );
  for (let c = 0; c < 4; c++) rows[8 + c] = 0.5 * (rows[8 + c] + rows[12 + c]);
  return {
    // Use the same JSON-representable supplied-input convention as the native
    // probe schedules. THREE's reflected world matrix can otherwise emit -0.
    view: Object.fromEntries(
      Object.entries({
        position,
        right: axis(0),
        up: axis(4),
        axis: axis(8),
      }).map(([key, values]) => [
        key,
        values.map((v) => (Object.is(v, -0) ? 0 : v)),
      ]),
    ),
    rows,
  };
}
