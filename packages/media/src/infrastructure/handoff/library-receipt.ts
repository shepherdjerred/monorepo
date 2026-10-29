import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  FinishedLibraryHandoffProtocolSchema,
  LibraryHandoffSelectionProtocolSchema,
} from "#shared/handoff/protocol.ts";
import {
  handoffPlexIdentityV3,
  assertHandoffPlexLabelsV3,
} from "#automation/handoff/plex-edit-plan.ts";
import { readPlexEditProofsV1 } from "./plex-edit-proofs.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";

const hash = (value: unknown) => identityHash(nativeJson(value));
type Receipt = Prisma.MediaHandoffReceiptGetPayload<{
  include: { plan: true };
}>;
type Selection = z.infer<typeof LibraryHandoffSelectionProtocolSchema>;

/** Original ownership is independent of current intent, flags and runtime; callers retain one read allowance. */
export async function readLibraryHandoffReceipt(
  tx: Prisma.TransactionClient,
  receiptId: string,
  budget: PublicationAuthorityReadBudget,
) {
  const receipt = await tx.mediaHandoffReceipt.findUniqueOrThrow({
    where: { id: receiptId },
    include: { plan: true },
  });
  budget.consume(2);
  if (
    receipt.plan.plan === null ||
    hash(receipt.plan.plan) !== receipt.planHash
  )
    throw new Error("Initial library parent literal plan hash changed");
  const finished = FinishedLibraryHandoffProtocolSchema.parse(
    receipt.plan.plan,
  );
  const selection = LibraryHandoffSelectionProtocolSchema.parse(
    receipt.selection,
  );
  assertApproval(receipt, finished, selection);
  assertEvidenceHeaders(receipt, selection);
  if (finished.schemaVersion === 3) {
    if (selection.schemaVersion !== 3)
      throw new Error("Initial library protocol changed");
    const actual = await readPlexEditProofsV1(
      tx,
      {
        planId: receipt.planId,
        planHash: receipt.planHash,
        recoveryEpoch: receipt.recoveryEpoch,
        changes: finished.plexEdits,
      },
      budget,
    );
    if (hash(actual) !== hash(selection.plexEdits))
      throw new Error("Initial library Plex edit proofs changed");
    assertHandoffPlexLabelsV3(selection.networkEvidence);
  }
  return { receipt, selection };
}
export type LibraryHandoffReceipt = Awaited<
  ReturnType<typeof readLibraryHandoffReceipt>
>;

function assertApproval(
  receipt: Receipt,
  finished: z.infer<typeof FinishedLibraryHandoffProtocolSchema>,
  selection: Selection,
) {
  const scope = selection.scope;
  const network =
    finished.schemaVersion === 3
      ? handoffPlexIdentityV3(selection.networkEvidence)
      : selection.networkEvidence;
  const reviewedNetwork =
    finished.schemaVersion === 3
      ? handoffPlexIdentityV3(finished.network)
      : finished.network;
  if (
    selection.schemaVersion !== finished.schemaVersion ||
    scope.schemaVersion !== finished.schemaVersion ||
    receipt.plan.state !== "applied" ||
    receipt.planId !== receipt.plan.id ||
    receipt.plan.planHash !== receipt.planHash ||
    receipt.plan.bundleReviewId !== scope.request.bundleReviewId ||
    receipt.plan.bundleReviewVersion !== scope.request.bundleReviewVersion ||
    receipt.plan.runtimeVersion !== scope.request.runtimeVersion ||
    receipt.recoveryEpoch !== receipt.plan.recoveryEpoch ||
    receipt.recoveryEpoch !== scope.request.recoveryEpoch ||
    receipt.previousRuntimeVersion !== receipt.plan.runtimeVersion ||
    receipt.runtimeVersion !== receipt.previousRuntimeVersion + 1 ||
    receipt.plan.requestHash !== hash(scope.request) ||
    hash(receipt.plan.scope) !== finished.scopeHash ||
    hash(scope) !== finished.scopeHash ||
    hash(selection.fileEvidence) !== hash(finished.files) ||
    hash(network) !== hash(reviewedNetwork)
  )
    throw new Error(
      "Initial library parent approval or literal evidence changed",
    );
}

function assertEvidenceHeaders(receipt: Receipt, selection: Selection) {
  const network = z
    .object({
      schemaVersion: z.literal(selection.schemaVersion),
      planId: z.uuid(),
      recoveryEpoch: z.int().nonnegative(),
    })
    .parse(selection.networkEvidence);
  const expected = {
    planId: receipt.planId,
    recoveryEpoch: receipt.recoveryEpoch,
  };
  if (
    hash({
      planId: selection.fileEvidence.planId,
      recoveryEpoch: selection.fileEvidence.recoveryEpoch,
    }) !== hash(expected) ||
    hash({ planId: network.planId, recoveryEpoch: network.recoveryEpoch }) !==
      hash(expected)
  )
    throw new Error(
      "Initial library parent evidence belongs to another plan or epoch",
    );
}
