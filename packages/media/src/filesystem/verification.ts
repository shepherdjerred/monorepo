import { createHash } from "node:crypto";
import { constants, lstat, open, realpath } from "node:fs/promises";
import nodePath from "node:path";
import { z } from "zod";
import { NativeFileIdentitySchema } from "#shared/native-subtitles.ts";
import { writeChunk } from "./operations-io.ts";
import { DigestSchema, FileOperationConflict } from "./operations-types.ts";

export type VerifiedFile = {
  libraryPath: string;
  sha256: string;
  sizeBytes: string;
};

/** In-process evidence only: never accept this proof from a client or persisted payload. */
export type VerifiedFileProof = Readonly<
  VerifiedFile & {
    target: string;
    dev: bigint;
    ino: bigint;
    mtimeNs: bigint;
    ctimeNs: bigint;
  }
>;

const CopiedFileIdentitySchema = NativeFileIdentitySchema.extend({
  sizeBytes: z.string().regex(/^\d+$/u),
});
export const ExclusiveCopyReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  source: CopiedFileIdentitySchema,
  partial: CopiedFileIdentitySchema,
});
type ExclusiveCopyReceipt = z.infer<typeof ExclusiveCopyReceiptSchema>;

/** Verify one pinned descriptor and prove the path still names that unchanged regular file. */
export async function verifyStableFile(
  path: string,
  input: VerifiedFile,
  checkpoint: () => Promise<void>,
): Promise<VerifiedFileProof> {
  DigestSchema.parse(input.sha256);
  if (!/^(?:0|[1-9]\d*)$/u.test(input.sizeBytes))
    throw new FileOperationConflict("Invalid expected media size");
  const proof = await hashStableFile(path, checkpoint);
  if (proof.sha256 !== input.sha256 || proof.sizeBytes !== input.sizeBytes)
    throw new FileOperationConflict(
      "Media content does not match its committed checksum",
    );
  return Object.freeze({ ...proof, libraryPath: input.libraryPath });
}

/** Hash through a pinned descriptor before acquiring any database authority locks. */
export async function hashStableFile(
  path: string,
  checkpoint: () => Promise<void>,
): Promise<VerifiedFileProof> {
  const before = await lstat(path, { bigint: true });
  if (!before.isFile())
    throw new FileOperationConflict("Media file type or size changed");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    requireSameFile(before, await handle.stat({ bigint: true }));
    const hash = createHash("sha256");
    const buffer = new Uint8Array(1024 * 1024);
    for (;;) {
      await checkpoint();
      const { bytesRead } = await handle.read(buffer);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
    requireSameFile(before, await handle.stat({ bigint: true }));
    requireSameFile(before, await lstat(path, { bigint: true }));
    return Object.freeze({
      libraryPath: path,
      sha256: hash.digest("hex"),
      sizeBytes: before.size.toString(),
      target: path,
      dev: before.dev,
      ino: before.ino,
      mtimeNs: before.mtimeNs,
      ctimeNs: before.ctimeNs,
    });
  } finally {
    await handle.close();
  }
}

/** New private staging bytes only; the caller independently measures the target
 * with ContentProof before acknowledging this actual invocation's copy. */
export async function copyVerifiedExclusive(
  source: string,
  target: string,
  {
    checksum,
    checkpoint,
    beforeEffect,
  }: {
    checksum: string;
    checkpoint: () => Promise<void>;
    beforeEffect: () => void;
  },
) {
  DigestSchema.parse(checksum);
  const parents = await captureCopyParents([source, target]);
  const before = await lstat(source, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink())
    throw new FileOperationConflict("Copy source is not a regular file");
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    requireSameFile(before, await input.stat({ bigint: true }));
    await assertCopyParents(parents);
    beforeEffect();
    const output = await open(
      target,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const opened = await output.stat({ bigint: true });
      if (!opened.isFile())
        throw new FileOperationConflict("Copy target is not a regular file");
      requireSameFile(opened, await lstat(target, { bigint: true }));
      const hash = createHash("sha256");
      const buffer = new Uint8Array(1024 * 1024);
      for (;;) {
        await checkpoint();
        beforeEffect();
        const { bytesRead } = await input.read(buffer);
        if (bytesRead === 0) break;
        const chunk = buffer.subarray(0, bytesRead);
        hash.update(chunk);
        beforeEffect();
        await writeChunk(output, chunk);
      }
      requireSameFile(before, await input.stat({ bigint: true }));
      requireSameFile(before, await lstat(source, { bigint: true }));
      await assertCopyParents(parents);
      if (hash.digest("hex") !== checksum)
        throw new FileOperationConflict("Copy source checksum changed");
      beforeEffect();
      await output.sync();
      const copied = await output.stat({ bigint: true });
      if (
        copied.dev !== opened.dev ||
        copied.ino !== opened.ino ||
        copied.size !== before.size
      )
        throw new FileOperationConflict(
          "Exclusive copy target identity changed",
        );
      requireSameFile(copied, await lstat(target, { bigint: true }));
      await assertCopyParents(parents);
      beforeEffect();
      // Read-only, invocation-local witness: retain the actual streamed file
      // and directory identities through the caller's first journal ACK.
      const assertUnchanged = async () => {
        await assertCopyParents(parents);
        requireSameFile(before, await lstat(source, { bigint: true }));
        requireSameFile(copied, await lstat(target, { bigint: true }));
        await assertCopyParents(parents);
        beforeEffect();
      };
      return {
        assertUnchanged,
        receipt: {
          schemaVersion: 1 as const,
          source: copiedFileIdentity(source, before, parents),
          partial: copiedFileIdentity(target, copied, parents),
        },
      };
    } finally {
      await output.close();
    }
  } finally {
    await input.close();
  }
}

