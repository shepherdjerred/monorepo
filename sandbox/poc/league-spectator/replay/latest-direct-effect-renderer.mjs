import * as THREE from "three";
import {
  LatestParentVfxRenderer,
  parentRenderCamera,
} from "./latest-parent-renderer.mjs";
import { writeReplayCameraBlocks } from "./latest-vfx-bound-renderer.mjs";
import { directRenderAttributes } from "./latest-direct-effect-draw.mjs";
import { sha256 } from "./structural-comparison.mjs";
import {
  validateDirectDepthBiasProgram,
  assertDirectDepthBiasRenderer,
} from "./latest-direct-effect-depth-bias.mjs";
import { loadLatestDirectStaticMeshPackage } from "./latest-direct-static-mesh-package.mjs";
import { LatestDirectStaticMeshRenderer } from "./latest-direct-static-mesh-renderer.mjs";
import { loadLatestDirectRayPackage } from "./latest-direct-ray-package.mjs";
import { LatestDirectRayRenderer } from "./latest-direct-ray-renderer.mjs";
import { LatestDirectNavGroundRenderer } from "./latest-direct-nav-ground-renderer.mjs";
import {
  directGroundMaterials,
  DIRECT_GROUND_PACKAGE_SHA,
  DIRECT_GROUND_POLICY,
} from "./latest-direct-ground-policy.mjs";

// Static RGBA8 package for all already prepared native component materials.
export const DIRECT_EFFECT_TEXTURES_SHA =
  "f1bdb57833fd7aec46cf0d7af94fedc7e8a2aa534c54492f0df308f02036fe19";

