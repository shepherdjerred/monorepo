import {
  Events,
  MessageFlags,
  SlashCommandBuilder,
  type Client,
  type ChatInputCommandInteraction,
} from "discord.js";
import { GameIdSchema, games, type GameId } from "@arcade/common/catalog.ts";
import type { createApplication } from "#src/web/application.ts";
import { UserError } from "#src/errors.ts";
import type { BotAccess } from "./access.ts";
import type { Logger } from "@shepherdjerred/discord-plays-core/logger.ts";

type Application = ReturnType<typeof createApplication>;

export async function registerCommands(options: {
  bot: Client;
  application: Application;
  access: BotAccess;
  origin: string;
  enabled: (gameId: GameId, guildId: string) => Promise<boolean>;
  logger: Logger;
}): Promise<void> {
  const data = new SlashCommandBuilder()
    .setName("arcade")
    .setDescription("Play together in the arcade")
    .addSubcommand((command) =>
      command
        .setName("play")
        .setDescription("Start a game in your voice channel")
        .addStringOption((game) =>
          game
            .setName("game")
            .setDescription("Choose a game")
            .setRequired(true)
            .addChoices(
              ...Object.values(games).map((definition) => ({
                name: definition.title,
                value: definition.id,
              })),
            ),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName("stop")
        .setDescription("Stop your game")
        .addChannelOption((channel) =>
          channel
            .setName("channel")
            .setDescription("Voice channel of the game to stop"),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName("status")
        .setDescription("Show this server’s arcade sessions"),
    )
    .addSubcommand((command) =>
      command
        .setName("screenshot")
        .setDescription("Share a screenshot of your game"),
    )
    .addSubcommand((command) =>
      command
        .setName("goal")
        .setDescription("Set an Emerald adventure goal")
        .addStringOption((goal) =>
          goal
            .setName("objective")
            .setDescription("What should we do next?")
            .setMaxLength(1000)
            .setRequired(true),
        ),
    );
  const botApplication = options.bot.application;
  if (botApplication === null)
    throw new Error("Discord application is not ready");
  await botApplication.commands.set([data]);
  options.bot.on(Events.InteractionCreate, (interaction) => {
    if (
      !interaction.isChatInputCommand() ||
      interaction.commandName !== "arcade"
    )
      return;
    void (async () => {
      try {
        await handle(interaction);
      } catch (error) {
        if (!(error instanceof UserError))
          options.logger.error("arcade slash command failed", error);
        const content =
          error instanceof UserError
            ? error.message
            : "Arcade could not complete that request.";
        try {
          if (interaction.deferred || interaction.replied)
            await interaction.editReply({ content });
          else
            await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        } catch (replyError) {
          options.logger.error("could not report command failure", replyError);
        }
      }
    })();
  });

  async function handle(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const guildId = interaction.guildId;
    if (guildId === null)
      throw new UserError(400, "Use Arcade in a server voice channel.");
    const command = interaction.options.getSubcommand();
    if (command === "status") {
      await statusReply(interaction, guildId);
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (command === "play") await playReply(interaction, guildId);
    else await activeReply(interaction, guildId, command);
  }

  async function statusReply(
    interaction: ChatInputCommandInteraction,
    guildId: string,
  ): Promise<void> {
    const sessions = options.application.manager.list(guildId);
    await interaction.reply({
      content:
        sessions.length === 0
          ? "The arcade is free. Join voice and use /arcade play."
          : sessions
              .map(
                (session) =>
                  `${games[session.gameId].title} · <#${session.voiceChannelId}> · ${options.origin}/servers/${guildId}/games/${session.gameId}`,
              )
              .join("\n"),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  async function playReply(
    interaction: ChatInputCommandInteraction,
    guildId: string,
  ): Promise<void> {
    const gameId = GameIdSchema.parse(
      interaction.options.getString("game", true),
    );
    if (!(await options.enabled(gameId, guildId)))
      throw new UserError(409, "This game is not available yet.");
    const target = await options.access.startTarget(
      guildId,
      interaction.user.id,
    );
    const result = await options.application.manager.start({
      gameId,
      guildId,
      ...target,
      startedByUserId: interaction.user.id,
    });
    if (
      result.kind === "started" ||
      result.kind === "occupied" ||
      result.kind === "save-in-use"
    ) {
      await interaction.editReply(
        `${result.kind === "started" ? "Starting" : "Already playing"} ${games[result.session.gameId].title} in <#${result.session.voiceChannelId}>.\n${options.origin}/servers/${guildId}/games/${result.session.gameId}`,
      );
      return;
    }
    if (result.kind === "failed") {
      options.logger.error("game start failed", result.error);
      throw new UserError(
        500,
        "The game could not start. Your previous save is safe.",
      );
    }
    throw new UserError(
      409,
      result.kind === "heavy-capacity"
        ? "A Wii or Smash session is already running. MK64 and Emerald are still available."
        : "No arcade capacity is available for this game right now.",
    );
  }

  async function activeReply(
    interaction: ChatInputCommandInteraction,
    guildId: string,
    command: string,
  ): Promise<void> {
    const channelId = commandChannel(interaction, guildId);
    const session = options.application.manager
      .list(guildId)
      .find((active) => active.voiceChannelId === channelId);
    if (session === undefined)
      throw new UserError(
        404,
        "Join a game’s voice channel or select its channel.",
      );
    const active = options.application.manager.session(session.id);
    if (active === undefined) throw new UserError(404, "This game has ended.");
    switch (command) {
      case "stop": {
        await stopReply(interaction, guildId, session.id);
        return;
      }
      case "goal": {
        if (session.startedByUserId !== interaction.user.id)
          throw new UserError(403, "Only this session’s host can set a goal.");
        if (active.runtime?.goal === undefined)
          throw new UserError(400, "Goals are not available for this game.");
        await active.runtime.goal(
          interaction.options.getString("objective", true),
        );
        await interaction.editReply("The adventure has a new goal.");
        return;
      }
      case "screenshot": {
        if (!options.access.inVoice(session, interaction.user.id))
          throw new UserError(403, "Join the game’s voice channel first.");
        if (active.runtime === undefined)
          throw new UserError(409, "The game is still starting.");
        await interaction.editReply({
          files: [
            {
              attachment: await active.runtime.screenshot(),
              name: `${session.gameId}.png`,
            },
          ],
        });
        return;
      }
      default:
        throw new UserError(400, "Unknown Arcade command.");
    }
  }
  function commandChannel(
    interaction: ChatInputCommandInteraction,
    guildId: string,
  ) {
    const channelId =
      interaction.options.getChannel("channel")?.id ??
      options.bot.guilds.cache
        .get(guildId)
        ?.voiceStates.cache.get(interaction.user.id)?.channelId;
    return channelId;
  }
  async function stopReply(
    interaction: ChatInputCommandInteraction,
    guildId: string,
    sessionId: string,
  ): Promise<void> {
    const result = await options.application.manager.stop(sessionId, {
      userId: interaction.user.id,
      moderator: await options.access.moderator(guildId, interaction.user.id),
    });
    if (result.kind === "forbidden")
      throw new UserError(
        403,
        "Only the host or a server moderator can stop this game.",
      );
    if (result.kind === "stopped" && result.error !== undefined)
      throw new UserError(
        500,
        "The game stopped, but closing it reported an error. Check the server logs before resuming.",
      );
    await interaction.editReply("Game stopped.");
  }
}
