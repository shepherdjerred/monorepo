import { expect, test } from "vitest";
import { videoCompatibility } from "./video-compatibility.ts";

test("requires a signaled compatible Dolby Vision base layer rather than a filename guess", () => {
  expect(videoCompatibility([])).toBe("compatible");
  expect(
    videoCompatibility([{ side_data_type: "Mastering display metadata" }]),
  ).toBe("compatible");
  expect(
    videoCompatibility([
      { dv_profile: 5, bl_present_flag: 1, dv_bl_signal_compatibility_id: 0 },
    ]),
  ).toBe("incompatible");
  expect(
    videoCompatibility([
      { dv_profile: 8, bl_present_flag: 1, dv_bl_signal_compatibility_id: 1 },
    ]),
  ).toBe("compatible");
  expect(videoCompatibility([{ dv_profile: 8 }])).toBe("unknown");
  expect(
    videoCompatibility([
      { dv_profile: 8, bl_present_flag: 0, dv_bl_signal_compatibility_id: 1 },
    ]),
  ).toBe("incompatible");
});
