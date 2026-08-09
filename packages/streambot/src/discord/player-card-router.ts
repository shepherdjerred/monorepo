/**
 * Routes a player-card button click or chapter pick back to the session that owns the card, checks
 * permissions, applies the effect, and acks the presser.
 *
 * Lives outside `command-bot.ts` for the same reason `pagination.ts` does: that file is close to the
 * 500-line `max-lines` cap, and this is a self-contained edge. Unlike pagination's per-message
 * collector, a card can be clicked hours after it was posted — long after any collector or
 * interaction token would have expired — so routing goes through the messenger's message → owner
 * table and every click is a fresh interaction.
 */
import {
  MessageFlags,
  type MessageComponentInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import * as Sentry from "@sentry/bun";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import {
  ControlAction,
  decodeControlId,
  resolveControlAction,
  type ControlOutcome,
} from "@shepherdjerred/streambot/discord/player-controls.ts";
import type { PlayerCardMessenger } from "@shepherdjerred/streambot/discord/player-card-message.ts";
import type { SessionHandle } from "@shepherdjerred/streambot/session/session-types.ts";
import type { CardOwner } from "@shepherdjerred/streambot/discord/player-card-manager.ts";
import {
  toUserId,
  type ChannelId,
} from "@shepherdjerred/streambot/types/ids.ts";
import {
  getErrorMessage,
  isStaleInteractionError,
} from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("player-card-router");

export type PlayerCardRouterDeps = {
  readonly config: Config;
  readonly messenger: PlayerCardMessenger;
  /** The live session for a card's owner, or null once it has ended. */
  readonly sessionFor: (owner: CardOwner) => SessionHandle | null;
  /** Re-render the owner's card now, so the channel sees the effect without waiting for a tick. */
  readonly refreshCard: (owner: CardOwner) => void;
  /** Voice channel the clicking user currently sits in, or null when they're not in voice. */
  readonly voiceChannelOf: (
    interaction: MessageComponentInteraction,
  ) => ChannelId | null;
  /**
   * Open the `/stream subtitles` track picker over this interaction. Implemented in `command-bot.ts`
   * by running the real {@link CommandHandler}, so the single-flight guard and the
   * playback-moved-on re-check are shared with the slash command rather than reimplemented.
   */
  readonly openSubtitlePicker: (
    interaction: MessageComponentInteraction,
    handle: SessionHandle,
  ) => Promise<void>;
};

/** 1-based chapter number from a chapter-menu pick, or undefined when the value is unusable. */
function pickedChapterNumber(
  interaction: MessageComponentInteraction,
): number | undefined {
  if (!interaction.isStringSelectMenu()) {
    return undefined;
  }
  const selected: StringSelectMenuInteraction = interaction;
  const raw = selected.values[0];
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export class PlayerCardRouter {
  private readonly deps: PlayerCardRouterDeps;

  constructor(deps: PlayerCardRouterDeps) {
    this.deps = deps;
  }

  /**
   * Handle a component interaction. Returns false when the id isn't ours — `pagination.ts`'s
   * `page_*` buttons and the subtitle picker's menu are driven by their own message-scoped
   * collectors and must be left alone.
   */
  async handle(interaction: MessageComponentInteraction): Promise<boolean> {
    const action = decodeControlId(interaction.customId);
    if (action === null) {
      return false;
    }
    const owner = this.deps.messenger.ownerOf(interaction.message.id);
    if (owner === null) {
      await this.ephemeral(
        interaction,
        "That player card is no longer active — run `/stream nowplaying` for the current one.",
      );
      return true;
    }
    const handle = this.deps.sessionFor(owner);
    if (handle === null) {
      await this.ephemeral(interaction, "That stream has ended.");
      return true;
    }

    const outcome = resolveControlAction({
      action,
      view: handle.view(),
      userId: toUserId(interaction.user.id),
      adminIds: this.deps.config.discord.adminIds,
      inVoiceChannel:
        this.deps.voiceChannelOf(interaction) === owner.voiceChannelId,
      ...(action === ControlAction.Chapter
        ? { chapterNumber: pickedChapterNumber(interaction) }
        : {}),
    });
    await this.apply(interaction, owner, handle, outcome);
    return true;
  }

  private async apply(
    interaction: MessageComponentInteraction,
    owner: CardOwner,
    handle: SessionHandle,
    outcome: ControlOutcome,
  ): Promise<void> {
    switch (outcome.kind) {
      case "denied":
        await this.ephemeral(interaction, outcome.message);
        return;
      case "ephemeral":
        await this.ephemeral(interaction, outcome.text);
        return;
      case "subtitle-picker":
        await this.deps.openSubtitlePicker(interaction, handle);
        return;
      case "dispatch":
        handle.dispatch(outcome.event);
        await this.ephemeral(interaction, outcome.ack);
        this.deps.refreshCard(owner);
        return;
      case "volume":
        // Mirror `/stream volume`: the machine event persists the level for the next video, the
        // side-channel applies it to the stream that is already playing.
        handle.dispatch({ type: "SET_VOLUME", volume: outcome.percent });
        await this.ephemeral(interaction, outcome.ack);
        void handle.setVolume(outcome.percent);
        this.deps.refreshCard(owner);
        return;
      case "seek": {
        // A seek restarts ffmpeg and can outlast Discord's 3-second ack window, so defer first.
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const applied = await handle.seek(outcome.seconds);
        await interaction.editReply(
          applied ? outcome.ack : "Nothing is playing.",
        );
        this.deps.refreshCard(owner);
        return;
      }
    }
  }

  private async ephemeral(
    interaction: MessageComponentInteraction,
    content: string,
  ): Promise<void> {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
}

/**
 * Total wrapper: the client dispatches component interactions fire-and-forget, so a rejection here
 * would surface as an unhandled rejection. A click that fails without any ack renders as
 * "Interaction Failed" in the client, so make a best-effort ack before giving up — tolerating the
 * stale-token case the way `command-bot.ts`'s `safeHandle` does.
 */
export async function safeHandleCardInteraction(
  router: PlayerCardRouter,
  interaction: MessageComponentInteraction,
): Promise<void> {
  try {
    await router.handle(interaction);
  } catch (error) {
    log.error("player card interaction failed", {
      customId: interaction.customId,
      error: getErrorMessage(error),
    });
    Sentry.captureException(error);
    try {
      const content = "Something went wrong handling that control.";
      await (interaction.replied || interaction.deferred
        ? interaction.followUp({ content, flags: MessageFlags.Ephemeral })
        : interaction.reply({ content, flags: MessageFlags.Ephemeral }));
    } catch (ackError) {
      if (!isStaleInteractionError(ackError)) {
        log.error("player card error ack failed", {
          error: getErrorMessage(ackError),
        });
      }
    }
  }
}
