import { expect, test } from "vitest";
import {
  TOOLKIT_BUILD_INPUT_PATHS,
  buildDefineFlags,
  buildSteps,
  codesignArgv,
  computeInputTreeDigest,
  developerIdIdentity,
  installPaths,
  installPlatform,
  resolveToolkitBuildStamp,
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

test("embeds compile-time commit, input digest, and timestamp defines", () => {
  expect(buildDefineFlags()).toEqual([]);
  expect(TOOLKIT_BUILD_INPUT_PATHS).toContain("packages/toolkit");
  expect(TOOLKIT_BUILD_INPUT_PATHS).toContain("packages/ops-model");
  expect(TOOLKIT_BUILD_INPUT_PATHS).toContain("packages/mc-harness");

  const digest = computeInputTreeDigest(
    "040000 tree abc123\tpackages/toolkit\n",
  );
  expect(digest).toMatch(/^[0-9a-f]{64}$/u);

  const stamp = {
    commit: "1111111111111111111111111111111111111111",
    inputDigest: digest,
    builtAt: "2026-11-24T17:00:00.000Z",
  };
  const darwinSteps = buildSteps("/Users/test", "darwin", stamp);
  expect(darwinSteps[0]?.argv).toEqual([
    "bun",
    "build",
    "./src/index.ts",
    "--compile",
    "--define",
    'TOOLKIT_BUILD_COMMIT="1111111111111111111111111111111111111111"',
    "--define",
    `TOOLKIT_BUILD_INPUT_DIGEST=${JSON.stringify(digest)}`,
    "--define",
    'TOOLKIT_BUILT_AT="2026-11-24T17:00:00.000Z"',
    "--external",
    "ffmpeg-static",
    "--outfile=dist/toolkit",
  ]);
  const winSteps = buildSteps(String.raw`C:\Users\Test`, "win32", stamp);
  expect(winSteps[0]?.argv).toContain(
    'TOOLKIT_BUILD_COMMIT="1111111111111111111111111111111111111111"',
  );
});

test("resolves live git build stamp from checkout and returns null on git failures", () => {
  const fixedNow = new Date("2026-11-24T18:00:00.000Z");
  const liveStamp = resolveToolkitBuildStamp(import.meta.dir, {
    now: fixedNow,
  });
  expect(liveStamp).not.toBeNull();
  expect(liveStamp?.commit).toMatch(/^[0-9a-f]{40}$/u);
  expect(liveStamp?.inputDigest).toMatch(/^[0-9a-f]{64}$/u);
  expect(liveStamp?.builtAt).toBe("2026-11-24T18:00:00.000Z");

  expect(
    resolveToolkitBuildStamp("/nonexistent", {
      runGit: () => ({ exitCode: 128, stdout: "" }),
    }),
  ).toBeNull();
  expect(
    resolveToolkitBuildStamp("/repo", {
      runGit: (args) =>
        args[1] === "--show-toplevel"
          ? { exitCode: 0, stdout: "/repo\n" }
          : { exitCode: 128, stdout: "" },
    }),
  ).toBeNull();
  expect(
    resolveToolkitBuildStamp("/repo", {
      runGit: (args) => {
        if (args[1] === "--show-toplevel") {
          return { exitCode: 0, stdout: "/repo\n" };
        }
        return args[0] === "rev-parse"
          ? { exitCode: 0, stdout: "deadbeef\n" }
          : { exitCode: 1, stdout: "" };
      },
    }),
  ).toBeNull();
});
