import {
  assertDirectCompiledDataGraph,
  sameDirectCompiledData,
} from "./latest-direct-compiled-restore.mjs";
export const LEGACY_ANM_DUAL_CLOCK_POLICY =
  "legacy-anm3-native-time-to-toolkit-sample-grid-v1";
const f = Math.fround;
// The original legacy reader converts integer FPS to float32 seconds/frame;
// its loaded resource getter reciprocates that value. Toolkit retains the
// authored integer FPS. These are separate clocks, even for authored FPS30.
export function compileAnimationPoseTimeDomain(reference, sampleFps) {
  if (
    !Number.isFinite(sampleFps) ||
    sampleFps <= 0 ||
    !Number.isFinite(f(sampleFps))
  )
    throw Error("Finite prepared animation sample FPS required");
  if (Object.is(f(sampleFps), reference?.clock?.resourceFps)) return null;
  if (
    reference?.resourceKind !== "uncompressed" ||
    reference.resourceVersion !== 3 ||
    !Number.isInteger(sampleFps) ||
    sampleFps !== reference.exportedFps ||
    !/^[a-f0-9]{64}$/.test(reference.source?.headerSha256) ||
    !Object.is(f(1 / f(1 / f(sampleFps))), reference.clock?.resourceFps)
  )
    throw Error("Unsupported animation resource/sample clock relationship");
  return {
    policy: LEGACY_ANM_DUAL_CLOCK_POLICY,
    sourceKind: "uncompressed",
    sourceVersion: 3,
    sourceHeaderSha256: reference.source.headerSha256,
    nativeResourceFps: reference.clock.resourceFps,
    toolkitSampleFps: sampleFps,
  };
}
export function validateAnimationPoseTimeDomain(reference, clip) {
  const expected = compileAnimationPoseTimeDomain(reference, clip.fps);
  if (expected === null) {
    if (Object.hasOwn(clip, "poseTimeDomain"))
      throw Error(
        "Unexpected dual-clock declaration on matching animation clocks",
      );
    return;
  }
  assertDirectCompiledDataGraph(clip.poseTimeDomain);
  if (!sameDirectCompiledData(expected, clip.poseTimeDomain))
    throw Error("Prepared dual animation clock declaration differs");
}
// Presentation conversion into the explicitly prepared Toolkit sample grid.
// This does not establish original native pose interpolation/blending parity.
export function sampleDualClockAnimationPoseFrame(poseTime, clip) {
  const domain = clip.poseTimeDomain;
  if (
    !Number.isFinite(poseTime) ||
    domain?.policy !== LEGACY_ANM_DUAL_CLOCK_POLICY ||
    domain.toolkitSampleFps !== clip.fps ||
    !Object.is(domain.nativeResourceFps, f(1 / f(1 / f(clip.fps))))
  )
    throw Error("Verified dual-clock pose sample required");
  return f(poseTime * f(domain.toolkitSampleFps));
}
