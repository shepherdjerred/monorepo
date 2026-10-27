import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  FinishedLibraryHandoffV3Schema,
  LibraryHandoffScopeV3Schema,
  LibraryPlexFileProofV1Schema,
  HandoffNetworkV3Schema,
  type LibraryPlexEditOperationV3,
} from "#shared/handoff/library-v3.ts";
import type {
  PlexEditionCompletionV1,
  PlexEditionIntentV1,
} from "#shared/handoff/plex-edition.ts";
import { assertPlexEditionReadbackV1 } from "#migration/handoff-network/plex-edition.ts";
import { readPlexEditIntentV1 } from "./plex-edit-records.ts";

/** Completed acknowledgements retain their original command and sources, independently of current grants. */
export async function readPlexEditHistoryV1(
  tx: Prisma.TransactionClient,
  input: Pick<LibraryPlexEditOperationV3, "planId" | "operationId" | "assetId">,
  budget: PublicationAuthorityReadBudget,
) {
  const plan = await tx.mediaHandoffPlan.findUniqueOrThrow({
    where: { id: input.planId },
  });
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  budget.consume(2);
  if (plan.planHash === null || identityHash(plan.plan) !== plan.planHash)
    throw new Error("Plex edition original plan hash changed");
  const scope = LibraryHandoffScopeV3Schema.parse(plan.scope);
  const finished = FinishedLibraryHandoffV3Schema.parse(plan.plan);
  const payload = z
    .object({
      schemaVersion: z.literal(3),
      actorId: z.uuid(),
      planId: z.uuid(),
      planHash: z.string(),
    })
    .parse(operation.payload);
  if (
    operation.kind !== "apply_library_handoff_v3" ||
    operation.targetId !== plan.id ||
    operation.userId !== payload.actorId ||
    payload.planId !== plan.id ||
    payload.planHash !== plan.planHash ||
    finished.scopeHash !== identityHash(scope)
  )
    throw new Error("Plex edition original command changed");
  const change = finished.plexEdits.find(
    (item) => item.assetId === input.assetId,
  );
  const file = scope.files.find((item) => item.assetId === input.assetId);
  if (
    change === undefined ||
    file?.libraryKind !== "movies" ||
    file.canonicalPath !== change.identity.canonicalPath ||
    file.edition !== change.scope.edition ||
    file.mediaIds.length !== 1 ||
    file.mediaIds[0] !== change.scope.mediaId ||
    identityHash(change.identity) !== change.identityHash
  )
    throw new Error("Plex edition original classification changed");
  return { plan, operation, scope, finished, change, file };
}

export async function readPlexEditSourcesV1(
  tx: Prisma.TransactionClient,
  input: {
    binding: Pick<
      LibraryPlexEditOperationV3,
      "planId" | "operationId" | "assetId"
    >;
    planHash: string;
    epoch: number;
    files: { id: string; evidenceHash: string };
  },
  budget: PublicationAuthorityReadBudget,
) {
  const row = await tx.mediaHandoffObservation.findUniqueOrThrow({
    where: { id: input.files.id },
  });
  budget.consume(1);
  if (
    row.kind !== "plex_edit_files_v1" ||
    row.planId !== input.binding.planId ||
    row.evidenceHash !== input.files.evidenceHash ||
    identityHash(row.evidence) !== row.evidenceHash
  )
    throw new Error("Plex edition original file source changed");
  const files = LibraryPlexFileProofV1Schema.parse(row.evidence);
  const networkRow = await tx.mediaHandoffObservation.findUniqueOrThrow({
    where: { id: files.networkObservation.id },
  });
  budget.consume(1);
  if (
    networkRow.kind !== "network" ||
    networkRow.planId !== input.binding.planId ||
    networkRow.evidenceHash !== files.networkObservation.evidenceHash ||
    identityHash(networkRow.evidence) !== networkRow.evidenceHash
  )
    throw new Error("Plex edition original network source changed");
  const network = HandoffNetworkV3Schema.parse(networkRow.evidence);
  if (
    files.planId !== input.binding.planId ||
    files.operationId !== input.binding.operationId ||
    files.assetId !== input.binding.assetId ||
    files.planHash !== input.planHash ||
    files.recoveryEpoch !== input.epoch ||
    files.file.assetId !== input.binding.assetId ||
    network.planId !== files.planId ||
    network.recoveryEpoch !== input.epoch ||
    files.recoveryEpoch !== network.recoveryEpoch
  )
    throw new Error("Plex edition original source binding changed");
  assertSourceDates(row, files, networkRow, network);
  return { row, files, networkRow, network };
}

