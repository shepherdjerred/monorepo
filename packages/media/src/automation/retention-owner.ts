import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import { RemovalConfirmationSchema } from "#shared/contract.ts";
import type {
  MediaOperation,
  MediaNetworkActivities,
} from "#shared/automation.ts";
import { RETENTION_DEFAULTS } from "#domain/retention.ts";
import type { MediaAutomationContext } from "./context.ts";
import { serializable } from "./store.ts";

const OwnerOverrideSchema = RemovalConfirmationSchema.extend({
  ownerId: z.string(),
});
type Override = z.infer<typeof OwnerOverrideSchema>;
type Result = Awaited<
  ReturnType<MediaNetworkActivities["evaluateMediaRetention"]>
>;
type Decision = Prisma.RetentionDecisionGetPayload<Record<string, never>>;
const protectedResult = (reason: string): Result => ({
  status: "protected",
  reason,
  decisionId: null,
  wakeAt: null,
});

function ownerResult(
  target: Decision | null,
  quarantine: boolean,
  observedAt: Date,
): Result {
  if (target === null) throw new Error("Owner removal target disappeared");
  if (!quarantine)
    return {
      status: "quarantine",
      decisionId: target.id,
      wakeAt: null,
      reason: "owner_confirmed_removal",
    };
  if (
    target.quarantinedAt === null ||
    target.purgeAfter === null ||
    target.manifest === null
  )
    return protectedResult("owner_quarantine_manifest_missing");
  const purgeAt = Math.max(
    target.purgeAfter.getTime(),
    target.quarantinedAt.getTime() + RETENTION_DEFAULTS.quarantineMs,
  );
  return {
    status: observedAt.getTime() >= purgeAt ? "purge" : "grace",
    decisionId: target.id,
    wakeAt: new Date(purgeAt).toISOString(),
    reason: "owner_confirmed_removal",
  };
}

export async function readOwnerOverride(
  context: MediaAutomationContext,
  input: MediaOperation,
): Promise<Override | null> {
  const operation = await context.db.operation.findUnique({
    where: { id: input.operationId },
  });
  if (operation === null) return null;
  const payload = z
    .object({ ownerOverride: OwnerOverrideSchema.optional() })
    .parse(operation.payload);
  if (payload.ownerOverride === undefined) return null;
  const command = z
    .object({
      action: z.literal("remove"),
      mediaId: z.string(),
      generation: z.number().int(),
    })
    .parse(operation.payload);
  if (
    operation.kind !== "retain_media" ||
    operation.userId !== payload.ownerOverride.ownerId ||
    command.mediaId !== input.mediaId ||
    command.generation !== input.generation
  )
    throw new Error("Owner removal command identity is invalid");
  return payload.ownerOverride;
}

async function confirmedOwnership(
  tx: Prisma.TransactionClient,
  override: Override,
  ids: string[],
) {
  const media = await tx.mediaItem.findMany({
    where: { id: { in: ids } },
    include: { intent: true },
  });
  const quarantine = media.every((item) => item.availability === "quarantined");
  const offset = quarantine ? 1 : 0;
  if (
    media.length !== ids.length ||
    media.some((item) => {
      const expected = override.media.find((value) => value.id === item.id);
      return (
        expected === undefined ||
        item.version !== expected.version + offset ||
        item.intent?.generation !== expected.generation ||
        item.intent.desiredPresence
      );
    })
  )
    return { error: "owner_confirmation_obsolete", media, quarantine };
  const assets = await tx.libraryAsset.findMany({
    where: { coverage: { some: { mediaId: { in: ids }, current: true } } },
    include: { coverage: { where: { current: true } } },
  });
  if (
    assets.length !== override.assets.length ||
    assets.some((asset) => {
      const expected = override.assets.find((value) => value.id === asset.id);
      return (
        expected === undefined ||
        !asset.owned ||
        asset.version !== expected.version + offset ||
        asset.checksum !== expected.checksum ||
        asset.state !== (quarantine ? "quarantined" : "published") ||
        asset.coverage.some((coverage) => !ids.includes(coverage.mediaId))
      );
    })
  )
    return { error: "owner_asset_confirmation_obsolete", media, quarantine };
  return { error: null, media, quarantine };
}

export async function evaluateOwnerOverride(
  context: MediaAutomationContext,
  input: MediaOperation,
  override: Override,
  observedAt: Date,
): Promise<Result> {
  const ids = override.media.map((item) => item.id).sort();
  if (
    ids.length === 0 ||
    ids.length > 500 ||
    new Set(ids).size !== ids.length ||
    !ids.includes(input.mediaId)
  )
    return protectedResult("owner_confirmation_invalid");
  return await serializable(context.db, async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "MediaItem" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
    );
    const owner = await tx.mediaUser.findUniqueOrThrow({
      where: { id: override.ownerId },
    });
    const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    if (
      owner.role !== "owner" ||
      runtime.mode !== "active" ||
      !runtime.ownershipConfirmed
    )
      return protectedResult("owner_override_not_authorized");
    if (Date.now() - observedAt.getTime() > 30_000)
      return protectedResult("playback_observation_stale");
    const { error, media, quarantine } = await confirmedOwnership(
      tx,
      override,
      ids,
    );
    if (error !== null) return protectedResult(error);
    const reservation = await tx.acquisitionReservation.findFirst({
      where: { mediaId: { in: ids } },
    });
    if (reservation !== null) return protectedResult("acquisition_active");
    const evidence = {
      ownerOverride: { ...override, operationId: input.operationId },
      authorizedAt: observedAt.toISOString(),
      activePlayback: false,
      recoveryEpoch: runtime.recoveryEpoch,
    };
    let target: Awaited<ReturnType<typeof tx.retentionDecision.findFirst>> =
      null;
    for (const item of media) {
      const generation = item.intent?.generation;
      if (generation === undefined)
        throw new Error("Confirmed owner removal intent disappeared");
      let decision = await tx.retentionDecision.findFirst({
        where: {
          mediaId: item.id,
          generation,
          state: { in: ["grace_period", "quarantined"] },
          evidence: {
            path: ["ownerOverride", "operationId"],
            equals: input.operationId,
          },
        },
        orderBy: { createdAt: "desc" },
      });
      if (decision === null && quarantine)
        return protectedResult("owner_quarantine_manifest_missing");
      decision =
        decision === null
          ? await tx.retentionDecision.create({
              data: {
                mediaId: item.id,
                generation,
                state: "grace_period",
                graceUntil: observedAt,
                evidence,
              },
            })
          : await tx.retentionDecision.update({
              where: { id: decision.id },
              data: { evidence },
            });
      if (item.id === input.mediaId) target = decision;
    }
    return ownerResult(target, quarantine, observedAt);
  });
}
