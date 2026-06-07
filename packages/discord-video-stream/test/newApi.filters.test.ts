import { describe, expect, test } from "bun:test";
import { buildVideoFilterChain } from "../src/media/newApi.ts";

describe("buildVideoFilterChain", () => {
  test("scale only when no extra or encoder filters", () => {
    expect(buildVideoFilterChain(1280, 720, [], [])).toEqual(["scale=1280:720"]);
  });

  test("appends caller videoFilters after scale (e.g. burned subtitles)", () => {
    expect(
      buildVideoFilterChain(1280, 720, ["subtitles='/tmp/s.srt'"], []),
    ).toEqual(["scale=1280:720", "subtitles='/tmp/s.srt'"]);
  });

  test("ordering: scale → caller filters → encoder out filters", () => {
    expect(
      buildVideoFilterChain(
        1920,
        1080,
        ["subtitles='/tmp/s.srt'"],
        ["format=nv12", "hwupload"],
      ),
    ).toEqual([
      "scale=1920:1080",
      "subtitles='/tmp/s.srt'",
      "format=nv12",
      "hwupload",
    ]);
  });

  test("drops empty filter entries so the -vf spec has no stray commas", () => {
    expect(buildVideoFilterChain(1280, 720, ["", "subtitles='x'"], ["", ""]))
      .toEqual(["scale=1280:720", "subtitles='x'"]);
  });

  test("negative dimensions (aspect-preserving scale) are preserved verbatim", () => {
    expect(buildVideoFilterChain(-2, -2, [], [])).toEqual(["scale=-2:-2"]);
  });
});
