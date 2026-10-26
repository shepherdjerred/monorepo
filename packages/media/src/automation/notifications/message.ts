import { z } from "zod";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import {
  allRequestersWatched,
  type RequesterWatchContext,
} from "./requester-watch.ts";
import { eligibleRequester, isReadiness } from "./readiness.ts";
import { defaultIntent } from "#shared/editions/scope.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import type { CredentialCipher } from "#application/security.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import {
  OwnerHealthSchema,
  ownerHealthDescriptions,
} from "#shared/notification-authority.ts";
import { subtitleAccepted } from "#domain/subtitle-quality.ts";
import {
  currentSubtitleWork,
  subtitleTargetsReady,
} from "#automation/subtitles/authority.ts";
import { assertBoundMediaCohort } from "#automation/retention/binding.ts";
import { assertRetentionPlexProjection } from "#infrastructure/plex-binding/retention.ts";

export const ItemSchema = z.object({
  mediaId: z.string(),
  generation: z.number().int(),
  assetId: z.string().optional(),
  assetVersion: z.number().int().optional(),
  assetChecksum: z.string().optional(),
  subtitleId: z.string().optional(),
  language: z.string().optional(),
  decisionId: z.string().optional(),
});
export const BatchSchema = z.object({
  items: z.array(ItemSchema).max(1000),
  ownerOnly: z.boolean(),
  recoveryEpoch: z.number().int(),
  operationId: z.string().optional(),
});
export const deliveryInclude = {
  event: true,
  user: { include: { notificationPreference: true } },
} satisfies Prisma.NotificationDeliveryInclude;
export type Delivery = Prisma.NotificationDeliveryGetPayload<{
  include: typeof deliveryInclude;
}>;
export type Message = {
  channel: "email" | "discord" | "discord_shared";
  recipient: string;
  subject: string;
  text: string;
};
type Context = {
  cipher: CredentialCipher;
  publicOrigin: string;
} & RequesterWatchContext &
  Pick<
    MediaAutomationContext,
    "sharedAnnouncements" | "personalDiscordAvailable"
  >;

export function eventMediaIds(delivery: Delivery): string[] {
  const batch = BatchSchema.safeParse(delivery.event.payload);
  return batch.success
    ? batch.data.items.map((item) => item.mediaId)
    : delivery.event.mediaId === null
      ? []
      : [delivery.event.mediaId];
}

export async function composeMessage(
  tx: Prisma.TransactionClient,
  context: Context,
  delivery: Delivery,
): Promise<Message | null> {
  if (
    isReadiness(delivery.event.kind) ||
    delivery.event.kind === "retention_warning"
  ) {
    if (context.binding === undefined) return null;
    await assertBoundMediaCohort(
      tx,
      context.binding.cohort,
      context.binding.freshness,
    );
    if (
      context.binding.cohort.original.some(
        (value) => value.authority.purpose !== "current_serving",
      )
    )
      return null;
    context.captureFreshness?.(context.binding.freshness);
  }
  if (delivery.channel === "discord_shared")
    return sharedMessage(tx, context, delivery);
  if (
    delivery.channel === "discord" &&
    (await context.personalDiscordAvailable?.()) !== true
  )
    return null;
  if (delivery.event.kind === "email_verification")
    return verification(tx, context, delivery);
  const target = personalTarget(delivery);
  if (target === null) return null;
  if (delivery.event.kind === "owner_health") {
    const proof = OwnerHealthSchema.parse(delivery.event.payload);
    return {
      ...target,
      subject: "Media automation needs owner attention",
      text: `${ownerHealthDescriptions[proof.reason]}\nReview recovery protections before resuming automation; opening this page does not restore writer or storage authority.\n${new URL("/recovery", context.publicOrigin).toString()}`,
    };
  }
  return delivery.event.kind === "retention_warning"
    ? warning(tx, context, delivery, target)
    : batchMessage(tx, context, delivery, target);
}

function personalTarget(
  delivery: Delivery,
): { channel: "email" | "discord"; recipient: string } | null {
  const channel = z.enum(["email", "discord"]).parse(delivery.channel);
  const preference = delivery.user.notificationPreference;
  const recipient =
    channel === "email" ? delivery.user.email : delivery.user.discordId;
  const enabled =
    channel === "email"
      ? preference?.emailEnabled === true &&
        delivery.user.emailVerifiedAt !== null
      : preference?.discordEnabled === true;
  if (recipient === null || !enabled) return null;
  if (delivery.event.kind === "media_upgraded" && preference?.upgrades !== true)
    return null;
  return ["files_quarantined", "files_purged"].includes(delivery.event.kind) &&
    preference?.removalCompleted !== true
    ? null
    : { channel, recipient };
}

