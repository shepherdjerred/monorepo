import type { Client } from "discord.js";
import { AttachmentBuilder, ChannelType, EmbedBuilder } from "discord.js";
import { logger } from "#src/logger.ts";
import {
  gameEventsTotal,
  notificationSendErrorsTotal,
} from "#src/observability/metrics.ts";
import type { GameEvent, GameEventKind } from "#src/game/events/types.ts";
import { BADGES } from "#src/game/events/data/badges.ts";
import { describeGameEvent } from "#src/game/events/describe.ts";

// Per-event-kind enable flags (from config bot.notifications.events).
export type EventToggles = Readonly<Record<GameEventKind, boolean>>;

export type EventNotifierMode = "log" | "send";

export type EventNotifier = {
  /** Queue an event for notification. Never throws. */
  enqueue: (event: GameEvent) => void;
};

const BATCH_WINDOW_MS = 2000;
const MAX_EMBEDS_PER_MESSAGE = 10;

const COLORS: Record<GameEventKind, number> = {
  faint: 0xed_42_45,
  whiteout: 0x99_24_1f,
  badge: 0xfe_e7_5c,
  evolution: 0x9b_59_b6,
  catch: 0x57_f2_87,
  levelUp: 0x58_65_f2,
  dexEntry: 0x1a_bc_9c,
};

export function eventToEmbed(event: GameEvent): EmbedBuilder {
  const description = describeGameEvent(event);
  return new EmbedBuilder()
    .setColor(COLORS[event.kind])
    .setTitle(description.title)
    .setDescription(emphasise(event, description.text));
}

// Discord renders markdown: bold the badge name and the shiny call-out as the
// embeds always have. The shared text stays plain for other transports.
function emphasise(event: GameEvent, text: string): string {
  switch (event.kind) {
    case "badge": {
      const badge = BADGES[event.badgeIndex];
      return badge === undefined
        ? text
        : text.replace(badge.name, `**${badge.name}**`);
    }
    case "catch":
      return text.replace("✨ Shiny!", "✨ **Shiny!**");
    case "faint":
    case "whiteout":
    case "evolution":
    case "levelUp":
    case "dexEntry":
      return text;
  }
}

function describe(event: GameEvent): string {
  return describeGameEvent(event).text;
}

export function createEventNotifier(deps: {
  client: Client;
  channelId: string;
  toggles: EventToggles;
  mode: EventNotifierMode;
  attachScreenshot: boolean;
  renderScreenshot: () => Buffer;
}): EventNotifier {
  const pending: GameEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function flush(): Promise<void> {
    timer = undefined;
    const batch = pending.splice(0);
    if (batch.length === 0) return;

    if (deps.mode === "log") {
      for (const event of batch) {
        logger.info(`[event:shadow] ${event.kind}: ${describe(event)}`);
      }
      return;
    }

    try {
      const channel = await deps.client.channels.fetch(deps.channelId);
      if (channel?.type !== ChannelType.GuildText) {
        logger.error(
          `notifications channel ${deps.channelId} is not a text channel`,
        );
        notificationSendErrorsTotal.inc();
        return;
      }
      if (batch.length > MAX_EMBEDS_PER_MESSAGE) {
        const dropped = batch.length - MAX_EMBEDS_PER_MESSAGE;
        logger.warn(
          `event batch exceeded embed cap: sending ${String(MAX_EMBEDS_PER_MESSAGE)}, dropping ${String(dropped)}`,
        );
        notificationSendErrorsTotal.inc();
      }
      const embeds = batch
        .slice(0, MAX_EMBEDS_PER_MESSAGE)
        .map((event) => eventToEmbed(event));
      const files = [];
      if (deps.attachScreenshot) {
        const png = deps.renderScreenshot();
        const attachment = new AttachmentBuilder(png, { name: "event.png" });
        embeds[0]?.setImage("attachment://event.png");
        files.push(attachment);
      }
      await channel.send({ embeds, files });
    } catch (error) {
      notificationSendErrorsTotal.inc();
      logger.error("failed to send event notification", error);
    }
  }

  return {
    enqueue(event: GameEvent): void {
      if (!deps.toggles[event.kind]) return;
      gameEventsTotal.inc({ kind: event.kind });
      pending.push(event);
      timer ??= setTimeout(() => {
        void flush();
      }, BATCH_WINDOW_MS);
    },
  };
}
