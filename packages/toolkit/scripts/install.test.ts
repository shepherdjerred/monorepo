import { expect, test } from "vitest";
import {
  buildSteps,
  codesignArgv,
  developerIdIdentity,
  installPaths,
  installPlatform,
} from "./install-core.ts";

test("installation remains scoped below the supplied home directory", () => {
  expect(installPaths("/home/test")).toEqual({
    binary: "/home/test/.local/bin/toolkit",
    legacyBinary: "/home/test/.local/bin/tools",
    brimBinary: "/home/test/.local/bin/brim",
  });
});

test("Windows installs only brim.exe under the user profile", () => {
  expect(installPaths(String.raw`C:\Users\test`, "win32").brimBinary).toBe(
    String.raw`C:\Users\test\.local\bin\brim.exe`,
  );
  const steps = buildSteps(String.raw`C:\Users\test`, "win32");
  expect(steps).toHaveLength(1);
  expect(steps[0]?.argv).toContain("--target=bun-windows-x64");
  expect(steps[0]?.destination).toBe(
    String.raw`C:\Users\test\.local\bin\brim.exe`,
  );
});

test("macOS builds toolkit and brim", () => {
  expect(
    buildSteps("/Users/test", "darwin").map((step) => step.destination),
  ).toEqual(["/Users/test/.local/bin/toolkit", "/Users/test/.local/bin/brim"]);
});

test("unsupported platforms fail loudly", () => {
  expect(installPlatform("win32")).toBe("win32");
  expect(() => installPlatform("aix")).toThrow(/does not support/);
});

const IDENTITY_OUTPUT = `  1) 1111111111111111111111111111111111111111 "Apple Development: Jerred (AAAAAAAAAA)"
  2) 2222222222222222222222222222222222222222 "Developer ID Application: Jerred Shepherd (BBBBBBBBBB)"
     2 valid identities found`;

test("installed binaries sign with the single Developer ID identity", () => {
  expect(developerIdIdentity(IDENTITY_OUTPUT)).toBe(
    "2222222222222222222222222222222222222222",
  );
  expect(
    codesignArgv(
      "2222222222222222222222222222222222222222",
      "/Users/test/.local/bin/toolkit",
    ),
  ).toEqual([
    "codesign",
    "--force",
    "--sign",
    "2222222222222222222222222222222222222222",
    "--identifier",
    "red.sjer.toolkit",
    "--timestamp=none",
    "/Users/test/.local/bin/toolkit",
  ]);
});

test("signing fails loudly without exactly one Developer ID identity", () => {
  expect(() => developerIdIdentity("     0 valid identities found")).toThrow(
    /needs a "Developer ID Application"/,
  );
  const twice = `${IDENTITY_OUTPUT}\n  3) 3333333333333333333333333333333333333333 "Developer ID Application: Other (CCCCCCCCCC)"`;
  expect(() => developerIdIdentity(twice)).toThrow(/found 2/);
});