async function batchMessage(
  tx: Prisma.TransactionClient,
  context: Context,
  delivery: Delivery,
  target: { channel: "email" | "discord"; recipient: string },
): Promise<Message | null> {
  const batch = BatchSchema.parse(delivery.event.payload);
  if (
    batch.recoveryEpoch !== delivery.recoveryEpoch ||
    (batch.ownerOnly && delivery.user.role !== "owner")
  )
    return null;
  const titles = await eligibleTitles(tx, delivery, {
    batch,
    movieAccess: context.movieAccess,
    captureFreshness: context.captureFreshness,
  });
  if (
    titles.length === 0 &&
    (!batch.ownerOnly || isReadiness(delivery.event.kind))
  )
    return null;
  const description = descriptions[delivery.event.kind];
  if (description === undefined) throw new Error("Unknown notification kind");
  const title =
    titles.length === 0
      ? "Media"
      : titles.length === 1
        ? (titles[0] ?? "Media")
        : `${String(titles.length)} requested titles`;
  const path =
    titles.length === 1 && batch.items.length === 1
      ? `/media/${encodeURIComponent(batch.items[0]?.mediaId ?? "")}`
      : "/notifications";
  return {
    ...target,
    subject: `Media: ${title.slice(0, 160)}`,
    text: `${title} ${description}.\n${titles
      .slice(0, 10)
      .map((value) => value.slice(0, 100))
      .join("\n")}\n${new URL(path, context.publicOrigin).toString()}`,
  };
}

async function eligibleTitles(
  tx: Prisma.TransactionClient,
  delivery: Delivery,
  input: {
    batch: z.infer<typeof BatchSchema>;
    movieAccess: MovieChoiceAccess | undefined;
    captureFreshness: Context["captureFreshness"];
  },
): Promise<string[]> {
  const { batch } = input;
  const titles: string[] = [];
  for (const item of batch.items) {
    const media = await tx.mediaItem.findUniqueOrThrow({
      where: { id: item.mediaId },
      include: { intents: { where: { edition: "default" } } },
    });
    if (
      defaultIntent(media.intents)?.generation !== item.generation ||
      defaultIntent(media.intents)?.automationEpoch !== delivery.recoveryEpoch
    )
      continue;
    if (
      !(await eligibleRequester(tx, {
        ownerOnly: batch.ownerOnly,
        userId: delivery.userId,
        mediaId: item.mediaId,
        mediaKind: media.kind,
        eventKind: delivery.event.kind,
        item,
        movieAccess: input.movieAccess,
        captureFreshness: input.captureFreshness,
      }))
    )
      continue;
    if (
      !(await itemCurrent(
        tx,
        delivery.event.kind,
        item,
        delivery.recoveryEpoch,
      ))
    )
      continue;
    titles.push(media.title);
  }
  return titles;
}

const descriptions: Record<string, string> = {
  media_available: "is available in Plex",
  media_upgraded: "has been upgraded in Plex",
  subtitles_ready: "has requested subtitles ready",
  acquisition_failed: "needs attention",
  system_intervention: "needs owner attention",
  files_quarantined: "has moved to recoverable quarantine",
  files_purged: "has been removed",
};

async function sharedMessage(
  tx: Prisma.TransactionClient,
  context: Context,
  delivery: Delivery,
): Promise<Message | null> {
  if (
    !["media_available", "media_upgraded"].includes(delivery.event.kind) ||
    delivery.user.role !== "owner"
  )
    return null;
  const settings = await context.sharedAnnouncements?.();
  if (
    settings?.enabled !== true ||
    !settings.available ||
    settings.channelId === "" ||
    (delivery.event.kind === "media_upgraded" && !settings.upgrades)
  )
    return null;
  const batch = BatchSchema.extend({ channelId: z.string() }).parse(
    delivery.event.payload,
  );
  if (
    batch.channelId !== settings.channelId ||
    batch.recoveryEpoch !== delivery.recoveryEpoch
  )
    return null;
  const titles: string[] = [];
  for (const item of batch.items) {
    const media = await tx.mediaItem.findUniqueOrThrow({
      where: { id: item.mediaId },
      include: { intents: { where: { edition: "default" } } },
    });
    if (
      defaultIntent(media.intents)?.automationEpoch ===
        delivery.recoveryEpoch &&
      defaultIntent(media.intents)?.generation === item.generation &&
      (await itemCurrent(tx, delivery.event.kind, item, delivery.recoveryEpoch))
    )
      titles.push(media.title);
  }
  if (titles.length === 0) return null;
  return {
    channel: "discord_shared",
    recipient: settings.channelId,
    subject:
      delivery.event.kind === "media_upgraded"
        ? "Plex library upgrades"
        : "New in Plex",
    text: `${String(titles.length)} title(s):\n${titles
      .slice(0, 10)
      .map((title) => title.slice(0, 100))
      .join("\n")}`,
  };
}

