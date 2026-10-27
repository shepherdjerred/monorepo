import { defaultIntent } from "#shared/editions/scope.ts";
import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import { Prisma } from "#generated/prisma/client.ts";
import { HandoffFileEvidenceSchema } from "#shared/handoff.ts";
import {
  HandoffScopeProtocolSchema,
  HandoffNetworkProtocolSchema,
  type HandoffProtocolScope,
  FinishedLibraryHandoffV2Schema,
} from "#shared/handoff-v2.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  lockHandoffScopes,
  assertLibraryHandoffSnapshot,
} from "#infrastructure/handoff/scoped-snapshot.ts";
import type { PreparedHandoffFiles } from "./files.ts";

export function stableNetwork(raw: unknown) {
  const network = HandoffNetworkProtocolSchema.parse(raw);
  const torrents = network.torrents.map(
    ({ observationHash: _observationHash, ...identity }) => identity,
  );
  return {
    ...(network.schemaVersion === 2 ? { schemaVersion: 2 } : {}),
    planId: network.planId,
    recoveryEpoch: network.recoveryEpoch,
    controllers: network.quiescence.controllers,
    configurationDigest: network.quiescence.configurationDigest,
    targetsDigest: network.quiescence.targetsDigest,
    mounts: network.mounts.bindings,
    claims: network.claims,
    plex: network.plex,
    torrents,
  };
}
export function stableFiles(raw: unknown) {
  const files = HandoffFileEvidenceSchema.parse(raw);
  return {
    planId: files.planId,
    recoveryEpoch: files.recoveryEpoch,
    workerPodUid: files.workerPodUid,
    files: files.files,
  };
}
const FinishedV1 = z.strictObject({
  schemaVersion: z.literal(1),
  scopeHash: z.string(),
  network: z.json(),
  files: z.json(),
});
export const FinishedHandoffSchema = z.union([
  FinishedV1,
  FinishedLibraryHandoffV2Schema,
]);

export async function assertHandoffSnapshot(
  tx: Prisma.TransactionClient,
  planId: string,
  scope: HandoffProtocolScope,
) {
  const profileIds = [
    ...new Set(
      scope.media.flatMap((item) =>
        item.profileId === null ? [] : [item.profileId],
      ),
    ),
  ].sort();
  if (profileIds.length > 0)
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "QualityProfile" WHERE id IN (${Prisma.join(profileIds)}) ORDER BY id FOR SHARE`,
    );
  const plan = await tx.mediaHandoffPlan.findUniqueOrThrow({
    where: { id: planId },
    include: { bundleReview: { include: { bundle: true } } },
  });
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const expectedMode =
    scope.request.activation === "activate" ? "observe" : "active";
  if (
    runtime.mode !== expectedMode ||
    runtime.version !== plan.runtimeVersion ||
    runtime.recoveryEpoch !== plan.recoveryEpoch ||
    plan.bundleReview.status !== "approved" ||
    plan.bundleReview.version !== plan.bundleReviewVersion ||
    plan.bundleReview.reportHash !== scope.request.reportHash ||
    JSON.stringify(HandoffScopeProtocolSchema.parse(plan.scope)) !==
      JSON.stringify(scope)
  )
    throw new Error("Handoff runtime, approval, or immutable scope changed");
  await assertLibraryHandoffSnapshot(tx, scope);
  const media = await tx.mediaItem.findMany({
    where: { id: { in: scope.media.map((item) => item.mediaId) } },
    include: { intents: { where: { edition: "default" } } },
  });
  for (const expected of scope.media) {
    const current = media.find((item) => item.id === expected.mediaId);
    if (
      current?.version !== expected.version ||
      (defaultIntent(current.intents)?.generation ?? null) !==
        expected.generation
    )
      throw new Error("Handoff media intent changed");
    if (expected.profileId !== null) {
      const profile = await tx.qualityProfile.findUniqueOrThrow({
        where: { id: expected.profileId },
      });
      if (profile.version !== expected.profileVersion)
        throw new Error("Handoff quality profile changed");
    }
  }
  return { plan, runtime };
}

/** Freeze the complete proof for a separate explicit owner review. No authority is transferred. */
export async function finishHandoffPreparation(
  db: Database,
  planId: string,
  prepared: PreparedHandoffFiles,
): Promise<void> {
  await db.$transaction(
    async (tx) => {
      await lockHandoffScopes(tx, prepared.scope);
      await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "MediaHandoffPlan" WHERE id = ${planId} FOR UPDATE`;
      const { plan } = await assertHandoffSnapshot(tx, planId, prepared.scope);
      if (plan.state === "awaiting_review") return;
      if (plan.state !== "preparing")
        throw new Error("Handoff preparation state changed");
      const network = await tx.mediaHandoffObservation.findFirstOrThrow({
        where: { planId, kind: "network" },
        orderBy: { createdAt: "desc" },
      });
      if (network.expiresAt <= new Date())
        throw new Error("Handoff network proof expired during file inspection");
      const files = stableFiles(prepared.evidence);
      const complete = FinishedHandoffSchema.parse({
        schemaVersion: "schemaVersion" in prepared.scope ? 2 : 1,
        scopeHash: snapshotHash(z.json().parse(prepared.scope)),
        network: stableNetwork(network.evidence),
        files,
      });
      await tx.mediaHandoffObservation.create({
        data: {
          planId,
          kind: "files",
          evidenceHash: snapshotHash(z.json().parse(prepared.evidence)),
          evidence: z.record(z.string(), z.json()).parse(prepared.evidence),
          observedAt: new Date(prepared.evidence.capturedAt),
          expiresAt: new Date(Date.now() + 12 * 3_600_000),
        },
      });
      await tx.mediaHandoffPlan.update({
        where: { id: planId },
        data: {
          plan: complete,
          planHash: snapshotHash(complete),
          state: "awaiting_review",
          expiresAt: new Date(Date.now() + 12 * 3_600_000),
          version: { increment: 1 },
        },
      });
    },
    { timeout: 30_000 },
  );
}
