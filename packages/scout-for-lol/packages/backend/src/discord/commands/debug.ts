import { type ChatInputCommandInteraction, SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } from "discord.js";
import { formatDistanceToNow } from "date-fns";
import { DiscordGuildIdSchema } from "@scout-for-lol/data/index";
import configuration from "@scout-for-lol/backend/configuration.ts";
import { getAccountsWithState, prisma } from "@scout-for-lol/backend/database/index.ts";
import { calculatePollingInterval, shouldCheckPlayer } from "@scout-for-lol/backend/utils/polling-intervals.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("commands-debug");

export const debugCommand = new SlashCommandBuilder()
  .setName("debug")
  .setDescription("Debug commands (dev-only)")
  .addSubcommand((subcommand) =>
    subcommand.setName("database").setDescription("[Dev Only] Upload the SQLite database file"),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("polling").setDescription("[Dev Only] Show polling intervals for all tracked players"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("server-info")
      .setDescription("[Dev Only] View detailed server information (players, accounts, subscriptions, competitions)"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("force-snapshot")
      .setDescription("[Dev Only] Force create snapshots for a competition")
      .addIntegerOption((option) => option.setName("competition-id").setDescription("Competition ID").setRequired(true))
      .addStringOption((option) =>
        option
          .setName("type")
          .setDescription("Snapshot type")
          .setRequired(true)
          .addChoices({ name: "START", value: "START" }, { name: "END", value: "END" }),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("force-leaderboard-update")
      .setDescription("[Dev Only] Force leaderboard update for competitions")
      .addIntegerOption((option) =>
        option
          .setName("competition-id")
          .setDescription("Optional: Specific competition ID (omit to update all active competitions)")
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("manage-participant")
      .setDescription("[Dev Only] Add or remove a participant from a competition")
      .addStringOption((option) =>
        option
          .setName("action")
          .setDescription("Action to perform")
          .setRequired(true)
          .addChoices({ name: "Add", value: "add" }, { name: "Kick", value: "kick" }),
      )
      .addIntegerOption((option) => option.setName("competition-id").setDescription("Competition ID").setRequired(true))
      .addUserOption((option) =>
        option.setName("user").setDescription("Discord user to add or remove").setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("force-pairing-update")
      .setDescription("[Dev Only] Force run the weekly Common Denominator pairing update"),
  );

export async function executeDebugDatabase(interaction: ChatInputCommandInteraction) {
  logger.info("🐛 Executing debug database command");

  // Get the database file path from configuration
  const databaseUrl = configuration.databaseUrl;

  // Handle file:// URLs and extract the path
  const databasePath = databaseUrl.startsWith("file:") ? databaseUrl.replace(/^file:/, "") : databaseUrl;

  logger.info(`📁 Database path: ${databasePath}`);

  // Check if file exists
  if (!(await Bun.file(databasePath).exists())) {
    logger.error(`❌ Database file not found at ${databasePath}`);
    await interaction.reply({
      content: `❌ Database file not found at: \`${databasePath}\``,
      ephemeral: true,
    });
    return;
  }

  try {
    // Defer reply as file reading might take a moment
    await interaction.deferReply({ ephemeral: true });

    logger.info(`📖 Reading database file from ${databasePath}`);
    const file = Bun.file(databasePath);
    const fileSize = file.size;
    logger.info(`✅ Successfully opened database file (${String(fileSize)} bytes)`);

    // Read file and convert to Buffer for Discord.js type compatibility
    // Using Bun's Buffer (not Node.js) - Discord.js types require Buffer, not Uint8Array
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const attachment = new AttachmentBuilder(buffer, { name: "database.sqlite" });

    await interaction.editReply({
      content: `✅ Database file uploaded successfully\n\nPath: \`${databasePath}\`\nSize: ${(fileSize / 1024).toFixed(2)} KB`,
      files: [attachment],
    });

    logger.info(`🎉 Database file uploaded successfully`);
  } catch (error) {
    logger.error("❌ Error reading or uploading database file:", error);
    await interaction.editReply({
      content: `❌ Error uploading database file: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

export async function executeDebugPolling(interaction: ChatInputCommandInteraction) {
  logger.info("🐛 Executing debug polling command");

  try {
    await interaction.deferReply({ ephemeral: true });

    const accountsWithState = await getAccountsWithState();
    const currentTime = new Date();

    if (accountsWithState.length === 0) {
      await interaction.editReply({ content: "No tracked players found." });
      return;
    }

    // Build summary info
    const intervalCounts = new Map<number, number>();
    const shouldCheckCount = { yes: 0, no: 0 };

    const playerDetails: string[] = [];

    for (const { config, lastMatchTime, lastCheckedAt } of accountsWithState) {
      const interval = calculatePollingInterval(lastMatchTime, currentTime);
      const shouldCheck = shouldCheckPlayer(lastMatchTime, lastCheckedAt, currentTime);

      // Count intervals
      intervalCounts.set(interval, (intervalCounts.get(interval) ?? 0) + 1);
      if (shouldCheck) {
        shouldCheckCount.yes++;
      } else {
        shouldCheckCount.no++;
      }

      // Format player info
      const lastMatchStr = lastMatchTime ? formatDistanceToNow(lastMatchTime, { addSuffix: true }) : "never";
      const lastCheckedStr = lastCheckedAt ? formatDistanceToNow(lastCheckedAt, { addSuffix: true }) : "never";
      const checkStatus = shouldCheck ? "✅" : "⏸️";

      playerDetails.push(
        `${checkStatus} **${config.alias}** (${config.league.leagueAccount.region})\n` +
          `  Interval: ${interval.toString()}m | Last match: ${lastMatchStr} | Last checked: ${lastCheckedStr}`,
      );
    }

    // Build summary
    const sortedIntervals = Array.from(intervalCounts.entries()).sort((a, b) => a[0] - b[0]);
    const intervalSummary = sortedIntervals
      .map(([interval, count]) => `${interval.toString()}min: ${count.toString()} player(s)`)
      .join("\n");

    const summary =
      `**Polling Interval Summary**\n` +
      `Total players: ${accountsWithState.length.toString()}\n` +
      `Should check now: ${shouldCheckCount.yes.toString()}\n` +
      `Waiting: ${shouldCheckCount.no.toString()}\n\n` +
      `**Interval Distribution:**\n${intervalSummary}\n\n` +
      `**Player Details:**\n${playerDetails.join("\n\n")}`;

    // Split into chunks if too long (Discord limit is 2000 characters)
    if (summary.length > 1900) {
      const chunks: string[] = [];
      let currentChunk =
        `**Polling Interval Summary**\n` +
        `Total players: ${accountsWithState.length.toString()}\n` +
        `Should check now: ${shouldCheckCount.yes.toString()}\n` +
        `Waiting: ${shouldCheckCount.no.toString()}\n\n` +
        `**Interval Distribution:**\n${intervalSummary}\n\n` +
        `**Player Details:**\n`;

      for (const detail of playerDetails) {
        if (currentChunk.length + detail.length + 2 > 1900) {
          chunks.push(currentChunk);
          currentChunk = "";
        }
        currentChunk += detail + "\n\n";
      }
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
      }

      await interaction.editReply({ content: chunks[0] ?? "No content" });
      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp({ content: chunks[i] ?? "No content", ephemeral: true });
      }
    } else {
      await interaction.editReply({ content: summary });
    }

    logger.info(`✅ Polling debug info sent (${accountsWithState.length.toString()} players)`);
  } catch (error) {
    logger.error("❌ Error in debug polling command:", error);
    await interaction.editReply({
      content: `❌ Error getting polling info: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

export async function executeDebugServerInfo(interaction: ChatInputCommandInteraction) {
  logger.info("📊 Executing debug server-info command");

  // Defer reply since this might take a moment to gather all data
  await interaction.deferReply({ ephemeral: true });

  try {
    const serverId = interaction.guildId ? DiscordGuildIdSchema.parse(interaction.guildId) : null;

    if (!serverId) {
      await interaction.editReply({
        content: "❌ This command can only be used in a server (guild).",
      });
      return;
    }

    logger.info(`📊 Fetching server info for guild: ${serverId}`);

    // Fetch all data in parallel for better performance
    const [players, accounts, subscriptions, competitions, activeCompetitions, permissions] = await Promise.all([
      prisma.player.findMany({
        where: { serverId },
        include: { accounts: true },
      }),
      prisma.account.findMany({
        where: { serverId },
        include: { player: true },
      }),
      prisma.subscription.findMany({
        where: { serverId },
        include: { player: true },
      }),
      prisma.competition.findMany({
        where: { serverId },
        include: {
          participants: true,
          snapshots: true,
        },
      }),
      prisma.competition.findMany({
        where: { serverId, isCancelled: false },
        include: {
          participants: {
            where: { status: "JOINED" },
          },
        },
      }),
      prisma.serverPermission.findMany({
        where: { serverId },
      }),
    ]);

    logger.info(
      `📊 Data fetched - Players: ${players.length.toString()}, Accounts: ${accounts.length.toString()}, Subscriptions: ${subscriptions.length.toString()}, Competitions: ${competitions.length.toString()}`,
    );

    // Count subscriptions by channel
    const channelMap: Record<string, number> = {};
    for (const sub of subscriptions) {
      const count = channelMap[sub.channelId] ?? 0;
      channelMap[sub.channelId] = count + 1;
    }

    // Build embeds (Discord has a limit, so we'll create multiple embeds)
    const embeds: EmbedBuilder[] = [];

    // Overview Embed
    const overviewEmbed = new EmbedBuilder()
      .setTitle("📊 Server Overview")
      .setColor(0x5865f2) // Discord Blurple
      .addFields(
        { name: "👥 Total Players", value: players.length.toString(), inline: true },
        { name: "🎮 Total Accounts", value: accounts.length.toString(), inline: true },
        { name: "🔔 Subscriptions", value: subscriptions.length.toString(), inline: true },
        { name: "📺 Subscribed Channels", value: Object.keys(channelMap).length.toString(), inline: true },
        { name: "🏆 Total Competitions", value: competitions.length.toString(), inline: true },
        { name: "✅ Active Competitions", value: activeCompetitions.length.toString(), inline: true },
        { name: "🔑 Permissions Granted", value: permissions.length.toString(), inline: true },
      )
      .setTimestamp();

    embeds.push(overviewEmbed);

    // Players Embed (limited to first 10 for readability)
    if (players.length > 0) {
      const playersEmbed = new EmbedBuilder().setTitle("👥 Players").setColor(0x57f287); // Green

      const playersList = players.slice(0, 10).map((player) => {
        const accountCount = player.accounts.length;
        const discordMention = player.discordId ? `<@${player.discordId}>` : "No Discord";
        return `**${player.alias}** - ${accountCount.toString()} account${accountCount !== 1 ? "s" : ""} - ${discordMention}`;
      });

      if (playersList.length > 0) {
        playersEmbed.setDescription(playersList.join("\n"));
      }

      if (players.length > 10) {
        playersEmbed.setFooter({ text: `Showing 10 of ${players.length.toString()} players` });
      }

      embeds.push(playersEmbed);
    }

    // Accounts Embed (limited to first 10)
    if (accounts.length > 0) {
      const accountsEmbed = new EmbedBuilder().setTitle("🎮 Accounts").setColor(0xfee75c); // Yellow

      const accountsList = accounts.slice(0, 10).map((account) => {
        const region = account.region.toUpperCase();
        return `**${account.alias}** (${region}) - ${account.player.alias}`;
      });

      if (accountsList.length > 0) {
        accountsEmbed.setDescription(accountsList.join("\n\n"));
      }

      if (accounts.length > 10) {
        accountsEmbed.setFooter({ text: `Showing 10 of ${accounts.length.toString()} accounts` });
      }

      embeds.push(accountsEmbed);
    }

    // Subscriptions Embed (by channel)
    if (subscriptions.length > 0) {
      const subscriptionsEmbed = new EmbedBuilder().setTitle("🔔 Subscriptions").setColor(0xeb459e); // Pink

      const channelsList = Object.entries(channelMap)
        .slice(0, 10)
        .map(([channelId, count]) => `<#${channelId}>: ${count.toString()} subscription${count !== 1 ? "s" : ""}`)
        .join("\n");
      subscriptionsEmbed.setDescription(channelsList);

      embeds.push(subscriptionsEmbed);
    }

    // Active Competitions Embed
    if (activeCompetitions.length > 0) {
      const competitionsEmbed = new EmbedBuilder().setTitle("🏆 Active Competitions").setColor(0xed4245); // Red

      const competitionsList = activeCompetitions.slice(0, 5).map((comp) => {
        const participantCount = comp.participants.length;
        const owner = `<@${comp.ownerId}>`;
        const channel = `<#${comp.channelId}>`;
        const startDate = comp.startDate ? `<t:${Math.floor(comp.startDate.getTime() / 1000).toString()}:d>` : "N/A";
        const endDate = comp.endDate ? `<t:${Math.floor(comp.endDate.getTime() / 1000).toString()}:d>` : "N/A";

        return (
          `**${comp.title}**\n` +
          `Owner: ${owner} | Channel: ${channel}\n` +
          `Participants: ${participantCount.toString()}/${comp.maxParticipants.toString()}\n` +
          `Period: ${startDate} - ${endDate}\n` +
          `Type: ${comp.criteriaType} | Visibility: ${comp.visibility}`
        );
      });

      if (competitionsList.length > 0) {
        competitionsEmbed.setDescription(competitionsList.join("\n\n"));
      }

      if (activeCompetitions.length > 5) {
        competitionsEmbed.setFooter({
          text: `Showing 5 of ${activeCompetitions.length.toString()} active competitions`,
        });
      }

      embeds.push(competitionsEmbed);
    }

    // Debug Info Embed
    const debugEmbed = new EmbedBuilder()
      .setTitle("🐛 Debug Info")
      .setColor(0x9b59b6) // Purple
      .addFields(
        { name: "Bot Version", value: configuration.version, inline: true },
        { name: "Environment", value: configuration.environment, inline: true },
        { name: "Git SHA", value: configuration.gitSha.substring(0, 8), inline: true },
        { name: "Database", value: configuration.databaseUrl.includes("file:") ? "SQLite" : "External", inline: true },
        { name: "S3 Bucket", value: configuration.s3BucketName ?? "Not configured", inline: true },
      );

    embeds.push(debugEmbed);

    logger.info(`✅ Server info compiled successfully with ${embeds.length.toString()} embeds`);

    await interaction.editReply({
      embeds,
    });
  } catch (error) {
    logger.error("❌ Error executing debug server-info command:", error);
    await interaction.editReply({
      content: `❌ Error fetching server information: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
