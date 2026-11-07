// Exact-build CameraTrail admission followed by the shared replay lifecycle.
import { createLatestTrailParticles } from "./latest-trail-particles.mjs";
import { createLatestVfxControl } from "./latest-vfx-control.mjs";
import {
  createLatestParticlePlayback,
  PARTICLE_CONTROL_SHA,
} from "./latest-particle-playback.mjs";
export { PARTICLE_CONTROL_SHA as TRAIL_CONTROL_SHA } from "./latest-particle-playback.mjs";

export async function createLatestTrailPlayback(options) {
  const {
      uc,
      profile,
      image,
      spawnBytes,
      emitterBytes,
      boundBytes,
      packageBytes,
      controlBytes,
      loadGraphBytes,
      math,
      captureEvidence = false,
    } = options,
    meta = JSON.parse(new TextDecoder().decode(packageBytes));
  if (typeof loadGraphBytes !== "function" || !meta.templates?.length)
    throw Error("Trail playback requires its prepared graph loader");
  const runtime = await createLatestTrailParticles(
      uc,
      profile,
      image,
      spawnBytes,
      emitterBytes,
      boundBytes,
      packageBytes,
      await loadGraphBytes(meta.templates[0].file),
      math,
    ),
    control = await createLatestVfxControl(
      runtime,
      profile,
      image,
      controlBytes,
      PARTICLE_CONTROL_SHA,
    );
  return createLatestParticlePlayback(runtime, control, meta, loadGraphBytes, {
    captureEvidence,
  });
}
