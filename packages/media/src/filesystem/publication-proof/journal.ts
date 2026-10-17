import { constants, lstat, open } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { PublicationJournalSchema } from "#shared/publication-proof/effects.ts";
import type { PublicationJournal } from "#shared/publication-proof/effects.ts";
import {
  ManifestSchema,
  FileOperationConflict,
  type FileOperationManifest,
  type MediaFileRoots,
} from "#filesystem/operations-types.ts";
import { safePath, syncDirectory } from "#filesystem/operations-io.ts";

export async function auditAncestors(filename: string) {
  const result: { path: string; device: string; inode: string }[] = [];
  for (let parent = path.dirname(filename); ; parent = path.dirname(parent)) {
    const info = await lstat(parent, { bigint: true });
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new FileOperationConflict("Publication journal ancestor changed");
    result.push({
      path: parent,
      device: info.dev.toString(),
      inode: info.ino.toString(),
    });
    if (parent === path.dirname(parent)) return result;
  }
}

/** Final PG fence: identity only; raw journal hashing belongs to preparation/our actual save ACK. */
export async function assertPublicationJournalIdentity(
  roots: MediaFileRoots,
  journal: PublicationJournal,
): Promise<void> {
  const filename = await safePath(roots.control, journal.path, false);
  const info = await lstat(filename, { bigint: true });
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.dev.toString() !== journal.identity.device ||
    info.ino.toString() !== journal.identity.inode ||
    info.size.toString() !== journal.sizeBytes ||
    info.mtimeNs.toString() !== journal.identity.mtimeNs ||
    info.ctimeNs.toString() !== journal.identity.ctimeNs ||
    JSON.stringify(await auditAncestors(filename)) !==
      JSON.stringify(journal.identity.ancestors)
  )
    throw new FileOperationConflict(
      "Publication journal identity changed after acknowledgment",
    );
}

/** Bounded actual journal bytes, never a fabricated future phase or a global hash scan. */
export async function durablePublicationJournal(
  roots: MediaFileRoots,
  manifest: FileOperationManifest,
) {
  const relative = `journal/${manifest.operationId}.json`;
  const filename = await safePath(roots.control, relative, false);
  const ancestors = await auditAncestors(filename);
  const before = await lstat(filename, { bigint: true });
  if (!before.isFile() || before.size > 32_768n)
    throw new FileOperationConflict(
      "Publication journal is not bounded regular content",
    );
  const handle = await open(
    filename,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const opened = await handle.stat({ bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino)
      throw new FileOperationConflict("Publication journal was substituted");
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let offset = 0;
    for (;;) {
      const result = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      offset += result.bytesRead;
      if (result.bytesRead === 0 || offset === bytes.length) break;
    }
    const raw = bytes.subarray(0, offset).toString("utf8");
    if (
      BigInt(offset) !== before.size ||
      Buffer.byteLength(raw) !== offset ||
      JSON.stringify(ManifestSchema.parse(JSON.parse(raw))) !==
        JSON.stringify(manifest)
    )
      throw new FileOperationConflict("Publication journal descriptor changed");
    await handle.sync();
    await syncDirectory(path.dirname(filename));
    const after = await lstat(filename, { bigint: true });
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs ||
      JSON.stringify(await auditAncestors(filename)) !==
        JSON.stringify(ancestors)
    )
      throw new FileOperationConflict(
        "Publication journal changed during acknowledgment",
      );
    return PublicationJournalSchema.parse({
      path: relative,
      raw,
      sha256: createHash("sha256")
        .update(bytes.subarray(0, offset))
        .digest("hex"),
      sizeBytes: before.size.toString(),
      identity: {
        device: before.dev.toString(),
        inode: before.ino.toString(),
        mtimeNs: before.mtimeNs.toString(),
        ctimeNs: before.ctimeNs.toString(),
        ancestors,
      },
    });
  } finally {
    await handle.close();
  }
}
