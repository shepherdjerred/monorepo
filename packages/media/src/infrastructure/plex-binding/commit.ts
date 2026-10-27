import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import {
  PlexBindingSnapshotSchema,
  plexScopeKey,
  type PlexBindingFreshness,
  type PlexBindingSnapshot,
  type PlexInvalidationReason,
  type PlexPointerExpected,
} from "#shared/plex-binding/contract.ts";
import type { PlexBindingExpected } from "#shared/plex-binding/expected.ts";
import {
  ServingPlexObservationSchema,
  type VerifiedServingPlex,
} from "#shared/plex-binding/observations.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { assertPlexBindingExpected } from "./authority.ts";
import { bindPlexTransactionDeadline } from "./freshness.ts";
import { replacePlexClaims } from "./claims.ts";
import { PlexBindingProtection } from "./errors.ts";
import { invalidateRetentionPlexProjections } from "./retention.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { CompensationPublicationPhase } from "#infrastructure/native-compensation/publication/phase.ts";

/** Same transaction as the caller's publication and its immutable completion receipt. */
export async function commitVerifiedPlexBindings(
  tx: Prisma.TransactionClient,
  input: {
    expected: PlexBindingExpected;
    verified: VerifiedServingPlex;
  },
  budget = new PublicationAuthorityReadBudget(),
  compensationPhase?: CompensationPublicationPhase,
): Promise<PlexBindingSnapshot[]> {
  const { expected, verified } = input;
  const { freshness, ...rawObservation } = verified;
  const observation = ServingPlexObservationSchema.parse(rawObservation);
  freshness.assertActive();
  if (Date.parse(observation.verification.expiresAt) > freshness.expiresAtMs)
    throw new Error("Plex verification outlives its original authority");
  await bindPlexTransactionDeadline(tx, freshness);
  await assertPlexBindingExpected(tx, expected, freshness, {
    access: expected.access,
    budget,
    compensationPhase,
  });
  assertVerifiedCoverage(expected, observation);
  const rows = observation.associations.map((association) => ({
    id: crypto.randomUUID(),
    mediaId: association.scope.mediaId,
    edition: association.scope.edition,
    assetId: association.group.assetId,
    serverMachineId: association.access.serverMachineId,
    associationHash: identityHash(association),
    evidence: z.record(z.string(), z.json()).parse(association),
  }));
  await tx.plexAssociationEvidence.createMany({
    data: rows,
    skipDuplicates: true,
  });
  freshness.assertActive();
  const stored = await tx.plexAssociationEvidence.findMany({
    where: {
      OR: rows.map((row) => ({
        mediaId: row.mediaId,
        edition: row.edition,
        associationHash: row.associationHash,
      })),
    },
  });
  freshness.assertActive();
  const byKey = new Map(
    stored.map((row) => [
      `${row.mediaId}/${row.edition}/${row.associationHash}`,
      row,
    ]),
  );
  const previous = new Map(
    expected.previous.map((row) => [plexScopeKey(row.scope), row]),
  );
  const members = observation.associations.map((association) => {
    const hash = identityHash(association);
    const row = byKey.get(`${plexScopeKey(association.scope)}/${hash}`);
    if (
      row === undefined ||
      identityHash(row.evidence) !== hash ||
      row.assetId !== association.group.assetId ||
      row.serverMachineId !== association.access.serverMachineId
    )
      throw new Error("Plex immutable association insert changed");
    return { association, evidenceId: row.id, associationHash: hash };
  });
  const bindings = members.map((member) => {
    const prior = previous.get(plexScopeKey(member.association.scope));
    if (prior === undefined)
      throw new Error("Plex verified scope absent from expected union");
    return PlexBindingSnapshotSchema.parse({
      scope: member.association.scope,
      evidenceId: member.evidenceId,
      associationHash: member.associationHash,
      revision:
        prior.revision +
        (prior.evidence?.associationHash === member.associationHash ? 0 : 1),
    });
  });
  const byScope = new Map(
    bindings.map((binding) => [plexScopeKey(binding.scope), binding]),
  );
  const changed = expected.previous.filter(
    (prior) =>
      prior.evidence?.associationHash !==
      (byScope.get(plexScopeKey(prior.scope))?.associationHash ?? undefined),
  );
  const server = expected.access[0];
  if (server === undefined)
    throw new Error("Plex commit lacks configured server");
  await replacePlexClaims(
    tx,
    {
      serverMachineId: server.serverMachineId,
      oldGroups: expected.oldGroups,
      members,
    },
    freshness,
  );
  await writePlexBindingPointers(
    tx,
    {
      expected,
      bindings,
      startedAt: observation.verification.startedAt,
      completedAt: observation.verification.completedAt,
    },
    freshness,
  );
  await invalidatePlexConsequences(
    tx,
    expected,
    changed.map((row) => plexScopeKey(row.scope)),
    freshness,
  );
  freshness.assertActive();
  return bindings;
}

function assertVerifiedCoverage(
  expected: PlexBindingExpected,
  observation: z.infer<typeof ServingPlexObservationSchema>,
) {
  const groups = new Map(
    expected.newGroups.map((group) => [group.assetId, identityHash(group)]),
  );
  const targets = new Map(
    expected.targets.map((target) => [plexScopeKey(target.scope), target]),
  );
  const expectedScopes = expected.newGroups
    .flatMap((group) => group.coverage.map((scope) => plexScopeKey(scope)))
    .sort();
  if (
    identityHash(expectedScopes) !==
    identityHash(observation.associations.map((row) => plexScopeKey(row.scope)))
  )
    throw new Error("Plex verification omitted whole-group coverage");
  for (const association of observation.associations) {
    const target = targets.get(plexScopeKey(association.scope));
    if (
      target === undefined ||
      groups.get(association.group.assetId) !==
        identityHash(association.group) ||
      target.editionRootId !== association.editionRootId ||
      target.canonicalIdentityHash !== association.canonicalIdentityHash ||
      target.numberingHash !== association.numberingHash ||
      identityHash(target.definition) !==
        identityHash(association.definition) ||
      !expected.access.some(
        (access) => identityHash(access) === identityHash(association.access),
      )
    )
      throw new Error("Plex verification differs from captured authority");
  }
}

