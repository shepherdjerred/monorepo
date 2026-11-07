// Complete camera/arbitrary quad admission, including continuous emission and
// native random lifetimes. No field projection or synthetic random samples.
import { createLatestVfxBoundQuads } from "./latest-vfx-bound-quads.mjs";
import { createLatestVfxControl } from "./latest-vfx-control.mjs";
import {
  createLatestParticlePlayback,
  PARTICLE_CONTROL_SHA,
} from "./latest-particle-playback.mjs";

export async function createLatestQuadPlayback(options) {
  const {
      uc,
      profile,
      image,
      spawnBytes,
      emitterBytes,
      boundBytes,
      postloadBytes,
      controlBytes,
      loadGraphBytes,
      math,
      captureEvidence = false,
    } = options,
    meta = JSON.parse(new TextDecoder().decode(boundBytes));
  if (typeof loadGraphBytes !== "function" || !meta.templates?.length)
    throw Error("Quad playback requires its complete graph loader");
  const runtime = await createLatestVfxBoundQuads(
      uc,
      profile,
      image,
      spawnBytes,
      emitterBytes,
      postloadBytes,
      boundBytes,
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
