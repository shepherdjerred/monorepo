import { tool } from "ai";
import { z } from "zod";
import {
  COMPETITIVE_PROGRESSION_CATALOG,
  DiscordGuildIdSchema,
  HallBaselineStatusSchema,
  HallQueueFamilyIdSchema,
  HallRecordIdSchema,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { getHall } from "#src/progression/hall/read.ts";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";

/** The servers in scope whose Hall of Fame is switched on. */
export type HallExploreCapability = {
  readonly guildIds: readonly DiscordGuildId[];
};

/**
 * Whether — and for which servers — this turn may read the Hall of Fame.
 *
 * The same flag the web app checks before serving the board. Membership is
 * already guaranteed: a turn's guilds are the asker's own servers, which is
 * the only other thing the web route requires.
 */
export async function resolveHallCapability(
  guildIds: readonly string[],
): Promise<HallExploreCapability | null> {
  const enabled: DiscordGuildId[] = [];
  for (const raw of guildIds) {
    const guildId = DiscordGuildIdSchema.parse(raw);
    if (await isPolicyEnabled("hall_of_fame_enabled", { server: guildId })) {
      enabled.push(guildId);
    }
  }
  return enabled.length === 0 ? null : { guildIds: enabled };
}

const HallCellSchema = z.strictObject({
  queueFamily: z.string(),
  record: z.string(),
  status: HallBaselineStatusSchema,
  value: z.number().nullable(),
  holders: z.array(z.string()),
  games: z.array(
    z.strictObject({
      matchId: z.string(),
      gameEndAt: z.string(),
      holder: z.string(),
    }),
  ),
});

const HallToolResultSchema = z.strictObject({
  kind: z.literal("hall_of_fame"),
  message: z.string(),
  data: z.array(
    z.strictObject({
      guildId: z.string(),
      enabledQueueFamilies: z.array(z.string()),
      cells: z.array(HallCellSchema),
    }),
  ),
});

const HallToolInputSchema = z.strictObject({
  guildId: DiscordGuildIdSchema.optional().describe(
    "Only this server. Omit to read every server in scope that has a Hall.",
  ),
  queueFamily: HallQueueFamilyIdSchema.optional().describe(
    "Only this queue family. Omit for all of the server's enabled families.",
  ),
  record: HallRecordIdSchema.optional().describe(
    "Only this record. Omit for every enabled record.",
  ),
});

const FAMILY_LABEL = new Map(
  COMPETITIVE_PROGRESSION_CATALOG.hall.queueFamilies.map((family) => [
    family.id,
    family.label,
  ]),
);
const RECORD_LABEL = new Map(
  COMPETITIVE_PROGRESSION_CATALOG.hall.records.map((record) => [
    record.id,
    record.label,
  ]),
);

function holderName(holder: {
  readonly playerAlias: string;
  readonly accountAlias: string;
}): string {
  return holder.playerAlias === holder.accountAlias
    ? holder.playerAlias
    : `${holder.playerAlias} (${holder.accountAlias})`;
}

/**
 * The Hall of Fame board itself, read rather than re-derived.
 *
 * Explore used to approximate each record from the match lake, which can
 * disagree with the board a server actually shows: the board counts only
 * games since the server began tracking, only the families and records the
 * server switched on, and reports a board still being built as building.
 * Reading the cells answers "who is in the Hall of Fame" exactly.
 */
export function createHallExploreTools(options: {
  readonly db: ExtendedPrismaClient;
  readonly capability: HallExploreCapability;
  readonly track: ToolTracker;
}) {
  return {
    get_hall_of_fame: tool({
      description:
        "Read a server's Hall of Fame: every enabled record's current value, holders and the games that set it, per queue family. Use this for any Hall of Fame question instead of computing records from match data.",
      inputSchema: HallToolInputSchema,
      outputSchema: HallToolResultSchema,
      execute: (input) =>
        options.track("get_hall_of_fame", async () => {
          const guildIds =
            input.guildId === undefined
              ? options.capability.guildIds
              : options.capability.guildIds.filter(
                  (guildId) => guildId === input.guildId,
                );
          if (guildIds.length === 0) {
            return HallToolResultSchema.parse({
              kind: "hall_of_fame",
              message:
                "That server does not have the Hall of Fame switched on, so there is no board to read.",
              data: [],
            });
          }
          const guilds = await Promise.all(
            guildIds.map(async (guildId) => {
              const hall = await getHall(options.db, guildId);
              const cells = hall.entries
                .filter(
                  (entry) =>
                    (input.queueFamily === undefined ||
                      entry.queueFamilyId === input.queueFamily) &&
                    (input.record === undefined ||
                      entry.recordId === input.record),
                )
                .map((entry) => ({
                  queueFamily:
                    FAMILY_LABEL.get(entry.queueFamilyId) ??
                    entry.queueFamilyId,
                  record: RECORD_LABEL.get(entry.recordId) ?? entry.recordId,
                  status: entry.baselineStatus,
                  value: entry.currentValue,
                  holders: entry.holders.map((holder) => holderName(holder)),
                  games: entry.evidence.map((game) => ({
                    matchId: game.matchId,
                    gameEndAt: game.gameEndAt,
                    holder: holderName(game.holder),
                  })),
                }));
              return {
                guildId,
                enabledQueueFamilies: hall.settings.enabledQueueFamilies.map(
                  (family) => FAMILY_LABEL.get(family) ?? family,
                ),
                cells,
              };
            }),
          );
          const building = guilds.some((guild) =>
            guild.cells.some((cell) => cell.status !== "ready"),
          );
          return HallToolResultSchema.parse({
            kind: "hall_of_fame",
            message: building
              ? "Some records are still being built or failed to build; report those as not yet available rather than as having no holder."
              : "These are the server's current Hall of Fame records.",
            data: guilds,
          });
        }),
    }),
  };
}
