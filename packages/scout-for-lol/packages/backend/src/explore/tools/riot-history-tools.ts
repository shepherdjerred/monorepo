import { tool } from "ai";
import { z } from "zod";
import {
  LeaguePuuidSchema,
  DiscordGuildIdSchema,
  RegionSchema,
  RiotIdSchema,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import { ScoutExploreHistoryResultSchema } from "@scout-for-lol/temporal";
import configuration from "#src/configuration.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma } from "#src/database/index.ts";
import { resolveCurrentLaneOpponent } from "#src/explore/tools/current-opponent.ts";
import { resolveRiotIdToPuuid } from "#src/lib/riot/resolve-puuid.ts";
import { currentScoutTemporalSupervisor } from "#src/temporal/runtime.ts";
import { startScoutExploreHistory } from "#src/temporal/starts.ts";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";

const ACQUISITION_BUCKET_MS = 10 * 60 * 1000;
const RANKED_MATCH_COUNT = 100;

export const RankedHistoryTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("current_lane_opponent") }).strict(),
  z
    .object({
      kind: z.literal("riot_id"),
      riotId: z.string().min(1).max(32),
      region: RegionSchema,
    })
    .strict(),
]);

export async function riotHistoryExploreEnabled(
  guildIds: string[],
): Promise<boolean> {
  const decisions = await Promise.all(
    guildIds.map(
      async (guildId) =>
        await isPolicyEnabled("explore_on_demand_riot_enabled", {
          server: DiscordGuildIdSchema.parse(guildId),
        }),
    ),
  );
  return decisions.some(Boolean);
}

export async function resolveRiotPlayerTarget(
  target: z.infer<typeof RankedHistoryTargetSchema>,
  requesterId: DiscordAccountId,
  guildIds: string[],
): Promise<
  | {
      kind: "ok";
      puuid: string;
      region: z.infer<typeof RegionSchema>;
      label: string;
      lane: string | null;
    }
  | { kind: "error"; message: string }
> {
  if (target.kind === "current_lane_opponent") {
    const opponent = await resolveCurrentLaneOpponent({
      database: prisma,
      requesterId,
      guildIds,
    });
    return opponent.kind === "found"
      ? {
          kind: "ok",
          puuid: opponent.puuid,
          region: opponent.region,
          label: opponent.riotId,
          lane: opponent.lane,
        }
      : { kind: "error", message: opponent.message };
  }
  const riotId = RiotIdSchema.safeParse(target.riotId);
  if (!riotId.success) {
    return {
      kind: "error",
      message: "Use a full Riot ID in the form GameName#TAG.",
    };
  }
  const resolved = await resolveRiotIdToPuuid(riotId.data, target.region);
  return resolved.kind === "ok"
    ? {
        kind: "ok",
        puuid: resolved.puuid,
        region: target.region,
        label: `${resolved.gameName}#${resolved.tagLine}`,
        lane: null,
      }
    : {
        kind: "error",
        message: `Riot could not find that account: ${resolved.message}`,
      };
}

export function createRiotHistoryExploreTools(input: {
  requesterId: DiscordAccountId;
  guildIds: string[];
  track: ToolTracker;
}) {
  return {
    acquire_ranked_history: tool({
      description:
        "Ensure Scout's report lake covers the newest 100 ranked games for a full Riot ID or the asker's current lane opponent. Known games are reused and only missing games are fetched. Use before ScoutQL when existing data does not cover that player. Load riot-history first.",
      inputSchema: z.object({ target: RankedHistoryTargetSchema }).strict(),
      outputSchema: ScoutExploreHistoryResultSchema.extend({
        ok: z.boolean(),
        player: z.string().nullable(),
        lane: z.string().nullable(),
        message: z.string(),
      }).strict(),
      execute: ({ target }) =>
        input.track("acquire_ranked_history", async () => {
          const resolved = await resolveRiotPlayerTarget(
            target,
            input.requesterId,
            input.guildIds,
          );
          if (resolved.kind === "error") {
            return {
              ok: false,
              player: null,
              lane: null,
              requested: 0,
              found: 0,
              alreadyAvailable: 0,
              ingested: 0,
              skipped: 0,
              message: resolved.message,
            };
          }
          const supervisor = currentScoutTemporalSupervisor();
          if (supervisor === undefined) {
            throw new Error(
              "Temporal is unavailable for Riot history acquisition",
            );
          }
          const handle = await startScoutExploreHistory(supervisor.client(), {
            stage: configuration.environment,
            puuid: LeaguePuuidSchema.parse(resolved.puuid),
            region: resolved.region,
            acquisitionBucket: Math.floor(Date.now() / ACQUISITION_BUCKET_MS),
            requestedMatches: RANKED_MATCH_COUNT,
          });
          const workflowResult = await handle.result();
          const result = ScoutExploreHistoryResultSchema.parse(workflowResult);
          return {
            ok: true,
            player: resolved.label,
            lane: resolved.lane,
            ...result,
            message: `${(result.alreadyAvailable + result.ingested).toString()} of ${result.found.toString()} recent ranked games for ${resolved.label} are now ready in Scout's report lake (${result.alreadyAvailable.toString()} already present, ${result.ingested.toString()} newly fetched). Query them with ScoutQL and state the actual game count returned.`,
          };
        }),
    }),
  };
}
