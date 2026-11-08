import {
  LatestParentVfxRenderer,
  parentRenderCamera,
} from "./latest-parent-renderer.mjs";
import { LatestParentMissilePlayback } from "./latest-parent-missile-playback.mjs";

// Complete parent CPU timelines and the real shared material/mesh consumer.
export class LatestParentMissileRenderer extends LatestParentVfxRenderer {
  constructor(world, manifest, effectsManifestBytes, options = {}) {
    super(world, manifest, effectsManifestBytes, options);
    this.playbackOptions = options;
    this.frames = new WeakSet();
  }
  async load(playback) {
    if (this.playback || this.disposed)
      throw Error("Parent missile renderer must be loaded once");
    if (
      !Array.isArray(playback?.traces) ||
      playback.traces.some(
        (t) =>
          !this.manifest.definitions[t.effectId] ||
          t.effect?.definitionSha256 !==
            this.manifest.definitions[t.effectId].sha256,
      )
    )
      throw Error(
        "Parent missile effect binding differs from the matching asset manifest",
      );
    this.playback = new LatestParentMissilePlayback({
      assetBase: this.assetBase,
      ...this.playbackOptions,
    });
    try {
      await this.playback.load(playback);
      const effects = [...new Set(this.playback.owners.map((o) => o.effectId))];
      await super.load(effects);
      for (const owner of this.playback.owners)
        this.bindParent(owner.key, owner.effectId, owner.ownership);
      this.summary = this.playback.summary;
      this.gaps = this.playback.gaps;
      this.supportedSequences = new Set(this.playback.owners.map((o) => o.key));
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  supportsTrace(sequence) {
    return this.supportedSequences.has(sequence);
  }
  async prepareFrame(time, camera) {
    if (this.disposed)
      throw new DOMException("Parent renderer disposed", "AbortError");
    if (!this.ready) throw Error("Parent renderer is not ready");
    let frame;
    if (!this.enabled) frame = { time, disabled: true };
    else {
      const { view, rows } = parentRenderCamera(camera, this.world),
        key = JSON.stringify([time, view, rows]);
      if (key === this.lastFrameKey) return this.lastFrame;
      const packet = await this.playback.frame(time, view);
      frame = { time, key, rows, stage: this.stageFrame(packet) };
    }
    this.frames.add(frame);
    return frame;
  }
  commitFrame(frame) {
    if (this.disposed || !this.frames.has(frame))
      throw Error("Unowned or disposed parent missile presentation");
    if (frame.disabled) {
      for (const mesh of this.meshes.values()) mesh.visible = false;
      this.stats = {
        visibleParticles: 0,
        visibleQuads: 0,
        visibleTrailPoints: 0,
        visibleMissiles: 0,
      };
      this.lastFrameKey = null;
      this.lastFrame = null;
      return;
    }
    super.commitFrame(frame.stage, frame.rows);
    this.lastFrameKey = frame.key;
    this.lastFrame = frame;
  }
  dispose() {
    this.playback?.close();
    super.dispose();
  }
}
