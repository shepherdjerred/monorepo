import { expect, test } from "vitest";
import {
  cmakeConfigureArgs,
  devInstallManifest,
  parseSpaghettiUpstream,
  spaghettiBinaryPath,
} from "./spaghetti.ts";

test("pins an immutable commit and the supported ROM identity", async () => {
  const root = import.meta.dir.replace(/\/scripts$/, "");
  const upstream = parseSpaghettiUpstream(
    await Bun.file(`${root}/spaghetti-src/upstream.json`).json(),
  );
  expect(upstream.submodules).toEqual(["libultraship", "torch"]);
  expect(() => parseSpaghettiUpstream({ ...upstream, commit: "main" })).toThrow(
    "Invalid",
  );
});

test("finds the binary inside the macOS bundle and beside the build elsewhere", () => {
  expect(spaghettiBinaryPath("/b", "darwin")).toBe(
    "/b/SpaghettiKart.app/Contents/MacOS/SpaghettiKart",
  );
  expect(spaghettiBinaryPath("/b", "linux")).toBe("/b/Spaghettify");
});

test("uses vcpkg dependencies only on macOS", () => {
  expect(cmakeConfigureArgs("/s", "/b", "darwin")).toContain(
    "-DENABLE_VCPKG=ON",
  );
  expect(cmakeConfigureArgs("/s", "/b", "linux")).toContain(
    "-DENABLE_VCPKG=OFF",
  );
});

test("describes a local build as an install the backend can load", () => {
  const upstream = {
    repository: "https://example.com/r.git",
    branch: "main",
    commit: "a".repeat(40),
    submodules: ["libultraship"],
    romSha1: "b".repeat(40),
  };
  expect(devInstallManifest(upstream, "/s", "/s/build", "linux")).toEqual({
    binary: "/s/build/Spaghettify",
    engineArchive: "/s/build/spaghetti.o2r",
    torch: "/s/build/TorchExternal/src/TorchExternal-build/torch",
    torchInputs: "/s",
    commit: "a".repeat(40),
    romSha1: "b".repeat(40),
  });
});
