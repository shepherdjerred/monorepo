// Complete native quad pools use the shared preview lifecycle. Parent activation,
// replay seed and cadence remain supplied, as for the existing trail compositor.
import { createLatestVfxBoundQuads } from "./latest-vfx-bound-quads.mjs";
import { createLatestVfxControl } from "./latest-vfx-control.mjs";
import {
  createLatestParticlePlayback,
  PARTICLE_CONTROL_SHA,
} from "./latest-particle-playback.mjs";

export async function createLatestQuadPoolPlayback(options) {
  const {
    uc,
    profile,
    image,
    spawnBytes,
    emitterBytes,
    postloadBytes,
    packageBytes,
    controlBytes,
    loadGraphBytes,
    math,
    captureEvidence = false,
  } = options;
  const meta = JSON.parse(new TextDecoder().decode(packageBytes));
  if (typeof loadGraphBytes !== "function" || !meta.templates?.length)
    throw Error("Quad pool playback requires prepared native graphs");
  const runtime = await createLatestVfxBoundQuads(
    uc,
    profile,
    image,
    spawnBytes,
    emitterBytes,
    postloadBytes,
    packageBytes,
    await loadGraphBytes(meta.templates[0].file),
    math,
  );
  const control = await createLatestVfxControl(
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
