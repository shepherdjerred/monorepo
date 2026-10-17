import path from "node:path";
import { constants, lstat, opendir, open } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  ManifestSchema,
  FileOperationConflict,
  type FileOperationManifest,
} from "#filesystem/operations-types.ts";
import type { PublicationJournal } from "#shared/publication-proof/effects.ts";
import { hashStableFile } from "#filesystem/verification.ts";
import {
  verifyJournalProof,
  type JournalProof,
} from "#automation/handoff/journals.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import type { compensationDependencyJournals } from "./compensation-proof.ts";

/** Only immutable settled-compensation journals may retain an unfinished historical phase. */
export async function inspectCompensationJournals(
  control: string,
  targets: ReadonlySet<string>,
  expected: ReturnType<typeof compensationDependencyJournals>,
): Promise<JournalProof> {
  const directoryPath = path.join(control, "journal");
  const info = await lstat(directoryPath, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new FileOperationConflict("Settled journal directory is unsafe");
  const directory = {
    path: directoryPath,
    dev: info.dev,
    ino: info.ino,
    mtimeNs: info.mtimeNs,
    ctimeNs: info.ctimeNs,
    absent: false,
  };
  const files: JournalProof["files"] = [];
  const manifests = [];
  const entries = await opendir(directoryPath);
  let count = 0;
  for await (const entry of entries) {
    if (++count > 10_000 || !entry.isFile() || !entry.name.endsWith(".json"))
      throw new FileOperationConflict(
        "Settled journal inventory is unknown or exceeds bound",
      );
    const target = path.join(directoryPath, entry.name);
    const raw = await readJournal(target);
    const manifest = ManifestSchema.parse(JSON.parse(raw));
    const known = expected.find(
      (item) => path.join(control, item.path) === target,
    );
    if (
      known === undefined &&
      !targets.has(manifest.source) &&
      !targets.has(manifest.target)
    )
      continue;
    assertSettledJournal(raw, manifest, known);
    if (files.length >= 250)
      throw new FileOperationConflict(
        "Settled selected journal history exceeds bound",
      );
    const proof = await hashStableFile(target, () => Promise.resolve());
    if (proof.sha256 !== createHash("sha256").update(raw).digest("hex"))
      throw new FileOperationConflict(
        "Settled journal changed during observation",
      );
    files.push(proof);
    manifests.push(manifest);
  }
  for (const journal of expected)
    if (!files.some((file) => file.target === path.join(control, journal.path)))
      throw new FileOperationConflict(
        "Settled compensation journal is missing",
      );
  const proof = {
    directory,
    files,
    digest: snapshotHash(
      manifests.sort((a, b) => a.operationId.localeCompare(b.operationId)),
    ),
  };
  await verifyJournalProof(proof);
  return proof;
}

function assertSettledJournal(
  raw: string,
  manifest: FileOperationManifest,
  known: PublicationJournal | undefined,
) {
  if (
    known === undefined
      ? manifest.phase !== "complete"
      : raw !== known.raw ||
        createHash("sha256").update(raw).digest("hex") !== known.sha256
  )
    throw new FileOperationConflict(
      "Selected journal is not an exact settled compensation dependency",
    );
}

async function readJournal(filename: string) {
  const handle = await open(
    filename,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 64 * 1024)
      throw new FileOperationConflict(
        "Settled journal is not bounded regular content",
      );
    const buffer = Buffer.alloc(64 * 1024 + 1);
    const { bytesRead } = await handle.read(buffer);
    if (bytesRead === buffer.length)
      throw new FileOperationConflict("Settled journal exceeds bound");
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}
