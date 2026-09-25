import type { DiscordGuildId } from "@scout-for-lol/data";

/**
 * Which population a lake query runs over.
 *
 * `guild` joins the accounts dimension, narrowing match facts to the accounts
 * one Discord server tracks and labelling rows with that server's player
 * aliases. This is what every scheduled and user-authored report uses.
 *
 * `global` skips the accounts join entirely. Match facts already hold one row
 * per participant of every ingested match (`flattenMatch` maps
 * `info.participants` with no tracked-player filter) and already carry
 * `riot_id_game_name` / `riot_id_tagline`, so there is nothing to join.
 *
 * Not joining is what makes the global path *correct*, not merely simpler:
 * accounts rows are written per `(server_id, account)`, so an accounts join
 * with the `server_id` predicate removed would match a PUUID once per server
 * tracking it and silently double-count that account in every aggregate.
 *
 * A discriminated union rather than an optional `serverId` on purpose — a
 * field that merely went missing would let a scheduled report widen to the
 * whole lake by accident. Global has to be asked for.
 */
export type LakeQueryScope =
  | { kind: "guild"; serverId: DiscordGuildId }
  /**
   * The tracked players of several servers at once, merged into people so a
   * player several of them track counts once (see `server-people.ts`). One
   * server is always `guild`, never a one-element list, so a single-server
   * answer is exactly what that server's reports show.
   */
  | { kind: "servers"; serverIds: readonly DiscordGuildId[] }
  | { kind: "global" };

export function guildScope(serverId: DiscordGuildId): LakeQueryScope {
  return { kind: "guild", serverId };
}

export const GLOBAL_SCOPE: LakeQueryScope = { kind: "global" };

/** One server is guild scope; several are the merged `servers` scope. */
export function serversScope(
  serverIds: readonly DiscordGuildId[],
): LakeQueryScope {
  const unique = [...new Set(serverIds)];
  const [first, ...rest] = unique;
  if (first === undefined) {
    throw new Error("A server scope needs at least one server.");
  }
  return rest.length === 0
    ? guildScope(first)
    : { kind: "servers", serverIds: unique };
}

/** Whether rows are a set of servers' tracked players, labelled by alias. */
export function isTrackedScope(scope: LakeQueryScope): boolean {
  return scope.kind !== "global";
}

/**
 * The server id a guild-scoped operation requires, or a hard failure.
 *
 * Used by the paths that authorize against an owning server (competitions),
 * which have no meaning without one.
 */
export function requireGuildScope(
  scope: LakeQueryScope,
  what: string,
): DiscordGuildId {
  if (scope.kind !== "guild") {
    throw new Error(`${what} needs exactly one server's scope.`);
  }
  return scope.serverId;
}
