import fs, { constants, type FileHandle } from "node:fs/promises";
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
    const metadata = await fs.lstat(ancestor);
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
      await fs.readFile(
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

async function assertProtectedParents(
  target: string,
  store: string,
  owner: number,
) {
  for (
    let ancestor = path.dirname(target);
    ;
    ancestor = path.dirname(ancestor)
  ) {
    const entry = await fs.lstat(ancestor);
    if (
      !entry.isDirectory() ||
      entry.uid !== owner ||
      (entry.mode & 0o022) !== 0
    ) {
      throw new Error("Codex launcher installation ancestor is mutable");
    }
    if (ancestor === store) break;
  }
  if (owner === 0) await assertOwnedAncestors(target, owner);
}

async function descriptorContents(handle: FileHandle) {
  const metadata = await handle.stat();
  const contents = Buffer.alloc(metadata.size);
  let offset = 0;
  while (offset < contents.length) {
    const { bytesRead } = await handle.read(
      contents,
      offset,
      contents.length - offset,
      offset,
    );
    if (bytesRead === 0)
      throw new Error("Codex launcher changed while reading");
    offset += bytesRead;
  }
  const after = await handle.stat();
  if (after.size !== contents.length) {
    throw new Error("Codex launcher changed while reading");
  }
  return contents;
}

async function assertHardenedLauncher(
  handle: FileHandle,
  target: string,
  baseline: {
    metadata: Awaited<ReturnType<FileHandle["stat"]>>;
    owner: number;
    contents: Buffer;
  },
) {
  const { metadata, owner, contents } = baseline;
  const after = await handle.stat();
  const current = await fs.lstat(target);
  if (
    !after.isFile() ||
    !current.isFile() ||
    after.uid !== owner ||
    current.uid !== owner ||
    after.dev !== metadata.dev ||
    after.ino !== metadata.ino ||
    current.dev !== after.dev ||
    current.ino !== after.ino ||
    (after.mode & 0o7777) !== 0o755 ||
    (current.mode & 0o7777) !== 0o755 ||
    !contents.equals(await descriptorContents(handle)) ||
    !contents.equals(await fs.readFile(target))
  ) {
    throw new Error("Codex launcher permission hardening failed verification");
  }
}

/** Only the declared Codex CLI bin inside this install store may be hardened. */
export async function hardenCodexLauncher(filename: string, store: string) {
  if (!path.isAbsolute(filename) || !path.isAbsolute(store)) {
    throw new TypeError("Codex launcher and install store must be absolute");
  }
  const canonicalStore = await fs.realpath(store);
  const target = await fs.realpath(filename);
  assertStoreContains(canonicalStore, target);
  await assertDeclaredLauncher(target);
  const owner = process.getuid?.();
  if (owner === undefined)
    throw new Error("Codex launcher builder identity is unavailable");
  await assertProtectedParents(target, canonicalStore, owner);
  const entry = await fs.lstat(target);
  if (!entry.isFile() || entry.uid !== owner) {
    throw new Error("Codex CLI launcher is not a regular builder-owned file");
  }

  // Writable open performs overlay copy-up before taking the identity baseline.
  // Chmod alone can replace a hard-linked lower-layer inode. Anchor all later
  // operations to this descriptor; do not follow a replacement symlink.
  const handle = await fs.open(target, constants.O_RDWR | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.uid !== owner) {
      throw new Error("Codex CLI launcher is not a regular builder-owned file");
    }
    const contents = await descriptorContents(handle);
    await handle.chmod(0o755);
    await assertHardenedLauncher(handle, target, { metadata, owner, contents });
    if (
      (await fs.realpath(filename)) !== target ||
      (await fs.realpath(store)) !== canonicalStore
    ) {
      throw new Error(
        "Codex launcher permission hardening failed verification",
      );
    }
    assertStoreContains(canonicalStore, target);
    await assertDeclaredLauncher(target);
    await assertProtectedParents(target, canonicalStore, owner);
  } finally {
    await handle.close();
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
