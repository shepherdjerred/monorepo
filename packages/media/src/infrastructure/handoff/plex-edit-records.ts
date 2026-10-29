import type { Prisma } from "#generated/prisma/client.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  PlexEditionIntentV1Schema,
  PlexEditionCompletionV1Schema,
} from "#shared/handoff/plex-edition.ts";

type Binding = { planId: string; operationId: string; assetId: string };

async function readRecord(
  tx: Prisma.TransactionClient,
  input: Binding & { kind: string },
  budget: PublicationAuthorityReadBudget,
) {
  const rows = await tx.mediaHandoffObservation.findMany({
    where: {
      planId: input.planId,
      kind: input.kind,
      evidence: { path: ["assetId"], equals: input.assetId },
    },
    orderBy: { id: "asc" },
    take: budget.take,
  });
  budget.consume(rows.length);
  if (rows.length > 1) throw new Error("Ambiguous Plex edition checkpoint");
  const row = rows[0];
  if (row === undefined) return null;
  if (identityHash(row.evidence) !== row.evidenceHash)
    throw new Error("Plex edition checkpoint hash changed");
  return row;
}

export async function readPlexEditIntentV1(
  tx: Prisma.TransactionClient,
  input: Binding,
  budget: PublicationAuthorityReadBudget,
) {
  const row = await readRecord(
    tx,
    { ...input, kind: "plex_edit_intent_v1" },
    budget,
  );
  if (row === null) return null;
  const evidence = PlexEditionIntentV1Schema.parse(row.evidence);
  assertBinding(row, evidence, input);
  return { row, evidence };
}

export async function readPlexEditCompletionV1(
  tx: Prisma.TransactionClient,
  input: Binding,
  budget: PublicationAuthorityReadBudget,
) {
  const row = await readRecord(
    tx,
    { ...input, kind: "plex_edit_completion_v1" },
    budget,
  );
  if (row === null) return null;
  const evidence = PlexEditionCompletionV1Schema.parse(row.evidence);
  assertBinding(row, evidence, input);
  return { row, evidence };
}

function assertBinding(
  row: { observedAt: Date; expiresAt: Date },
  evidence: Binding & { observedAt: string; expiresAt: string },
  input: Binding,
) {
  if (
    evidence.planId !== input.planId ||
    evidence.operationId !== input.operationId ||
    evidence.assetId !== input.assetId ||
    row.observedAt.toISOString() !== evidence.observedAt ||
    row.expiresAt.toISOString() !== evidence.expiresAt
  )
    throw new Error("Plex edition checkpoint binding changed");
}

/** A possibly delivered metadata write fences every later owner of that same physical file. */
export async function assertNoPendingPlexEdits(
  tx: Prisma.TransactionClient,
  files: readonly { canonicalPath: string }[],
  budget: PublicationAuthorityReadBudget,
  resolvedPlanId?: string,
) {
  if (files.length === 0) return;
  const rows = await tx.mediaHandoffObservation.findMany({
    where: {
      kind: "plex_edit_intent_v1",
      ...(resolvedPlanId === undefined
        ? {}
        : { planId: { not: resolvedPlanId } }),
      OR: files.map((file) => ({
        evidence: {
          path: ["before", "identity", "canonicalPath"],
          equals: file.canonicalPath,
        },
      })),
    },
    orderBy: { id: "asc" },
    take: budget.take,
  });
  budget.consume(rows.length);
  for (const row of rows) {
    if (identityHash(row.evidence) !== row.evidenceHash)
      throw new Error("Plex edition pending intent hash changed");
    const intent = PlexEditionIntentV1Schema.parse(row.evidence);
    assertBinding(row, intent, { ...intent, planId: row.planId });
    const completion = await readPlexEditCompletionV1(tx, intent, budget);
    if (
      completion === null ||
      completion.evidence.intent?.id !== row.id ||
      completion.evidence.intent.evidenceHash !== row.evidenceHash
    )
      throw new Error(
        "Plex edition edit remains uncertain; observe it before adopting this file",
      );
    const confirmed = completion.evidence;
    if (
      confirmed.planHash !== intent.planHash ||
      confirmed.recoveryEpoch !== intent.recoveryEpoch ||
      confirmed.changeHash !== intent.changeHash ||
      identityHash(confirmed.before) !== identityHash(intent.before) ||
      identityHash(confirmed.filesObservation) !==
        identityHash(intent.filesObservation) ||
      identityHash(confirmed.networkObservation) !==
        identityHash(intent.networkObservation)
    )
      throw new Error("Plex edition completed intent binding changed");
  }
}
