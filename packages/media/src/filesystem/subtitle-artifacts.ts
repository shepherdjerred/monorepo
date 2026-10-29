import path from "node:path";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { withAdvisoryLock } from "./advisory-lock.ts";
import type { ContentProof } from "./content-proof.ts";
import type { VerifiedFileProof } from "./verification.ts";
import {
  safePath,
  verifyControlExclusion,
  exists,
  saveManifest,
  syncDirectory,
} from "./operations-io.ts";
import {
  IdSchema,
  ManifestSchema,
  FileOperationConflict,
  type MediaFileRoots,
  type FileOperationManifest,
} from "./operations-types.ts";

/** Bounded subtitle-only cleanup. Never accepts a library target or an arbitrary path. */
export async function cleanupSubtitleArtifact(input: {
  roots: MediaFileRoots;
  replacementId: string;
  importOperationId: string;
  rollbackOperationId: string;
  artifact: "source" | "staged" | "partial" | "rollback-staged";
  format: "srt" | "ass" | "ssa" | "vtt";
  candidate: Uint8Array;
  previousChecksum: string;
  identity?: {
    device: string;
    inode: string;
    mtimeNs: string;
    sizeBytes: string;
    checksum: string;
  };
  content: ContentProof;
  authorize: (manifest: FileOperationManifest) => Promise<void>;
  verifyPlexExclusion?: (roots: MediaFileRoots) => Promise<void>;
  checkpoint: (phase: string) => Promise<void>;
}) {
  for (const id of [
    input.replacementId,
    input.importOperationId,
    input.rollbackOperationId,
  ])
    IdSchema.parse(id);
  if (
    input.candidate.byteLength === 0 ||
    input.candidate.byteLength > 8 * 1024 * 1024
  )
    throw new FileOperationConflict(
      "Subtitle artifact candidate exceeds bound",
    );
  await verifyControlExclusion(input.roots, input.verifyPlexExclusion);
  const operationId = `subclean-${input.replacementId}-${input.artifact}`;
  const originalId =
    input.artifact === "rollback-staged"
      ? input.rollbackOperationId
      : input.importOperationId;
  const relative =
    input.artifact === "source"
      ? `subtitles/replacement-${input.replacementId}.${input.format}`
      : `staging/${originalId}${input.artifact === "partial" ? ".partial" : ""}`;
  const target = await safePath(input.roots.control, relative, true);
  const journalPath = await safePath(
    input.roots.control,
    `journal/${operationId}.json`,
    true,
  );
  const keys = [`operation:${originalId}`, `operation:${operationId}`].sort();
  keys.push(target);
  const held: (() => void)[] = [];
  const enter = async (index: number): Promise<void> => {
    const key = keys[index];
    if (key === undefined) {
      await remove();
      return;
    }
    const lock = await safePath(
      input.roots.control,
      `locks/${createHash("sha256").update(key).digest("hex")}.lock`,
      true,
    );
    await withAdvisoryLock(lock, async (assertHeld) => {
      held.push(assertHeld);
      try {
        await enter(index + 1);
      } finally {
        held.pop();
      }
    });
  };
  const remove = async () => {
    const existing = (await exists(journalPath))
      ? ManifestSchema.parse(JSON.parse(await readFile(journalPath, "utf8")))
      : null;
    const digest = await input.content.digest(target);
    assertCleanupJournal(existing, target, operationId);
    if (digest !== null && existing?.phase === "complete")
      throw new FileOperationConflict(
        "Cleaned subtitle artifact path was reused",
      );
    if (digest === null) {
      if (existing === null && input.identity !== undefined)
        throw new FileOperationConflict(
          "Subtitle artifact absence lacks cleanup journal",
        );
      if (existing !== null)
        await saveManifest(journalPath, { ...existing, phase: "complete" });
      return;
    }
    const expected =
      input.artifact === "rollback-staged"
        ? input.previousChecksum
        : createHash("sha256").update(input.candidate).digest("hex");
    const verified = await input.content.verifiedFile(target);
    assertCreationIdentity({
      identity: input.identity,
      verified,
      digest,
      expected,
    });
    const manifest =
      existing ??
      ManifestSchema.parse({
        version: 1,
        operationId,
        kind: "purge",
        source: target,
        target,
        sha256: digest,
        previousSha256: null,
        phase: "prepared",
      });
    if (manifest.sha256 !== digest)
      throw new FileOperationConflict(
        "Subtitle artifact bytes changed after cleanup intent",
      );
    await saveManifest(journalPath, manifest);
    for (const assertHeld of held) assertHeld();
    await input.authorize(manifest);
    await verifyControlExclusion(input.roots, input.verifyPlexExclusion);
    for (const assertHeld of held) assertHeld();
    await input.content.unlink(target);
    await syncDirectory(path.dirname(target));
    await input.checkpoint("subtitle-artifact-unlinked");
    for (const assertHeld of held) assertHeld();
    await saveManifest(journalPath, { ...manifest, phase: "complete" });
  };
  await enter(0);
}

function assertCleanupJournal(
  existing: FileOperationManifest | null,
  target: string,
  operationId: string,
) {
  if (
    existing !== null &&
    (existing.kind !== "purge" ||
      existing.source !== target ||
      existing.target !== target ||
      existing.operationId !== operationId ||
      existing.previousSha256 !== null)
  )
    throw new FileOperationConflict(
      "Subtitle artifact cleanup journal changed",
    );
}

function assertCreationIdentity(input: {
  identity: Parameters<typeof cleanupSubtitleArtifact>[0]["identity"];
  verified: VerifiedFileProof;
  digest: string;
  expected: string;
}) {
  const { identity, verified, digest, expected } = input;
  if (
    identity === undefined ||
    digest !== expected ||
    identity.checksum !== digest ||
    identity.device !== verified.dev.toString() ||
    identity.inode !== verified.ino.toString() ||
    identity.mtimeNs !== verified.mtimeNs.toString() ||
    identity.sizeBytes !== verified.sizeBytes
  )
    throw new FileOperationConflict(
      "Subtitle artifact creation ownership is unconfirmed",
    );
}
