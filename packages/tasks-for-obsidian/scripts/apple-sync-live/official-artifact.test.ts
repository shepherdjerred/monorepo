import { copyFile, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { packageRoot, PendingCheckpoint } from "./model";
import {
  readOfficialArtifact,
  validateOfficialScreenshot,
} from "./official-artifact";

const icon = path.join(
  packageRoot,
  "ios/TasksForObsidian/Images.xcassets/AppIcon.appiconset/icon-1024.png",
);
const directories: string[] = [];
async function temporary() {
  const directory = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "facet-official-artifact-")),
  );
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true });
});

test("missing official screenshot leaves the manual checkpoint pending", async () => {
  const directory = await temporary();
  await expect(
    readOfficialArtifact(directory, "create"),
  ).rejects.toBeInstanceOf(PendingCheckpoint);
});
test("retains a valid image digest without claiming its visual contents are verified", async () => {
  const directory = await temporary();
  // A committed image is a decoder fixture, never live official UI evidence.
  await copyFile(icon, path.join(directory, "edit.png"));
  const artifact = await readOfficialArtifact(directory, "edit");
  expect(artifact.width).toBe(1024);
  expect(artifact.height).toBe(1024);
  expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/u);
  expect(artifact.filename).toBe(path.join(directory, "edit.png"));
});
test("rejects substituted, corrupt and incomplete image payloads", async () => {
  const bytes = new Uint8Array(await Bun.file(icon).arrayBuffer());
  expect(() =>
    validateOfficialScreenshot(new TextEncoder().encode("placeholder")),
  ).toThrow();
  expect(() => validateOfficialScreenshot(bytes.subarray(0, 45))).toThrow();
  const changed = new Uint8Array(bytes);
  changed[40] = (changed[40] ?? 0) ^ 1;
  expect(() => validateOfficialScreenshot(changed)).toThrow("Corrupt");
});
test("rejects symlink redirection and unknown step names", async () => {
  const directory = await temporary();
  await symlink(icon, path.join(directory, "complete.png"));
  await expect(readOfficialArtifact(directory, "complete")).rejects.toThrow(
    "owned artifact",
  );
  await expect(readOfficialArtifact(directory, "../other")).rejects.toThrow(
    "Invalid official",
  );
});
