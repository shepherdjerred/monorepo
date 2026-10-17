import type { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";

export type LifecycleKind =
  | "media_available"
  | "media_upgraded"
  | "subtitles_ready"
  | "files_quarantined"
  | "files_purged"
  | "acquisition_failed"
  | "system_intervention";
export type NotificationItem = {
  mediaId: string;
  generation: number;
  assetId?: string;
  assetVersion?: number;
  assetChecksum?: string;
  subtitleId?: string;
  language?: string;
  decisionId?: string;
};
type LifecycleInput = {
  key: string;
  kind: LifecycleKind;
  epoch: number;
  items: NotificationItem[];
  ownerOnly?: boolean;
  operationId?: string;
};
type Recipient = Prisma.MediaUserGetPayload<{
  include: { notificationPreference: true };
}>;

/** Called inside the transaction which commits the verified lifecycle transition. */
export async function queueLifecycleNotifications(
  tx: Prisma.TransactionClient,
  input: LifecycleInput,
): Promise<void> {
  for (const item of input.items) {
    await tx.applicationEvent.upsert({
      where: { dedupeKey: `${input.key}:item:${item.mediaId}` },
      create: {
        dedupeKey: `${input.key}:item:${item.mediaId}`,
        mediaId: item.mediaId,
        kind: input.kind,
        payload: {
          ...item,
          recoveryEpoch: input.epoch,
          ...(input.operationId === undefined
            ? {}
            : { operationId: input.operationId }),
        },
      },
      update: {},
    });
  }
  const users =
    input.ownerOnly === true
      ? await tx.mediaUser.findMany({
          where: { role: "owner" },
          include: { notificationPreference: true },
        })
      : await tx.mediaUser.findMany({
          where: {
            requests: {
              some: {
                mediaId: { in: input.items.map((item) => item.mediaId) },
                ...effectiveRequestWhere,
              },
            },
          },
          include: { notificationPreference: true },
        });
  for (const user of users) await queueForUser(tx, input, user);
}

async function queueForUser(
  tx: Prisma.TransactionClient,
  input: LifecycleInput,
  user: Recipient,
): Promise<void> {
  const preference = user.notificationPreference;
  if (preference === null || !recipientEnabled(input.kind, preference)) return;
  const requests =
    input.ownerOnly === true
      ? []
      : await tx.mediaRequest.findMany({
          where: {
            userId: user.id,
            mediaId: { in: input.items.map((item) => item.mediaId) },
            ...effectiveRequestWhere,
          },
        });
  const items =
    input.ownerOnly === true
      ? input.items
      : input.items.filter((item) =>
          requests.some(
            (claim) =>
              claim.mediaId === item.mediaId &&
              (input.kind === "subtitles_ready" ||
                item.language === undefined ||
                claim.subtitleLanguages.includes(item.language)),
          ),
        );
  if (items.length === 0 && input.ownerOnly !== true) return;
  const ordered = [...items].sort((left, right) =>
    left.mediaId.localeCompare(right.mediaId),
  );
  const chunks = Array.from(
    { length: Math.max(1, Math.ceil(ordered.length / 1000)) },
    (_, index) => ordered.slice(index * 1000, (index + 1) * 1000),
  );
  for (const [index, chunk] of chunks.entries()) {
    const key = `${input.key}:recipient:${user.id}:batch:${String(index)}`;
    const event = await tx.applicationEvent.upsert({
      where: { dedupeKey: key },
      create: {
        dedupeKey: key,
        mediaId: chunk[0]?.mediaId ?? null,
        kind: input.kind,
        payload: {
          items: chunk,
          ownerOnly: input.ownerOnly === true,
          recoveryEpoch: input.epoch,
          ...(input.operationId === undefined
            ? {}
            : { operationId: input.operationId }),
        },
      },
      update: {},
    });
    for (const channel of [
      preference.emailEnabled ? "email" : null,
      preference.discordEnabled ? "discord" : null,
    ].filter((value) => value !== null)) {
      const delivery = await tx.notificationDelivery.upsert({
        where: {
          eventId_userId_channel: {
            eventId: event.id,
            userId: user.id,
            channel,
          },
        },
        create: {
          eventId: event.id,
          userId: user.id,
          channel,
          state: "pending",
          recoveryEpoch: input.epoch,
        },
        update: {},
      });
      await queueDelivery(
        tx,
        delivery.id,
        user.id,
        `notification:${delivery.id}`,
      );
    }
  }
}

function recipientEnabled(
  kind: LifecycleInput["kind"],
  preference: NonNullable<Recipient["notificationPreference"]>,
): boolean {
  return (
    (kind !== "media_upgraded" || preference.upgrades) &&
    (!["files_quarantined", "files_purged"].includes(kind) ||
      preference.removalCompleted)
  );
}

export async function queueDelivery(
  tx: Prisma.TransactionClient,
  notificationId: string,
  userId: string,
  key: string,
): Promise<void> {
  const operationId = crypto.randomUUID();
  const payload = { operationId, kind: "deliver_notification", notificationId };
  await tx.operation.upsert({
    where: { idempotencyKey: key },
    update: {},
    create: {
      id: operationId,
      idempotencyKey: key,
      userId,
      kind: "deliver_notification",
      targetId: notificationId,
      payload,
      outbox: { create: { kind: "deliver_notification", payload } },
    },
  });
}

export async function queuePublicationNotifications(
  tx: Prisma.TransactionClient,
  attemptId: string,
): Promise<void> {
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  // Retry adopts current intent authority without rewriting the immutable file-effect plan.
  const generations = z
    .record(z.string(), z.number().int().nonnegative())
    .parse(attempt.generations);
  const plan = z
    .array(
      z.object({
        assetId: z.string(),
        checksum: z.string(),
        mediaIds: z.array(z.string()),
        generations: z.record(z.string(), z.number().int()),
        previousAssetId: z.string().nullable(),
      }),
    )
    .parse(attempt.filePlan);
  const coverages = await tx.assetCoverage.findMany({
    where: { mediaId: { in: attempt.mediaIds }, current: true },
    include: { asset: true, media: { include: { intent: true } } },
  });
  const groups: Record<
    "media_available" | "media_upgraded",
    NotificationItem[]
  > = { media_available: [], media_upgraded: [] };
  for (const coverage of coverages) {
    const entry = plan.find(
      (file) =>
        file.assetId === coverage.assetId &&
        file.mediaIds.includes(coverage.mediaId),
    );
    if (
      entry === undefined ||
      coverage.asset.version !== 0 ||
      coverage.asset.checksum !== entry.checksum ||
      coverage.media.intent?.generation !== generations[coverage.mediaId]
    )
      continue;
    if (
      coverage.media.availability !== "available" ||
      coverage.asset.plexPublishedAt === null ||
      coverage.asset.state !== "published" ||
      coverage.media.intent === null
    )
      throw new Error("Notification publication evidence is unverified");
    const predecessor =
      entry.previousAssetId === null
        ? null
        : await tx.libraryAsset.findFirst({
            where: {
              id: entry.previousAssetId,
              supersededByAssetId: coverage.assetId,
              plexPublishedAt: { not: null },
              coverage: { some: { mediaId: coverage.mediaId } },
            },
          });
    groups[predecessor === null ? "media_available" : "media_upgraded"].push({
      mediaId: coverage.mediaId,
      generation: coverage.media.intent.generation,
      assetId: coverage.assetId,
      assetVersion: coverage.asset.version,
      assetChecksum: coverage.asset.checksum,
    });
  }
  for (const kind of ["media_available", "media_upgraded"] as const) {
    if (groups[kind].length > 0)
      await queueLifecycleNotifications(tx, {
        key: `publication:${attemptId}:${kind}`,
        kind,
        epoch: attempt.recoveryEpoch,
        items: groups[kind],
      });
  }
}
