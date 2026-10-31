import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { parseMacVMArguments } from "./run-vm.ts";
import {
  persistMacVMCaptureReady,
  readOwnedMacVMJSON,
  requireMacVMCaptureReady,
} from "../apple-acceptance/mac-vm-export.ts";

const build = "12345678-1234-1234-1234-123456789abc";
const expected = {
  payloadSHA256: "a".repeat(64),
  sourceHead: "b".repeat(40),
  installationID: build,
  bundlePath: "/owned/Runner.app",
};
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true });
});
test("prepare and exact replay are explicit mutually exclusive operations", () => {
  expect(parseMacVMArguments(["--vm", "owned", "--prepare"])).toEqual({
    vm: "owned",
    mode: "recurrence",
  });
  expect(
    parseMacVMArguments(["--vm", "owned", "--artifact-build", build]),
  ).toEqual({ vm: "owned", buildID: build, mode: "recurrence" });
  expect(
    parseMacVMArguments([
      "--vm",
      "owned",
      "--artifact-build",
      build,
      "--setup-capture",
    ]),
  ).toEqual({ vm: "owned", buildID: build, mode: "capture-readiness" });
  for (const args of [
    [],
    ["--vm", "owned"],
    ["--vm", "../foreign", "--prepare"],
    ["--vm", "owned", "--prepare", "--setup-capture"],
    ["--vm", "owned", "--artifact-build", "../foreign"],
    ["--vm", "owned", "--artifact-build", build, "--prepare"],
  ])
    expect(() => parseMacVMArguments(args)).toThrow();
});
test("readiness remains tied to an actual successful setup and exact installed epoch", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "facet-ready-contract-"));
  directories.push(directory);
  const file = path.join(directory, "ready.json");
  await persistMacVMCaptureReady(file, expected, build);
  const bytes = await readFile(file),
    before = await lstat(file);
  requireMacVMCaptureReady(await readOwnedMacVMJSON(file), expected);
  await persistMacVMCaptureReady(file, expected, crypto.randomUUID());
  expect(await readFile(file)).toEqual(bytes);
  expect((await lstat(file)).ino).toBe(before.ino);
  const receipt = JSON.parse(bytes.toString());
  for (const altered of [
    { ...receipt, status: "passed" },
    { ...receipt, installationID: crypto.randomUUID() },
    { ...receipt, payloadSHA256: "c".repeat(64) },
    { ...receipt, runID: "unknown" },
  ])
    expect(() => requireMacVMCaptureReady(altered, expected)).toThrow();
});
test("corrupt, linked, oversized or foreign-writable readiness is rejected without overwrite", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "facet-ready-negative-"));
  directories.push(directory);
  const target = path.join(directory, "target.json");
  await persistMacVMCaptureReady(target, expected, build);
  const linked = path.join(directory, "linked.json");
  await symlink(target, linked);
  await expect(
    persistMacVMCaptureReady(linked, expected, build),
  ).rejects.toThrow();
  const broken = path.join(directory, "broken.json");
  await writeFile(broken, "{", { mode: 0o600 });
  await expect(
    persistMacVMCaptureReady(broken, expected, build),
  ).rejects.toThrow();
  expect(await readFile(broken, "utf8")).toBe("{");
  const huge = path.join(directory, "huge.json");
  await writeFile(huge, "x".repeat(4097), { mode: 0o600 });
  await expect(readOwnedMacVMJSON(huge, 4096)).rejects.toThrow("bound");
  await chmod(target, 0o666);
  await expect(readOwnedMacVMJSON(target)).rejects.toThrow();
});
