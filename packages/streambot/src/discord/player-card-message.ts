/**
 * discord.js adapter for the player card: turns the neutral descriptors from `player-card.ts` into
 * an embed plus action rows, performs the send/edit/delete, and owns the message → session routing
 * table that `command-bot.ts` consults when a button is clicked.
 *
 * Routing lives here rather than in the component ids because a card outlives any interaction token:
 * a click arrives hours later carrying only `interaction.message.id`, which this table maps back to
 * the owning `(guild, voice channel)`. A card whose session has since ended — or one that predates a
 * restart — simply isn't in the table, and the router answers "That stream has ended."
 *
 * This mirrors the role `pagination.ts` and `subtitle-menu.ts` play for their own features: the
 * discord.js-shaped edge of an otherwise pure feature.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Client,
  EmbedBuilder,
  type MessageActionRowComponentBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import type {
  ButtonSpec,
  ButtonStyleName,
  PlayerCardPayload,
  SelectSpec,
} from "@shepherdjerred/streambot/discord/player-card.ts";
import type {
  CardEditResult,
  CardOwner,
  PlayerCardPort,
} from "@shepherdjerred/streambot/discord/player-card-manager.ts";
import type { ChannelId } from "@shepherdjerred/streambot/types/ids.ts";
import {
  getErrorMessage,
  isUnknownMessageError,
} from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("player-card-message");

function toButtonStyle(style: ButtonStyleName): ButtonStyle {
  switch (style) {
    case "primary":
      return ButtonStyle.Primary;
    case "secondary":
      return ButtonStyle.Secondary;
    case "danger":
      return ButtonStyle.Danger;
    case "success":
      return ButtonStyle.Success;
  }
}

function toButtonRow(
  buttons: readonly ButtonSpec[],
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    ...buttons.map((spec) =>
      new ButtonBuilder()
        .setCustomId(spec.id)
        .setLabel(spec.label)
        .setStyle(toButtonStyle(spec.style))
        .setDisabled(spec.disabled),
    ),
  );
}

function toSelectRow(
  select: SelectSpec,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(select.id)
      .setPlaceholder(select.placeholder)
      .addOptions(
        ...select.options.map((option) => ({
          label: option.label,
          value: option.value,
          description: option.description,
        })),
      ),
  );
}

/**
 * Message options shared by `channel.send` and `message.edit`. Spelled out structurally rather than
 * as `MessageEditOptions`/`MessageCreateOptions`, whose `flags` unions differ and so are not
 * mutually assignable under `exactOptionalPropertyTypes`.
 */
type CardMessageOptions = {
  readonly content: string;
  readonly embeds: readonly EmbedBuilder[];
  readonly components: readonly ActionRowBuilder<MessageActionRowComponentBuilder>[];
};

/** Render a payload into the message options shared by `send` and `edit`. */
export function toMessagePayload(
  payload: PlayerCardPayload,
): CardMessageOptions {
  const embeds: EmbedBuilder[] = [];
  if (payload.embed !== null) {
    const embed = new EmbedBuilder().setTitle(payload.embed.title);
    if (payload.embed.description !== null) {
      embed.setDescription(payload.embed.description);
    }
    if (payload.embed.imageUrl !== null) {
      embed.setImage(payload.embed.imageUrl);
    }
    if (payload.embed.thumbnailUrl !== null) {
      embed.setThumbnail(payload.embed.thumbnailUrl);
    }
    embeds.push(embed);
  }
  const components = [
    ...payload.rows
      .filter((row) => row.length > 0)
      .map((row) => toButtonRow(row)),
    ...(payload.select === null ? [] : [toSelectRow(payload.select)]),
  ];
  return { content: payload.content, embeds, components };
}

/** {@link PlayerCardPort} backed by a live discord.js client, plus the click-routing table. */
export class PlayerCardMessenger implements PlayerCardPort {
  private readonly client: Client;
  /** Live card message id → the session that owns it. */
  private readonly owners = new Map<string, CardOwner>();

  constructor(client: Client) {
    this.client = client;
  }

  /** The session a clicked card belongs to, or null when the card is stale/unknown. */
  ownerOf(messageId: string): CardOwner | null {
    return this.owners.get(messageId) ?? null;
  }

  register(messageId: string, owner: CardOwner): void {
    this.owners.set(messageId, owner);
  }

  unregister(messageId: string): void {
    this.owners.delete(messageId);
  }

  async post(
    channelId: ChannelId,
    payload: PlayerCardPayload,
    owner: CardOwner | null,
  ): Promise<string | null> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel?.isSendable() !== true) {
        return null;
      }
      const message = await channel.send(toMessagePayload(payload));
      // A null owner means the message carries no controls (the legacy announcement), so there is
      // nothing to route and registering it would leak an entry nothing ever removes.
      if (owner !== null) {
        this.register(message.id, owner);
      }
      return message.id;
    } catch (error) {
      log.warn("posting player card failed", {
        channelId,
        error: getErrorMessage(error),
      });
      return null;
    }
  }

  async edit(
    channelId: ChannelId,
    messageId: string,
    payload: PlayerCardPayload,
  ): Promise<CardEditResult> {
    try {
      const message = await this.fetchMessage(channelId, messageId);
      if (message === null) {
        return "gone";
      }
      await message.edit(toMessagePayload(payload));
      return "ok";
    } catch (error) {
      if (isUnknownMessageError(error)) {
        this.owners.delete(messageId);
        return "gone";
      }
      log.warn("editing player card failed", {
        channelId,
        error: getErrorMessage(error),
      });
      // A rate limit or transient 5xx: the card still exists, so don't orphan it with a re-post —
      // but report the failure so the caller retries instead of caching an undelivered payload.
      return "failed";
    }
  }

  async strip(channelId: ChannelId, messageId: string): Promise<void> {
    this.owners.delete(messageId);
    try {
      const message = await this.fetchMessage(channelId, messageId);
      await message?.edit({ components: [] });
    } catch (error) {
      if (isUnknownMessageError(error)) {
        return;
      }
      log.warn("stripping player card controls failed", {
        channelId,
        error: getErrorMessage(error),
      });
    }
  }

  async remove(channelId: ChannelId, messageId: string): Promise<void> {
    this.owners.delete(messageId);
    try {
      const message = await this.fetchMessage(channelId, messageId);
      await message?.delete();
    } catch (error) {
      if (isUnknownMessageError(error)) {
        return;
      }
      log.warn("deleting player card failed", {
        channelId,
        error: getErrorMessage(error),
      });
    }
  }

  private async fetchMessage(channelId: ChannelId, messageId: string) {
    const channel = await this.client.channels.fetch(channelId);
    if (channel?.isTextBased() !== true) {
      return null;
    }
    return await channel.messages.fetch(messageId);
  }
}
