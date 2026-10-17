import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  type LegacyRecoveryScopeSchema,
  RecoveryScopeV2Schema,
} from "#shared/recovery.ts";
import { buildRecoveryClaims } from "./legacy-claims/projection.ts";
import { requiredClaimAcknowledgements } from "./legacy-claims/accounting.ts";
import { recoveryHouseholdPairs } from "./household.ts";

export async function buildHouseholdScope(
  db: Prisma.TransactionClient,
  legacy: z.infer<typeof LegacyRecoveryScopeSchema>,
  machineId: string,
) {
  const ids = legacy.media.map((item) => item.id);
  const users = await db.mediaUser.findMany({
    include: { plexIdentity: true },
    orderBy: { id: "asc" },
    take: 101,
  });
  if (users.length > 100)
    throw new Error("Household snapshot bound changed under locks");
  const receipts = await db.mediaHandoffReceipt.findMany({
    where: { id: { in: legacy.handoffReceipts.map((item) => item.id) } },
    select: { planId: true },
  });
  const claims = await buildRecoveryClaims(db, {
    planIds: receipts.map((item) => item.planId),
    mediaIds: ids,
  });
  const media = await db.mediaItem.findMany({
    where: { id: { in: ids } },
    include: { parent: { include: { parent: true } } },
  });
  const ancestorsByMedia = Object.fromEntries(
    media.map((item) => [
      item.id,
      [item.parent?.id, item.parent?.parent?.id].filter(
        (id) => id !== undefined,
      ),
    ]),
  );
  const pairs = recoveryHouseholdPairs({
    users,
    scope: legacy,
    machineId,
    ancestorsByMedia,
    relevantClaims: claims.relevantClaims,
  });
  const householdRoster = pairs.roster.map((user) => ({
    ...user,
    claimAcknowledgements: requiredClaimAcknowledgements(
      claims.claims,
      user.id,
    ),
  }));
  const activeUsers = householdRoster.filter(
    (user) => user.applicableMediaIds.length > 0,
  );
  // v1 intentionally required whole roots and account-only declarations. v2
  // binds selected leaves and exact managed proxy authority instead.
  const blockers = legacy.blockers.filter(
    (reason) =>
      ![
        "partial_root_request_scope",
        "household_identity_requires_reconciliation",
        "unresolved_migration_household_claim",
      ].includes(reason),
  );
  const roots = z
    .array(
      z.object({
        id: z.string(),
        mediaId: z.string(),
        userId: z.string(),
        version: z.number(),
      }),
    )
    .parse(legacy.requests);
  const selectedCoverage = z
    .array(
      z.object({
        rootRequestId: z.string(),
        requestId: z.string(),
        mediaId: z.string(),
        active: z.boolean(),
        sourceVersion: z.number(),
      }),
    )
    .parse(legacy.coverage);
  if (
    selectedCoverage.some((coverage) => {
      if (!coverage.active) return false;
      const root = roots.find((row) => row.id === coverage.rootRequestId);
      const leaf = roots.find((row) => row.id === coverage.requestId);
      return (
        root === undefined ||
        root.userId !== leaf?.userId ||
        root.version !== coverage.sourceVersion ||
        ancestorsByMedia[coverage.mediaId]?.includes(root.mediaId) !== true
      );
    })
  )
    blockers.push("root_request_coordinates_unconfirmed");
  return RecoveryScopeV2Schema.parse({
    ...legacy,
    schemaVersion: 2,
    users: activeUsers,
    householdRoster,
    excludedPairs: pairs.excluded,
    excludedUsers: householdRoster
      .filter((user) => user.applicableMediaIds.length === 0)
      .map((user) => ({
        id: user.id,
        displayName: user.displayName,
        version: user.version,
        mappingVersion: user.mappingVersion,
        reason: "fresh_scope_denial_without_relevant_claim",
      })),
    legacyClaims: claims.claims,
    blockers: [
      ...new Set([...blockers, ...pairs.blockers, ...claims.blockers]),
    ],
  });
}
