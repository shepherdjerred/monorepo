import {
  LatestTrailVfxRenderer,
  replayTrailAttributes,
} from "./latest-trail-renderer.mjs";
import { COMPLETE_QUAD_GPU_SHA } from "./latest-effect-pipeline.mjs";

const QUAD_PACKAGE_SHA =
  "f92f2b9d46bce40f4b3419eb20056150ee7fa303ec11b6c56240394669e51aee";

export class LatestQuadPoolVfxRenderer extends LatestTrailVfxRenderer {
  runtimeConfiguration() {
    return {
      kind: "quad",
      directory: "/assets/decoder-16.21-macos",
      packageUrl: "/assets/decoder-16.21-macos/vfx-bound-quads.json",
      packageSha256: QUAD_PACKAGE_SHA,
      gpuUrl: "/assets/latest-complete-quad-gpu/package.json",
      gpuSha256: COMPLETE_QUAD_GPU_SHA,
    };
  }
  validateRuntimeGpu(gpu, profile) {
    if (
      gpu.quadPackageSha256 !== QUAD_PACKAGE_SHA ||
      profile.vfxBoundQuadsSha256 !== QUAD_PACKAGE_SHA ||
      gpu.counts.emitters !== gpu.emitters.length
    )
      throw Error("Complete quad pool GPU/runtime package mismatch");
  }
  async createPlayback(options) {
    return super.createPlayback({
      ...options,
      postloadBytes: await this.checked(
        "/assets/decoder-16.21-macos/vfx-postload.json",
        options.profile.vfxPostloadSha256,
      ),
    });
  }
  decodeGeometry(geometry) {
    const attributes = replayTrailAttributes(geometry, 4096);
    if (
      attributes.a_POSITION.length % 12 ||
      attributes.index.length !== attributes.a_POSITION.length / 2
    )
      throw Error(
        "Native quad pool did not produce four vertices and six indices per particle",
      );
    return attributes;
  }
  async load(playback) {
    await super.load(playback);
    for (const trace of playback.traces) {
      if (this.definitions.has(trace.effectId)) continue;
      const ref = this.manifest.definitions[trace.effectId];
      if (!ref || ref.sha256 !== trace.effect.definitionSha256)
        throw Error("Quad pool effect definition identity differs");
      const record = JSON.parse(
        new TextDecoder().decode(await this.bytes(ref.file, ref.sha256)),
      );
      const emitters = record.definition.complexEmitterDefinitionData ?? [];
      const supported = this.bindings
        .filter((b) => b.effectId === trace.effectId)
        .map((b) => ({ index: b.emitterIndex }));
      const omitted = this.gpuDefinition.omitted
        .filter((b) => b.effectId === trace.effectId)
        .map((b) => ({
          index: b.emitterIndex,
          name: emitters[b.emitterIndex]?.emitterName,
          reasons: b.reasons,
        }));
      this.definitions.set(trace.effectId, { supported, omitted });
    }
    this.group.name = "Complete native quad pools / translated game shaders";
    this.summary.effects = this.definitions.size;
    this.summary.omittedEmitters = [...this.definitions.values()].reduce(
      (n, d) => n + d.omitted.length,
      0,
    );
  }
}
