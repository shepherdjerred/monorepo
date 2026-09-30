import { TRPCError } from "@trpc/server";
import type {
  CompetitionId,
  CompetitionWithCriteria,
} from "@scout-for-lol/data";
import { getCompetitionById } from "#src/database/competition/queries.ts";
import { prisma } from "#src/database/index.ts";

/** Translate a competition domain error into a user-facing request failure. */
export function asCompetitionBadRequest(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

export async function loadGuildCompetitionOr404(
  competitionId: CompetitionId,
  guildId: string,
): Promise<CompetitionWithCriteria> {
  const competition = await getCompetitionById(prisma, competitionId);
  if (competition?.serverId !== guildId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Competition not found",
    });
  }
  return competition;
}
