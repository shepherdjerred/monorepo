import "reflect-metadata";
import { dataSource } from "./db/index.ts";
import { Karma } from "./db/karma.ts";

/**
 * One-time migration script to assign a guildId to legacy karma records
 * that were created before multi-server support was added.
 *
 * Usage:
 *   GUILD_ID=your_server_id bun run src/migrate-legacy-karma.ts
 */

const GUILD_ID = Bun.env["GUILD_ID"];

async function migrateLegacyKarma() {
  if (GUILD_ID === undefined || GUILD_ID === "") {
    console.error("Error: GUILD_ID environment variable is required");
    console.error("Usage: GUILD_ID=your_server_id bun run src/migrate-legacy-karma.ts");
    console.error("\nTo find your server ID:");
    console.error("1. Enable Developer Mode in Discord (User Settings > Advanced > Developer Mode)");
    console.error("2. Right-click your server icon and select 'Copy Server ID'");
    process.exit(1);
  }

  console.warn(`Checking for legacy karma records (where guildId is NULL)...`);

  // Count records that need migration
  const countResult = await dataSource
    .getRepository(Karma)
    .createQueryBuilder("karma")
    .where("karma.guildId IS NULL")
    .getCount();

  if (countResult === 0) {
    console.warn("No legacy karma records found. Migration not needed.");
    process.exit(0);
  }

  console.warn(`Found ${countResult.toString()} legacy karma record(s) to migrate`);
  console.warn(`Will assign them to guild: ${GUILD_ID}`);
  console.warn("");

  // Prompt for confirmation
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question("Proceed with migration? (yes/no): ", resolve);
  });
  rl.close();

  if (answer.toLowerCase() !== "yes" && answer.toLowerCase() !== "y") {
    console.warn("Migration cancelled");
    process.exit(0);
  }

  // Perform the migration
  console.warn("Starting migration...");

  const result = await dataSource
    .getRepository(Karma)
    .createQueryBuilder()
    .update(Karma)
    .set({ guildId: GUILD_ID })
    .where("guildId IS NULL")
    .execute();

  console.warn(`Migration complete! Updated ${String(result.affected)} record(s)`);
  console.warn("All legacy karma has been assigned to the specified server");

  process.exit(0);
}

try {
  await migrateLegacyKarma();
} catch (error: unknown) {
  console.error("Migration failed:", error);
  process.exit(1);
}
