import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { MessageFlags, type InteractionEditReplyOptions } from "discord.js";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { getGuildPageUrl } from "#src/discord/commands/links.ts";
import { parseScoutCreateCustomId } from "#src/discord/scout/custom-id.ts";
import { NO_GENERATED_MENTIONS } from "#src/discord/scout/messages.ts";
import { confirmCreation } from "#src/explore/creation/confirm.ts";
import type { CreationIntentOutcome } from "#src/lib/confirmation-intent/creation.ts";
import type { ClaimRefusal } from "#src/lib/confirmation-intent/claim.ts";
import { resolveGuildPermissionsForMember } from "#src/trpc/guild-permission.ts";

/**
 * The Confirm button under a Discord answer that prepared a creation.
 *
 * Discord askers have no web session, so the confirmer is built from what the
 * interaction proves: who clicked, in which server, with permissions Scout's
 * bot resolves now. Everything else — the actor check, the feature gate, the
 * single-use claim, the audit row — is the same path the web card runs.
 */

export type ScoutCreateButtonInteraction = {
  readonly customId: string;
  readonly guildId: z.input<typeof DiscordGuildIdSchema> | null;
  readonly user: { readonly id: string };
  readonly deferReply: (options: {
    flags: MessageFlags.Ephemeral;
  }) => Promise<unknown>;
  readonly editReply: (
    options: InteractionEditReplyOptions,
  ) => Promise<unknown>;
};

/** What a first confirmation stored on the intent, read back for a second press. */
const StoredOutcomeSchema = z.union([
  z.strictObject({
    kind: z.literal("created"),
    entity: z.enum(["report", "subscription", "competition"]),
    entityId: z.number().int(),
    guildId: DiscordGuildIdSchema,
  }),
  z.strictObject({
    kind: z.enum([
      "limit_reached",
      "invalid_query",
      "invalid_configuration",
      "rate_limited",
      "missing_permission",
      "account_already_subscribed",
      "subscription_already_exists",
      "riot_id_not_found",
    ]),
    message: z.string(),
  }),
]);

const PAGE_FOR_ENTITY = {
  report: "reports",
  subscription: "subscriptions",
  competition: "competitions",
} as const;

/** What to tell the clicker, in the words the web card uses. */
export function creationOutcomeMessage(
  outcome: CreationIntentOutcome | ClaimRefusal,
  guildId: DiscordGuildId,
): string {
  switch (outcome.kind) {
    case "created": {
      return `Done — your ${outcome.entity} is created. Manage it at ${getGuildPageUrl(guildId, PAGE_FOR_ENTITY[outcome.entity])}`;
    }
    case "intent_expired": {
      return "This confirmation expired, so nothing was created. Ask Scout to prepare it again.";
    }
    case "already_consumed": {
      // Written by this same path; a row that does not parse is a broken
      // writer, so it fails loudly rather than reading as "already used".
      return creationOutcomeMessage(
        StoredOutcomeSchema.parse(outcome.result),
        guildId,
      );
    }
    case "limit_reached":
    case "invalid_query":
    case "invalid_configuration":
    case "rate_limited":
    case "missing_permission":
    case "account_already_subscribed":
    case "subscription_already_exists":
    case "riot_id_not_found": {
      return `Nothing was created: ${outcome.message}`;
    }
  }
}

async function intentGuild(intentId: string): Promise<DiscordGuildId | null> {
  const intent = await prisma.confirmationIntent.findUnique({
    where: { id: intentId },
    select: { serverId: true },
  });
  return intent === null ? null : DiscordGuildIdSchema.parse(intent.serverId);
}

export async function handleScoutCreateButton(
  interaction: ScoutCreateButtonInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const parsed = parseScoutCreateCustomId(interaction.customId);
  if (parsed === undefined) {
    await interaction.editReply({
      content: "That Scout action is no longer valid.",
    });
    return;
  }
  // A voice answer's button arrives by DM, with no server on the interaction.
  // The server is then the one on the intent row; the confirm path still
  // requires the clicker to be the intent's actor and a member there.
  const guildId =
    interaction.guildId === null
      ? await intentGuild(parsed.intentId)
      : DiscordGuildIdSchema.parse(interaction.guildId);
  if (guildId === null) {
    await interaction.editReply({
      content: "That confirmation is not yours or no longer exists.",
    });
    return;
  }
  const actorId = DiscordAccountIdSchema.parse(interaction.user.id);
  try {
    const outcome = await confirmCreation({
      intentId: parsed.intentId,
      confirmer: {
        actorId,
        guildIds: [guildId],
        resolvePermissions: (target) =>
          resolveGuildPermissionsForMember(actorId, target),
        ipAddress: null,
        userAgent: null,
        surface: "discord",
      },
    });
    await interaction.editReply({
      content: creationOutcomeMessage(outcome, guildId),
      allowedMentions: NO_GENERATED_MENTIONS,
    });
  } catch (error) {
    // Expected refusals arrive as the same TRPCErrors the web card shows;
    // anything else is a bug and propagates to the router's error handler.
    if (!(error instanceof TRPCError)) throw error;
    await interaction.editReply({
      content:
        error.code === "NOT_FOUND"
          ? "That confirmation is not yours or no longer exists."
          : `Nothing was created: ${error.message}`,
      allowedMentions: NO_GENERATED_MENTIONS,
    });
  }
}
