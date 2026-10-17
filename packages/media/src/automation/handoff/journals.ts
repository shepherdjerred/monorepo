import path from "node:path";
import { constants, lstat, opendir, open } from "node:fs/promises";
import { z } from "zod";
import { ManifestSchema } from "#filesystem/operations-types.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { createHash } from "node:crypto";
import {
  hashStableFile,
  requireFileIdentity,
  type VerifiedFileProof,
} from "#filesystem/verification.ts";

type DirectoryIdentity = {
  path: string;
  dev: bigint;
  ino: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
  absent: boolean;
};
export type JournalProof = {
  digest: string;
  directory: DirectoryIdentity;
  files: VerifiedFileProof[];
};

async function directoryIdentity(
  directory: string,
): Promise<DirectoryIdentity> {
  try {
    const info = await lstat(directory, { bigint: true });
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("Handoff journal directory is unsafe");
    return {
      path: directory,
      dev: info.dev,
      ino: info.ino,
      mtimeNs: info.mtimeNs,
      ctimeNs: info.ctimeNs,
      absent: false,
    };
  } catch (error) {
    if (!z.object({ code: z.literal("ENOENT") }).safeParse(error).success)
      throw error;
    const parent = await lstat(path.dirname(directory), { bigint: true });
    if (!parent.isDirectory() || parent.isSymbolicLink())
      throw new Error("Handoff control directory is unsafe", { cause: error });
    return {
      path: directory,
      dev: parent.dev,
      ino: parent.ino,
      mtimeNs: parent.mtimeNs,
      ctimeNs: parent.ctimeNs,
      absent: true,
    };
  }
}

/** Bounded read before PG authority locks; complete effects remain explicit in owner review. */
export async function inspectHandoffJournals(
  control: string,
  targets: ReadonlySet<string>,
): Promise<JournalProof> {
  const directory = await directoryIdentity(path.join(control, "journal"));
  const manifests = [];
  const files: VerifiedFileProof[] = [];
  if (!directory.absent) {
    const entries = await opendir(directory.path);
    let count = 0;
    for await (const entry of entries) {
      if (++count > 10_000)
        throw new Error("Handoff journal inventory exceeds bound");
      if (!entry.isFile() || !entry.name.endsWith(".json"))
        throw new Error("Handoff journal inventory contains unknown entry");
      const target = path.join(directory.path, entry.name);
      const selected = await inspectSelectedJournal(target, targets);
      if (selected === null) continue;
      if (files.length >= 250)
        throw new Error("Handoff selected journal history exceeds bound");
      files.push(selected.proof);
      manifests.push(selected.manifest);
    }
  }
  await verifyJournalProof({ directory, digest: "", files });
  return {
    directory,
    files,
    digest: snapshotHash(
      manifests.sort((a, b) => a.operationId.localeCompare(b.operationId)),
    ),
  };
}

async function inspectSelectedJournal(
  target: string,
  targets: ReadonlySet<string>,
) {
  const info = await lstat(target);
  if (info.size > 64 * 1024 || info.isSymbolicLink())
    throw new Error("Handoff journal exceeds bound");
  const content = await readJournal(target);
  const manifest = ManifestSchema.parse(JSON.parse(content));
  if (!targets.has(manifest.source) && !targets.has(manifest.target))
    return null;
  if (manifest.phase !== "complete")
    throw new Error("Handoff selected path has unresolved filesystem effect");
  const proof = await hashStableFile(target, () => Promise.resolve());
  if (proof.sha256 !== createHash("sha256").update(content).digest("hex"))
    throw new Error("Handoff journal changed during observation");
  return { proof, manifest };
}

/** Atomic manifest replacement changes the directory identity timestamps; no large reads under PG. */
export async function verifyJournalProof(proof: JournalProof): Promise<void> {
  const current = await directoryIdentity(proof.directory.path);
  const expected = proof.directory;
  if (
    current.absent !== expected.absent ||
    current.dev !== expected.dev ||
    current.ino !== expected.ino ||
    current.mtimeNs !== expected.mtimeNs ||
    current.ctimeNs !== expected.ctimeNs
  )
    throw new Error("Handoff filesystem journal changed after observation");
  for (const file of proof.files) await requireFileIdentity(file.target, file);
}

async function readJournal(target: string): Promise<string> {
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const buffer = Buffer.alloc(64 * 1024 + 1);
    const { bytesRead } = await handle.read(buffer);
    if (bytesRead === buffer.length)
      throw new Error("Handoff journal exceeds bound");
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}
