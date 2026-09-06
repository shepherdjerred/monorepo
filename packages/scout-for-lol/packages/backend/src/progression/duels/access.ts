import { TRPCError } from "@trpc/server";
import type { DiscordGuildId } from "@scout-for-lol/data";
import type { ScoutStage } from "@scout-for-lol/temporal";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

const REQUIRED_RIOT_APPROVALS = [
  "classic_objectives",
  "sub_twenty_events",
] as const;

export async function duelRolloutAllowed(
  db: ExtendedPrismaClient,
  guildId: DiscordGuildId,
  stage: ScoutStage,
): Promise<boolean> {
  if (!(await isPolicyEnabled("duels_enabled", { server: guildId }))) {
    return false;
  }
  if (stage === "dev") return true;
  const approvals = await db.duelRiotApproval.count({
    where: { feature: { in: [...REQUIRED_RIOT_APPROVALS] } },
  });
  return approvals === REQUIRED_RIOT_APPROVALS.length;
}

export async function assertDuelsEnabled(
  db: ExtendedPrismaClient,
  guildId: DiscordGuildId,
  stage: ScoutStage,
): Promise<void> {
  if (!(await duelRolloutAllowed(db, guildId, stage))) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Duels are unavailable pending Riot approval",
    });
  }
}
