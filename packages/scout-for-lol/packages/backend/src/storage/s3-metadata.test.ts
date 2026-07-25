import { describe, expect, test } from "bun:test";
import {
  getTrackedPlayerCount,
  trackedPlayerCountMetadata,
  validateS3Metadata,
} from "#src/storage/s3-metadata.ts";

describe("trackedPlayerCountMetadata", () => {
  test("stores only an ASCII count for Unicode aliases", () => {
    expect(
      trackedPlayerCountMetadata(["Lord ARKΞV", "H6 Hadès", "玩家一"]),
    ).toEqual({
      trackedPlayerCount: "3",
    });
  });

  test("stores zero for an empty alias list", () => {
    expect(trackedPlayerCountMetadata([])).toEqual({
      trackedPlayerCount: "0",
    });
  });
});

describe("getTrackedPlayerCount", () => {
  test("reads the new count metadata", () => {
    expect(getTrackedPlayerCount(new Map([["trackedplayercount", "2"]]))).toBe(
      2,
    );
  });

  test("prefers the new count over legacy aliases", () => {
    expect(
      getTrackedPlayerCount(
        new Map([
          ["trackedplayercount", "1"],
          ["trackedplayers", "One, Two"],
        ]),
      ),
    ).toBe(1);
  });

  test("counts legacy comma-separated aliases", () => {
    expect(
      getTrackedPlayerCount(
        new Map([["trackedplayers", "Lord ARKΞV, H6 Hadès"]]),
      ),
    ).toBe(2);
  });

  test("returns zero when neither metadata field is present", () => {
    expect(getTrackedPlayerCount(new Map())).toBe(0);
  });

  test("rejects a malformed new count instead of using legacy metadata", () => {
    expect(() =>
      getTrackedPlayerCount(
        new Map([
          ["trackedplayercount", "two"],
          ["trackedplayers", "One, Two"],
        ]),
      ),
    ).toThrow("Tracked player count must be a decimal integer");
  });
});

describe("validateS3Metadata", () => {
  test("accepts printable ASCII keys and values", () => {
    const metadata = {
      matchId: "NA1_1234567890",
      trackedPlayerCount: "2",
    };

    expect(validateS3Metadata(metadata)).toEqual(metadata);
  });

  test.each(["Lord ARKΞV", "H6 Hadès", "line\nbreak"])(
    "rejects non-printable-ASCII value %s",
    (value) => {
      expect(() => validateS3Metadata({ trackedPlayers: value })).toThrow(
        "S3 metadata must contain printable ASCII only",
      );
    },
  );
});
