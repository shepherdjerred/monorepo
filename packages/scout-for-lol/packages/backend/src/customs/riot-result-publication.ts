import type { RawMatch } from "@scout-for-lol/data";
import { finalizeTournamentResult } from "#src/customs/riot-results.ts";
import { publishCustomNightSnapshot } from "#src/customs/socket.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

/** Publishes the committed Match-V5 projection before its cursor can advance. */
export async function finalizeAndPublishTournamentResult(
  client: ExtendedPrismaClient,
  match: RawMatch,
): Promise<void> {
  const nightId = await finalizeTournamentResult(client, match);
  if (nightId !== undefined) await publishCustomNightSnapshot(nightId);
}
