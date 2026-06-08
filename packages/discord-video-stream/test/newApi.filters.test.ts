import { describe, expect, test } from "bun:test";
import { buildVideoFilterChain, prepareStream } from "../src/media/newApi.ts";

describe("buildVideoFilterChain", () => {
  test("scale only when no extra or encoder filters", () => {
    expect(buildVideoFilterChain("scale=1280:720", [], [])).toEqual([
      "scale=1280:720",
    ]);
  });

  test("appends caller videoFilters after scale (e.g. burned subtitles)", () => {
    expect(
      buildVideoFilterChain("scale=1280:720", ["subtitles='/tmp/s.srt'"], []),
    ).toEqual(["scale=1280:720", "subtitles='/tmp/s.srt'"]);
  });

  test("ordering: scale → caller filters → encoder out filters", () => {
    expect(
      buildVideoFilterChain(
        "scale=1920:1080",
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

  test("works with a GPU scale filter as the base", () => {
    expect(
      buildVideoFilterChain(
        "scale_vaapi=w=1280:h=720:format=nv12",
        ["subtitles='/tmp/s.srt'"],
        [],
      ),
    ).toEqual([
      "scale_vaapi=w=1280:h=720:format=nv12",
      "subtitles='/tmp/s.srt'",
    ]);
  });

  test("drops empty filter entries so the -vf spec has no stray commas", () => {
    expect(
      buildVideoFilterChain("scale=1280:720", ["", "subtitles='x'"], ["", ""]),
    ).toEqual(["scale=1280:720", "subtitles='x'"]);
  });
});

describe("prepareStream videoFilters + noTranscoding guard", () => {
  test("throws instead of silently dropping videoFilters when noTranscoding is set", () => {
    expect(() =>
      prepareStream("input.mkv", {
        noTranscoding: true,
        videoFilters: ["subtitles='/tmp/x.srt'"],
      }),
    ).toThrow(/noTranscoding/);
  });
});
