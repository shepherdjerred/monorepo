import {
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
  AttachmentBuilder,
} from "discord.js";
import { formatDistanceToNow } from "date-fns";
import configuration from "@scout-for-lol/backend/configuration.ts";
import { getAccountsWithState } from "@scout-for-lol/backend/database/index.ts";
import {
  calculatePollingInterval,
  shouldCheckPlayer,
} from "@scout-for-lol/backend/utils/polling-intervals.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("commands-debug");

export const debugCommand = new SlashCommandBuilder()
  .setName("debug")
  .setDescription("Debug commands (dev-only)")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("database")
      .setDescription("[Dev Only] Upload the SQLite database file"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("polling")
      .setDescription(
        "[Dev Only] Show polling intervals for all tracked players",
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("server-info")
      .setDescription(
        "[Dev Only] View detailed server information (players, accounts, subscriptions, competitions)",
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("force-snapshot")
      .setDescription("[Dev Only] Force create snapshots for a competition")
      .addIntegerOption((option) =>
        option
          .setName("competition-id")
          .setDescription("Competition ID")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("type")
          .setDescription("Snapshot type")
          .setRequired(true)
          .addChoices(
            { name: "START", value: "START" },
            { name: "END", value: "END" },
          ),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("force-leaderboard-update")
      .setDescription("[Dev Only] Force leaderboard update for competitions")
      .addIntegerOption((option) =>
        option
          .setName("competition-id")
          .setDescription(
            "Optional: Specific competition ID (omit to update all active competitions)",
          )
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("manage-participant")
      .setDescription(
        "[Dev Only] Add or remove a participant from a competition",
      )
      .addStringOption((option) =>
        option
          .setName("action")
          .setDescription("Action to perform")
          .setRequired(true)
          .addChoices(
            { name: "Add", value: "add" },
            { name: "Kick", value: "kick" },
          ),
      )
      .addIntegerOption((option) =>
        option
          .setName("competition-id")
          .setDescription("Competition ID")
          .setRequired(true),
      )
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("Discord user to add or remove")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("force-pairing-update")
      .setDescription(
        "[Dev Only] Force run the weekly Common Denominator pairing update",
      ),
  );

export async function executeDebugDatabase(
  interaction: ChatInputCommandInteraction,
) {
  logger.info("🐛 Executing debug database command");

  // Get the database file path from configuration
  const databaseUrl = configuration.databaseUrl;

  // Handle file:// URLs and extract the path
  const databasePath = databaseUrl.startsWith("file:")
    ? databaseUrl.replace(/^file:/, "")
    : databaseUrl;

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
    logger.info(
      `✅ Successfully opened database file (${String(fileSize)} bytes)`,
    );

    // Read file and convert to Buffer for Discord.js type compatibility
    // Using Bun's Buffer (not Node.js) - Discord.js types require Buffer, not Uint8Array
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const attachment = new AttachmentBuilder(buffer, {
      name: "database.sqlite",
    });

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

export async function executeDebugPolling(
  interaction: ChatInputCommandInteraction,
) {
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
      const shouldCheck = shouldCheckPlayer(
        lastMatchTime,
        lastCheckedAt,
        currentTime,
      );

      // Count intervals
      intervalCounts.set(interval, (intervalCounts.get(interval) ?? 0) + 1);
      if (shouldCheck) {
        shouldCheckCount.yes++;
      } else {
        shouldCheckCount.no++;
      }

      // Format player info
      const lastMatchStr = lastMatchTime
        ? formatDistanceToNow(lastMatchTime, { addSuffix: true })
        : "never";
      const lastCheckedStr = lastCheckedAt
        ? formatDistanceToNow(lastCheckedAt, { addSuffix: true })
        : "never";
      const checkStatus = shouldCheck ? "✅" : "⏸️";

      playerDetails.push(
        `${checkStatus} **${config.alias}** (${config.league.leagueAccount.region})\n` +
          `  Interval: ${interval.toString()}m | Last match: ${lastMatchStr} | Last checked: ${lastCheckedStr}`,
      );
    }

    // Build summary
    const sortedIntervals = [...intervalCounts.entries()].toSorted(
      (a, b) => a[0] - b[0],
    );
    const intervalSummary = sortedIntervals
      .map(
        ([interval, count]) =>
          `${interval.toString()}min: ${count.toString()} player(s)`,
      )
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
        await interaction.followUp({
          content: chunks[i] ?? "No content",
          ephemeral: true,
        });
      }
    } else {
      await interaction.editReply({ content: summary });
    }

    logger.info(
      `✅ Polling debug info sent (${accountsWithState.length.toString()} players)`,
    );
  } catch (error) {
    logger.error("❌ Error in debug polling command:", error);
    await interaction.editReply({
      content: `❌ Error getting polling info: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
