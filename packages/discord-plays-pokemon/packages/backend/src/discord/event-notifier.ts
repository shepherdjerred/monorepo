import type { Client } from "discord.js";
import { AttachmentBuilder, ChannelType, EmbedBuilder } from "discord.js";
import { logger } from "#src/logger.ts";
import {
  gameEventsTotal,
  notificationSendErrorsTotal,
} from "#src/observability/metrics.ts";
import type { GameEvent, GameEventKind } from "#src/game/events/types.ts";
import {
  speciesName,
  nationalDexName,
} from "#src/game/events/generated/species.ts";
import { BADGES } from "#src/game/events/data/badges.ts";

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

// Display names are stored uppercase (BULBASAUR); title-case for prose.
function titleCase(name: string): string {
  return name.replaceAll(
    /[A-Z]+/gi,
    (word) => word[0] + word.slice(1).toLowerCase(),
  );
}

export function eventToEmbed(event: GameEvent): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(COLORS[event.kind]);
  switch (event.kind) {
    case "faint":
      return embed
        .setTitle("💀 Fainted")
        .setDescription(
          `${titleCase(speciesName(event.species))} (Lv. ${String(event.level)}) fainted.`,
        );
    case "whiteout":
      return embed
        .setTitle("⬜ Whiteout")
        .setDescription("The whole party fainted — blacked out!");
    case "badge": {
      // badgeIndex is always 0-7 (the diff iterates the 8 badge flags).
      const badge = BADGES[event.badgeIndex];
      return embed
        .setTitle("🏅 Badge earned")
        .setDescription(
          `Earned the **${badge.name}** — ${badge.leader}, ${badge.city}.`,
        );
    }
    case "evolution":
      return embed
        .setTitle("✨ Evolution")
        .setDescription(
          `${titleCase(speciesName(event.fromSpecies))} evolved into ${titleCase(speciesName(event.toSpecies))}!`,
        );
    case "catch":
      return embed
        .setTitle("🎯 Caught a Pokémon")
        .setDescription(
          `Caught ${titleCase(speciesName(event.species))}!${event.shiny ? " ✨ **Shiny!**" : ""}`,
        );
    case "levelUp":
      return embed
        .setTitle("⬆️ Level up")
        .setDescription(
          `${titleCase(speciesName(event.species))} grew from Lv. ${String(event.fromLevel)} to Lv. ${String(event.toLevel)}.`,
        );
    case "dexEntry": {
      const name = nationalDexName(event.nationalDexNumber);
      return embed
        .setTitle("📖 New Pokédex entry")
        .setDescription(
          `#${String(event.nationalDexNumber)}${name === undefined ? "" : ` ${titleCase(name)}`} registered.`,
        );
    }
  }
}

function describe(event: GameEvent): string {
  return eventToEmbed(event).data.description ?? event.kind;
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
