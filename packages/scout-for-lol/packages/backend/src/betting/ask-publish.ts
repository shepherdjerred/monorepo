import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type APIActionRowComponent,
  type APIComponentInMessageActionRow,
  type APIEmbed,
} from "discord.js";
import { z } from "zod";
import {
  parseBucksAskPublishCustomId,
  type BucksAskPublishCustomId,
} from "#src/betting/ask-custom-id.ts";

const CLAIM_TTL_MS = 60 * 60 * 1000;
const MAX_CLAIMS = 1000;
const DefinitiveDiscordApiFailureSchema = z.object({ code: z.number() });

type PublishClaim =
  | { state: "posting"; claimedAt: number }
  | {
      state: "posted";
      claimedAt: number;
      buttonDisabledAt: number | null;
    };

export type BucksAskPublicMessage = {
  content: string;
  embeds: APIEmbed[];
  allowedMentions: { parse: [] };
  nonce: string;
  enforceNonce: true;
};

export type BucksAskPublishInteraction = {
  customId: string;
  user: { id: string };
  client: { user: { id: string } };
  message: {
    id: string;
    author: { id: string };
    embeds: readonly { toJSON: () => APIEmbed }[];
  };
  sendPublic: (message: BucksAskPublicMessage) => Promise<unknown>;
  deferUpdate: () => Promise<unknown>;
  reply: (options: { content: string; ephemeral: true }) => Promise<unknown>;
  editReply: (options: {
    content: string;
    components?: APIActionRowComponent<APIComponentInMessageActionRow>[];
  }) => Promise<unknown>;
  followUp: (options: { content: string; ephemeral: true }) => Promise<unknown>;
};

export type BucksAskPublishOutcome = "failed" | "not_posted" | "posted";

const claims = new Map<string, PublishClaim>();

export async function handleBucksAskPublish(
  interaction: BucksAskPublishInteraction,
): Promise<BucksAskPublishOutcome> {
  const parsed = parseBucksAskPublishCustomId(interaction.customId);
  if (parsed === undefined) {
    await interaction.deferUpdate();
    return "not_posted";
  }
  if (interaction.user.id !== parsed.askerDiscordId) {
    await interaction.reply({
      content: "Only the person who asked this question can post its answer.",
      ephemeral: true,
    });
    return "not_posted";
  }
  if (
    interaction.message.author.id !== interaction.client.user.id ||
    interaction.message.embeds.length !== 1
  ) {
    await interaction.reply({
      content: "This Bryan Bucks answer can no longer be posted.",
      ephemeral: true,
    });
    return "not_posted";
  }

  const claim = claimPublish(interaction.message.id);
  if (claim !== "claimed") {
    await interaction.reply({
      content:
        claim === "posted"
          ? "This Bryan Bucks answer was already posted."
          : claim === "posting"
            ? "This Bryan Bucks answer is already being posted."
            : "Bryan Bucks publishing is busy right now. Try again shortly.",
      ephemeral: true,
    });
    return "not_posted";
  }

  let sendStarted = false;
  let posted = false;
  try {
    await interaction.deferUpdate();
    sendStarted = true;
    await interaction.sendPublic(publicMessage(parsed, interaction));
    posted = true;
    claims.set(interaction.message.id, {
      state: "posted",
      claimedAt: Date.now(),
      buttonDisabledAt: null,
    });
    await interaction.editReply({
      content: "✅ Posted publicly.",
      components: publishComponents(interaction.customId, true),
    });
    claims.set(interaction.message.id, {
      state: "posted",
      claimedAt: Date.now(),
      buttonDisabledAt: Date.now(),
    });
  } catch (error) {
    if (!sendStarted) {
      claims.delete(interaction.message.id);
      throw error;
    }
    if (!posted) {
      if (isDefinitiveDiscordApiFailure(error)) {
        claims.delete(interaction.message.id);
        await interaction.followUp({
          content:
            "I couldn't post that answer in this channel. Check my send-message permission and try again.",
          ephemeral: true,
        });
        return "failed";
      }
      // A connection failure cannot prove whether Discord accepted the send.
      // Leave the source button enabled and release the local claim: a retry
      // reuses the source-message nonce with enforceNonce, so Discord returns
      // the accepted message instead of creating another one. Disabling before
      // the send would strand the answer if this process exited in between.
      claims.delete(interaction.message.id);
      await interaction.followUp({
        content:
          "I couldn't confirm whether Discord posted that answer. The button is still available to retry safely.",
        ephemeral: true,
      });
      return "failed";
    }
    // The public send is the authoritative side effect. A later failure to
    // replace the private progress copy cannot undo it or turn the run into a
    // provider failure; retain the duplicate-suppression claim and report the
    // completed public outcome.
    claims.set(interaction.message.id, {
      state: "posted",
      claimedAt: Date.now(),
      buttonDisabledAt: null,
    });
    return "posted";
  }
  return "posted";
}

function publicMessage(
  parsed: BucksAskPublishCustomId,
  interaction: BucksAskPublishInteraction,
): BucksAskPublicMessage {
  // Discord enforces this source-message nonce server-side, so a retry after
  // an ambiguous response or process restart returns the original public post.
  return {
    content: `Asked by <@${parsed.askerDiscordId}>`,
    embeds: interaction.message.embeds.map((embed) => embed.toJSON()),
    allowedMentions: { parse: [] },
    nonce: interaction.message.id,
    enforceNonce: true,
  };
}

function publishComponents(
  customId: string,
  disabled: boolean,
): APIActionRowComponent<APIComponentInMessageActionRow>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(customId)
          .setLabel("Post publicly")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled),
      )
      .toJSON(),
  ];
}

function claimPublish(
  messageId: string,
): "capacity" | "claimed" | "posting" | "posted" {
  pruneClaims(Date.now());
  const existing = claims.get(messageId);
  if (existing !== undefined) {
    return existing.state;
  }
  if (claims.size >= MAX_CLAIMS) {
    return "capacity";
  }
  claims.set(messageId, { state: "posting", claimedAt: Date.now() });
  return "claimed";
}

function pruneClaims(now: number): void {
  for (const [key, claim] of claims) {
    const expiresAt =
      claim.state === "posting"
        ? claim.claimedAt + CLAIM_TTL_MS
        : claim.buttonDisabledAt === null
          ? null
          : claim.buttonDisabledAt + CLAIM_TTL_MS;
    if (expiresAt !== null && now >= expiresAt) {
      claims.delete(key);
    }
  }
}

export function resetBucksAskPublishClaimsForTests(): void {
  claims.clear();
}

function isDefinitiveDiscordApiFailure(error: unknown): boolean {
  return DefinitiveDiscordApiFailureSchema.safeParse(error).success;
}
