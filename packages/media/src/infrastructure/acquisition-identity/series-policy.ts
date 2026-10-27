import type { Prisma } from "#generated/prisma/client.ts";
import {
  readLibraryHandoffReceipt,
  type LibraryHandoffReceipt,
} from "#infrastructure/handoff/library-receipt.ts";
import { identityHash } from "./snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { librarySourceAssociation } from "./library-association.ts";
import {
  protectLibraryManagement,
  type LibraryManagementInvocation,
} from "./library-policy.ts";
import type { LibrarySeriesManagementV2Schema } from "#shared/acquisition/library-management.ts";
import type { z } from "zod";

type SeriesManagement = z.infer<typeof LibrarySeriesManagementV2Schema>;

/** Caller holds series/episode/target/runtime locks. A leaf selection never becomes a series approval. */
export async function readLibrarySeriesPolicy(
  tx: Prisma.TransactionClient,
  input: { seriesId: string; epoch: number; expected?: SeriesManagement },
  invocation: LibraryManagementInvocation,
) {
  invocation.freshness.assertActive();
  const origins =
    input.expected === undefined
      ? await tx.mediaHandoffReceipt.findMany({
          where: {
            recoveryEpoch: input.epoch,
            selection: {
              path: ["scope", "request", "seriesMonitoring"],
              array_contains: [
                {
                  schemaVersion: 1,
                  seriesId: input.seriesId,
                  includeFutureEpisodes: true,
                },
              ],
            },
          },
          select: { id: true, runtimeVersion: true },
          orderBy: { runtimeVersion: "desc" },
          take: 2,
        })
      : [{ id: input.expected.receiptId, runtimeVersion: -1 }];
  if (input.expected === undefined) invocation.budget.consume(origins.length);
  const origin = origins[0];
  if (origin === undefined) return null;
  if (origins[1]?.runtimeVersion === origin.runtimeVersion)
    protectLibraryManagement();
  const approval = await readLibraryHandoffReceipt(
    tx,
    origin.id,
    invocation.budget,
  );
  const series = await tx.mediaItem.findUniqueOrThrow({
    where: { id: input.seriesId },
  });
  const target = await tx.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: series.id, edition: "default" } },
  });
  const { selected, profileId, includeSpecials } = seriesApproval(
    approval,
    series.id,
  );
  if (
    series.kind !== "series" ||
    series.catalogState !== "ready" ||
    approval.receipt.recoveryEpoch !== input.epoch ||
    invocation.access.sectionType !== "show" ||
    !target.desiredPresence ||
    !target.monitoring ||
    !target.libraryMonitoring ||
    target.generation < 1 ||
    target.intentionallyRemovedAt !== null ||
    target.automationEpoch !== input.epoch ||
    target.profileId !== profileId
  )
    protectLibraryManagement();
  await tx.$queryRaw`SELECT id FROM "MediaUser" WHERE id=${approval.receipt.actorId} FOR SHARE`;
  const actor = await tx.mediaUser.findUniqueOrThrow({
    where: { id: approval.receipt.actorId },
  });
  invocation.budget.consume(1);
  if (actor.role !== "owner" || actor.restricted) protectLibraryManagement();
  const profile = await tx.qualityProfile.findUniqueOrThrow({
    where: { id: profileId },
  });
  const association = await librarySourceAssociation(
    tx,
    {
      approval,
      root: series,
      ...(input.expected === undefined ? {} : { expected: input.expected }),
    },
    invocation,
  );
  invocation.freshness.assertActive();
  return {
    schemaVersion: 2 as const,
    kind: "library_series_management" as const,
    policyScope: "series" as const,
    includeSpecials,
    seriesId: series.id,
    receiptId: approval.receipt.id,
    planId: approval.receipt.planId,
    planHash: approval.receipt.planHash,
    selectionHash: identityHash(nativeJson(selected)),
    actorId: actor.id,
    serverMachineId: invocation.access.serverMachineId,
    sectionId: invocation.access.sectionId,
    association,
    profileId: profile.id,
    profileVersionAtCapture: profile.version,
    rootGenerationAtCapture: target.generation,
    birthEpoch: input.epoch,
  };
}

function seriesApproval(approval: LibraryHandoffReceipt, seriesId: string) {
  const selected = approval.selection.scope.media.filter(
    (item) => item.mediaId === seriesId,
  );
  const policy = selected[0];
  const monitoring =
    approval.selection.scope.request.schemaVersion === 3
      ? approval.selection.scope.request.seriesMonitoring?.filter(
          (item) => item.seriesId === seriesId,
        )
      : undefined;
  const configuration = monitoring?.[0];
  if (
    configuration === undefined ||
    monitoring?.length !== 1 ||
    selected.length !== 1 ||
    policy?.profileId == null ||
    !policy.monitored ||
    !approval.selection.scope.request.selected.some(
      (item) => item.provenanceKey === configuration.provenanceKey,
    ) ||
    !approval.selection.scope.targets.some(
      (item) => item.mediaId === seriesId && item.edition === "default",
    )
  )
    protectLibraryManagement();
  return {
    selected,
    profileId: policy.profileId,
    includeSpecials: configuration.includeSpecials,
  };
}
