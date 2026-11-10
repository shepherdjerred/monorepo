import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { hardenCodexLauncher } from "./harden-codex-launcher.ts";

const owned: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    owned
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "codex-launcher-producer-"));
  owned.push(root);
  const store = path.join(root, "store");
  const pkg = path.join(store, "codex-package");
  await mkdir(path.join(pkg, "bin"), { recursive: true, mode: 0o755 });
  await writeFile(
    path.join(pkg, "package.json"),
    JSON.stringify({ name: "@openai/codex", bin: { codex: "bin/codex.js" } }),
  );
  const launcher = path.join(pkg, "bin", "codex.js");
  await writeFile(launcher, "synthetic Codex entrypoint", { mode: 0o777 });
  await chmod(launcher, 0o777);
  return { root, store, pkg, launcher };
}

async function mode(filename: string) {
  const metadata = await lstat(filename);
  return metadata.mode & 0o7777;
}

function interceptPermissionChange(
  effect: (apply: () => Promise<void>) => Promise<void>,
) {
  const open = fs.open.bind(fs);
  vi.spyOn(fs, "open").mockImplementation(
    async (filename, flags, permissions) => {
      const handle = await open(filename, flags, permissions);
      const apply = handle.chmod.bind(handle);
      vi.spyOn(handle, "chmod").mockImplementation(async (nextPermissions) => {
        await effect(() => apply(nextPermissions));
      });
      return handle;
    },
  );
}

test("hardens only the declared installed CLI and preserves bytes, links and unrelated files", async () => {
  const { root, store, pkg, launcher } = await fixture();
  const unrelated = path.join(pkg, "unrelated");
  await writeFile(unrelated, "keep", { mode: 0o777 });
  await chmod(unrelated, 0o777);
  const link = path.join(root, "codex-link");
  await symlink(launcher, link);
  await hardenCodexLauncher(link, store);
  expect(await mode(launcher)).toBe(0o755);
  expect(await readFile(launcher, "utf8")).toBe("synthetic Codex entrypoint");
  expect(await mode(unrelated)).toBe(0o777);
  const linkMetadata = await lstat(link);
  expect(linkMetadata.isSymbolicLink()).toBe(true);
});

test("refuses a symlink escaping the install store without changing its target", async () => {
  const { root, store } = await fixture();
  const outside = path.join(root, "outside");
  await writeFile(outside, "keep", { mode: 0o777 });
  await chmod(outside, 0o777);
  const link = path.join(store, "escape");
  await symlink(outside, link);
  await expect(hardenCodexLauncher(link, store)).rejects.toThrow(
    "outside its install store",
  );
  expect(await mode(outside)).toBe(0o777);
});

test("refuses an unrelated package and mutable installation parents", async () => {
  const { store, pkg, launcher } = await fixture();
  await writeFile(
    path.join(pkg, "package.json"),
    JSON.stringify({ name: "unrelated", bin: { codex: "bin/codex.js" } }),
  );
  await expect(hardenCodexLauncher(launcher, store)).rejects.toThrow(
    "declared CLI launcher",
  );
  await writeFile(
    path.join(pkg, "package.json"),
    JSON.stringify({ name: "@openai/codex", bin: { codex: "bin/codex.js" } }),
  );
  await chmod(path.join(pkg, "bin"), 0o777);
  await expect(hardenCodexLauncher(launcher, store)).rejects.toThrow(
    "ancestor is mutable",
  );
  expect(await mode(launcher)).toBe(0o777);
});

test("accepts copy-up during writable open and anchors the new file identity", async () => {
  const { store, launcher, pkg } = await fixture();
  const before = await lstat(launcher);
  const open = fs.open.bind(fs);
  vi.spyOn(fs, "open").mockImplementation(
    async (filename, flags, permissions) => {
      const copied = path.join(pkg, "copy-up");
      await copyFile(launcher, copied);
      await chmod(copied, 0o777);
      await rename(copied, launcher);
      return open(filename, flags, permissions);
    },
  );
  await hardenCodexLauncher(launcher, store);
  const after = await lstat(launcher);
  expect(after.ino).not.toBe(before.ino);
  expect(after.mode & 0o7777).toBe(0o755);
  expect(await readFile(launcher, "utf8")).toBe("synthetic Codex entrypoint");
});

test("rejects path replacement after open and leaves the replacement unhardened", async () => {
  const { store, launcher, pkg } = await fixture();
  const original = path.join(pkg, "opened-original");
  interceptPermissionChange(async (apply) => {
    await rename(launcher, original);
    await copyFile(original, launcher);
    await chmod(launcher, 0o777);
    await apply();
  });
  await expect(hardenCodexLauncher(launcher, store)).rejects.toThrow(
    "hardening failed verification",
  );
  expect(await mode(launcher)).toBe(0o777);
  expect(await mode(original)).toBe(0o755);
});

test("rejects content changes to the same opened inode", async () => {
  const { store, launcher } = await fixture();
  const before = await lstat(launcher);
  interceptPermissionChange(async (apply) => {
    await apply();
    await writeFile(launcher, "altered launcher bytes");
  });
  await expect(hardenCodexLauncher(launcher, store)).rejects.toThrow(
    "hardening failed verification",
  );
  const after = await lstat(launcher);
  expect(after.ino).toBe(before.ino);
  expect(await mode(launcher)).toBe(0o755);
});

test("does not follow a replacement symlink when opening the canonical target", async () => {
  const { root, store, launcher } = await fixture();
  const outside = path.join(root, "outside-launcher");
  await writeFile(outside, "outside bytes");
  await chmod(outside, 0o777);
  const open = fs.open.bind(fs);
  vi.spyOn(fs, "open").mockImplementation(
    async (filename, flags, permissions) => {
      await rm(launcher);
      await symlink(outside, launcher);
      return open(filename, flags, permissions);
    },
  );
  await expect(hardenCodexLauncher(launcher, store)).rejects.toThrow();
  expect(await mode(outside)).toBe(0o777);
  expect(await readFile(outside, "utf8")).toBe("outside bytes");
});

test("revalidates installation parents after hardening", async () => {
  const { store, launcher, pkg } = await fixture();
  interceptPermissionChange(async (apply) => {
    await apply();
    await chmod(path.join(pkg, "bin"), 0o777);
  });
  await expect(hardenCodexLauncher(launcher, store)).rejects.toThrow(
    "ancestor is mutable",
  );
});
