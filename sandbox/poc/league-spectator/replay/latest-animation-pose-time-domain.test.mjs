import { expect, test } from "bun:test";
import {
  compileAnimationPoseTimeDomain,
  validateAnimationPoseTimeDomain,
  sampleDualClockAnimationPoseFrame,
} from "./latest-animation-pose-time-domain.mjs";
const f = Math.fround;
function source(fps = 30) {
  return {
    resourceKind: "uncompressed",
    resourceVersion: 3,
    exportedFps: fps,
    source: { headerSha256: "1".repeat(64) },
    clock: { resourceFps: f(1 / f(1 / f(fps))) },
  };
}
test("legacy authored FPS and native reciprocal tick retain distinct exact clocks", () => {
  const reference = source(),
    clip = {
      fps: 30,
      poseTimeDomain: compileAnimationPoseTimeDomain(reference, 30),
    };
  expect(clip.poseTimeDomain.nativeResourceFps).toBe(29.999998092651367);
  expect(clip.poseTimeDomain.toolkitSampleFps).toBe(30);
  validateAnimationPoseTimeDomain(reference, clip);
  for (const time of [
    -1e-7,
    0,
    f(1 / 30) - 1e-7,
    f(1 / 30),
    f(1 / 30) + 1e-7,
    1.9,
  ])
    expect(sampleDualClockAnimationPoseFrame(f(time), clip)).toBe(
      f(f(time) * 30),
    );
});
test("matching clocks preserve old catalog data and unsupported relationships fail explicitly", () => {
  const same = { ...source(), clock: { resourceFps: 30 } };
  expect(compileAnimationPoseTimeDomain(same, 30)).toBeNull();
  validateAnimationPoseTimeDomain(same, { fps: 30 });
  for (const mutate of [
    (r) => (r.resourceVersion = 4),
    (r) => (r.clock.resourceFps = 29),
    (r) => (r.exportedFps = 31),
  ]) {
    const reference = source();
    mutate(reference);
    expect(() => compileAnimationPoseTimeDomain(reference, 30)).toThrow(
      "Unsupported",
    );
  }
  expect(() => validateAnimationPoseTimeDomain(source(), { fps: 30 })).toThrow(
    "declaration differs",
  );
  expect(() =>
    validateAnimationPoseTimeDomain(same, { fps: 30, poseTimeDomain: {} }),
  ).toThrow("Unexpected");
});
