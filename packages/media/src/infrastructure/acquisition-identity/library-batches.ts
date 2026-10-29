import type { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  LibraryBatchManagementV3Schema,
  type LibraryEpisodeManagementV1Schema,
} from "#shared/acquisition/library-management.ts";
import { LibraryHandoffSelectionProtocolSchema } from "#shared/handoff/protocol.ts";
import { identityHash } from "./snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import {
  protectLibraryManagement,
  type LibraryManagementInvocation,
  type LibraryManagementResult,
} from "./library-policy.ts";

type Episode = z.infer<typeof LibraryEpisodeManagementV1Schema>;
type Batch = z.infer<typeof LibraryBatchManagementV3Schema>;
type Reader = (input: {
  receiptId: string;
  mediaIds: string[];
  expected?: Episode;
}) => Promise<LibraryManagementResult>;

/** Every constituent remains a real episode approval; the caller owns all locks and one allowance. */
export async function readLibraryBatchPolicy(
  tx: Prisma.TransactionClient,
  input: {
    mediaIds: readonly string[];
    seriesId: string;
    epoch: number;
    expected?: Batch;
  },
  invocation: LibraryManagementInvocation,
  read: Reader,
): Promise<LibraryManagementResult> {
  if (
    input.expected !== undefined &&
    (input.expected.targets.length !== input.mediaIds.length ||
      input.expected.targets.some(
        (target) => !input.mediaIds.includes(target.mediaId),
      ))
  )
    protectLibraryManagement();
  const selected =
    input.expected === undefined
      ? await selectApprovals(tx, input, invocation)
      : input.expected.approvals.map((approval) => ({
          receiptId: approval.receiptId,
          mediaIds: approval.targets.map((target) => target.mediaId),
          expected: approval,
        }));
  if (selected === null) return null;
  const approvals: Episode[] = [];
  for (const source of selected) {
    const current = await read(source);
    if (current?.proof.schemaVersion !== 1) protectLibraryManagement();
    approvals.push(current.proof);
  }
  approvals.sort((a, b) => a.receiptId.localeCompare(b.receiptId));
  const first = approvals[0];
  if (first === undefined)
    throw new Error("Complete batch policy lost its original approvals");
  const header = commonPolicy(first);
  if (
    header.seriesId !== input.seriesId ||
    header.birthEpoch !== input.epoch ||
    approvals.some(
      (approval) =>
        identityHash(nativeJson(commonPolicy(approval))) !==
        identityHash(nativeJson(header)),
    )
  )
    protectLibraryManagement();
  const proof = LibraryBatchManagementV3Schema.parse({
    ...header,
    schemaVersion: 3,
    policyScope: "episodes",
    approvals,
    targets: approvals
      .flatMap((approval) => approval.targets)
      .sort((a, b) => a.mediaId.localeCompare(b.mediaId)),
  });
  if (
    input.expected !== undefined &&
    identityHash(nativeJson(proof)) !== identityHash(nativeJson(input.expected))
  )
    protectLibraryManagement();
  invocation.freshness.assertActive();
  return { proof, freshness: invocation.freshness };
}

function commonPolicy(approval: Episode) {
  return {
    kind: approval.kind,
    seriesId: approval.seriesId,
    serverMachineId: approval.serverMachineId,
    sectionId: approval.sectionId,
    profileId: approval.profileId,
    profileVersionAtCapture: approval.profileVersionAtCapture,
    birthEpoch: approval.birthEpoch,
  };
}

async function selectApprovals(
  tx: Prisma.TransactionClient,
  input: { mediaIds: readonly string[]; epoch: number },
  invocation: LibraryManagementInvocation,
) {
  const origins = await tx.mediaHandoffReceipt.findMany({
    where: {
      recoveryEpoch: input.epoch,
      OR: input.mediaIds.map((mediaId) => ({
        selection: {
          path: ["scope", "targets"],
          array_contains: [{ mediaId, edition: "default" }],
        },
      })),
    },
    select: { id: true, runtimeVersion: true, selection: true },
    orderBy: [{ runtimeVersion: "desc" }, { id: "asc" }],
    take: 26,
  });
  invocation.budget.consume(origins.length);
  if (origins.length > 25) protectLibraryManagement();
  const assigned = new Map<string, number>();
  const selected: { receiptId: string; mediaIds: string[] }[] = [];
  for (const origin of origins) {
    const targets = LibraryHandoffSelectionProtocolSchema.parse(
      origin.selection,
    ).scope.targets.filter(
      (target) =>
        target.edition === "default" && input.mediaIds.includes(target.mediaId),
    );
    if (
      targets.some(
        (target) => assigned.get(target.mediaId) === origin.runtimeVersion,
      )
    )
      protectLibraryManagement();
    const ids = targets
      .filter((target) => !assigned.has(target.mediaId))
      .map((target) => target.mediaId)
      .sort();
    if (ids.length === 0) continue;
    for (const id of ids) assigned.set(id, origin.runtimeVersion);
    selected.push({ receiptId: origin.id, mediaIds: ids });
  }
  if (assigned.size !== input.mediaIds.length) return null;
  if (selected.length < 2)
    throw new Error(
      "A single full approval must use its literal episode policy",
    );
  return selected;
}
