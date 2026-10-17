import path from "node:path";
import { lstat, opendir } from "node:fs/promises";
import { z } from "zod";
import { FileOperations } from "#filesystem/operations.ts";
import {
  FileOperationConflict,
  type FileOperationManifest,
} from "#filesystem/operations-types.ts";
import {
  inspectHandoffJournals,
  verifyJournalProof,
} from "#automation/handoff/journals.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeLocalPath } from "#automation/native-recovery/files.ts";
import { archiveOriginalJournals } from "./paths.ts";
import type {
  ArchiveCleanupProof,
  ArchiveCleanupBase,
  ArchiveJournalProof,
  ArchiveJournalEntries,
} from "./cleanup-types.ts";
import { archivePurgeManifest } from "./purge-manifest.ts";
import {
  assertArchiveActive,
  archiveAwait,
  type ArchiveFileContext,
} from "./execution.ts";

async function inventory(directory: string) {
  const result = new Map<
    string,
    {
      device: string;
      inode: string;
      mtime: string;
      ctime: string;
      size: string;
    }
  >();
  try {
    const entries = await opendir(directory);
    for await (const entry of entries) {
      if (
        result.size >= 10_000 ||
        !entry.isFile() ||
        !entry.name.endsWith(".json")
      )
        throw new FileOperationConflict(
          "Archive journal inventory is unsafe or exceeds bound",
        );
      const stat = await lstat(path.join(directory, entry.name), {
        bigint: true,
      });
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64n * 1024n)
        throw new FileOperationConflict("Archive journal identity is unsafe");
      result.set(entry.name, {
        device: String(stat.dev),
        inode: String(stat.ino),
        mtime: String(stat.mtimeNs),
        ctime: String(stat.ctimeNs),
        size: String(stat.size),
      });
    }
  } catch (error) {
    if (!z.object({ code: z.literal("ENOENT") }).safeParse(error).success)
      throw error;
    if (result.size > 0)
      throw new FileOperationConflict(
        "Archive journal disappeared during inventory",
      );
  }
  return result;
}

