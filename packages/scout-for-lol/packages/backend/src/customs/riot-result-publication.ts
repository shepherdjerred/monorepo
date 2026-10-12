import type { MatchDataSource } from "@scout-for-lol/domain/match-processing/states.ts";
import type { RawMatch } from "@scout-for-lol/data";
import { finalizeManagedCustomResult } from "#src/customs/riot-results.ts";
import { publishCustomNightSnapshot } from "#src/customs/socket.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

/** Publishes the committed Match-V5 projection before its cursor can advance. */
export async function finalizeAndPublishManagedCustomResult(
  client: ExtendedPrismaClient,
  match: RawMatch,
  source: MatchDataSource,
): Promise<void> {
  const nightId = await finalizeManagedCustomResult(client, match, source);
  if (nightId !== undefined) await publishCustomNightSnapshot(nightId);
}
