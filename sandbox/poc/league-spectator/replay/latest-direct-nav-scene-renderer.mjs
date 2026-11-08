import * as THREE from "three";
import { createReplayUniformBlock } from "./latest-vfx-bound-renderer.mjs";
import {
  createDirectNavSceneMaterialOwner,
  directNavSceneMaterialAdmission,
} from "./latest-direct-nav-scene-material.mjs";
import { isLatestDirectNavScene } from "./latest-direct-nav-scene.mjs";
import {
  isDirectNavSceneGpuProgram,
  validateDirectNavSceneGpuPasses,
  DIRECT_NAV_SCENE_SAMPLER,
} from "./latest-direct-nav-scene-gpu.mjs";
import { DIRECT_NAV_SCENE_POLICY } from "./latest-direct-nav-scene-contract.mjs";

// Camera-independent resource passes on the same WebGL command stream as the
// spectator. No all-white mask, CPU readback, guest simulation or async upload
// is substituted for the actual current render-target texture.
export class LatestDirectNavSceneRenderer {
  constructor({ renderer, worldNavScene, program }) {
    if (
      renderer?.isWebGLRenderer !== true ||
      !isLatestDirectNavScene(worldNavScene) ||
      !isDirectNavSceneGpuProgram(program)
    )
      throw Error(
        "Actual WebGL renderer, owned nav scene and exact GPU program required",
      );
    this.renderer = renderer;
    this.worldNavScene = worldNavScene;
    this.program = program;
    this.resources = null;
    this.disposed = false;
    this.lastTime = null;
    this.lastToken = null;
    this.ready = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      "a_POSITION",
      new THREE.BufferAttribute(Float32Array.of(0, 0, 2, 0, 0, 2), 2),
    );
    // The original shader uses a_POSITION, while THREE only infers an
    // unindexed draw count from the conventional position attribute. Preserve
    // the reflected binding and explicitly bound the fullscreen triangle.
    this.geometry.setDrawRange(0, 3);
    this.mesh = new THREE.Mesh(this.geometry);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.materials = {};
    this.blocks = {};
    for (const name of ["fade", "blur"]) {
      const block = createReplayUniformBlock({
        size: 16,
        bytesHex: "00".repeat(16),
        glslName: "Globals_ps",
        sceneMembers: [],
      });
      this.blocks[name] = block;
      const uniforms =
        name === "fade"
          ? {
              SAMPLER_NAV_GRID_CURRENT_TX: { value: null },
              SAMPLER_NAV_GRID_TARGET_TX: { value: null },
            }
          : { srcTex_TX: { value: null } };
      this.materials[name] = new THREE.RawShaderMaterial({
        vertexShader: program.vertexBody,
        fragmentShader: program[`${name}Body`],
        glslVersion: THREE.GLSL3,
        uniforms,
        uniformsGroups: [block.group],
        transparent: false,
        toneMapped: false,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.NoBlending,
        colorWrite: true,
      });
      this.materials[name].name = `OriginalNavmask_${name}`;
    }
    this.owner = createDirectNavSceneMaterialOwner({
      worldNavScene,
      execute: (job) => this.execute(job),
    });
  }
  async prepare() {
    if (
      this.ready ||
      this.disposed ||
      typeof this.renderer.compileAsync !== "function" ||
      typeof this.renderer.initRenderTarget !== "function"
    )
      throw Error("Unprepared actual WebGL navigation renderer required");
    this.initialize(this.worldNavScene.initialization());
    for (const target of this.resources.targets.values())
      this.renderer.initRenderTarget(target);
    for (const material of Object.values(this.materials)) {
      this.mesh.material = material;
      await this.renderer.compileAsync(this.scene, this.camera);
      const program = this.renderer.properties.get(material).currentProgram;
      if (
        !program ||
        !this.renderer
          .getContext()
          .getProgramParameter(
            program.program,
            this.renderer.getContext().LINK_STATUS,
          )
      )
        throw Error(
          "Navigation shader program failed readiness/link validation",
        );
    }
    if (
      this.renderer.getContext().getError() !==
      this.renderer.getContext().NO_ERROR
    )
      throw Error("Navigation shader preparation WebGL error");
    this.ready = true;
  }
  initialize(initialization) {
    if (this.resources || !initialization)
      throw Error("One explicit nav resource initialization required");
    const { resources, plan } = initialization;
    if (
      resources.width !== plan.width ||
      resources.height !== plan.height ||
      plan.upload?.target !== "mask-a" ||
      plan.upload.bytes.length !== resources.width * resources.height
    )
      throw Error("Exact initial nav upload required");
    const textures = new Map(),
      targets = new Map();
    for (const mask of resources.masks) {
      if (
        !["mask-a", "mask-b"].includes(mask.id) ||
        mask.format !== "r8-unorm" ||
        !(mask.initialBytes instanceof Uint8Array) ||
        mask.initialBytes.length !== resources.width * resources.height ||
        mask.initialBytes.some(Boolean)
      )
        throw Error("Zero-initialized owned R8 navigation histories required");
      const texture = new THREE.DataTexture(
        mask.initialBytes,
        resources.width,
        resources.height,
        THREE.RedFormat,
        THREE.UnsignedByteType,
      );
      texture.name = `OriginalNavmask_${mask.id}`;
      texture.internalFormat = "R8";
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.minFilter = texture.magFilter =
        mask.id === "mask-b" ? THREE.NearestFilter : THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.flipY = false;
      texture.colorSpace = THREE.NoColorSpace;
      texture.unpackAlignment = 1;
      texture.needsUpdate = true;
      // Preserve original zero allocation/upload before its first dirty update.
      this.renderer.initTexture(texture);
      textures.set(mask.id, texture);
    }
    const targetMask = textures.get(plan.upload.target);
    targetMask.image.data.set(plan.upload.bytes);
    targetMask.needsUpdate = true;
    this.renderer.initTexture(targetMask);
    for (const spec of resources.targets) {
      if (
        !["output", "scratch"].includes(spec.id) ||
        spec.format !== "bgra8-unorm" ||
        spec.initialBytes !== null ||
        spec.lifetime !== "per-update-pool-lease"
      )
        throw Error("Owned transient original color targets required");
      const target = new THREE.WebGLRenderTarget(
        resources.width,
        resources.height,
        {
          format: THREE.RGBAFormat,
          type: THREE.UnsignedByteType,
          internalFormat: "RGBA8",
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          wrapS: THREE.ClampToEdgeWrapping,
          wrapT: THREE.ClampToEdgeWrapping,
          depthBuffer: false,
          stencilBuffer: false,
          generateMipmaps: false,
          samples: 0,
        },
      );
      target.texture.colorSpace = THREE.NoColorSpace;
      target.texture.name = `OriginalNavmask_${spec.id}`;
      targets.set(spec.id, target);
      textures.set(spec.id, target.texture);
    }
    if (textures.size !== 4 || targets.size !== 2)
      throw Error(
        "Two distinct nav masks and two color target leases required",
      );
    this.resources = {
      textures,
      targets,
      width: resources.width,
      height: resources.height,
    };
  }
  execute({ initialization, frame }) {
    if (this.disposed) throw Error("Navigation renderer is disposed");
    validateDirectNavSceneGpuPasses(frame);
    if (initialization && !this.resources) this.initialize(initialization);
    if (!this.resources) throw Error("Nav producer source was not initialized");
    const r = this.renderer,
      gl = r.getContext(),
      previous = {
        target: r.getRenderTarget(),
        face: r.getActiveCubeFace(),
        mip: r.getActiveMipmapLevel(),
        viewport: r.getCurrentViewport(new THREE.Vector4()),
        scissor: Array.from(gl.getParameter(gl.SCISSOR_BOX)),
        scissorTest: gl.isEnabled(gl.SCISSOR_TEST),
        autoClear: r.autoClear,
        xrEnabled: r.xr.enabled,
      };
    if (gl.getError() !== gl.NO_ERROR)
      throw Error("WebGL error precedes navigation resource submission");
    let finishedPasses = 0;
    try {
      r.xr.enabled = false;
      r.autoClear = false;
      for (const pass of frame.plan.passes) {
        const material = this.materials[pass.shader];
        this.blocks[pass.shader].data.set(pass.parameters);
        const names =
          pass.shader === "fade"
            ? {
                current: "SAMPLER_NAV_GRID_CURRENT_TX",
                target: "SAMPLER_NAV_GRID_TARGET_TX",
              }
            : { source: "srcTex_TX" };
        for (const [role, name] of Object.entries(names))
          material.uniforms[name].value = this.resources.textures.get(
            pass.textures[role],
          );
        this.mesh.material = material;
        // setRenderTarget uses the target's physical-pixel viewport/scissor.
        // setViewport would multiply these dimensions by the screen DPR.
        r.setRenderTarget(this.resources.targets.get(pass.target));
        const beforeCalls = r.info.render.calls;
        r.render(this.scene, this.camera);
        const afterCalls = r.info.render.calls,
          submittedCalls = r.info.autoReset
            ? afterCalls
            : afterCalls - beforeCalls,
          glError = gl.getError();
        if (submittedCalls !== 1 || glError !== gl.NO_ERROR)
          throw Error(
            `Navigation pass did not submit one error-free GPU draw: ${JSON.stringify({ passIndex: finishedPasses, shader: pass.shader, target: pass.target, beforeCalls, afterCalls, submittedCalls, autoReset: r.info.autoReset, glError, glErrorHex: `0x${glError.toString(16)}`, drawRange: { ...this.geometry.drawRange }, positionCount: this.geometry.getAttribute("a_POSITION").count })}`,
          );
        finishedPasses++;
      }
    } finally {
      r.setRenderTarget(previous.target, previous.face, previous.mip);
      r.state.viewport(previous.viewport);
      r.state.scissor(new THREE.Vector4(...previous.scissor));
      r.state.setScissorTest(previous.scissorTest);
      r.autoClear = previous.autoClear;
      r.xr.enabled = previous.xrEnabled;
    }
    return {
      texture: this.resources.targets.get("output").texture,
      width: this.resources.width,
      height: this.resources.height,
      format: "bgra8-unorm",
      finishedPasses,
      frameSequence: frame.sequence,
      replayTime: frame.replayTime,
      sourcePackageSha256: frame.metadata.sourcePackageSha256,
      sourceInitialized: true,
    };
  }
  renderAt(time) {
    if (this.disposed) throw Error("Navigation renderer is disposed");
    if (time !== this.lastTime) {
      this.lastToken = this.worldNavScene.frame({ time });
      this.lastTime = time;
    }
    return this.owner.render(this.lastToken);
  }
  stage(time) {
    if (this.disposed) throw Error("Navigation renderer is disposed");
    if (time !== this.lastTime) {
      this.lastToken = this.worldNavScene.frame({ time });
      this.lastTime = time;
    }
    return this.worldNavScene.inspectFrame(this.lastToken);
  }
  renderAtSync(time) {
    if (!this.ready || this.disposed)
      throw Error("Prepared navigation shaders and resources required");
    this.stage(time);
    return this.owner.renderSync(this.lastToken);
  }
  materialInputs({ requiredScene, binding, replayTime }) {
    const result = directNavSceneMaterialAdmission({
      requiredScene,
      owner: this.owner,
      binding,
      replayTime,
      policy: DIRECT_NAV_SCENE_POLICY,
    });
    if (result.inputs) {
      const value = result.inputs.textures.NAVMESH_MASK_TEXTURE_SharedTexture;
      value.samplerDescriptorHex = DIRECT_NAV_SCENE_SAMPLER.descriptorHex;
      value.samplerParameters = { ...DIRECT_NAV_SCENE_SAMPLER.parameters };
      value.samplerIdentity = DIRECT_NAV_SCENE_SAMPLER.name;
    }
    return result;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const material of Object.values(this.materials)) material.dispose();
    for (const block of Object.values(this.blocks)) block.group.dispose();
    this.geometry.dispose();
    if (this.resources) {
      for (const [id, texture] of this.resources.textures)
        if (id.startsWith("mask-")) texture.dispose();
      for (const target of this.resources.targets.values()) target.dispose();
    }
  }
}
