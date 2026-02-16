import type { ChatInputCommandInteraction } from "discord.js";
import { runWeeklyPairingUpdate } from "@scout-for-lol/backend/league/tasks/pairing/index.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("debug-force-pairing-update");

export async function executeDebugForcePairingUpdate(
  interaction: ChatInputCommandInteraction,
) {
  logger.info("🐛 Executing debug force-pairing-update command");

  // Defer reply since this might take time
  await interaction.deferReply({ ephemeral: true });

  try {
    logger.info("📊 Running weekly pairing update (Common Denominator)");

    const result = await runWeeklyPairingUpdate();

    if (result.success) {
      await interaction.editReply(`✅ ${result.message}`);
      logger.info(
        `✅ Successfully ran weekly pairing update: ${result.message}`,
      );
    } else {
      await interaction.editReply(`⚠️ ${result.message}`);
      logger.warn(`⚠️ Pairing update skipped: ${result.message}`);
    }
  } catch (error) {
    logger.error("❌ Error running pairing update:", error);
    await interaction.editReply(
      `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
