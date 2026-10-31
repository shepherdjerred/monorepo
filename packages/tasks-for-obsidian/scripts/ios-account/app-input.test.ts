import { mkdtemp, realpath, rm, writeFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { inputBundle } from "./app-input-artifacts";

const roots: string[] = [];
async function fixture() {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "facet-private-app-bundle-")),
  );
  roots.push(root);
  await writeFile(path.join(root, "Launcher"), "synthetic launcher", {
    mode: 0o600,
  });
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true });
});

test("bundle ownership binds changed Debug dylib bytes even when the launcher stub is unchanged", async () => {
  const root = await fixture();
  await writeFile(
    path.join(root, "App.debug.dylib"),
    "synthetic original code",
    { mode: 0o600 },
  );
  const before = await inputBundle(root);
  await writeFile(
    path.join(root, "App.debug.dylib"),
    "synthetic different code",
    { mode: 0o600 },
  );
  const after = await inputBundle(root);
  expect(after["Launcher"]).toBe(before["Launcher"]);
  expect(after["App.debug.dylib"]).not.toBe(before["App.debug.dylib"]);
});

test("private bundle checks reject external symlinks rather than fingerprinting their target", async () => {
  const root = await fixture(),
    outside = await fixture();
  await symlink(
    path.join(outside, "Launcher"),
    path.join(root, "App.debug.dylib"),
  );
  await expect(inputBundle(root)).rejects.toThrow("ownership changed");
});
