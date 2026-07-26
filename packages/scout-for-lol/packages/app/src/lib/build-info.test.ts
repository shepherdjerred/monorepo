import { describe, expect, test } from "bun:test";
import {
  isContractMismatch,
  shortSha,
  VersionResponseSchema,
} from "#src/lib/build-info.ts";

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
