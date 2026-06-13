import { describe, expect, test } from "bun:test";
import { prepareStream } from "../src/media/newApi.ts";

// Graph construction itself (scale/tonemap/subtitle ordering, GPU overlay branches, PTS
// compensation) is covered exhaustively in videoGraph.test.ts against the pure builders. These
// tests guard prepareStream's option handling around them.
describe("prepareStream subtitleBurn + noTranscoding guard", () => {
  test("throws instead of silently dropping a subtitle burn when noTranscoding is set", () => {
    expect(() =>
      prepareStream("input.mkv", {
        noTranscoding: true,
        subtitleBurn: { path: "/tmp/x.srt" },
      }),
    ).toThrow(/noTranscoding/);
  });
});
