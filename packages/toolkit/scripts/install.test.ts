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

test("Windows installs native toolkit.exe and brim.exe under the user profile", () => {
  const home = String.raw`C:\Users\Test User`;
  const steps = buildSteps(home, "win32");
  expect(steps).toEqual([
    {
      argv: [
        "bun",
        "build",
        "./src/index.ts",
        "--compile",
        "--target=bun-windows-x64",
        "--external",
        "ffmpeg-static",
        "--outfile=dist/toolkit.exe",
      ],
      output: "dist/toolkit.exe",
      destination: String.raw`C:\Users\Test User\.local\bin\toolkit.exe`,
    },
    {
      argv: [
        "bun",
        "build",
        "./src/brim.ts",
        "--compile",
        "--target=bun-windows-x64",
        "--outfile=dist/brim.exe",
      ],
      output: "dist/brim.exe",
      destination: String.raw`C:\Users\Test User\.local\bin\brim.exe`,
    },
  ]);
  expect(installPaths(home, "win32").legacyBinary).toBe(
    String.raw`C:\Users\Test User\.local\bin\tools.exe`,
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
