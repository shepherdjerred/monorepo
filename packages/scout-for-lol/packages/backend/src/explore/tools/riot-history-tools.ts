import type { DiscordGuildId } from "@scout-for-lol/domain/identity/discord.ts";
import type { LeaguePuuid } from "@scout-for-lol/domain/identity/league-account.ts";
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
const HISTORY_MATCH_COUNT = 100;
const HISTORY_WAIT_MS = 120_000;

const MatchTypeSchema = z.enum(["ranked", "normal"]);
const HistoryContextSchema = z.object({
  player: z.string().nullable(),
  lane: z.string().nullable(),
  matchType: MatchTypeSchema,
  message: z.string(),
});
const HistoryOutputSchema = z.discriminatedUnion("status", [
  HistoryContextSchema.extend({
    status: z.literal("ready"),
    ok: z.literal(true),
    ...ScoutExploreHistoryResultSchema.shape,
  }).strict(),
  HistoryContextSchema.extend({
    status: z.literal("pending"),
    ok: z.literal(true),
    requested: z.number().int(),
    workflowId: z.string(),
  }).strict(),
  HistoryContextSchema.extend({
    status: z.literal("error"),
    ok: z.literal(false),
  }).strict(),
]);

/** A bounded turn wait never cancels the durable import. */
export async function waitForExploreHistory<T>(
  result: Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs = HISTORY_WAIT_MS,
): Promise<{ status: "ready"; result: T } | { status: "pending" }> {
  signal?.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      result.then((value) => ({ status: "ready" as const, result: value })),
      new Promise<{ status: "pending" }>((resolve, reject) => {
        timer = setTimeout(() => {
          resolve({ status: "pending" });
        }, timeoutMs);
        abort = () => {
          reject(new Error("History wait aborted", { cause: signal?.reason }));
        };
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted === true) abort();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort !== undefined) signal?.removeEventListener("abort", abort);
  }
}

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
  guildIds: DiscordGuildId[],
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
  guildIds: DiscordGuildId[],
): Promise<
  | {
      kind: "ok";
      puuid: LeaguePuuid;
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
  guildIds: DiscordGuildId[];
  track: ToolTracker;
  abortSignal?: AbortSignal | undefined;
}) {
  const acquire = (
    toolName: string,
    target: z.infer<typeof RankedHistoryTargetSchema>,
    matchType: z.infer<typeof MatchTypeSchema>,
    legacy = false,
  ) =>
    input.track(
      toolName,
      async (): Promise<z.infer<typeof HistoryOutputSchema>> => {
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
            status: "error",
            matchType,
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
          requestedMatches: HISTORY_MATCH_COUNT,
          ...(legacy ? {} : { matchType }),
        });
        const waited = await waitForExploreHistory(
          handle.result(),
          input.abortSignal,
        );
        if (waited.status === "pending") {
          return {
            status: "pending",
            ok: true,
            player: resolved.label,
            lane: resolved.lane,
            matchType,
            requested: HISTORY_MATCH_COUNT,
            workflowId: handle.workflowId,
            message: `The recent ${matchType} history import for ${resolved.label} is still running. No completed coverage count is available yet. It continues in the background; ask again after it finishes. Do not claim these games are ready or that Scout has no games.`,
          };
        }
        const result = ScoutExploreHistoryResultSchema.parse(waited.result);
        return {
          status: "ready",
          ok: true,
          player: resolved.label,
          lane: resolved.lane,
          matchType,
          ...result,
          message: `${(result.alreadyAvailable + result.ingested).toString()} of ${result.found.toString()} recent ${matchType} games returned by Riot for ${resolved.label} are now ready in Scout's report lake (${result.alreadyAvailable.toString()} already present, ${result.ingested.toString()} newly fetched, ${result.skipped.toString()} unavailable). Query them with ScoutQL and state the actual game count and date bounds returned. This does not establish lifetime coverage.`,
        };
      },
    );
  return {
    acquire_ranked_history: tool({
      description:
        "Import up to the newest 100 ranked games for a full Riot ID or current lane opponent. Use only for requested recent ranked history. Load riot-history first.",
      inputSchema: z.object({ target: RankedHistoryTargetSchema }).strict(),
      outputSchema: HistoryOutputSchema,
      execute: ({ target }) =>
        acquire("acquire_ranked_history", target, "ranked", true),
    }),
    acquire_match_history: tool({
      description:
        "Import up to the newest 100 ranked or normal games for a full Riot ID or current lane opponent. Choose the requested match type explicitly. Use only when the user requests fetching more history; existing missing coverage alone is not permission. Known matches are reused. Load riot-history first. May return pending while the durable import continues.",
      inputSchema: z
        .object({
          target: RankedHistoryTargetSchema,
          matchType: MatchTypeSchema,
        })
        .strict(),
      outputSchema: HistoryOutputSchema,
      execute: ({ target, matchType }) =>
        acquire("acquire_match_history", target, matchType),
    }),
  };
}
