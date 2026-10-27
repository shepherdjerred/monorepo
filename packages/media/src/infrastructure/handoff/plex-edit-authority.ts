import type { Prisma } from "#generated/prisma/client.ts";
import {
  LibraryHandoffScopeV3Schema,
  FinishedLibraryHandoffV3Schema,
  HandoffNetworkV3Schema,
} from "#shared/handoff/library-v3.ts";
import type { LibraryPlexEditOperationV3 } from "#shared/handoff/library-v3.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { lockHandoffScopes } from "./scoped-snapshot.ts";
import { assertHandoffSnapshot } from "#automation/handoff/plan.ts";
import {
  assertApplyActor,
  assertLatestLease,
} from "#automation/handoff/final-guards.ts";
import { runtimeAuthority } from "./authority.ts";

/** Canonical/target locks precede runtime, plan, command and current owner checks. */
export async function lockLibraryPlexEditAuthority(
  tx: Prisma.TransactionClient,
  input: Pick<LibraryPlexEditOperationV3, "planId" | "operationId" | "assetId">,
  budget: PublicationAuthorityReadBudget,
) {
  const initial = await tx.mediaHandoffPlan.findUniqueOrThrow({
    where: { id: input.planId },
    select: { scope: true },
  });
  budget.consume(1);
  const scope = LibraryHandoffScopeV3Schema.parse(initial.scope);
  await lockHandoffScopes(tx, scope);
  await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id='singleton' FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "MediaHandoffPlan" WHERE id=${input.planId} FOR UPDATE`;
  const { plan, runtime } = await assertHandoffSnapshot(
    tx,
    input.planId,
    scope,
  );
  budget.consume(3);
  if (
    plan.state !== "applying" ||
    plan.planHash === null ||
    plan.expiresAt === null ||
    plan.expiresAt.getTime() <= Date.now() ||
    identityHash(plan.plan) !== plan.planHash
  )
    throw new Error(
      "Plex edition correction requires the original live owner approval",
    );
  const finished = FinishedLibraryHandoffV3Schema.parse(plan.plan);
  if (finished.scopeHash !== identityHash(scope))
    throw new Error("Plex edition correction owner scope changed");
  const actorId = await assertApplyActor(
    tx,
    { ...input, protocol: 3 },
    plan.planHash,
  );
  budget.consume(2);
  if (scope.request.activation === "activate" && runtime.ownershipConfirmed)
    throw new Error("Plex edition correction activation is already owned");
  if (scope.request.activation === "extend") {
    const currentAuthority = await runtimeAuthority(tx);
    budget.consume(2);
    if (!currentAuthority.active)
      throw new Error("Plex edition correction active authority expired");
  }
  const file = scope.files.find((item) => item.assetId === input.assetId);
  const change = finished.plexEdits.find(
    (item) => item.assetId === input.assetId,
  );
  if (
    file === undefined ||
    change === undefined ||
    file.libraryKind !== "movies" ||
    file.mediaIds.length !== 1 ||
    file.mediaIds[0] !== change.scope.mediaId ||
    file.edition !== change.scope.edition ||
    file.canonicalPath !== change.identity.canonicalPath
  )
    throw new Error(
      "Plex edition correction does not belong to this exact reviewed file",
    );
  return {
    plan,
    planHash: plan.planHash,
    runtime,
    scope,
    finished,
    file,
    change,
    actorId,
  };
}

export async function freshHandoffNetworkV3(
  tx: Prisma.TransactionClient,
  input: {
    planId: string;
    epoch: number;
    reference?: { id: string; evidenceHash: string };
  },
  budget: PublicationAuthorityReadBudget,
) {
  const row = await tx.mediaHandoffObservation.findFirstOrThrow({
    where: {
      planId: input.planId,
      kind: "network",
      ...(input.reference === undefined ? {} : { id: input.reference.id }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
  budget.consume(1);
  if (
    identityHash(row.evidence) !== row.evidenceHash ||
    (input.reference !== undefined &&
      row.evidenceHash !== input.reference.evidenceHash)
  )
    throw new Error("Plex edition network evidence hash changed");
  const evidence = HandoffNetworkV3Schema.parse(row.evidence);
  if (
    evidence.planId !== input.planId ||
    evidence.recoveryEpoch !== input.epoch ||
    row.observedAt.toISOString() !== evidence.capturedAt ||
    row.expiresAt.toISOString() !== evidence.expiresAt ||
    row.observedAt.getTime() > Date.now() ||
    row.expiresAt.getTime() <= Date.now() ||
    row.expiresAt.getTime() > Date.parse(evidence.quiescence.expiresAt) ||
    row.expiresAt.getTime() > Date.parse(evidence.mounts.expiresAt) ||
    !evidence.quiescence.quiescent ||
    evidence.quiescence.blockers.length > 0
  )
    throw new Error("Plex edition network authority is stale or changed");
  await assertLatestLease(tx, evidence);
  return { row, evidence };
}
