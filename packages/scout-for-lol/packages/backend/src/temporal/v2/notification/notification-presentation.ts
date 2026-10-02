import { z } from "zod";
import {
  ActionRowBuilder,
  ButtonBuilder,
  type APIEmbed,
  type MessageCreateOptions,
} from "discord.js";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import {
  prisma,
  type Db,
  type ExtendedPrismaClient,
} from "#src/database/index.ts";
import type { NotificationIntent } from "@scout-for-lol/domain/notifications/intent.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { fetchChannelForDelivery } from "#src/discord/utils/channel.ts";
import { clashSurfaceEnabledForGuild } from "#src/league/clash/access.ts";
import { selectTip } from "#src/tips/tip-selection.ts";
import {
  claimTip,
  confirmTipClaim,
  releaseTipClaim,
} from "#src/tips/tip-state.ts";
import { parseTipKey } from "#src/tips/tip-catalog.ts";
import { withFeatureTip } from "#src/tips/tip-render.ts";
import { getSubjectIntent } from "#src/database/durable/intent-repository.ts";
import { NotificationIntentKeySchema } from "@scout-for-lol/domain/identity/brands.ts";

const image = z.strictObject({ url: z.string() });
const embed = z
  .strictObject({
    title: z.string().optional(),
    description: z.string().optional(),
    url: z.string().optional(),
    color: z.int().optional(),
    timestamp: z.string().optional(),
    image: image.optional(),
    thumbnail: image.optional(),
    footer: z
      .strictObject({ text: z.string(), icon_url: z.string().optional() })
      .transform((value) => ({
        text: value.text,
        ...(value.icon_url === undefined ? {} : { icon_url: value.icon_url }),
      }))
      .optional(),
    author: z
      .strictObject({
        name: z.string(),
        url: z.string().optional(),
        icon_url: z.string().optional(),
      })
      .optional(),
    fields: z
      .array(
        z.strictObject({
          name: z.string(),
          value: z.string(),
          inline: z.boolean().optional(),
        }),
      )
      .optional(),
  })
  .transform((value): APIEmbed => {
    const output: APIEmbed = {};
    if (value.title !== undefined) output.title = value.title;
    if (value.description !== undefined) output.description = value.description;
    if (value.url !== undefined) output.url = value.url;
    if (value.color !== undefined) output.color = value.color;
    if (value.timestamp !== undefined) output.timestamp = value.timestamp;
    if (value.image !== undefined) output.image = value.image;
    if (value.thumbnail !== undefined) output.thumbnail = value.thumbnail;
    if (value.footer !== undefined) output.footer = value.footer;
    if (value.author !== undefined)
      output.author = {
        name: value.author.name,
        ...(value.author.url === undefined ? {} : { url: value.author.url }),
        ...(value.author.icon_url === undefined
          ? {}
          : { icon_url: value.author.icon_url }),
      };
    const fields = value.fields?.map((field) => ({
      name: field.name,
      value: field.value,
      ...(field.inline === undefined ? {} : { inline: field.inline }),
    }));
    if (fields !== undefined) output.fields = fields;
    return output;
  });
const buttonBase = {
  type: z.literal(2),
  label: z.string().optional(),
  disabled: z.boolean().optional(),
  emoji: z
    .strictObject({
      id: z.string().optional(),
      name: z.string().optional(),
      animated: z.boolean().optional(),
    })
    .optional(),
};
const button = z
  .union([
    z.strictObject({
      ...buttonBase,
      style: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
      custom_id: z.string(),
    }),
    z.strictObject({ ...buttonBase, style: z.literal(5), url: z.string() }),
  ])
  .transform((value) => {
    const output = new ButtonBuilder().setStyle(value.style);
    if ("custom_id" in value) output.setCustomId(value.custom_id);
    else output.setURL(value.url);
    if (value.label !== undefined) output.setLabel(value.label);
    if (value.disabled !== undefined) output.setDisabled(value.disabled);
    if (value.emoji !== undefined)
      output.setEmoji({
        ...(value.emoji.id === undefined ? {} : { id: value.emoji.id }),
        ...(value.emoji.name === undefined ? {} : { name: value.emoji.name }),
        ...(value.emoji.animated === undefined
          ? {}
          : { animated: value.emoji.animated }),
      });
    return output;
  });
/** A versioned, closed snapshot of the furniture these two builders produce.
 * Attachments remain in their separately attested S3 render receipts. */
export const NotificationMessageSnapshotSchema = z.strictObject({
  version: z.literal(1),
  content: z.string().default(""),
  embeds: z.array(embed).default([]),
  components: z
    .array(
      z
        .strictObject({ type: z.literal(1), components: z.array(button) })
        .transform((row) =>
          new ActionRowBuilder<ButtonBuilder>().addComponents(row.components),
        ),
    )
    .default([]),
});

export async function prepareNotificationPresentation(
  record: MatchNotificationIntentRecord,
  database: ExtendedPrismaClient = prisma,
) {
  if (record.intent.kind !== "prematch") return null;
  const existing = await database.notificationPresentation.findUnique({
    where: { intentKey: record.intent.key },
  });
  if (existing !== null) return existing;
  if (record.intent.target.kind !== "channel") return null;
  const channel = await fetchChannelForDelivery(record.intent.target.channelId);
  if (channel === null) return null;
  const serverId = DiscordGuildIdSchema.parse(
    "guildId" in channel ? channel.guildId : undefined,
  );
  return await database.notificationPresentation.upsert({
    where: { intentKey: record.intent.key },
    update: {},
    create: {
      intentKey: record.intent.key,
      serverId,
      clashEnabled: await clashSurfaceEnabledForGuild(serverId),
      guildPrematchArtifact: true,
    },
  });
}

