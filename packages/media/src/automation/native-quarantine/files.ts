import { ContentProof } from "#filesystem/content-proof.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  verifyJournalProof,
  type JournalProof,
} from "#automation/handoff/journals.ts";
import {
  NativeQuarantineScopeSchema,
  NativeQuarantineNetworkEvidenceSchema,
  NativeQuarantineFileEvidenceSchema,
} from "#shared/native-recovery/quarantine.ts";
import type { NativeFileContext } from "#automation/native-recovery/files.ts";
import { assertNativeEvidenceFresh } from "#automation/native-recovery/authority.ts";
import {
  inspectQuarantineRoot,
  captureQuarantineGroups,
  quarantineParticipantEvidence,
  type CapturedQuarantineParticipant,
} from "./inspection.ts";

export async function prepareNativeQuarantineFiles(
  context: NativeFileContext,
  planId: string,
) {
  const plan = await context.files.db.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: planId },
  });
  if (!["preparing", "applying"].includes(plan.state))
    throw new Error("Quarantine proof requires a current owner command");
  const scope = NativeQuarantineScopeSchema.parse(plan.scope);
  const observation =
    await context.files.db.nativeRecoveryObservation.findFirstOrThrow({
      where: { planId, kind: "network" },
      orderBy: { createdAt: "desc" },
    });
  const network = NativeQuarantineNetworkEvidenceSchema.parse(
    observation.evidence,
  );
  if (
    network.planId !== planId ||
    network.recoveryEpoch !== plan.recoveryEpoch ||
    observation.expiresAt <= new Date()
  )
    throw new Error("Quarantine network evidence is stale");
  assertNativeEvidenceFresh(network);
  const content = new ContentProof();
  const journals: JournalProof[] = [];
  const captured: CapturedQuarantineParticipant[] = [];
  const embedded = [];
  for (const kind of ["movies", "tv"] as const) {
    if (context.files.verifyPlexExclusion === undefined)
      throw new Error(
        "Quarantine recovery requires both current exclusion proofs",
      );
    await context.files.verifyPlexExclusion(context.files.roots[kind]);
    if (
      network.mounts.mounts.find((item) => item.root === `/data/${kind}`)
        ?.podUid !== context.workerPodUid
    )
      throw new Error("Quarantine proof belongs to another files executor");
    const inspected = await inspectQuarantineRoot(
      context,
      scope,
      kind,
      content,
    );
    journals.push(inspected.journal);
    captured.push(...inspected.captured);
    embedded.push(...inspected.embedded);
  }
  const groupJournals = await captureQuarantineGroups(context, scope, captured);
  journals.push(...groupJournals.proofs);
  content.seal();
  const participants = [];
  for (const item of captured)
    participants.push(
      await quarantineParticipantEvidence(content, scope, item),
    );
  for (const journal of journals) await verifyJournalProof(journal);
  const evidence = NativeQuarantineFileEvidenceSchema.parse({
    schemaVersion: 2,
    lifecycleKind: "committed_quarantine",
    planId,
    recoveryEpoch: plan.recoveryEpoch,
    workerPodUid: context.workerPodUid,
    capturedAt: new Date().toISOString(),
    participants,
    embedded,
    journalDigest: snapshotHash(journals.map((journal) => journal.digest)),
    groupJournals: groupJournals.groups,
  });
  return { scope, content, journals, evidence };
}
export type PreparedNativeQuarantine = Awaited<
  ReturnType<typeof prepareNativeQuarantineFiles>
>;
