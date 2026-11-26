import { createHash } from "node:crypto";
import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createZstdCompress } from "node:zlib";
import {
  withActivityHeartbeat,
  type GitSubprocessHooks,
} from "./git-backup-git.ts";

export type LfsObjectEntry = {
  readonly relPath: string;
  readonly absPath: string;
  readonly size: number;
  readonly sha256: string;
};

export type LfsInventory = {
  readonly objectCount: number;
  readonly digest: string | null;
  readonly files: readonly LfsObjectEntry[];
};

const TAR_BLOCK_BYTES = 512;
const MAX_USTAR_OCTAL_SIZE = 8_589_934_591;

async function collectRegularFiles(dirPath: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectRegularFiles(fullPath);
      results.push(...nested);
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

async function sha256FileStream(
  absPath: string,
  signal?: AbortSignal,
): Promise<string> {
  const hash = createHash("sha256");
  const reader = Bun.file(absPath).stream().getReader();
  try {
    for (;;) {
      signal?.throwIfAborted();
      const step = await reader.read();
      if (step.done) break;
      hash.update(step.value);
    }
  } finally {
    reader.releaseLock();
  }
  return hash.digest("hex");
}

export async function inspectMirrorLfsObjects(
  mirrorPath: string,
  hooks?: GitSubprocessHooks,
): Promise<LfsInventory> {
  const objectsRoot = path.join(mirrorPath, "lfs", "objects");
  const absPaths = await collectRegularFiles(objectsRoot);
  if (absPaths.length === 0) {
    return { objectCount: 0, digest: null, files: [] };
  }

  return withActivityHeartbeat(hooks, "lfs-inspect", async () => {
    const entries: LfsObjectEntry[] = [];
    for (const absPath of absPaths) {
      hooks?.cancellationSignal?.throwIfAborted();
      const fileStat = await stat(absPath);
      const sha256 = await sha256FileStream(absPath, hooks?.cancellationSignal);
      const relPath = path
        .relative(mirrorPath, absPath)
        .split(path.sep)
        .join("/");
      entries.push({ relPath, absPath, size: fileStat.size, sha256 });
    }

    const sorted = entries.toSorted((left, right) =>
      left.relPath < right.relPath ? -1 : left.relPath > right.relPath ? 1 : 0,
    );
    const digest = createHash("sha256")
      .update(
        sorted
          .map(
            (entry) => `${entry.relPath}:${entry.sha256}:${String(entry.size)}`,
          )
          .join("\n"),
        "utf8",
      )
      .digest("hex");

    return { objectCount: sorted.length, digest, files: sorted };
  });
}

function splitUstarPath(relPath: string): { name: string; prefix: string } {
  const normalized = relPath.replaceAll("\\", "/");
  if (Buffer.byteLength(normalized, "utf8") <= 100) {
    return { name: normalized, prefix: "" };
  }
  const splitIndex = normalized.lastIndexOf("/", 155);
  if (splitIndex <= 0) {
    throw new Error(`LFS archive path exceeds ustar limit: ${normalized}`);
  }
  const prefix = normalized.slice(0, splitIndex);
  const name = normalized.slice(splitIndex + 1);
  if (
    Buffer.byteLength(prefix, "utf8") > 155 ||
    Buffer.byteLength(name, "utf8") > 100
  ) {
    throw new Error(`LFS archive path exceeds ustar limit: ${normalized}`);
  }
  return { name, prefix };
}

function writeAsciiField(
  header: Buffer,
  offset: number,
  maxLength: number,
  value: string,
): void {
  header.write(value, offset, maxLength, "utf8");
}

function buildUstarHeader(relPath: string, size: number): Buffer {
  if (size < 0 || size > MAX_USTAR_OCTAL_SIZE) {
    throw new Error(
      `Unsupported LFS object size for ustar archive: ${String(size)}`,
    );
  }
  const { name, prefix } = splitUstarPath(relPath);
  const header = Buffer.alloc(TAR_BLOCK_BYTES, 0);
  writeAsciiField(header, 0, 100, name);
  writeAsciiField(header, 100, 8, "0000644\0");
  writeAsciiField(header, 108, 8, "0000000\0");
  writeAsciiField(header, 116, 8, "0000000\0");
  writeAsciiField(header, 124, 12, `${size.toString(8).padStart(11, "0")}\0`);
  writeAsciiField(header, 136, 12, "00000000000\0");
  writeAsciiField(header, 148, 8, "        ");
  writeAsciiField(header, 156, 1, "0");
  writeAsciiField(header, 257, 6, "ustar\0");
  writeAsciiField(header, 263, 2, "00");
  if (prefix !== "") {
    writeAsciiField(header, 345, 155, prefix);
  }

  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  writeAsciiField(
    header,
    148,
    8,
    `${checksum.toString(8).padStart(6, "0")}\0 `,
  );
  return header;
}

async function* streamUstarBlocks(
  inventory: LfsInventory,
  signal?: AbortSignal,
): AsyncGenerator<Buffer, void, undefined> {
  for (const entry of inventory.files) {
    signal?.throwIfAborted();
    const fileStat = await stat(entry.absPath);
    const expectedSize = fileStat.size;
    yield buildUstarHeader(entry.relPath, expectedSize);

    let bytesStreamed = 0;
    const reader = Bun.file(entry.absPath).stream().getReader();
    try {
      for (;;) {
        signal?.throwIfAborted();
        const step = await reader.read();
        if (step.done) break;
        const buf = Buffer.from(
          step.value.buffer,
          step.value.byteOffset,
          step.value.byteLength,
        );
        bytesStreamed += buf.byteLength;
        yield buf;
      }
    } finally {
      reader.releaseLock();
    }
    if (bytesStreamed !== expectedSize) {
      throw new Error(
        `LFS object size changed while streaming ${entry.relPath}: expected ${String(expectedSize)} bytes, read ${String(bytesStreamed)}`,
      );
    }

    const remainder = expectedSize % TAR_BLOCK_BYTES;
    if (remainder !== 0) {
      yield Buffer.alloc(TAR_BLOCK_BYTES - remainder, 0);
    }
  }
  yield Buffer.alloc(TAR_BLOCK_BYTES * 2, 0);
}

export async function createZstdLfsArchive(input: {
  readonly inventory: LfsInventory;
  readonly outputZstPath: string;
  readonly hooks?: GitSubprocessHooks | undefined;
}): Promise<void> {
  const signal = input.hooks?.cancellationSignal;
  await withActivityHeartbeat(input.hooks, "lfs-archive-compress", async () => {
    const outHandle = await open(input.outputZstPath, "w");
    try {
      await pipeline(
        Readable.from(streamUstarBlocks(input.inventory, signal), {
          objectMode: false,
        }),
        createZstdCompress(),
        outHandle.createWriteStream(),
        ...(signal === undefined ? [] : [{ signal }]),
      );
    } finally {
      await outHandle.close().catch(() => {
        // Closed by createWriteStream autoClose.
      });
    }
  });
}