export class LatestDirectEffectRenderer extends LatestParentVfxRenderer {
  constructor(world, manifest, manifestBytes, options = {}) {
    super(world, manifest, manifestBytes, options);
    this.directMeshes = new Map();
    this.directOwnership = new Map();
    this.submitted = new Map();
    this.frameMetrics = null;
    this.staticMeshRenderer = null;
    this.rayRenderer = null;
    this.navigation = options.navigation ?? null;
    this.navGroundRenderer = null;
    this.pendingCombat = null;
    this.group.name = "Direct typed-array effects / translated game shaders";
  }
  async gpuTexture(binding) {
    if (binding.kind !== "native-ground-all-vision")
      return super.gpuTexture(binding);
    if (
      binding.rgbaHex !== "ffffffff" ||
      binding.sampler?.name !== "clamp" ||
      binding.sampler.pixelated !== true ||
      !/^[a-f0-9]{64}$/.test(binding.nativeProofSha256) ||
      binding.nativeTextureSha256 !==
        "ad95131bc0b799c0b1af477fb14fcf26a6a9f76079e48bf090acb7e8367bfd0e"
    )
      throw Error(
        "Original native ground all-vision texture identity required",
      );
    const key = JSON.stringify(binding);
    if (this.textures.has(key)) return this.textures.get(key);
    const texture = new THREE.DataTexture(
      Uint8Array.from([255, 255, 255, 255]),
      1,
      1,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.NoColorSpace;
    texture.flipY = false;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    this.textures.set(key, texture);
    return texture;
  }
  async loadDefinitions(definitions) {
    this.compiled = definitions;
    const admitted = [...definitions.values()].filter((d) => d.emitters.length);
    if (
      this.selectedQuadMaterials &&
      admitted.some((d) =>
        d.emitters.some(
          (e) =>
            e.navGroundProgram ||
            e.groundLayer ||
            !["camera-quad", "arbitrary-quad"].includes(e.primitive),
        ),
      )
    )
      throw Error(
        "Selected partial material registry requires otherwise eligible quad-only definitions",
      );
    const hasStaticMesh = admitted.some((d) =>
      d.emitters.some((e) => e.primitive === "static-mesh"),
    );
    const hasRay = admitted.some((d) =>
      d.emitters.some((e) => e.primitive === "ray"),
    );
    const hasNav = admitted.some((d) =>
      d.emitters.some((e) => e.navGroundProgram),
    );
    if (hasNav) {
      if (!this.navigation)
        throw Error("Owned selected-scene navigation resources required");
      this.navGroundRenderer = new LatestDirectNavGroundRenderer(this.world, {
        ...this.navigation,
        onSubmit: (row) => {
          const id = `${row.sourceEventId}:${row.generation}`,
            entry = this.submitted.get(id) ?? {
              sourceEventId: row.sourceEventId,
              generation: row.generation,
              definitionId: row.definitionId,
              ownerId: row.ownerId,
              ownershipStatus: row.ownershipStatus,
              emitters: new Set(),
              firstTime: row.time,
            };
          entry.emitters.add(row.emitterId);
          this.submitted.set(id, entry);
        },
      });
      this.group.add(this.navGroundRenderer.group);
      await this.navGroundRenderer.loadDefinitions(definitions);
    }
    if (hasStaticMesh || hasRay) {
      const load = (path) => this.checked(`/assets/${path}`);
      const profile = JSON.parse(
        new TextDecoder().decode(
          await load("decoder-16.21-macos/profile.json"),
        ),
      );
      const records = admitted.map((d) => {
        const emitters = [];
        for (const e of d.emitters) emitters[e.index] = e.source;
        return {
          id: d.id,
          definition: { complexEmitterDefinitionData: emitters },
        };
      });
      const options = {
        onSubmit: (row) => {
          const instanceId = `${row.sourceEventId}:${row.generation}`;
          const entry = this.submitted.get(instanceId) ?? {
            sourceEventId: row.sourceEventId,
            generation: row.generation,
            definitionId: row.definitionId,
            ownerId: row.ownerId,
            ownershipStatus: row.ownershipStatus,
            emitters: new Set(),
            firstTime: row.time,
          };
          entry.emitters.add(row.emitterId);
          this.submitted.set(instanceId, entry);
        },
      };
      if (hasStaticMesh) {
        const resources = await loadLatestDirectStaticMeshPackage({
          load,
          profile,
          manifestBytes: this.effectsManifestBytes,
          records,
        });
        this.staticMeshRenderer = new LatestDirectStaticMeshRenderer(
          this.world,
          resources,
          options,
        );
        this.group.add(this.staticMeshRenderer.group);
        await this.staticMeshRenderer.loadDefinitions(definitions);
      }
      if (hasRay) {
        const resources = await loadLatestDirectRayPackage({
          load,
          profile,
          manifestBytes: this.effectsManifestBytes,
          records,
        });
        this.rayRenderer = new LatestDirectRayRenderer(
          this.world,
          resources,
          options,
        );
        this.group.add(this.rayRenderer.group);
        await this.rayRenderer.loadDefinitions(definitions);
      }
    }
    const conventional = admitted.filter((d) =>
      d.emitters.some(
        (e) =>
          !e.navGroundProgram && !["static-mesh", "ray"].includes(e.primitive),
      ),
    );
    const ground = admitted.flatMap((d) =>
      d.emitters.filter(
        (e) =>
          e.groundLayer &&
          !e.navGroundProgram &&
          !["static-mesh", "ray"].includes(e.primitive),
      ),
    );
    let materialOverrides = null;
    if (ground.length) {
      const bytes = await this.checked(
        "/assets/latest-direct-ground-materials/package.json",
        DIRECT_GROUND_PACKAGE_SHA,
      );
      const bindings = directGroundMaterials(
        JSON.parse(new TextDecoder().decode(bytes)),
        this.manifest,
        await sha256(this.effectsManifestBytes),
      );
      materialOverrides = new Map();
      for (const e of ground) {
        const binding = bindings.get(e.materialKey);
        if (!binding || e.materialPolicy !== DIRECT_GROUND_POLICY)
          throw Error(
            "Direct ground renderer requires exact pass5 all-vision material",
          );
        materialOverrides.set(e.materialKey, binding);
      }
    }
    await super.load(
      conventional.map((d) => d.id),
      {
        materialOverrides,
        materialKeys: conventional.flatMap((d) =>
          d.emitters
            .filter(
              (e) =>
                !e.navGroundProgram &&
                !["static-mesh", "ray"].includes(e.primitive),
            )
            .map((e) => e.materialKey),
        ),
        additionalRgbaCatalogs: this.selectedQuadMaterials
          ? []
          : [
              {
                directory: "latest-component-textures",
                sha256: DIRECT_EFFECT_TEXTURES_SHA,
              },
            ],
      },
    );
    for (const definition of conventional)
      for (const emitter of definition.emitters) {
        // Navigation components own their native pipeline in the dedicated
        // renderer, even when their definition also contains ordinary quads.
        if (!emitter.depthBiasProgram || emitter.navGroundProgram) continue;
        const binding = this.gpuMaterials.get(emitter.materialKey);
        if (!binding)
          throw Error("Owned native depth-bias material binding required");
        const bias = validateDirectDepthBiasProgram(
          emitter.depthBiasProgram,
          emitter.source,
          emitter.primitive,
          binding.prepared.nativeRenderStateHex,
        );
        binding.material.polygonOffset = bias.enabled;
        binding.material.polygonOffsetFactor = bias.slope;
        binding.material.polygonOffsetUnits = bias.constant;
        binding.depthBiasProgram = bias;
      }
  }
  commitDirect(packet, camera) {
    const started = performance.now();
    this.pendingCombat = null;
    const priorVisibility = this.group.visible;
    // Any failed replacement invalidates the old presentation, including a
    // later scene-only redraw that does not submit another effect packet.
    this.group.visible = false;
    // Own deferred packet bytes: transfers/caller mutation cannot change an
    // already validated frame between staging and the timed GPU submission.
    if (this.navGroundRenderer) {
      packet = structuredClone(packet);
      camera.updateWorldMatrix(true, false);
      camera = camera.clone();
      camera.matrixAutoUpdate = false;
      camera.matrixWorldAutoUpdate = false;
    }
    if (
      !this.ready ||
      !Number.isFinite(packet.time) ||
      !Array.isArray(packet.draws)
    )
      throw Error("Direct renderer is not ready");
    const packetSnapshotCpuMs = performance.now() - started;
    const active = new Set();
    const newOwnership = new Map();
    const prepared = [];
    const navStaged = this.navGroundRenderer?.preflight(packet, camera);
    const navKeys = new Set(
      navStaged?.pending.map((p) => p.draw.materialKey) ?? [],
    );
    const meshDraws = packet.draws.filter(
      (draw) => draw.primitive === "static-mesh",
    );
    if (meshDraws.length && !this.staticMeshRenderer)
      throw Error("Unloaded static mesh draw resources");
    const rayDraws = packet.draws.filter((draw) => draw.primitive === "ray");
    if (rayDraws.length && !this.rayRenderer)
      throw Error("Unloaded Ray draw resources");
    // The static consumer preflights all records before mutating its own meshes.
    // Conventional draws retain their shared quad/trail consumer below.
    for (const draw of packet.draws) {
      const definition = this.compiled.get(draw.definitionId);
      const program = definition?.emitters.find(
        (e) => e.index === draw.emitterId,
      );
      const binding = this.gpuMaterials.get(draw.materialKey);
      if (
        !program ||
        (program.primitive === "camera-trail") !==
          (draw.primitive === "camera-trail") ||
        (program.primitive === "static-mesh") !==
          (draw.primitive === "static-mesh") ||
        (program.primitive === "ray") !== (draw.primitive === "ray") ||
        program.materialKey !== draw.materialKey ||
        (!["static-mesh", "ray"].includes(draw.primitive) &&
          !navKeys.has(draw.materialKey) &&
          !binding) ||
        !Number.isSafeInteger(draw.generation) ||
        draw.generation < 1 ||
        typeof draw.sourceEventId !== "string" ||
        !draw.sourceEventId.length
      )
        throw Error("Unowned direct draw definition/emitter/material");
      const key = `${draw.sourceEventId}:${draw.generation}:${draw.emitterId}`;
      if (active.has(key)) throw Error("Duplicate direct draw identity");
      active.add(key);
      const instanceId = `${draw.sourceEventId}:${draw.generation}`;
      const identity = Object.freeze({
        sourceEventId: draw.sourceEventId,
        generation: draw.generation,
        definitionId: draw.definitionId,
        ownerId: draw.ownerId ?? null,
        ownershipStatus: draw.ownershipStatus ?? "unresolved",
      });
      const previous =
        this.directOwnership.get(instanceId) ?? newOwnership.get(instanceId);
      if (
        previous &&
        Object.keys(identity).some(
          (field) => identity[field] !== previous[field],
        )
      )
        throw Error("Direct instance definition or ownership changed");
      newOwnership.set(instanceId, identity);
      if (program.navGroundProgram) {
        directRenderAttributes(draw);
        continue;
      }
      if (draw.primitive === "ray") {
        // Validate packed geometry before either specialized child mutates its
        // visible meshes. Material ownership was fixed during child loading.
        directRenderAttributes(draw);
        continue;
      }
      if (draw.primitive === "static-mesh") continue;
      prepared.push({
        draw,
        key,
        instanceId,
        identity,
        binding,
        attributes: directRenderAttributes(draw),
      });
    }
    const { view, rows } = parentRenderCamera(camera, this.world);
    if (this.navGroundRenderer) {
      this.staticMeshRenderer?.commit({ ...packet, draws: meshDraws }, camera, {
        preflightOnly: true,
      });
      this.rayRenderer?.commit({ ...packet, draws: rayDraws }, camera, {
        preflightOnly: true,
      });
    }
    const metrics = {
      ...packet.metrics,
      geometryUploadPreparationMs: performance.now() - started,
      gpuExecutionMs: null,
      worldOnlyMs: null,
      packetSnapshotCpuMs,
    };
    this.frameMetrics = metrics;
    const commit = () => {
      if (this.staticMeshRenderer) {
        this.staticMeshRenderer.setEnabled(this.enabled);
        this.staticMeshRenderer.commit({ ...packet, draws: meshDraws }, camera);
      }
      if (this.rayRenderer) {
        this.rayRenderer.setEnabled(this.enabled);
        this.rayRenderer.commit({ ...packet, draws: rayDraws }, camera);
      }
      writeReplayCameraBlocks([...this.cameraBlocks], rows, view.position);
      for (const [instanceId, identity] of newOwnership)
        this.directOwnership.set(instanceId, identity);
      for (const {
        draw,
        key,
        instanceId,
        identity,
        binding,
        attributes,
      } of prepared) {
        const emitterId = draw.emitterId;
        let mesh = this.directMeshes.get(key);
        if (!mesh) {
          mesh = new THREE.Mesh(new THREE.BufferGeometry(), binding.material);
          mesh.frustumCulled = false;
          mesh.renderOrder = binding.prepared.suppliedSortPass;
          if (binding.depthBiasProgram)
            mesh.onBeforeRender = assertDirectDepthBiasRenderer;
          mesh.onAfterRender = () => {
            // THREE invokes this callback even when indexed drawCount is zero.
            // A retained single trail point generates geometry but no primitive.
            if (!mesh.visible || !(mesh.geometry.index?.count > 0)) return;
            // Submission is observable here; visible pixels require a raster or
            // user-observed check and are never inferred from this callback.
            const entry = this.submitted.get(instanceId) ?? {
              ...identity,
              emitters: new Set(),
              firstTime: mesh.userData.presentationTime,
            };
            entry.emitters.add(emitterId);
            this.submitted.set(instanceId, entry);
          };
          this.directMeshes.set(key, mesh);
          this.meshes.set(mesh, mesh);
          this.group.add(mesh);
        }
        this.applyGeometry(mesh, { attributes });
        mesh.userData.presentationTime = packet.time;
        mesh.visible = this.enabled && attributes.index.length > 0;
      }
      for (const [key, mesh] of this.directMeshes) {
        if (active.has(key)) continue;
        mesh.geometry.dispose();
        this.group.remove(mesh);
        this.meshes.delete(mesh);
        this.directMeshes.delete(key);
      }
      const visibleDraws = packet.draws
        .filter(
          (d) => !this.navigation?.loaderOnly || !navKeys.has(d.materialKey),
        )
        .filter((d) =>
          d.primitive === "static-mesh"
            ? d.particleCount > 0
            : d.indices.length > 0,
        );
      this.stats = {
        visibleParticles: visibleDraws.reduce((n, d) => n + d.particleCount, 0),
        visibleQuads: visibleDraws.reduce(
          (n, d) =>
            n +
            (["camera-trail", "static-mesh"].includes(d.primitive)
              ? 0
              : d.particleCount),
          0,
        ),
        visibleTrailPoints: visibleDraws.reduce(
          (n, d) => n + (d.primitive === "camera-trail" ? d.particleCount : 0),
          0,
        ),
        visibleMeshParticles: visibleDraws.reduce(
          (n, d) => n + (d.primitive === "static-mesh" ? d.particleCount : 0),
          0,
        ),
        visibleRayParticles: visibleDraws.reduce(
          (n, d) => n + (d.primitive === "ray" ? d.particleCount : 0),
          0,
        ),
        visibleEffectInstances: new Set(
          visibleDraws.map((d) => `${d.sourceEventId}:${d.generation}`),
        ).size,
        // Draw packets do not establish missile-origin ownership.
        visibleMissiles: null,
      };
    };
    this.pendingCombat = null;
    if (this.navGroundRenderer && !this.navigation.loaderOnly) {
      this.pendingCombat = { packet, navStaged, commit, metrics };
    } else {
      commit();
      this.group.visible = priorVisibility;
      metrics.geometryUploadPreparationMs = performance.now() - started;
      if (this.navigation?.loaderOnly)
        metrics.navigationSubmission = "loader-only-no-gpu-completion";
    }
  }
  submitStagedDirect() {
    const p = this.pendingCombat;
    if (!p) return;
    this.pendingCombat = null;
    try {
      const navStarted = performance.now();
      const binding = p.navStaged.pending.length
        ? this.navigation.provider.renderAtSync(p.packet.time)
        : null;
      p.metrics.navPrepassCpuMs = performance.now() - navStarted;
      const commitStarted = performance.now();
      // Publishing any nav binding follows all five successful GPU draws.
      // Non-nav meshes are committed in the same transaction before world render.
      if (p.navStaged.pending.length)
        this.navGroundRenderer.commit(p.navStaged, binding, this.enabled);
      else this.navGroundRenderer.commitEmpty();
      p.commit();
      this.group.visible = this.enabled;
      this.navGroundRenderer.group.visible = this.enabled;
      p.metrics.deferredCombatCommitMs = performance.now() - commitStarted;
    } catch (error) {
      // A reused target/seek failure must never allow a later world-only redraw
      // to sample old combat bindings. A new valid packet reopens the group.
      this.group.visible = false;
      throw error;
    }
  }
  submissionCoverage() {
    return {
      submittedInstances: this.submitted.size,
      distinctSubmittedDefinitions: new Set(
        [...this.submitted.values()].map((e) => e.definitionId),
      ).size,
      visiblePixelVerified: false,
      complete: null,
      rows: [...this.submitted].map(([id, e]) => ({
        id,
        ...e,
        emitters: [...e.emitters],
      })),
    };
  }
  dispose() {
    this.pendingCombat = null;
    this.navGroundRenderer?.dispose();
    this.navGroundRenderer = null;
    this.navigation?.provider?.dispose();
    this.navigation = null;
    this.staticMeshRenderer?.dispose();
    this.staticMeshRenderer = null;
    this.rayRenderer?.dispose();
    this.rayRenderer = null;
    super.dispose();
    this.directMeshes.clear();
    this.directOwnership.clear();
    this.submitted.clear();
  }
}
