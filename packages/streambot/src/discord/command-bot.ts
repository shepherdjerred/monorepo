import {
  type ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
  type VoiceState,
} from "discord.js";
import {
  CommandHandler,
  type CommandHandlerDeps,
  type CommandInteraction,
} from "@shepherdjerred/streambot/discord/command-handler.ts";
import { commandJson } from "@shepherdjerred/streambot/discord/commands.ts";
import { toUserId } from "@shepherdjerred/streambot/types/ids.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("command-bot");
// Grace period before leaving an empty voice channel, so a brief solo moment or a reconnect
// blip doesn't drop playback (and an unattended e2e can stream to an empty channel).
const ALONE_GRACE_MS = 30_000;

/** Everything the handler needs, minus the status-channel `announce` (the bot supplies that). */
export type CommandBotDeps = Omit<CommandHandlerDeps, "announce"> & {
  /** Discord user id of the streamer selfbot, to exclude it from the "alone in VC" check. */
  readonly streamerUserId: () => string | null;
};

/** The discord.js (bot-token) command bot. Registers + handles slash commands in any channel. */
export class CommandBot {
  private readonly client: Client;
  private readonly deps: CommandBotDeps;
  private readonly handler: CommandHandler;
  private aloneTimer: ReturnType<typeof setTimeout> | null = null;
  /** Resolves once the bot is logged in and its slash commands are registered; rejects on failure. */
  readonly ready: Promise<void>;

  constructor(deps: CommandBotDeps) {
    this.deps = deps;
    this.handler = new CommandHandler({
      config: deps.config,
      dispatch: deps.dispatch,
      view: deps.view,
      library: deps.library,
      setVolume: deps.setVolume,
      expandPlaylist: deps.expandPlaylist,
      announce: (message) => this.announce(message),
    });
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    });
    this.ready = new Promise<void>((resolve, reject) => {
      this.client.once(Events.ClientReady, (ready) => {
        void this.registerThenSettle(ready.application.id, resolve, reject);
      });
    });
    this.client.on(Events.InteractionCreate, (interaction) => {
      if (interaction.isChatInputCommand()) {
        void this.safeHandle(interaction);
      }
    });
    this.client.on(Events.VoiceStateUpdate, (oldState, newState) => {
      this.onVoiceStateUpdate(oldState, newState);
    });
  }

  async login(): Promise<void> {
    await this.client.login(this.deps.config.discord.botToken);
    log.info("command bot logged in", {
      user: this.client.user?.username ?? null,
    });
  }

  async destroy(): Promise<void> {
    this.clearAloneTimer();
    await this.client.destroy();
  }

  private clearAloneTimer(): void {
    if (this.aloneTimer !== null) {
      clearTimeout(this.aloneTimer);
      this.aloneTimer = null;
    }
  }

  /** Post a world-readable message to the configured status channel (used by the status reporter). */
  async announce(message: string): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(
        this.deps.config.discord.statusChannelId,
      );
      if (channel?.isSendable() === true) {
        await channel.send(message);
      }
    } catch (error) {
      log.warn("announce failed", { error: getErrorMessage(error) });
    }
  }

  private async registerThenSettle(
    applicationId: string,
    resolve: () => void,
    reject: (error: Error) => void,
  ): Promise<void> {
    try {
      await this.register(applicationId);
      resolve();
    } catch (error) {
      reject(
        error instanceof Error ? error : new Error(getErrorMessage(error)),
      );
    }
  }

  private async register(applicationId: string): Promise<void> {
    const rest = new REST().setToken(this.deps.config.discord.botToken);
    await rest.put(
      Routes.applicationGuildCommands(
        applicationId,
        this.deps.config.discord.guildId,
      ),
      {
        body: commandJson,
      },
    );
    log.info("slash commands registered", { count: commandJson.length });
  }

  private onVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): void {
    const videoChannelId = this.deps.config.discord.videoChannelId;
    if (
      oldState.channelId !== videoChannelId &&
      newState.channelId !== videoChannelId
    ) {
      return;
    }
    const channel = newState.guild.channels.cache.get(videoChannelId);
    if (channel?.isVoiceBased() !== true) {
      return;
    }
    const streamerId = this.deps.streamerUserId();
    const humans = channel.members.filter(
      (member) => !member.user.bot && member.id !== streamerId,
    );
    if (humans.size > 0) {
      // Someone's (still) here — cancel any pending leave.
      this.clearAloneTimer();
      return;
    }
    // Alone in the VC. Leave after a grace period (cancelled if a human (re)joins), rather than
    // dropping playback the instant the channel empties.
    this.aloneTimer ??= setTimeout(() => {
      this.aloneTimer = null;
      log.info("voice channel empty for grace period — stopping");
      this.deps.dispatch({ type: "STOP" });
    }, ALONE_GRACE_MS);
  }

  /** Adapt a discord.js interaction to the handler's minimal, testable surface. */
  private adapt(interaction: ChatInputCommandInteraction): CommandInteraction {
    return {
      userId: toUserId(interaction.user.id),
      subcommand: () => interaction.options.getSubcommand(),
      getString: (name) => interaction.options.getString(name),
      getStringRequired: (name) => interaction.options.getString(name, true),
      getIntegerRequired: (name) => interaction.options.getInteger(name, true),
      reply: async (content) => {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      },
      defer: async () => {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      },
      editReply: async (content) => {
        await interaction.editReply(content);
      },
    };
  }

  private async safeHandle(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    try {
      await this.handler.run(this.adapt(interaction));
    } catch (error) {
      log.error("command handling failed", {
        command: interaction.commandName,
        error: getErrorMessage(error),
      });
      const message = "Something went wrong handling that command.";
      await (interaction.replied || interaction.deferred
        ? interaction.followUp({
            content: message,
            flags: MessageFlags.Ephemeral,
          })
        : interaction.reply({
            content: message,
            flags: MessageFlags.Ephemeral,
          }));
    }
  }
}
