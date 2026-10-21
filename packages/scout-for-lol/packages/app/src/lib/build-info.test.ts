import { describe, expect, test } from "vitest";
import {
  buildInfo,
  isContractMismatch,
  shortArchiveIdentity,
  shortSha,
  VersionResponseSchema,
} from "#src/lib/build-info.ts";

describe("buildInfo", () => {
  test("carries only the content-derived identity, never a baked version", () => {
    expect(Object.keys(buildInfo).sort()).toEqual(["contractHash", "release"]);
    // Outside a site-release build both are absent / the dev placeholder.
    expect(buildInfo.release).toBeUndefined();
    expect(buildInfo.contractHash).toBe("dev");
  });
});

describe("shortArchiveIdentity", () => {
  test("shortens the archive digest to twelve hex characters", () => {
    expect(
      shortArchiveIdentity(`scout-site@sha256:${"0123456789abcdef".repeat(4)}`),
    ).toBe("scout-site@sha256:0123456789ab");
  });

  test("reports none outside a release build", () => {
    expect(shortArchiveIdentity(undefined)).toBe("none");
  });

  test("passes an unrecognised identity through unchanged", () => {
    expect(shortArchiveIdentity("custom-release")).toBe("custom-release");
  });
});

describe("isContractMismatch", () => {
  test("differing real hashes mismatch", () => {
    expect(isContractMismatch("aaaa1111", "bbbb2222")).toBe(true);
  });

  test("equal real hashes match", () => {
    expect(isContractMismatch("aaaa1111", "aaaa1111")).toBe(false);
  });

  test("dev placeholder on either side disables the check", () => {
    expect(isContractMismatch("dev", "bbbb2222")).toBe(false);
    expect(isContractMismatch("aaaa1111", "dev")).toBe(false);
    expect(isContractMismatch("dev", "dev")).toBe(false);
  });

  test("empty hash on either side disables the check", () => {
    expect(isContractMismatch("", "bbbb2222")).toBe(false);
    expect(isContractMismatch("aaaa1111", "")).toBe(false);
  });
});

describe("shortSha", () => {
  test("truncates long SHAs to 7 chars", () => {
    expect(shortSha("abcdef1234567890")).toBe("abcdef1");
  });

  test("passes short strings through", () => {
    expect(shortSha("dev")).toBe("dev");
  });
});

describe("VersionResponseSchema", () => {
  test("accepts the /api/version shape", () => {
    expect(
      VersionResponseSchema.parse({
        version: "2.0.0-6017",
        gitSha: "abcdef1234567890",
        contractHash: "cafebabe",
        canViewContractMismatch: true,
      }),
    ).toEqual({
      version: "2.0.0-6017",
      gitSha: "abcdef1234567890",
      contractHash: "cafebabe",
      canViewContractMismatch: true,
    });
  });

  test("lifts a raw bake number from an older backend image", () => {
    expect(
      VersionResponseSchema.parse({
        version: "14999",
        gitSha: "abcdef1234567890",
        contractHash: "cafebabe",
        canViewContractMismatch: true,
      }),
    ).toMatchObject({ version: "2.0.0-14999" });
  });

  test("rejects a payload missing the hash", () => {
    expect(
      VersionResponseSchema.safeParse({
        version: "2.0.0-6017",
        gitSha: "abcdef1234567890",
      }).success,
    ).toBe(false);
  });

  test("defaults the owner diagnostic off for older backends", () => {
    expect(
      VersionResponseSchema.parse({
        version: "2.0.0-6017",
        gitSha: "abcdef1234567890",
        contractHash: "cafebabe",
      }),
    ).toEqual({
      version: "2.0.0-6017",
      gitSha: "abcdef1234567890",
      contractHash: "cafebabe",
      canViewContractMismatch: false,
    });
  });
});
