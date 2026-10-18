import type { Db } from "#src/database/index.ts";
import type { DiscordGuildId } from "@scout-for-lol/data";

/** Serializes retained-history rewrites for one guild inside a transaction. */
export async function lockCustomGuild(
  transaction: Db,
  guildId: DiscordGuildId,
): Promise<void> {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('scout-customs'), hashtext(${guildId}))`;
}
