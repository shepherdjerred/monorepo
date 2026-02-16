import type { ChatInputCommandInteraction } from "discord.js";
import { z } from "zod";
import { prisma } from "@scout-for-lol/backend/database/index.ts";
import { getCompetitionById } from "@scout-for-lol/backend/database/competition/queries.ts";
import { createSnapshotsForAllParticipants } from "@scout-for-lol/backend/league/competition/snapshots.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("debug-force-snapshot");

export async function executeDebugForceSnapshot(
  interaction: ChatInputCommandInteraction,
) {
  logger.info("🐛 Executing debug force-snapshot command");

  // Validate command options at boundary
  const ForceSnapshotOptionsSchema = z.object({
    competitionId: z.number().int().positive(),
    snapshotType: z.enum(["START", "END"]),
  });

  const rawCompetitionId = interaction.options.getInteger(
    "competition-id",
    true,
  );
  const rawSnapshotType = interaction.options.getString("type", true);

  const optionsResult = ForceSnapshotOptionsSchema.safeParse({
    competitionId: rawCompetitionId,
    snapshotType: rawSnapshotType,
  });

  if (!optionsResult.success) {
    await interaction.reply({
      content: `❌ Invalid command options: ${optionsResult.error.message}`,
      ephemeral: true,
    });
    return;
  }

  const { competitionId, snapshotType } = optionsResult.data;

  // Defer reply since this might take time
  await interaction.deferReply({ ephemeral: true });

  try {
    logger.info(`🔍 Looking up competition ${competitionId.toString()}`);
    const competition = await getCompetitionById(prisma, competitionId);

    if (!competition) {
      await interaction.editReply(
        `❌ Competition ${competitionId.toString()} not found`,
      );
      return;
    }

    logger.info(
      `📸 Creating ${snapshotType} snapshots for competition "${competition.title}"`,
    );

    // Force create snapshots for all participants
    await createSnapshotsForAllParticipants(
      prisma,
      competition.id,
      snapshotType,
      competition.criteria,
    );

    await interaction.editReply(
      `✅ Created ${snapshotType} snapshots for all participants in competition **${competition.title}** (ID: ${competitionId.toString()})`,
    );

    logger.info(
      `✅ Successfully created ${snapshotType} snapshots for competition ${competitionId.toString()}`,
    );
  } catch (error) {
    logger.error(
      `❌ Error creating snapshots for competition ${competitionId.toString()}:`,
      error,
    );
    await interaction.editReply(
      `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
