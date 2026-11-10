import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { hardenCodexLauncher } from "./harden-codex-launcher.ts";

const owned: string[] = [];
afterEach(async () => {
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
