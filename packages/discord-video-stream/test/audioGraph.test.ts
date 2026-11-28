import { describe, expect, test } from "vitest";
import {
  buildAudioOutputStage,
  dialogDownmixFilter,
  isDialogDownmixLayout,
} from "../src/media/audioGraph.ts";

describe("dialogDownmixFilter", () => {
  // `pan` silently treats a channel the input layout lacks as silence (verified against ffmpeg
  // 7.1.5: SL on a `5.1` input measures -inf), so each layout must name the surrounds it has.
  test("names the surround pair each layout actually carries", () => {
    expect(dialogDownmixFilter("5.1")).toBe(
      "pan=stereo|FL=FC+0.707*FL+0.5*BL|FR=FC+0.707*FR+0.5*BR",
    );
    expect(dialogDownmixFilter("5.1(side)")).toBe(
      "pan=stereo|FL=FC+0.707*FL+0.5*SL|FR=FC+0.707*FR+0.5*SR",
    );
    expect(dialogDownmixFilter("7.1")).toBe(
      "pan=stereo|FL=FC+0.707*FL+0.5*SL+0.5*BL|FR=FC+0.707*FR+0.5*SR+0.5*BR",
    );
  });

  test("drops LFE from every matrix", () => {
    for (const layout of ["5.1", "5.1(side)", "7.1"] as const)
      expect(dialogDownmixFilter(layout)).not.toContain("LFE");
  });

  test("only claims the layouts it has a matrix for", () => {
    for (const layout of ["5.1", "5.1(side)", "7.1"])
      expect(isDialogDownmixLayout(layout)).toBe(true);
    for (const layout of ["stereo", "mono", "quad", "7.1(wide)", undefined])
      expect(isDialogDownmixLayout(layout)).toBe(false);
  });
});

describe("buildAudioOutputStage", () => {
  test("defaults to the legacy downmix and a lone volume filter", () => {
    expect(buildAudioOutputStage(1)).toEqual({
      channelOptions: ["-ac", "2", "-lfe_mix_level", "1"],
      filters: ["volume@internal_lib=1.0"],
    });
    expect(buildAudioOutputStage(0).filters).toEqual(["volume@internal_lib=0"]);
  });

  test("keeps the named volume filter last whatever is enabled", () => {
    const stage = buildAudioOutputStage(1.5, {
      dialogDownmix: "5.1",
      loudnessNormalization: true,
      resyncTimestamps: true,
    });
    expect(stage.channelOptions).toEqual([]);
    expect(stage.filters.at(-1)).toBe("volume@internal_lib=1.5");
  });
});
