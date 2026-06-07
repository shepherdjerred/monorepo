import { Client, Events, GatewayIntentBits, type Message } from "discord.js";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import type { PlaybackEvent } from "@shepherdjerred/streambot/machine/types.ts";
import {
  parseCommand,
  resolvePlayQuery,
} from "@shepherdjerred/streambot/discord/command.ts";
import {
  searchLibrary,
  type LibraryEntry,
} from "@shepherdjerred/streambot/sources/library.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("command-bot");
const MAX_LIST = 20;

/** A read-only view of the machine for status/queue display. */
export type PlaybackView = {
  readonly state: string;
  readonly currentTitle: string | null;
  readonly queueLength: number;
};

export type CommandBotDeps = {
  readonly config: Config;
  /** Dispatch an event to the playback machine. */
  readonly dispatch: (event: PlaybackEvent) => void;
  /** Current machine view for `$status`. */
  readonly view: () => PlaybackView;
  /** Current library entries for `$play` resolution and `$list` / `$search`. */
  readonly library: () => readonly LibraryEntry[];
};

/** The discord.js (bot-token) command bot. Translates chat commands into machine events. */
export class CommandBot {
  private readonly client: Client;
  private readonly deps: CommandBotDeps;

  constructor(deps: CommandBotDeps) {
    this.deps = deps;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
      ],
    });
    this.client.on(Events.MessageCreate, (message) => {
      void this.safeHandle(message);
    });
  }

  async login(): Promise<void> {
    await this.client.login(this.deps.config.discord.botToken);
    log.info("command bot logged in", {
      user: this.client.user?.username ?? null,
    });
  }

  async destroy(): Promise<void> {
    await this.client.destroy();
  }

  private async safeHandle(message: Message): Promise<void> {
    try {
      await this.handle(message);
    } catch (error) {
      log.error("command handling failed", { error: getErrorMessage(error) });
    }
  }

  private async handle(message: Message): Promise<void> {
    if (
      message.author.bot ||
      message.channelId !== this.deps.config.discord.commandChannelId
    ) {
      return;
    }
    const intent = parseCommand(
      message.content,
      this.deps.config.discord.prefix,
    );
    if (intent === null) {
      return;
    }

    switch (intent.type) {
      case "play": {
        const source = resolvePlayQuery(intent.query, this.deps.library());
        this.deps.dispatch({
          type: "ADD",
          source,
          requesterId: message.author.id,
        });
        await message.react("👍");
        return;
      }
      case "skip": {
        this.deps.dispatch({ type: "SKIP" });
        await message.react("⏭️");
        return;
      }
      case "stop": {
        this.deps.dispatch({ type: "STOP" });
        await message.react("⏹️");
        return;
      }
      case "status": {
        await message.reply(this.statusText());
        return;
      }
      case "list": {
        await message.reply(this.listText(intent.query));
        return;
      }
      case "search": {
        await message.reply(this.listText(intent.query));
        return;
      }
      case "help": {
        await message.reply(this.helpText());
        return;
      }
    }
  }

  private statusText(): string {
    const view = this.deps.view();
    const now = view.currentTitle ?? "nothing";
    return `**Now playing:** ${now}\n**State:** ${view.state} · **Queue:** ${String(view.queueLength)}`;
  }

  private listText(query: string | null): string {
    const entries = this.deps.library();
    const matched =
      query === null ? entries : searchLibrary(entries, query, MAX_LIST);
    if (matched.length === 0) {
      return query === null
        ? "The library is empty."
        : `No matches for \`${query}\`.`;
    }
    const shown = matched.slice(0, MAX_LIST);
    const lines = shown.map(
      (entry, index) =>
        `${String(index + 1)}. \`${entry.title}\` _(${entry.library})_`,
    );
    const suffix =
      matched.length > MAX_LIST
        ? `\n…and ${String(matched.length - MAX_LIST)} more`
        : "";
    return `**${String(matched.length)} result(s):**\n${lines.join("\n")}${suffix}`;
  }

  private helpText(): string {
    const { prefix } = this.deps.config.discord;
    return [
      "**Commands**",
      `\`${prefix}play <library title | url | search>\` — queue & play`,
      `\`${prefix}skip\` — skip the current video`,
      `\`${prefix}stop\` — stop and clear the queue`,
      `\`${prefix}list [filter]\` — browse the library`,
      `\`${prefix}search <query>\` — search the library`,
      `\`${prefix}status\` — what's playing`,
    ].join("\n");
  }
}
