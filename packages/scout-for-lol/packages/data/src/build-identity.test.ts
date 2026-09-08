import { describe, expect, test } from "vitest";
import { DEV_PLACEHOLDER, scoutReleaseVersion } from "#src/build-identity.ts";

describe("scoutReleaseVersion", () => {
  test("passes through canonical 2.0.0-<build> versions", () => {
    expect(scoutReleaseVersion("2.0.0-14999")).toBe("2.0.0-14999");
  });

  test("lifts a raw bake number to 2.0.0-<build>", () => {
    expect(scoutReleaseVersion("14999")).toBe("2.0.0-14999");
  });

  test("leaves the dev placeholder alone", () => {
    expect(scoutReleaseVersion(DEV_PLACEHOLDER)).toBe(DEV_PLACEHOLDER);
  });

  test("does not rewrite archive digests or other identities", () => {
    expect(
      scoutReleaseVersion(
        "scout-site@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ),
    ).toBe(
      "scout-site@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });
});
