import { expect, test } from "vitest";
import {
  assertSupportedRom,
  cmakeConfigureArgs,
  parseSpaghettiUpstream,
  romCandidates,
  sha1,
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

test("resolves the ROM from the flag, then MK64_ROM, then Syncthing", () => {
  expect(romCandidates("/flag.z64", "/env.z64", "/home/u")).toEqual([
    "/flag.z64",
    "/env.z64",
    "/home/u/syncthing/Sync/roms/mariokart64.z64",
    "/home/u/Sync/Sync/roms/mariokart64.z64",
  ]);
  expect(romCandidates(undefined, "", "/h")).toHaveLength(2);
});

test("rejects any ROM other than the supported US image", () => {
  const digest = sha1(new TextEncoder().encode("not a rom"));
  expect(() => {
    assertSupportedRom(digest, "579c48e211ae952530ffc8738709f078d5dd215e");
  }).toThrow("not the supported Mario Kart 64");
  expect(() => {
    assertSupportedRom(digest, digest);
  }).not.toThrow();
});
