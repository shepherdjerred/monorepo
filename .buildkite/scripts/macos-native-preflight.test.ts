import { describe, expect, test } from "vitest";
import {
  appleDevelopmentIdentities,
  availableDiskKib,
  parseNativeSuite,
  pinnedToolVersion,
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

describe("pinned toolchain versions", () => {
  test("reads the repository's own .mise.toml pins", async () => {
    const miseToml = await Bun.file(
      new URL("../../.mise.toml", import.meta.url),
    ).text();
    expect(pinnedToolVersion(miseToml, "bun")).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(pinnedToolVersion(miseToml, "rust")).toMatch(/^\d+\.\d+\.\d+$/u);
  });

  test("rejects a tool the pin file does not carry as a version string", () => {
    const miseToml = `[tools]\nbun = "1.2.3"\n"cargo:example" = { version = "1" }\n`;
    expect(pinnedToolVersion(miseToml, "bun")).toBe("1.2.3");
    expect(() => pinnedToolVersion(miseToml, "rust")).toThrow(
      "does not pin rust",
    );
    expect(() => pinnedToolVersion(miseToml, "cargo:example")).toThrow(
      "does not pin cargo:example",
    );
    expect(() => pinnedToolVersion(`bun = "1.2.3"\n`, "bun")).toThrow(
      "no [tools] table",
    );
  });
});

test("parses the available KiB column from BSD df output", () => {
  expect(
    availableDiskKib(`Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/disk3s1 971298980 623382748 318260292 67% /System/Volumes/Data`),
  ).toBe(318_260_292);
});
