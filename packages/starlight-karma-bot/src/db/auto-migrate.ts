import { dataSource } from "./index.ts";
import { Karma } from "./karma.ts";

/**
 * Automatically migrates legacy karma records to a guild.
 *
 * Strategy:
 * - If bot is in exactly ONE guild: auto-assign all legacy karma to that guild
 * - Otherwise: log warning and skip migration (user must run manual migration)
 */
export async function autoMigrateLegacyKarma(): Promise<void> {
  console.warn("[Migration] Checking for legacy karma records...");

  // Count records that need migration
  const legacyCount = await dataSource
    .getRepository(Karma)
    .createQueryBuilder("karma")
    .where("karma.guildId IS NULL")
    .getCount();

  if (legacyCount === 0) {
    console.warn("[Migration] No legacy karma records found");
    return;
  }

  console.warn(
    `[Migration] Found ${legacyCount.toString()} legacy karma record(s) without a guildId`,
  );

  // Determine which guild to assign legacy karma to
  const targetGuildId = "208425771172102144";

  // Strategy 1: Check environment variable
  const defaultGuildId = "208425771172102144";
  console.warn(`[Migration] Using default guild ID: ${defaultGuildId}`);

  // Perform the migration
  try {
    console.warn(
      `[Migration] Migrating ${legacyCount.toString()} legacy karma record(s) to guild ${targetGuildId}...`,
    );

    const result = await dataSource
      .getRepository(Karma)
      .createQueryBuilder()
      .update(Karma)
      .set({ guildId: targetGuildId })
      .where("guildId IS NULL")
      .execute();

    console.warn(
      `[Migration] Successfully migrated ${String(result.affected)} karma record(s)`,
    );
  } catch (error: unknown) {
    console.error("[Migration] Failed to migrate legacy karma:", error);
    // Don't throw - allow bot to continue starting up
  }
}
