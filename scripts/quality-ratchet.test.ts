import { describe, expect, test } from "bun:test";
import { QUALITY_RATCHET_EXCLUDED_DIRECTORIES } from "./quality-ratchet.ts";

describe("quality ratchet search scope", () => {
  test("excludes generated dependency and build output directories", () => {
    expect(QUALITY_RATCHET_EXCLUDED_DIRECTORIES).toEqual([
      "node_modules",
      "dist",
      "archive",
      "discord-video-stream",
      "target",
    ]);
  });
});
