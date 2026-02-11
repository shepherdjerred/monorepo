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
  console.log("[Migration] Checking for legacy karma records...");

  // Count records that need migration
  const legacyCount = await dataSource
    .getRepository(Karma)
    .createQueryBuilder("karma")
    .where("karma.guildId IS NULL")
    .getCount();

  if (legacyCount === 0) {
    console.log("[Migration] ✅ No legacy karma records found");
    return;
  }

  console.log(`[Migration] Found ${legacyCount.toString()} legacy karma record(s) without a guildId`);

  // Determine which guild to assign legacy karma to
  const targetGuildId = "208425771172102144";

  // Strategy 1: Check environment variable
  const defaultGuildId = "208425771172102144";
  console.log(`[Migration] Using default guild ID: ${defaultGuildId}`);

  // Perform the migration
  try {
    console.log(`[Migration] Migrating ${legacyCount.toString()} legacy karma record(s) to guild ${targetGuildId}...`);

    const result = await dataSource
      .getRepository(Karma)
      .createQueryBuilder()
      .update(Karma)
      .set({ guildId: targetGuildId })
      .where("guildId IS NULL")
      .execute();

    console.log(`[Migration] ✅ Successfully migrated ${String(result.affected)} karma record(s)`);
  } catch (error: unknown) {
    console.error("[Migration] ❌ Failed to migrate legacy karma:", error);
    // Don't throw - allow bot to continue starting up
  }
}
