import { z } from "zod";
import { ContentProof } from "#filesystem/content-proof.ts";
import { FileOperations } from "#filesystem/operations.ts";
import { ManifestSchema } from "#filesystem/operations-types.ts";
import {
  NativeQuarantineParticipantEvidenceSchema,
  type NativeQuarantineContinuation,
} from "#shared/native-recovery/quarantine.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  inspectHandoffJournals,
  verifyJournalProof,
} from "#automation/handoff/journals.ts";
import type { NativeFileContext } from "#automation/native-recovery/files.ts";
import { quarantineLocalPaths } from "./paths.ts";

export const QuarantineExecutionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  continuationId: z.uuid(),
  recoveryEpoch: z.int().nonnegative(),
  participants: z
    .array(NativeQuarantineParticipantEvidenceSchema)
    .min(1)
    .max(2525),
});
export function nativeRestoreEffectId(
  continuationId: string,
  quarantineId: string,
) {
  return `native-restore-${z.uuid().parse(continuationId)}-${z.uuid().parse(quarantineId)}`;
}

export async function prepareQuarantineRestoreProof(
  context: NativeFileContext,
  input: { id: string; recoveryEpoch: number; executionEvidence: unknown },
  descriptor: NativeQuarantineContinuation,
) {
  const content = new ContentProof();
  for (const participant of descriptor.participants) {
    const local = await quarantineLocalPaths(context, participant);
    for (const filename of [local.canonical, local.quarantined])
      await content.capture(filename, () =>
        context.files.checkpoint("native-quarantine-restore-hashing"),
      );
  }
  content.seal();
  const execution =
    input.executionEvidence === null
      ? null
      : QuarantineExecutionSchema.parse(input.executionEvidence);
  if (
    execution !== null &&
    (execution.continuationId !== input.id ||
      execution.recoveryEpoch !== input.recoveryEpoch ||
      snapshotHash(execution.participants) !==
        snapshotHash(descriptor.participants))
  )
    throw new Error(
      "Quarantine execution evidence belongs to another immutable descriptor",
    );
  await assertRestorePhysical(context, descriptor, {
    continuationId: input.id,
    content,
    executionCommitted: execution !== null,
  });
  await assertRestoreJournalInventory(context, descriptor, input.id);
  return {
    content,
    execution:
      execution ??
      QuarantineExecutionSchema.parse({
        schemaVersion: 1,
        continuationId: input.id,
        recoveryEpoch: input.recoveryEpoch,
        participants: descriptor.participants,
      }),
  };
}

/** A cold process may recognize only the original inode at its exact own journaled transition. */
export async function assertRestorePhysical(
  context: NativeFileContext,
  descriptor: NativeQuarantineContinuation,
  input: {
    continuationId: string;
    content: ContentProof;
    executionCommitted: boolean;
  },
) {
  for (const participant of descriptor.participants)
    await assertRestoreParticipant(context, participant, input);
}

async function assertRestoreParticipant(
  context: NativeFileContext,
  participant: NativeQuarantineContinuation["participants"][number],
  {
    continuationId,
    content,
    executionCommitted,
  }: {
    continuationId: string;
    content: ContentProof;
    executionCommitted: boolean;
  },
) {
  const local = await quarantineLocalPaths(context, participant);
  const source = await content.digest(local.quarantined);
  const target = await content.digest(local.canonical);
  const operations = new FileOperations(
    context.files.roots[participant.libraryKind],
    {
      authorize: () =>
        Promise.reject(new Error("Read-only restore inspection")),
      ...(context.files.verifyPlexExclusion === undefined
        ? {}
        : { verifyPlexExclusion: context.files.verifyPlexExclusion }),
    },
  );
  const operationId = nativeRestoreEffectId(
    continuationId,
    participant.quarantineId,
  );
  const journal = await operations.readManifest(operationId);
  if (journal !== null) {
    const expected = ManifestSchema.parse({
      version: 1,
      operationId,
      kind: "restore",
      source: local.quarantined,
      target: local.canonical,
      sha256: participant.checksum,
      previousSha256: null,
      phase: journal.phase,
    });
    if (
      !executionCommitted ||
      snapshotHash(expected) !== snapshotHash(journal) ||
      !["prepared", "complete"].includes(journal.phase)
    )
      throw new Error(
        "Quarantine restore journal does not belong to the committed execution",
      );
  }
  if (source === null && target === null)
    throw new Error(
      "Quarantine restore participant is missing from both locations",
    );
  if (target !== null && journal === null)
    throw new Error(
      "Quarantine canonical destination has no own restore journal",
    );
  if (source !== null && journal?.phase === "complete")
    throw new Error("Completed quarantine restore source was recreated");
  for (const [filename, digest, canonical] of [
    [local.quarantined, source, false],
    [local.canonical, target, true],
  ] as const) {
    await assertRestoreLocation({
      participant,
      content,
      filename,
      digest,
      canonical,
      untouched: target === null,
    });
  }
}

async function assertRestoreLocation(input: {
  participant: NativeQuarantineContinuation["participants"][number];
  content: ContentProof;
  filename: string;
  digest: string | null;
  canonical: boolean;
  untouched: boolean;
}) {
  const { participant, content, filename, digest, canonical } = input;
  const ancestors = canonical
    ? participant.canonicalAbsence.ancestors
    : participant.identity.ancestors;
  if (digest === null) {
    if (
      snapshotHash(await content.reviewAbsence(filename)) !==
      snapshotHash({ ancestors })
    )
      throw new Error("Quarantine restore absent path ancestor changed");
    return;
  }
  const current = await content.reviewIdentity(filename);
  const proof = await content.verifiedFile(filename);
  const before = participant.identity;
  if (
    digest !== participant.checksum ||
    proof.sizeBytes !== participant.sizeBytes ||
    current.device !== before.device ||
    current.inode !== before.inode ||
    current.mtimeNs !== before.mtimeNs ||
    snapshotHash(current.ancestors) !== snapshotHash(ancestors)
  )
    throw new Error("Quarantine restore file identity changed");
  if (input.untouched && current.ctimeNs !== before.ctimeNs)
    throw new Error("Untouched quarantine source metadata changed");
}

/** Exact own restore journals are excluded from the immutable pre-restore inventory digest only. */
export async function assertRestoreJournalInventory(
  context: NativeFileContext,
  descriptor: NativeQuarantineContinuation,
  continuationId: string,
) {
  for (const expected of descriptor.journals) {
    const selected = descriptor.participants.filter(
      (item) => item.libraryKind === expected.libraryKind,
    );
    const targets = new Set<string>();
    const transitions = [];
    for (const participant of selected) {
      const local = await quarantineLocalPaths(context, participant);
      targets.add(local.canonical);
      targets.add(local.quarantined);
      transitions.push(
        ManifestSchema.parse({
          version: 1,
          operationId: nativeRestoreEffectId(
            continuationId,
            participant.quarantineId,
          ),
          kind: "restore",
          source: local.quarantined,
          target: local.canonical,
          sha256: participant.checksum,
          previousSha256: null,
          phase: "prepared",
        }),
      );
    }
    const journal = await inspectHandoffJournals(
      context.files.roots[expected.libraryKind].control,
      targets,
      transitions,
    );
    if (journal.digest !== expected.digest)
      throw new Error(
        "Quarantine selected journal inventory changed since review",
      );
    await verifyJournalProof(journal);
  }
}
