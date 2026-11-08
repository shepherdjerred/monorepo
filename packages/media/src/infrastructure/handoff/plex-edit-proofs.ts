import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  PlexEditionProofV1Schema,
  PlexEditionIntentV1Schema,
  PlexEditionCompletionV1Schema,
  type PlexEditionChangeV1,
} from "#shared/handoff/plex-edition.ts";
import {
  LibraryPlexFileProofV1Schema,
  HandoffNetworkV3Schema,
} from "#shared/handoff/library-v3.ts";
import { assertPlexEditionReadbackV1 } from "#migration/handoff-network/plex-edition.ts";

type Row = Prisma.MediaHandoffObservationGetPayload<object>;
type Binding = {
  planId: string;
  planHash: string;
  recoveryEpoch: number;
  operationId?: string;
};

/** Batch immutable parents once; all actual queried records share the caller's allowance. */
export async function readPlexEditProofsV1(
  tx: Prisma.TransactionClient,
  input: Binding & { changes: readonly PlexEditionChangeV1[] },
  budget: PublicationAuthorityReadBudget,
) {
  if (input.changes.length === 0) return [];
  const checkpoints = await tx.mediaHandoffObservation.findMany({
    where: {
      planId: input.planId,
      kind: { in: ["plex_edit_intent_v1", "plex_edit_completion_v1"] },
    },
    orderBy: { id: "asc" },
    take: budget.take,
  });
  budget.consume(checkpoints.length);
  for (const row of checkpoints) assertHash(row);
  const completions = checkpoints
    .filter((row) => row.kind === "plex_edit_completion_v1")
    .map((row) => ({
      row,
      evidence: PlexEditionCompletionV1Schema.parse(row.evidence),
    }));
  const commands = await tx.operation.findMany({
    where: {
      id: {
        in: [...new Set(completions.map((item) => item.evidence.operationId))],
      },
    },
    orderBy: { id: "asc" },
    take: budget.take,
  });
  budget.consume(commands.length);
  for (const item of completions) {
    const command = commands.find(
      (row) => row.id === item.evidence.operationId,
    );
    const payload = z
      .object({
        schemaVersion: z.literal(3),
        planId: z.uuid(),
        planHash: z.string(),
        actorId: z.uuid(),
      })
      .parse(command?.payload);
    if (
      command?.kind !== "apply_library_handoff_v3" ||
      command.targetId !== input.planId ||
      command.userId !== payload.actorId ||
      payload.planId !== input.planId ||
      payload.planHash !== input.planHash
    )
      throw new Error("Plex edition completion original command changed");
  }
  const fileIds = [
    ...new Set(completions.map((item) => item.evidence.filesObservation.id)),
  ];
  const files = await tx.mediaHandoffObservation.findMany({
    where: { id: { in: fileIds } },
    orderBy: { id: "asc" },
    take: budget.take,
  });
  budget.consume(files.length);
  const networkIds = [
    ...new Set(completions.map((item) => item.evidence.networkObservation.id)),
  ];
  const networks = await tx.mediaHandoffObservation.findMany({
    where: { id: { in: networkIds } },
    orderBy: { id: "asc" },
    take: budget.take,
  });
  budget.consume(networks.length);
  for (const row of [...files, ...networks]) assertHash(row);
  return input.changes.map((change) => proofForChange(change));

  function proofForChange(change: PlexEditionChangeV1) {
    const matching = completions.filter(
      (item) => item.evidence.assetId === change.assetId,
    );
    const completion = matching[0];
    if (completion === undefined || matching.length !== 1)
      throw new Error(
        "Plex edition correction has no unique confirmed completion",
      );
    assertBinding(completion.row, completion.evidence, input);
    const evidence = completion.evidence;
    if (
      evidence.changeHash !== identityHash(change) ||
      evidence.before.identityHash !== change.identityHash ||
      identityHash(evidence.before.identity) !== change.identityHash
    )
      throw new Error("Plex edition correction classification changed");
    const { intentRow, intent } = intentForCompletion(evidence, change);
    assertSources(evidence, change, intent);
    assertPlexEditionReadbackV1(
      evidence.before,
      evidence.after,
      change.scope.edition,
    );
    return PlexEditionProofV1Schema.parse({
      change,
      intent:
        intentRow === undefined
          ? null
          : {
              id: intentRow.id,
              evidenceHash: intentRow.evidenceHash,
              evidence: intent,
            },
      completion: {
        id: completion.row.id,
        evidenceHash: completion.row.evidenceHash,
        evidence,
      },
    });
  }

  function intentForCompletion(
    evidence: z.infer<typeof PlexEditionCompletionV1Schema>,
    change: PlexEditionChangeV1,
  ) {
    const intentRow = checkpoints.find((row) => row.id === evidence.intent?.id);
    const intent =
      intentRow === undefined
        ? null
        : PlexEditionIntentV1Schema.parse(intentRow.evidence);
    const actualIntents = checkpoints.filter(
      (row) =>
        row.kind === "plex_edit_intent_v1" &&
        PlexEditionIntentV1Schema.parse(row.evidence).assetId ===
          change.assetId,
    );
    if (
      evidence.intent === null
        ? actualIntents.length > 0
        : intentRow === undefined ||
          intent === null ||
          actualIntents.length !== 1 ||
          intentRow.evidenceHash !== evidence.intent.evidenceHash ||
          intentRow.kind !== "plex_edit_intent_v1" ||
          intent.changeHash !== evidence.changeHash ||
          intent.operationId !== evidence.operationId ||
          identityHash(intent.before) !== identityHash(evidence.before) ||
          identityHash(intent.filesObservation) !==
            identityHash(evidence.filesObservation) ||
          identityHash(intent.networkObservation) !==
            identityHash(evidence.networkObservation)
    )
      throw new Error("Plex edition correction original intent changed");
    if (intent !== null && intentRow !== undefined) {
      assertBinding(intentRow, intent, input);
      if (
        (intent.before.editionTitle ?? "") !== (change.beforeEditionTitle ?? "")
      )
        throw new Error("Plex edition original label changed");
    }
    return { intentRow, intent };
  }

  function assertSources(
    evidence: z.infer<typeof PlexEditionCompletionV1Schema>,
    change: PlexEditionChangeV1,
    intent: z.infer<typeof PlexEditionIntentV1Schema> | null,
  ) {
    const { fileRow, networkRow } = findSources(evidence);
    const file = LibraryPlexFileProofV1Schema.parse(fileRow.evidence);
    const network = HandoffNetworkV3Schema.parse(networkRow.evidence);
    if (
      file.planId !== input.planId ||
      file.operationId !== evidence.operationId ||
      file.assetId !== change.assetId ||
      file.planHash !== input.planHash ||
      file.recoveryEpoch !== input.recoveryEpoch ||
      file.file.assetId !== change.assetId ||
      file.file.canonicalPath !== change.identity.canonicalPath ||
      network.planId !== input.planId ||
      network.recoveryEpoch !== input.recoveryEpoch ||
      identityHash(file.networkObservation) !==
        identityHash(evidence.networkObservation) ||
      (intent !== null &&
        (Date.parse(intent.expiresAt) > fileRow.expiresAt.getTime() ||
          Date.parse(intent.observedAt) < fileRow.observedAt.getTime()))
    )
      throw new Error(
        "Plex edition correction original source authority changed",
      );
    assertSourceTimes({ fileRow, networkRow, file, network });
  }

  function findSources(
    evidence: z.infer<typeof PlexEditionCompletionV1Schema>,
  ) {
    const fileRow = files.find(
      (row) => row.id === evidence.filesObservation.id,
    );
    const networkRow = networks.find(
      (row) => row.id === evidence.networkObservation.id,
    );
    if (
      fileRow?.kind !== "plex_edit_files_v1" ||
      fileRow.planId !== input.planId ||
      fileRow.evidenceHash !== evidence.filesObservation.evidenceHash ||
      networkRow?.kind !== "network" ||
      networkRow.planId !== input.planId ||
      networkRow.evidenceHash !== evidence.networkObservation.evidenceHash
    )
      throw new Error("Plex edition correction source parent changed");
    return { fileRow, networkRow };
  }
}