export async function writePlexBindingPointers(
  tx: Prisma.TransactionClient,
  input: {
    expected: Pick<PlexBindingExpected, "previous">;
    bindings: PlexBindingSnapshot[];
    startedAt: string;
    completedAt: string;
  },
  freshness: PlexBindingFreshness,
) {
  const byScope = new Map(
    input.bindings.map((binding) => [plexScopeKey(binding.scope), binding]),
  );
  const rows = input.expected.previous.map((prior) => {
    const binding = byScope.get(plexScopeKey(prior.scope));
    return {
      mediaId: prior.scope.mediaId,
      edition: prior.scope.edition,
      evidenceId: binding?.evidenceId ?? null,
      associationHash: binding?.associationHash ?? null,
      revision:
        binding?.revision ?? prior.revision + (prior.evidence === null ? 0 : 1),
      startedAt: binding === undefined ? null : input.startedAt,
      completedAt: binding === undefined ? null : input.completedAt,
    };
  });
  // Existing identical evidence preserves its revision and cannot regress verification clocks.
  await tx.$executeRaw(Prisma.sql`UPDATE "PlexBindingCurrent" p SET "evidenceId"=r."evidenceId","associationHash"=r."associationHash",revision=r.revision,
    "verifiedStartedAt"=CASE WHEN r."associationHash" IS NOT DISTINCT FROM p."associationHash" THEN GREATEST(p."verifiedStartedAt",r."startedAt"::timestamp) ELSE r."startedAt"::timestamp END,
    "verifiedCompletedAt"=CASE WHEN r."associationHash" IS NOT DISTINCT FROM p."associationHash" THEN GREATEST(p."verifiedCompletedAt",r."completedAt"::timestamp) ELSE r."completedAt"::timestamp END
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS r("mediaId" text,edition text,"evidenceId" text,"associationHash" text,revision integer,"startedAt" text,"completedAt" text)
    WHERE p."mediaId"=r."mediaId" AND p.edition=r.edition`);
  freshness.assertActive();
  await tx.$executeRaw(Prisma.sql`INSERT INTO "PlexBindingCurrent" ("mediaId",edition,"evidenceId","associationHash",revision,"verifiedStartedAt","verifiedCompletedAt")
    SELECT "mediaId",edition,"evidenceId","associationHash",revision,"startedAt"::timestamp,"completedAt"::timestamp
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS r("mediaId" text,edition text,"evidenceId" text,"associationHash" text,revision integer,"startedAt" text,"completedAt" text)
    WHERE NOT EXISTS (SELECT 1 FROM "PlexBindingCurrent" p WHERE p."mediaId"=r."mediaId" AND p.edition=r.edition)`);
  freshness.assertActive();
}

async function invalidatePlexConsequences(
  tx: Prisma.TransactionClient,
  expected: PlexBindingExpected,
  changed: string[],
  freshness: PlexBindingFreshness,
) {
  if (changed.length === 0) return;
  const keys = new Set(changed);
  const mediaIds = [
    ...new Set(
      [...expected.oldGroups, ...expected.newGroups]
        .filter((group) =>
          group.coverage.some((scope) => keys.has(plexScopeKey(scope))),
        )
        .flatMap((group) => group.coverage.map((scope) => scope.mediaId)),
    ),
  ].sort();
  await tx.plexWatchProjection.deleteMany({
    where: { mediaId: { in: mediaIds }, edition: "default" },
  });
  freshness.assertActive();
  await invalidateRetentionPlexProjections(
    tx,
    {
      expected,
      changedScopes: expected.previous
        .filter((row) => keys.has(plexScopeKey(row.scope)))
        .map((row) => row.scope),
    },
    freshness,
  );
}

export async function invalidatePlexBindings(
  tx: Prisma.TransactionClient,
  input: {
    expected: PlexBindingExpected;
    reason: PlexInvalidationReason;
  },
  freshness: PlexBindingFreshness,
  budget = new PublicationAuthorityReadBudget(),
): Promise<PlexPointerExpected[]> {
  await bindPlexTransactionDeadline(tx, freshness);
  await assertPlexBindingExpected(tx, input.expected, freshness, {
    access: input.expected.access,
    budget,
  });
  const server = input.expected.access[0];
  if (server === undefined) throw new PlexBindingProtection("wrong_server");
  await replacePlexClaims(
    tx,
    {
      serverMachineId: server.serverMachineId,
      oldGroups: input.expected.oldGroups,
      members: [],
    },
    freshness,
  );
  await writePlexBindingPointers(
    tx,
    {
      expected: input.expected,
      bindings: [],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    },
    freshness,
  );
  await invalidatePlexConsequences(
    tx,
    input.expected,
    input.expected.previous
      .filter((row) => row.evidence !== null)
      .map((row) => plexScopeKey(row.scope)),
    freshness,
  );
  return input.expected.previous.map((row) => ({
    scope: row.scope,
    revision: row.revision + (row.evidence === null ? 0 : 1),
    evidence: null,
  }));
}
