import { tool } from "ai";
import { z } from "zod";
import { DiscordGuildIdSchema, type DiscordGuildId } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  GLOBAL_SCOPE,
  serversScope,
  type LakeQueryScope,
} from "#src/reports/duckdb/scope.ts";
import { serverNames } from "#src/explore/tools/hall-tools.ts";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";

/**
 * Which servers' tracked players a query reads.
 *
 * Every member of a server holds the implicit Player role, which reads its
 * players and reports, and a turn's servers are already verified
 * memberships: the web session's OAuth guild list, or the one server a
 * Discord command or voice session runs in. So membership is the whole gate
 * — a server outside the turn is refused, and nothing else is checked.
 *
 * A web user may be in many servers, so the list is never put in the prompt
 * or a tool description; the model asks `list_my_servers` for it.
 */

/**
 * Explore's tools run in strict JSON-schema mode, where every property is
 * required. An optional `servers` could therefore never be left out, so
 * "every match" was not expressible and the model sent all its servers for
 * every question. Null is how a strict schema says "none".
 */
export const QueryServersSchema = z
  .union([
    z.literal("all_my_servers"),
    z.array(DiscordGuildIdSchema).min(1).max(50),
  ])
  .nullable()
  .describe(
    "null for most questions: the query then reads every ingested match. Set it only for 'our', 'the server's' or 'my group's' players and for player_groups: a list of server ids from list_my_servers, or \"all_my_servers\" for every server the user is in (never for every match — use null for that). With servers the query reads only those servers' tracked players, labelled by their Scout names.",
  );

export type QueryServers = z.infer<typeof QueryServersSchema>;

export type TurnScope =
  | { ok: true; scope: LakeQueryScope; guildIds: DiscordGuildId[] }
  | { ok: false; message: string };

/**
 * The lake scope for a query's `servers` input, bounded by the turn.
 *
 * `guildIds` is what `player('…')` names resolve against: the chosen servers,
 * or, for a global query, every server in the turn, as before.
 */
export function resolveTurnScope(
  servers: QueryServers,
  turnGuildIds: readonly string[],
): TurnScope {
  const turn = turnGuildIds.map((guildId) =>
    DiscordGuildIdSchema.parse(guildId),
  );
  if (servers === null) {
    return { ok: true, scope: GLOBAL_SCOPE, guildIds: turn };
  }
  const chosen = servers === "all_my_servers" ? turn : servers;
  const outside = chosen.filter((guildId) => !turn.includes(guildId));
  if (outside.length > 0) {
    return {
      ok: false,
      // No ids in the message: it is recorded in traces that share links
      // serve, and the model already knows which servers it asked for.
      message:
        "The user is not in some of those servers. Call list_my_servers for the servers they are in.",
    };
  }
  if (chosen.length === 0) {
    return {
      ok: false,
      message:
        "The user is in no Scout servers here, so there are no tracked players to read. Query without servers instead.",
    };
  }
  return { ok: true, scope: serversScope(chosen), guildIds: [...chosen] };
}

const ListServersInputSchema = z
  .object({
    search: z
      .string()
      .max(100)
      .optional()
      .describe("Part of a server name, case-insensitive."),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export const ListServersDataSchema = z.strictObject({
  servers: z.array(z.strictObject({ serverId: z.string(), name: z.string() })),
  total: z.number(),
});

export const ListServersResultSchema = z.strictObject({
  kind: z.literal("servers"),
  message: z.string(),
  data: ListServersDataSchema,
});

export function createListMyServersTool(options: {
  readonly db: ExtendedPrismaClient;
  readonly guildIds: readonly string[];
  readonly track: ToolTracker;
}) {
  return tool({
    description:
      "List the Discord servers the user is in, by name, to pick the `servers` of a query about 'our' players. Search by name when the user names one.",
    inputSchema: ListServersInputSchema,
    outputSchema: ListServersResultSchema,
    execute: (input) =>
      options.track("list_my_servers", async () => {
        const names = await serverNames(options.db, options.guildIds);
        const needle = input.search?.trim().toLowerCase() ?? "";
        const all = options.guildIds
          .map((serverId) => ({
            serverId,
            name: names.get(serverId) ?? serverId,
          }))
          .filter((server) => server.name.toLowerCase().includes(needle))
          .toSorted((left, right) => left.name.localeCompare(right.name));
        const servers = all.slice(0, input.limit ?? 20);
        return {
          kind: "servers" as const,
          data: { servers, total: all.length },
          message:
            all.length === 0
              ? "No server the user is in matches that name."
              : all.length === 1
                ? "One server matches; use it."
                : `${all.length.toString()} servers match. Use the one the user named; if it is still unclear, ask which they mean, naming a few.`,
        };
      }),
  });
}