async function itemCurrent(
  tx: Prisma.TransactionClient,
  kind: string,
  item: z.infer<typeof ItemSchema>,
  epoch: number,
): Promise<boolean> {
  if (["media_available", "media_upgraded", "subtitles_ready"].includes(kind)) {
    return publishedItemCurrent(tx, kind, item, epoch);
  }
  if (kind === "files_quarantined" || kind === "files_purged") {
    const decision = await tx.retentionDecision.findUnique({
      where: { id: item.decisionId ?? "" },
    });
    return (
      decision?.edition === "default" &&
      decision.state === (kind === "files_purged" ? "purged" : "quarantined")
    );
  }
  return true;
}

async function publishedItemCurrent(
  tx: Prisma.TransactionClient,
  kind: string,
  item: z.infer<typeof ItemSchema>,
  epoch: number,
): Promise<boolean> {
  if (
    item.assetId === undefined ||
    item.assetVersion === undefined ||
    item.assetChecksum === undefined
  )
    return false;
  const coverage = await tx.assetCoverage.findUnique({
    where: {
      assetId_mediaId: { assetId: item.assetId, mediaId: item.mediaId },
    },
    include: { asset: true, media: true },
  });
  if (
    coverage?.current !== true ||
    coverage.edition !== "default" ||
    coverage.asset.edition !== "default" ||
    coverage.media.availability !== "available" ||
    coverage.asset.state !== "published" ||
    coverage.asset.ownershipEpoch !== epoch ||
    coverage.asset.plexPublishedAt === null ||
    coverage.asset.version !== item.assetVersion ||
    coverage.asset.checksum !== item.assetChecksum
  )
    return false;
  if (kind === "subtitles_ready") {
    const work = await currentSubtitleWork(tx, coverage.asset.id, epoch);
    if (!subtitleTargetsReady(work, epoch)) return false;
    const subtitle = await tx.subtitleAsset.findUnique({
      where: { id: item.subtitleId ?? "" },
    });
    return (
      subtitle !== null &&
      item.language !== undefined &&
      subtitleAccepted({
        subtitle,
        asset: coverage.asset,
        epoch,
        target: { language: item.language },
      })
    );
  }
  return true;
}

async function warning(
  tx: Prisma.TransactionClient,
  context: Context,
  delivery: Delivery,
  target: { channel: "email" | "discord"; recipient: string },
): Promise<Message | null> {
  const { decisionId, generation } = z
    .object({ decisionId: z.string(), generation: z.number().int() })
    .parse(delivery.event.payload);
  const decision = await tx.retentionDecision.findUnique({
    where: { id: decisionId },
    include: {
      media: {
        include: {
          intents: { where: { edition: "default" } },
          holds: { where: { edition: "default" } },
        },
      },
    },
  });
  if (
    decision?.mediaId !== delivery.event.mediaId ||
    decision.edition !== "default" ||
    decision.generation !== generation ||
    defaultIntent(decision.media.intents)?.generation !== generation ||
    defaultIntent(decision.media.intents)?.automationEpoch !==
      delivery.recoveryEpoch ||
    !["warning_pending", "grace_period"].includes(decision.state) ||
    decision.media.holds.some(
      (hold) => hold.isPin || hold.until === null || hold.until > new Date(),
    )
  )
    return null;
  if (context.binding === undefined) return null;
  const binding = await assertBoundMediaCohort(
    tx,
    context.binding.cohort,
    context.binding.freshness,
  );
  await assertRetentionPlexProjection(
    tx,
    { decisionId: decision.id, ...binding },
    context.binding.freshness,
  );
  const claim = await tx.mediaRequest.findFirst({
    where: {
      userId: delivery.userId,
      mediaId: decision.mediaId,
      ...effectiveRequestWhere,
      edition: "default",
    },
  });
  if (
    claim === null ||
    delivery.user.role === "owner" ||
    !(await allRequestersWatched(tx, context))
  )
    return null;
  return {
    ...target,
    subject: `Media: ${decision.media.title.slice(0, 160)}`,
    text: `${decision.media.title} is eligible for removal after at least seven days. Open Media to confirm Keep or pin it.\n${new URL(`/media/${encodeURIComponent(decision.mediaId)}`, context.publicOrigin).toString()}`,
  };
}

async function verification(
  tx: Prisma.TransactionClient,
  context: Context,
  delivery: Delivery,
): Promise<Message | null> {
  if (delivery.channel !== "email")
    throw new Error("Invalid verification channel");
  const { verificationId } = z
    .object({ verificationId: z.string() })
    .parse(delivery.event.payload);
  const record = await tx.emailVerification.findUnique({
    where: { id: verificationId },
  });
  if (record?.userId !== delivery.userId || record.expiresAt <= new Date())
    return null;
  const url = new URL("/notifications/email", context.publicOrigin);
  url.hash = new URLSearchParams({
    verify: context.cipher.decrypt(record.encryptedToken, `email:${record.id}`),
  }).toString();
  return {
    channel: "email",
    recipient: record.email,
    subject: "Verify your Media email",
    text: `Verify this address while signed in to Media: ${url.toString()}`,
  };
}
