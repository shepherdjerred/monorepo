import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  link,
  lstat,
  mkdir,
  open,
  realpath,
  unlink,
} from "node:fs/promises";
import { z } from "zod";
import {
  PublicationEffectSchema,
  type PublicationEffect,
} from "#shared/publication-proof/effects.ts";
import {
  FileOperationConflict,
  type MediaFileRoots,
} from "#filesystem/operations-types.ts";
import {
  syncDirectory,
  validateMediaRoots,
  verifyControlExclusion,
} from "#filesystem/operations-io.ts";
import { auditAncestors } from "./journal.ts";
import type { VerifiedFileProof } from "#filesystem/verification.ts";

type Options = {
  transitionId: string;
  continuationId: string | null;
  assertActive: () => void;
  verifyPlexExclusion?: (roots: MediaFileRoots) => Promise<void>;
};
const code = z.object({ code: z.string() });
function isExists(error: unknown) {
  const parsed = code.safeParse(error);
  return parsed.success && parsed.data.code === "EEXIST";
}

/** Prepare exact record directories outside a physical transaction/proof seal. */
export async function publicationRecordStore(
  roots: MediaFileRoots,
  options: Options,
) {
  validateMediaRoots(roots, options.verifyPlexExclusion !== undefined);
  z.uuid().parse(options.transitionId);
  if (options.continuationId !== null) z.uuid().parse(options.continuationId);
  const segments = [
    "publication-transitions",
    options.transitionId,
    options.continuationId === null
      ? "publication"
      : `compensation-${options.continuationId}`,
  ];
  let directory = roots.control;
  if ((await realpath(directory)) !== directory)
    throw new FileOperationConflict("Publication control root is unsafe");
  for (const segment of segments) {
    options.assertActive();
    await verifyControlExclusion(roots, options.verifyPlexExclusion);
    const parent = directory;
    const before = await auditAncestors(path.join(parent, "record"));
    directory = path.join(parent, segment);
    try {
      await mkdir(directory);
    } catch (error) {
      if (!isExists(error)) throw error;
    }
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new FileOperationConflict("Publication record directory is unsafe");
    await syncDirectory(parent);
    if (
      JSON.stringify(await auditAncestors(path.join(parent, "record"))) !==
      JSON.stringify(before)
    )
      throw new FileOperationConflict("Publication directory parent changed");
  }
  const ancestors = await auditAncestors(path.join(directory, "record"));
  return recordStore(roots, options, { directory, ancestors });
}

/** Open only the measured, already initialized namespace. No directory or proof is minted here. */
export async function openMeasuredPublicationRecordStore(
  roots: MediaFileRoots,
  options: Options & {
    namespace: {
      directory: string;
      ancestors: Awaited<ReturnType<typeof auditAncestors>>;
      assertUnchanged: () => Promise<void>;
    };
  },
) {
  const originalActive = options.assertActive;
  const configured = { ...roots };
  const active = () => {
    originalActive();
    if (JSON.stringify(roots) !== JSON.stringify(configured))
      throw new FileOperationConflict("Measured store roots changed");
  };
  active();
  validateMediaRoots(configured, options.verifyPlexExclusion !== undefined);
  const transitionId = z.uuid().parse(options.transitionId);
  const continuationId = z.uuid().parse(options.continuationId);
  const retained: Options = {
    transitionId,
    continuationId,
    assertActive: active,
    ...(options.verifyPlexExclusion === undefined
      ? {}
      : { verifyPlexExclusion: options.verifyPlexExclusion }),
  };
  const directory = path.join(
    configured.control,
    "publication-transitions",
    transitionId,
    `compensation-${continuationId}`,
  );
  if (directory !== options.namespace.directory)
    throw new FileOperationConflict(
      "Measured record namespace belongs to another command",
    );
  const root = await realpath(configured.control);
  active();
  if (root !== configured.control)
    throw new FileOperationConflict("Measured control root is unsafe");
  const ancestors = await auditAncestors(path.join(directory, "record"));
  active();
  if (JSON.stringify(ancestors) !== JSON.stringify(options.namespace.ancestors))
    throw new FileOperationConflict(
      "Measured record directory identity changed",
    );
  await options.namespace.assertUnchanged();
  active();
  return recordStore(configured, retained, { directory, ancestors });
}

