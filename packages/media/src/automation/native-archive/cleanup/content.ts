import path from "node:path";
import { constants, lstat, open } from "node:fs/promises";
import { z } from "zod";
import { ContentProof } from "#filesystem/content-proof.ts";
import type { MeasurementAuthority } from "#filesystem/content-measurement.ts";
import {
  safePath,
  validateMediaRoots,
  verifyControlExclusion,
} from "#filesystem/operations-io.ts";
import {
  FileOperationConflict,
  IdSchema,
  ManifestSchema,
} from "#filesystem/operations-types.ts";
import { nativeLocalPath } from "#automation/native-recovery/files.ts";
import type { ArchiveFileContext } from "#automation/native-archive/execution.ts";
import { assertArchiveActive } from "#automation/native-archive/execution.ts";
import type { ArchiveContentFacts } from "#automation/native-archive/cleanup-types.ts";

/** Private unsealed evidence; no filesystem mutation capability escapes before full authority. */
export async function measureArchiveContent(
  context: ArchiveFileContext,
  canonicalPaths: readonly string[],
  assertActive: () => void,
) {
  if (canonicalPaths.length === 0 || canonicalPaths.length > 10_000)
    throw new FileOperationConflict("Archive measurement is not bounded");
  const roots = structuredClone(context.files.roots);
  const mapping = context.files.pathMapping;
  const active = () => {
    assertArchiveActive(context.execution);
    assertActive();
    if (
      JSON.stringify(roots) !== JSON.stringify(context.files.roots) ||
      mapping !== context.files.pathMapping
    )
      throw new FileOperationConflict("Archive measurement roots changed");
  };
  for (const kind of ["movies", "tv"] as const)
    validateMediaRoots(
      roots[kind],
      context.files.verifyPlexExclusion !== undefined,
    );
  const paths = new Set<string>();
  for (const canonical of canonicalPaths) {
    active();
    const local = nativeLocalPath(context, canonical);
    const kind = canonical.startsWith("/data/movies/") ? "movies" : "tv";
    const root = canonical.startsWith(`/data/${kind}/.media-control/`)
      ? roots[kind].control
      : roots[kind].library;
    await safePath(root, path.relative(root, local), false);
    active();
    if (paths.has(local))
      throw new FileOperationConflict(
        "Archive measurement path mapping collides",
      );
    paths.add(local);
  }
  for (const kind of ["movies", "tv"] as const) {
    await verifyControlExclusion(
      roots[kind],
      context.files.verifyPlexExclusion,
    );
    active();
  }
  const proof = new ContentProof();
  for (const filename of paths) {
    await proof.capture(filename, async () => {
      active();
      await context.files.checkpoint("native-archive-cleanup-hashing");
      active();
    });
    active();
  }
  const inspect = async (filename: string) => {
    active();
    if (!paths.has(filename))
      throw new FileOperationConflict("Archive path was not measured");
    const facts = await proof.reviewCaptured(filename);
    active();
    return facts;
  };
  const facts: ArchiveContentFacts = {
    async digest(filename) {
      const observed = await inspect(filename);
      return observed.file?.sha256 ?? null;
    },
    async reviewIdentity(filename) {
      const { file, ancestors } = await inspect(filename);
      if (file === null)
        throw new FileOperationConflict("Measured archive file is absent");
      return {
        device: String(file.dev),
        inode: String(file.ino),
        mtimeNs: String(file.mtimeNs),
        ctimeNs: String(file.ctimeNs),
        ancestors,
      };
    },
    async reviewAbsence(filename) {
      const { file, ancestors } = await inspect(filename);
      if (file !== null)
        throw new FileOperationConflict("Measured absent archive path exists");
      return { ancestors };
    },
  };
  return Object.freeze({
    facts,
    async seal(authority: MeasurementAuthority) {
      const currentActive = authority.assertActive;
      active();
      currentActive();
      await authority.assertCurrent();
      active();
      currentActive();
      for (const filename of paths) await inspect(filename);
      currentActive();
      proof.sealMeasured(() => {
        active();
        currentActive();
      });
      return proof;
    },
  });
}

/** Read-only journal lookup: even a missing parent must never initialize a namespace. */
export async function readArchiveManifest(
  context: ArchiveFileContext,
  kind: "movies" | "tv",
  operationId: string,
) {
  assertArchiveActive(context.execution);
  IdSchema.parse(operationId);
  const filename = await safePath(
    context.files.roots[kind].control,
    `journal/${operationId}.json`,
    false,
  );
  assertArchiveActive(context.execution);
  const handle = await open(
    filename,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  ).catch((error: unknown) => {
    if (z.object({ code: z.literal("ENOENT") }).safeParse(error).success)
      return null;
    throw error;
  });
  if (handle === null) {
    assertArchiveActive(context.execution);
    return null;
  }
  try {
    assertArchiveActive(context.execution);
    const before = await handle.stat({ bigint: true });
    assertArchiveActive(context.execution);
    if (!before.isFile() || before.size > 64n * 1024n)
      throw new FileOperationConflict(
        "Archive journal is not bounded regular content",
      );
    const bytes = Buffer.alloc(64 * 1024 + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = await handle.read(bytes, size, bytes.length - size, size);
      assertArchiveActive(context.execution);
      size += read.bytesRead;
      if (read.bytesRead === 0) break;
    }
    const after = await handle.stat({ bigint: true });
    assertArchiveActive(context.execution);
    const current = await lstat(filename, { bigint: true });
    assertArchiveActive(context.execution);
    if (
      size !== Number(before.size) ||
      size === bytes.length ||
      !current.isFile() ||
      current.isSymbolicLink() ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      current.dev !== before.dev ||
      current.ino !== before.ino ||
      current.size !== before.size ||
      current.mtimeNs !== before.mtimeNs ||
      current.ctimeNs !== before.ctimeNs
    )
      throw new FileOperationConflict(
        "Archive journal changed during read-only observation",
      );
    return ManifestSchema.parse(
      JSON.parse(bytes.subarray(0, size).toString("utf8")),
    );
  } finally {
    await handle.close();
    assertArchiveActive(context.execution);
  }
}
