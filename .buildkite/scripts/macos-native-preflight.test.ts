import { describe, expect, test } from "bun:test";
import {
  appleDevelopmentIdentities,
  availableDiskKib,
  parseNativeSuite,
} from "./macos-native-preflight.ts";

describe("native macOS suite parsing", () => {
  test("accepts only the two supported suites", () => {
    expect(parseNativeSuite("quotabar")).toBe("quotabar");
    expect(parseNativeSuite("tasknotes")).toBe("tasknotes");
    expect(() => parseNativeSuite("ios")).toThrow("quotabar|tasknotes");
  });
});

describe("Apple Development identity parsing", () => {
  test("returns only valid Apple Development fingerprints", () => {
    const output = `
  1) 0123456789abcdef0123456789abcdef01234567 "Apple Development: CI (TEAM123456)"
  2) 89ABCDEF0123456789ABCDEF0123456789ABCDEF "Developer ID Application: Release (TEAM123456)"
     2 valid identities found
`;
    expect(appleDevelopmentIdentities(output)).toEqual([
      "0123456789ABCDEF0123456789ABCDEF01234567",
    ]);
  });

  test("keeps ambiguity visible to the caller", () => {
    const output = `
  1) 0123456789ABCDEF0123456789ABCDEF01234567 "Apple Development: CI A (TEAM123456)"
  2) 89ABCDEF0123456789ABCDEF0123456789ABCDEF "Apple Development: CI B (TEAM123456)"
`;
    expect(appleDevelopmentIdentities(output)).toHaveLength(2);
  });
});

test("parses the available KiB column from BSD df output", () => {
  expect(
    availableDiskKib(`Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/disk3s1 971298980 623382748 318260292 67% /System/Volumes/Data`),
  ).toBe(318_260_292);
});
