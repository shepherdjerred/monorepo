import { expect, test } from "vitest";
import { buildSteps, installPaths, installPlatform } from "./install-core.ts";

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
