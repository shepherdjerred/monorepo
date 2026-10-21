import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import { createTarDecoder, createTarPacker } from "modern-tar";

const MAX_ARCHIVE_BYTES = 2 * 1024 ** 3;
const MAX_ARCHIVE_FILES = 50_000;

/** Paths are literal archive-relative names, never filesystem links or URLs. */
export function staticArchivePath(value: string): string {
  if (
    value === "" ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes(":") ||
    /\p{Cc}/u.test(value) ||
    value.split("/").some((part) => ["", ".", ".."].includes(part))
  ) {
    throw new Error(`Unsafe static archive path: ${JSON.stringify(value)}`);
  }
  return value;
}

export async function staticArchiveDigest(file: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  let size = 0;
  for await (const chunk of Bun.file(file).stream()) {
    size += chunk.length;
    if (size > MAX_ARCHIVE_BYTES)
      throw new Error("Static archive exceeds the 2 GiB release limit");
    hasher.update(chunk);
  }
  return `sha256:${hasher.digest("hex")}`;
}

export async function staticArchiveFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for await (const name of new Bun.Glob("**/*").scan({
    cwd: directory,
    onlyFiles: false,
    dot: true,
    followSymlinks: false,
  })) {
    const relative = staticArchivePath(name);
    const stats = await lstat(path.join(directory, relative));
    if (stats.isDirectory()) continue;
    if (!stats.isFile())
      throw new Error(`Static archives require regular files: ${relative}`);
    files.push(relative);
    if (files.length > MAX_ARCHIVE_FILES)
      throw new Error("Static archive has too many files");
  }
  if (files.length === 0) throw new Error("Static archive source is empty");
  return files.sort();
}

/** An explicit member list: validated names, no duplicates, sorted for determinism. */
function explicitArchiveFiles(names: readonly string[]): string[] {
  const files = [...new Set(names.map((name) => staticArchivePath(name)))];
  if (files.length === 0) throw new Error("Static archive source is empty");
  if (files.length > MAX_ARCHIVE_FILES)
    throw new Error("Static archive has too many files");
  return files.sort();
}

/**
 * Standard tar, deterministic names/modes/timestamps, streamed to bounded disk.
 *
 * Without `files`, every regular file under `source` is archived by its
 * source-relative name. With `files`, exactly those source-relative names are
 * archived, which lets a producer freeze a subtree plus declared inputs under
 * repository-relative paths.
 */
export async function createStaticArchive(
  source: string,
  output: string,
  members?: readonly string[],
): Promise<{ digest: string; files: string[] }> {
  const files =
    members === undefined
      ? await staticArchiveFiles(source)
      : explicitArchiveFiles(members);
  const { readable, controller } = createTarPacker();
  await mkdir(path.dirname(output), { recursive: true });
  const writing = Bun.write(output, new Response(readable));
  try {
    for (const name of files) {
      const file = Bun.file(path.join(source, name));
      const stream = controller.add({
        name,
        size: file.size,
        type: "file",
        mode: 0o644,
        mtime: new Date(0),
        uid: 0,
        gid: 0,
      });
      await file.stream().pipeTo(stream);
    }
    controller.finalize();
    await writing;
  } catch (error) {
    controller.error(error);
    await writing.catch(() => {
      /* Preserve the originating packing error. */
    });
    throw error;
  }
  return { digest: await staticArchiveDigest(output), files };
}

/** Verify bytes before decoding; reject links, duplicates and traversal paths. */
export async function restoreStaticArchive(
  archive: string,
  destination: string,
  expectedDigest: string,
): Promise<string[]> {
  const stats = await lstat(destination);
  if (!stats.isDirectory())
    throw new Error(
      "Static restore requires an existing empty scratch directory",
    );
  const existing = await Array.fromAsync(
    new Bun.Glob("*").scan({ cwd: destination, dot: true, onlyFiles: false }),
  );
  if (existing.length > 0)
    throw new Error("Static restore destination must be empty");
  if ((await staticArchiveDigest(archive)) !== expectedDigest)
    throw new Error(
      "Static archive checksum differs from the selected artifact",
    );
  const entries = Bun.file(archive)
    .stream()
    .pipeThrough(createTarDecoder({ strict: true }));
  const seen = new Set<string>();
  let size = 0;
  for await (const entry of entries) {
    const name = staticArchivePath(entry.header.name);
    if (
      entry.header.type !== "file" ||
      (entry.header.linkname !== undefined && entry.header.linkname !== "")
    )
      throw new Error(`Static archive contains a nonregular entry: ${name}`);
    if (seen.has(name))
      throw new Error(`Static archive contains a duplicate path: ${name}`);
    seen.add(name);
    size += entry.header.size;
    if (size > MAX_ARCHIVE_BYTES || seen.size > MAX_ARCHIVE_FILES)
      throw new Error("Static archive exceeds release extraction limits");
    const target = path.join(destination, name);
    await mkdir(path.dirname(target), { recursive: true });
    await Bun.write(target, new Response(entry.body));
  }
  if (seen.size === 0) throw new Error("Static archive contains no files");
  return [...seen].sort();
}
