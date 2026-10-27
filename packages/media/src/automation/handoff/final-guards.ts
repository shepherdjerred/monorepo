import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { HandoffNetworkEvidenceSchema } from "#shared/handoff.ts";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";
import { snapshotHash } from "#migration/profile-import.ts";

export async function assertApplyActor(
  tx: Prisma.TransactionClient,
  input: { operationId: string; planId: string },
  planHash: string,
) {
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  const payload = z
    .object({ actorId: z.uuid(), planId: z.uuid(), planHash: z.string() })
    .parse(operation.payload);
  if (
    operation.kind !== "apply_handoff" ||
    operation.targetId !== input.planId ||
    operation.userId !== payload.actorId ||
    payload.planId !== input.planId ||
    payload.planHash !== planHash
  )
    throw new Error("Handoff approval operation changed");
  await tx.$queryRaw`SELECT id FROM "MediaUser" WHERE id = ${payload.actorId} FOR SHARE`;
  const actor = await tx.mediaUser.findUniqueOrThrow({
    where: { id: payload.actorId },
  });
  if (actor.role !== "owner" || actor.restricted)
    throw new Error("Handoff approving owner authority changed");
  return actor.id;
}

/** Never replace a newer revocation with an older stopped-writer observation. */
export async function assertLatestLease(
  tx: Prisma.TransactionClient,
  network: Pick<
    z.infer<typeof HandoffNetworkEvidenceSchema>,
    "quiescence" | "recoveryEpoch"
  >,
) {
  const evidence = network.quiescence;
  const captured = Date.parse(evidence.capturedAt);
  const expires = Date.parse(evidence.expiresAt);
  const now = Date.now();
  if (
    !evidence.quiescent ||
    evidence.blockers.length > 0 ||
    captured > now ||
    expires <= now ||
    expires - captured > 120_000 ||
    evidence.configurationDigest !== snapshotHash(LEGACY_OBSERVER_CONFIG) ||
    evidence.targetsDigest !==
      snapshotHash(LEGACY_OBSERVER_CONFIG.legacyDeployments)
  )
    throw new Error("Handoff writer evidence is invalid");
  const current = await tx.legacyWriterLease.findUnique({
    where: { id: "singleton" },
  });
  if (
    current !== null &&
    current.recoveryEpoch === network.recoveryEpoch &&
    current.observedAt.getTime() >= captured &&
    current.revokedAt !== null
  )
    throw new Error("Handoff writer evidence superseded by revocation");
}