export async function freezeNotificationMessage(
  record: MatchNotificationIntentRecord,
  message: MessageCreateOptions,
  serverId: string | undefined,
  database: ExtendedPrismaClient = prisma,
): Promise<MessageCreateOptions> {
  if (serverId === undefined) return message;
  const guildId = DiscordGuildIdSchema.parse(serverId);
  const saved = await database.$transaction(
    async (tx) => {
      // Serialise tip cadence across simultaneous prematch/postmatch targets.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`notification-presentation:${guildId}`}, 0))`;
      const current = await tx.notificationPresentation.upsert({
        where: { intentKey: record.intent.key },
        update: {},
        // An old execution can have a global render already. Its presentation
        // explicitly retains that artifact rather than inventing a guild one.
        create: {
          intentKey: record.intent.key,
          serverId: guildId,
          clashEnabled: false,
          guildPrematchArtifact: false,
        },
      });
      if (current.serverId !== guildId)
        throw new Error("Notification presentation destination changed");
      if (current.messageJson !== null) return current.messageJson;
      let decorated = message;
      let chosen: Awaited<ReturnType<typeof selectTip>>;
      const tip = await selectTip({ serverId: guildId }, { db: tx });
      if (
        tip !== undefined &&
        withFeatureTip(message, tip) !== message &&
        (await claimTip({ serverId: guildId, tipKey: tip.key }, tx))
      ) {
        decorated = withFeatureTip(message, tip);
        chosen = tip;
      }
      // Discord builders serialize through toJSON; structuredClone would lose
      // that protocol and cannot produce the persisted API representation.
      const serialized = JSON.stringify({
        version: 1,
        content: decorated.content,
        embeds: decorated.embeds,
        components: decorated.components,
      });
      const snapshot = NotificationMessageSnapshotSchema.parse(
        JSON.parse(serialized),
      );
      const messageJson = JSON.stringify(snapshot);
      await tx.notificationPresentation.update({
        where: { intentKey: record.intent.key },
        data: {
          messageJson,
          tipKey: chosen?.key ?? null,
          tipText: chosen?.text ?? null,
        },
      });
      return messageJson;
    },
    { timeout: 15_000 },
  );
  const { version: _version, ...snapshot } =
    NotificationMessageSnapshotSchema.parse(JSON.parse(saved));
  return { ...message, ...snapshot };
}

export async function confirmNotificationTip(
  record: MatchNotificationIntentRecord,
  database: ExtendedPrismaClient = prisma,
): Promise<void> {
  if (record.intent.state.kind !== "delivered") return;
  await database.$transaction(async (tx) => {
    await settleNotificationTip(record.intent, tx);
  });
}

/** Called inside a transaction. Definitively unsent tips become eligible again;
 * ambiguous and retryable attempts retain their frozen claim. Clearing the
 * association once prevents a repeated suppression from releasing a newer claim. */
export async function settleNotificationTip(
  intent: NotificationIntent,
  database: Db,
): Promise<void> {
  const state = intent.state.kind;
  if (
    state !== "delivered" &&
    state !== "suppressed" &&
    state !== "expired" &&
    state !== "permission-denied"
  )
    return;
  const presentation = await database.notificationPresentation.findUnique({
    where: { intentKey: intent.key },
  });
  if (presentation?.tipKey == null) return;
  const audience = {
    serverId: DiscordGuildIdSchema.parse(presentation.serverId),
    tipKey: parseTipKey(presentation.tipKey),
  };
  const cleared = await database.notificationPresentation.updateMany({
    where: { intentKey: intent.key, tipKey: presentation.tipKey },
    data: { tipKey: null, tipText: null },
  });
  if (cleared.count === 1) {
    if (state === "delivered") await confirmTipClaim(audience, database);
    else await releaseTipClaim(audience, database);
  }
}

/** Repair settlement after an expiry/retirement sweep or a crash between the
 * intent transition and presentation bookkeeping. Terminal states cannot reopen. */
export async function settleTerminalNotificationTips(
  database: ExtendedPrismaClient = prisma,
): Promise<void> {
  const rows =
    await database.$queryRaw`SELECT p."intentKey" FROM "NotificationPresentation" p
    JOIN "MatchNotificationIntent" i ON i."intentKey" = p."intentKey"
    WHERE p."tipKey" IS NOT NULL AND i.state IN ('delivered', 'suppressed', 'expired', 'permission-denied')
    ORDER BY p."createdAt", p."intentKey" LIMIT 200`;
  const keys = z
    .array(z.object({ intentKey: NotificationIntentKeySchema }))
    .parse(rows);
  for (const { intentKey } of keys) {
    await database.$transaction(async (tx) => {
      const record = await getSubjectIntent(tx, { intentKey });
      if (record === null)
        throw new Error(
          `Notification presentation ${intentKey} lost its intent`,
        );
      await settleNotificationTip(record.intent, tx);
    });
  }
}