function recordStore(
  roots: MediaFileRoots,
  options: Options,
  measured: {
    directory: string;
    ancestors: Awaited<ReturnType<typeof auditAncestors>>;
  },
) {
  const { directory, ancestors } = measured;
  const assertDirectory = async () => {
    options.assertActive();
    await verifyControlExclusion(roots, options.verifyPlexExclusion);
    if (
      JSON.stringify(await auditAncestors(path.join(directory, "record"))) !==
      JSON.stringify(ancestors)
    )
      throw new FileOperationConflict(
        "Publication record directory identity changed",
      );
    options.assertActive();
  };
  let writing = false;
  return {
    async append(raw: PublicationEffect) {
      if (writing)
        throw new FileOperationConflict("Concurrent publication record append");
      writing = true;
      try {
        const effect = PublicationEffectSchema.parse(raw);
        if (
          effect.transitionId !== options.transitionId ||
          effect.continuationId !== options.continuationId
        )
          throw new FileOperationConflict(
            "Publication record namespace changed",
          );
        await assertDirectory();
        const bytes = Buffer.from(JSON.stringify(effect));
        const filename = path.join(
          directory,
          `${String(effect.ordinal).padStart(8, "0")}.json`,
        );
        const temporary = `${filename}.${randomUUID()}.pending`;
        options.assertActive();
        const handle = await open(
          temporary,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        try {
          options.assertActive();
          const identity = await handle.stat({ bigint: true });
          options.assertActive();
          await handle.writeFile(bytes);
          options.assertActive();
          await handle.sync();
          options.assertActive();
          await assertDirectory();
          await requireInode(temporary, identity);
          options.assertActive();
          try {
            await link(temporary, filename);
          } catch (error) {
            if (!isExists(error)) throw error;
          }
          options.assertActive();
          await assertDirectory();
          const written = await requireBytes(
            filename,
            bytes,
            options.assertActive,
          );
          options.assertActive();
          await syncDirectory(directory, options.assertActive);
          options.assertActive();
          await assertDirectory();
          await requireInode(temporary, identity);
          options.assertActive();
          await unlink(temporary);
          options.assertActive();
          await syncDirectory(directory, options.assertActive);
          options.assertActive();
          await assertDirectory();
          const final = await lstat(filename, { bigint: true });
          options.assertActive();
          if (
            !final.isFile() ||
            final.isSymbolicLink() ||
            final.dev !== written.dev ||
            final.ino !== written.ino ||
            final.size !== written.size ||
            final.mtimeNs !== written.mtimeNs
          )
            throw new FileOperationConflict(
              "Publication record changed after installation",
            );
          const hash = createHash("sha256").update(bytes).digest("hex");
          const proof: VerifiedFileProof = Object.freeze({
            target: filename,
            libraryPath: path.relative(roots.control, filename),
            sha256: hash,
            sizeBytes: final.size.toString(),
            dev: final.dev,
            ino: final.ino,
            mtimeNs: final.mtimeNs,
            ctimeNs: final.ctimeNs,
          });
          options.assertActive();
          return {
            effectHash: hash,
            path: path.relative(roots.control, filename),
            proof,
          };
        } finally {
          await handle.close();
          options.assertActive();
        }
      } finally {
        writing = false;
      }
    },
  };
}

async function requireInode(
  filename: string,
  expected: { dev: bigint; ino: bigint },
) {
  const info = await lstat(filename, { bigint: true });
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.dev !== expected.dev ||
    info.ino !== expected.ino
  )
    throw new FileOperationConflict(
      "Publication temporary record identity changed",
    );
}

async function requireBytes(
  filename: string,
  expected: Buffer,
  assertActive: () => void,
) {
  assertActive();
  const handle = await open(
    filename,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    assertActive();
    const before = await handle.stat({ bigint: true });
    assertActive();
    if (!before.isFile() || before.size !== BigInt(expected.length))
      throw new FileOperationConflict("Publication effect record conflicts");
    const bytes = Buffer.alloc(expected.length + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      assertActive();
      offset += result.bytesRead;
      if (result.bytesRead === 0) break;
    }
    const after = await handle.stat({ bigint: true });
    assertActive();
    if (
      !bytes.subarray(0, offset).equals(expected) ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    )
      throw new FileOperationConflict("Publication effect record conflicts");
    await handle.sync();
    assertActive();
    await requireInode(filename, before);
    assertActive();
    return before;
  } finally {
    await handle.close();
    assertActive();
  }
}