async function ancestors(directory: string) {
  const result = [];
  let current = path.dirname(directory);
  for (;;) {
    const stat = await lstat(current, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new FileOperationConflict("Archive journal ancestor is unsafe");
    result.push({
      path: current,
      device: String(stat.dev),
      inode: String(stat.ino),
    });
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return result;
}

/** Hash all relevant journal contents once, outside PG; retain every entry's stat identity. */
export async function prepareCleanupJournalProof(
  context: ArchiveFileContext,
  proof: ArchiveCleanupBase,
) {
  const originalIds = new Set(
    archiveOriginalJournals(context, proof.descriptor.scope).map(
      (item) => item.operationId,
    ),
  );
  const transitions = [
    ...proof.execution.participants.map((item) =>
      archivePurgeManifest(context, proof.execution.continuationId, item),
    ),
    ...archiveOriginalJournals(context, proof.scope).filter(
      (item) => !originalIds.has(item.operationId),
    ),
  ];
  const result = [];
  for (const kind of ["movies", "tv"] as const) {
    const control = context.files.roots[kind].control;
    const parents = await ancestors(path.join(control, "journal"));
    const before = await inventory(path.join(control, "journal"));
    const targets = new Set(
      proof.paths
        .filter((name) => name.startsWith(`/data/${kind}/`))
        .map((name) => nativeLocalPath(context, name)),
    );
    const journal = await archiveAwait(
      context.execution,
      inspectArchiveJournals(control, targets, transitions),
    );
    const after = await inventory(path.join(control, "journal"));
    if (inventoryHash(before) !== inventoryHash(after))
      throw new FileOperationConflict(
        "Archive journal set changed during proof",
      );
    const digests = new Set(
      proof.descriptor.fileEvidence.files
        .filter((file) => file.canonicalPath.startsWith(`/data/${kind}/`))
        .map((file) => file.journalDigest),
    );
    if (
      digests.size > 1 ||
      (digests.size === 1 && !digests.has(journal.digest))
    )
      throw new FileOperationConflict(
        "Archive journal inventory changed outside its owned effects",
      );
    if (
      snapshotHash(await ancestors(path.join(control, "journal"))) !==
      snapshotHash(parents)
    )
      throw new FileOperationConflict(
        "Archive journal ancestors changed during proof",
      );
    result.push({ kind, journal, entries: after, ancestors: parents });
  }
  return result;
}

async function inspectArchiveJournals(
  control: string,
  targets: ReadonlySet<string>,
  transitions: readonly FileOperationManifest[],
) {
  try {
    return await inspectHandoffJournals(control, targets, transitions);
  } catch (error) {
    if (
      error instanceof Error &&
      [
        "Handoff journal directory is unsafe",
        "Handoff control directory is unsafe",
        "Handoff journal inventory exceeds bound",
        "Handoff journal inventory contains unknown entry",
        "Handoff selected journal history exceeds bound",
        "Handoff journal exceeds bound",
        "Handoff exact transition descriptor changed",
        "Handoff selected path has unresolved filesystem effect",
        "Handoff journal changed during observation",
        "Handoff filesystem journal changed after observation",
      ].includes(error.message)
    )
      throw new FileOperationConflict(error.message);
    throw error;
  }
}

/** Only stat/list checks and bounded exact own-manifest readback occur under authority locks. */
export async function assertCleanupJournalProof(
  context: ArchiveFileContext,
  proof: ArchiveCleanupProof,
) {
  for (const original of proof.journals) {
    const roots = context.files.roots[original.kind];
    await assertJournalDirectory(original);
    const own = proof.execution.participants
      .filter((item) => item.libraryKind === original.kind)
      .map((item) =>
        archivePurgeManifest(context, proof.execution.continuationId, item),
      );
    const names = new Set(own.map((item) => `${item.operationId}.json`));
    const current = await inventory(path.join(roots.control, "journal"));
    assertEntrySet(original.entries, current, names);
    await assertOwnJournals(context, {
      original,
      own,
      executionCommitted: proof.executionCommitted,
    });
    if (own.every((item) => !current.has(`${item.operationId}.json`)))
      await verifyJournalProof(original.journal);
    const after = await inventory(path.join(roots.control, "journal"));
    if (inventoryHash(current) !== inventoryHash(after))
      throw new FileOperationConflict(
        "Archive journals changed during final validation",
      );
    await assertJournalDirectory(original);
    assertArchiveActive(context.execution);
  }
}

function inventoryHash(entries: ArchiveJournalEntries) {
  return snapshotHash([...entries].sort(([a], [b]) => a.localeCompare(b)));
}
async function assertJournalDirectory(original: ArchiveJournalProof) {
  if (
    snapshotHash(await ancestors(original.journal.directory.path)) !==
    snapshotHash(original.ancestors)
  )
    throw new FileOperationConflict(
      "Archive journal ancestor identity changed",
    );
  if (!original.journal.directory.absent) {
    const directory = await lstat(original.journal.directory.path, {
      bigint: true,
    });
    if (
      !directory.isDirectory() ||
      directory.isSymbolicLink() ||
      directory.dev !== original.journal.directory.dev ||
      directory.ino !== original.journal.directory.ino
    )
      throw new FileOperationConflict(
        "Archive journal directory identity changed",
      );
  }
}
function assertEntrySet(
  before: ArchiveJournalEntries,
  current: ArchiveJournalEntries,
  names: ReadonlySet<string>,
) {
  for (const [name, identity] of before)
    if (
      !names.has(name) &&
      snapshotHash(current.get(name) ?? null) !== snapshotHash(identity)
    )
      throw new FileOperationConflict(
        "Archive nonowned journal identity changed",
      );
  for (const name of current.keys())
    if (!before.has(name) && !names.has(name))
      throw new FileOperationConflict("Archive unrecognized journal appeared");
}
async function assertOwnJournals(
  context: ArchiveFileContext,
  {
    original,
    own,
    executionCommitted,
  }: {
    original: ArchiveJournalProof;
    own: FileOperationManifest[];
    executionCommitted: boolean;
  },
) {
  const roots = context.files.roots[original.kind];
  const operations = new FileOperations(roots, {
    authorize: () =>
      Promise.reject(new Error("Archive journal inspection is read only")),
    ...(context.files.verifyPlexExclusion === undefined
      ? {}
      : { verifyPlexExclusion: context.files.verifyPlexExclusion }),
  });
  for (const expected of own) {
    const actual = await operations.readManifest(expected.operationId);
    if (actual === null) {
      if (original.entries.has(`${expected.operationId}.json`))
        throw new FileOperationConflict("Archive own journal disappeared");
      continue;
    }
    if (
      !executionCommitted ||
      !["prepared", "complete"].includes(actual.phase) ||
      snapshotHash({ ...actual, phase: "prepared" }) !== snapshotHash(expected)
    )
      throw new FileOperationConflict(
        "Archive own journal transition is unrecognized",
      );
  }
}
