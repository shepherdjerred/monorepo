import { chmod, lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected a Codex package manifest object");
  }
  return Object.fromEntries(Object.entries(value));
}

async function assertOwnedAncestors(filename: string, owner: number) {
  for (
    let ancestor = path.dirname(filename);
    ;
    ancestor = path.dirname(ancestor)
  ) {
    const metadata = await lstat(ancestor);
    const rootSticky = metadata.uid === 0 && (metadata.mode & 0o1000) !== 0;
    if (
      metadata.uid !== owner ||
      !metadata.isDirectory() ||
      (!rootSticky && (metadata.mode & 0o022) !== 0)
    ) {
      throw new Error("Codex launcher installation ancestor is mutable");
    }
    if (ancestor === path.parse(ancestor).root) break;
  }
}

function assertStoreContains(store: string, target: string) {
  const relative = path.relative(store, target);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Codex launcher resolves outside its install store");
  }
}

async function assertDeclaredLauncher(target: string) {
  const manifest = record(
    JSON.parse(
      await readFile(
        path.join(path.dirname(path.dirname(target)), "package.json"),
        "utf8",
      ),
    ),
  );
  if (
    manifest["name"] !== "@openai/codex" ||
    record(manifest["bin"])["codex"] !== "bin/codex.js" ||
    path.basename(target) !== "codex.js" ||
    path.basename(path.dirname(target)) !== "bin"
  ) {
    throw new Error(
      "Expected the installed Codex package's declared CLI launcher",
    );
  }
}

/** Only the declared Codex CLI bin inside this install store may be hardened. */
export async function hardenCodexLauncher(filename: string, store: string) {
  if (!path.isAbsolute(filename) || !path.isAbsolute(store)) {
    throw new TypeError("Codex launcher and install store must be absolute");
  }
  const canonicalStore = await realpath(store);
  const target = await realpath(filename);
  assertStoreContains(canonicalStore, target);
  await assertDeclaredLauncher(target);
  const metadata = await lstat(target);
  const owner = process.getuid?.();
  if (owner === undefined || !metadata.isFile() || metadata.uid !== owner) {
    throw new Error("Codex CLI launcher is not a regular builder-owned file");
  }
  // The image entrypoint requires root. Portable unit fixtures use their owner.
  // A user-writable bin is the one defect this producer repairs; its parents
  // must already be protected. Stop at the caller-owned store for local tests.
  for (
    let ancestor = path.dirname(target);
    ;
    ancestor = path.dirname(ancestor)
  ) {
    const entry = await lstat(ancestor);
    if (
      !entry.isDirectory() ||
      entry.uid !== owner ||
      (entry.mode & 0o022) !== 0
    ) {
      throw new Error("Codex launcher installation ancestor is mutable");
    }
    if (ancestor === canonicalStore) break;
  }
  if (owner === 0) await assertOwnedAncestors(target, owner);
  const contents = await readFile(target);
  await chmod(target, 0o755);
  const after = await lstat(target);
  if (
    after.uid !== owner ||
    after.dev !== metadata.dev ||
    after.ino !== metadata.ino ||
    (after.mode & 0o7777) !== 0o755 ||
    !contents.equals(await readFile(target))
  ) {
    throw new Error("Codex launcher permission hardening failed verification");
  }
}

if (import.meta.main) {
  const [workspace, store, ...extra] = Bun.argv.slice(2);
  if (
    workspace === undefined ||
    store === undefined ||
    extra.length > 0 ||
    process.getuid?.() !== 0
  ) {
    throw new Error(
      "usage (root image build): harden-codex-launcher.ts <workspace> <install store>",
    );
  }
  const sdk = Bun.resolveSync("@openai/codex-sdk", workspace);
  const cli = path.join(
    path.dirname(path.dirname(sdk)),
    "..",
    "codex",
    "bin",
    "codex.js",
  );
  await hardenCodexLauncher(cli, store);
  console.log("Verified root-owned Codex CLI launcher permissions 0755");
}
