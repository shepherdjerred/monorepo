import { createHash } from "node:crypto";
import { constants, lstat, open } from "node:fs/promises";
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

/** Verify one pinned descriptor and prove the path still names that unchanged regular file. */
export async function verifyStableFile(
  path: string,
  input: VerifiedFile,
  checkpoint: () => Promise<void>,
): Promise<VerifiedFileProof> {
  DigestSchema.parse(input.sha256);
  if (!/^(?:0|[1-9]\d*)$/u.test(input.sizeBytes))
    throw new FileOperationConflict("Invalid expected media size");
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.size !== BigInt(input.sizeBytes))
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
    if (hash.digest("hex") !== input.sha256)
      throw new FileOperationConflict(
        "Media content does not match its committed checksum",
      );
    return Object.freeze({
      ...input,
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