function assertSourceTimes(source: {
  fileRow: Row;
  networkRow: Row;
  file: z.infer<typeof LibraryPlexFileProofV1Schema>;
  network: z.infer<typeof HandoffNetworkV3Schema>;
}) {
  const { fileRow, networkRow, file, network } = source;
  if (
    fileRow.observedAt.toISOString() !== file.capturedAt ||
    fileRow.expiresAt.toISOString() !== file.expiresAt ||
    networkRow.observedAt.toISOString() !== network.capturedAt ||
    networkRow.expiresAt.toISOString() !== network.expiresAt ||
    fileRow.expiresAt > networkRow.expiresAt ||
    Date.parse(file.expiresAt) > Date.parse(file.readSdkExpiresAt) ||
    Date.parse(file.capturedAt) < Date.parse(file.readObservedAt) ||
    Date.parse(file.expiresAt) > Date.parse(file.capturedAt) + 90_000
  )
    throw new Error(
      "Plex edition correction original source authority changed",
    );
}
function assertHash(row: Row) {
  if (identityHash(row.evidence) !== row.evidenceHash)
    throw new Error("Plex edition immutable checkpoint hash changed");
}
function assertBinding(
  row: Row,
  evidence: Binding & {
    observedAt: string;
    sdkExpiresAt: string;
    expiresAt: string;
  },
  input: Binding,
) {
  if (
    row.planId !== input.planId ||
    evidence.planId !== input.planId ||
    evidence.planHash !== input.planHash ||
    evidence.recoveryEpoch !== input.recoveryEpoch ||
    (input.operationId !== undefined &&
      evidence.operationId !== input.operationId) ||
    row.observedAt.toISOString() !== evidence.observedAt ||
    row.expiresAt.toISOString() !== evidence.expiresAt ||
    row.expiresAt.getTime() > row.observedAt.getTime() + 60_000 ||
    row.expiresAt.getTime() > Date.parse(evidence.sdkExpiresAt)
  )
    throw new Error("Plex edition immutable checkpoint binding changed");
}