/** A cold retry may check which files were copied, then must independently hash the partial. */
export async function assertExclusiveCopyReceipt(
  source: string,
  partial: string,
  receipt: ExclusiveCopyReceipt,
): Promise<void> {
  const parents = await captureCopyParents([source, partial]);
  for (const [filename, expected, conflict] of [
    [source, receipt.source, "Streamed copy source identity changed"],
    [partial, receipt.partial, "Prepared import partial identity changed"],
  ] as const) {
    const info = await lstat(filename, { bigint: true });
    if (
      !info.isFile() ||
      JSON.stringify(copiedFileIdentity(filename, info, parents)) !==
        JSON.stringify(expected)
    )
      throw new FileOperationConflict(conflict);
  }
  await assertCopyParents(parents);
}

function copiedFileIdentity(
  filename: string,
  info: FileIdentity,
  parents: ReadonlyMap<string, { dev: bigint; ino: bigint }>,
): z.infer<typeof CopiedFileIdentitySchema> {
  const ancestors = [];
  for (let path = nodePath.dirname(filename); ; path = nodePath.dirname(path)) {
    const identity = parents.get(path);
    if (identity === undefined)
      throw new FileOperationConflict("Copy ancestor identity is missing");
    ancestors.push({
      path,
      device: identity.dev.toString(),
      inode: identity.ino.toString(),
    });
    if (nodePath.dirname(path) === path) break;
  }
  return {
    device: info.dev.toString(),
    inode: info.ino.toString(),
    mtimeNs: info.mtimeNs.toString(),
    ctimeNs: info.ctimeNs.toString(),
    ancestors,
    sizeBytes: info.size.toString(),
  };
}

async function captureCopyParents(paths: readonly string[]) {
  const parents = new Map<string, { dev: bigint; ino: bigint }>();
  for (const filename of paths) {
    for (
      let parent = nodePath.dirname(filename);
      ;
      parent = nodePath.dirname(parent)
    ) {
      if (!parents.has(parent)) {
        const info = await lstat(parent, { bigint: true });
        if (
          !info.isDirectory() ||
          info.isSymbolicLink() ||
          (await realpath(parent)) !== parent
        )
          throw new FileOperationConflict(
            "Copy ancestor is not a real directory",
          );
        parents.set(parent, { dev: info.dev, ino: info.ino });
      }
      if (nodePath.dirname(parent) === parent) break;
    }
  }
  return parents;
}

async function assertCopyParents(
  parents: ReadonlyMap<string, { dev: bigint; ino: bigint }>,
) {
  for (const [parent, expected] of parents) {
    const current = await lstat(parent, { bigint: true });
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      current.dev !== expected.dev ||
      current.ino !== expected.ino ||
      (await realpath(parent)) !== parent
    )
      throw new FileOperationConflict("Copy ancestor identity changed");
  }
}

export async function requireFileIdentity(
  path: string,
  proof: VerifiedFileProof,
): Promise<void> {
  const current = await lstat(path, { bigint: true });
  if (
    path !== proof.target ||
    !current.isFile() ||
    current.dev !== proof.dev ||
    current.ino !== proof.ino ||
    current.size !== BigInt(proof.sizeBytes) ||
    current.mtimeNs !== proof.mtimeNs ||
    current.ctimeNs !== proof.ctimeNs
  )
    throw new FileOperationConflict(
      "Media file identity changed after verification",
    );
}

type FileIdentity = {
  isFile: () => boolean;
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
};

function requireSameFile(before: FileIdentity, after: FileIdentity): void {
  if (
    !after.isFile() ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs
  )
    throw new FileOperationConflict(
      "Media file identity changed during verification",
    );
}