function assertSourceDates(
  row: { observedAt: Date; expiresAt: Date },
  files: z.infer<typeof LibraryPlexFileProofV1Schema>,
  networkRow: { observedAt: Date; expiresAt: Date },
  network: z.infer<typeof HandoffNetworkV3Schema>,
) {
  if (
    row.observedAt.toISOString() !== files.capturedAt ||
    row.expiresAt.toISOString() !== files.expiresAt ||
    networkRow.observedAt.toISOString() !== network.capturedAt ||
    networkRow.expiresAt.toISOString() !== network.expiresAt ||
    Date.parse(files.expiresAt) > Date.parse(files.readSdkExpiresAt) ||
    Date.parse(files.expiresAt) > Date.parse(network.expiresAt) ||
    Date.parse(files.capturedAt) < Date.parse(files.readObservedAt) ||
    Date.parse(files.expiresAt) > Date.parse(files.capturedAt) + 90_000
  )
    throw new Error("Plex edition original source binding changed");
}

export async function validatePlexEditCompletionV1(
  tx: Prisma.TransactionClient,
  completion: PlexEditionCompletionV1,
  budget: PublicationAuthorityReadBudget,
) {
  const history = await readPlexEditHistoryV1(tx, completion, budget);
  const intent = await readPlexEditIntentV1(tx, completion, budget);
  const sources = await readPlexEditSourcesV1(
    tx,
    {
      binding: completion,
      planHash: completion.planHash,
      epoch: completion.recoveryEpoch,
      files: completion.filesObservation,
    },
    budget,
  );
  if (
    completion.planHash !== history.plan.planHash ||
    completion.recoveryEpoch !== history.plan.recoveryEpoch ||
    completion.changeHash !== identityHash(history.change) ||
    completion.before.identityHash !== history.change.identityHash ||
    identityHash(completion.networkObservation) !==
      identityHash(sources.files.networkObservation) ||
    (completion.intent === null
      ? intent !== null
      : completion.intent.id !== intent?.row.id ||
        completion.intent.evidenceHash !== intent.row.evidenceHash ||
        identityHash(completion.before) !==
          identityHash(intent.evidence.before) ||
        identityHash(completion.filesObservation) !==
          identityHash(intent.evidence.filesObservation))
  )
    throw new Error("Plex edition completion parent changed");
  assertPlexEditionReadbackV1(
    completion.before,
    completion.after,
    history.change.scope.edition,
  );
  assertCheckpointDeadline(completion);
  if (intent !== null)
    await validatePlexEditIntentV1(tx, intent.evidence, budget);
  return { ...history, intent, sources };
}

export async function validatePlexEditIntentV1(
  tx: Prisma.TransactionClient,
  intent: PlexEditionIntentV1,
  budget: PublicationAuthorityReadBudget,
) {
  const history = await readPlexEditHistoryV1(tx, intent, budget);
  const sources = await readPlexEditSourcesV1(
    tx,
    {
      binding: intent,
      planHash: intent.planHash,
      epoch: intent.recoveryEpoch,
      files: intent.filesObservation,
    },
    budget,
  );
  const reviewed = z
    .object({ files: z.array(z.looseObject({ assetId: z.uuid() })) })
    .parse(history.finished.files)
    .files.find((file) => file.assetId === intent.assetId);
  if (
    intent.planHash !== history.plan.planHash ||
    intent.recoveryEpoch !== history.plan.recoveryEpoch ||
    intent.changeHash !== identityHash(history.change) ||
    intent.before.identityHash !== history.change.identityHash ||
    identityHash(intent.before.identity) !== history.change.identityHash ||
    (intent.before.editionTitle ?? "") !==
      (history.change.beforeEditionTitle ?? "") ||
    identityHash(intent.networkObservation) !==
      identityHash(sources.files.networkObservation) ||
    identityHash(reviewed) !== identityHash(sources.files.file) ||
    Date.parse(intent.expiresAt) > sources.row.expiresAt.getTime() ||
    Date.parse(intent.observedAt) < sources.row.observedAt.getTime()
  )
    throw new Error("Plex edition intent original authority changed");
  assertCheckpointDeadline(intent);
  return { ...history, sources };
}

function assertCheckpointDeadline(value: {
  observedAt: string;
  sdkExpiresAt: string;
  expiresAt: string;
}) {
  const observed = Date.parse(value.observedAt);
  const expires = Date.parse(value.expiresAt);
  if (
    expires <= observed ||
    expires > observed + 60_000 ||
    expires > Date.parse(value.sdkExpiresAt)
  )
    throw new Error("Plex edition original SDK deadline changed");
}
