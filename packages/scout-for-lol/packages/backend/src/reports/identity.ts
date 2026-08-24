import { z } from "zod";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { bindParams } from "#src/reports/duckdb/lake-reads.ts";
import {
  buildMatchesSource,
  listParam,
  resolveLakeFiles,
  scalarParam,
  type BoundParam,
  type SqlFragment,
} from "#src/reports/duckdb/lake.ts";

/**
 * Who a name refers to, as a set of PUUIDs.
 *
 * Explore filters players by the Riot ID recorded on each match row. That is a
 * display name: it changes when someone renames, and it belongs to one of
 * possibly several accounts the same person plays. Both fan-outs compound —
 * in Beta one player holds five PUUIDs under seven Riot IDs — so a query for
 * one name finds only the slice played under that name, and a name can even
 * belong to somebody else entirely.
 *
 * PUUIDs never change, so resolving to a PUUID set fixes both at once. The
 * resolved PUUIDs stay in the data layer: everything a human reads is the
 * display name on {@link ResolvedIdentity}.
 */

export type ResolvedIdentity = {
  /** What a human should read: the Scout alias if tracked, else a Riot ID. */
  displayName: string;
  /** The data-layer key. Never rendered, never written into query text. */
  puuids: string[];
  /** Every Riot ID these accounts have used, most recent first. */
  riotIds: string[];
  games: number;
  firstSeen: string;
  lastSeen: string;
  matchedBy: "alias" | "riot_id";
  /** Set when this came from a tracked player rather than a raw Riot ID. */
  trackedAlias: string | undefined;
};

const AccountRowSchema = z.object({
  server_id: z.string(),
  puuid: z.string(),
  player_id: z.union([z.bigint(), z.number()]).transform(Number),
  player_alias: z.string(),
  discord_id: z.string().nullable(),
});

const IdentityRowSchema = z.object({
  puuid: z.string(),
  riot_id: z.string(),
  games: z.union([z.bigint(), z.number()]).transform(Number),
  // Cast to VARCHAR in SQL: DuckDB hands back a DuckDBTimestampValue object,
  // not a string or a Date, and an ISO string is what callers render anyway.
  first_seen: z.string(),
  last_seen: z.string(),
});

async function runQuery<T>(
  sql: string,
  params: BoundParam[],
  schema: z.ZodType<T>,
): Promise<T[]> {
  return await withDuckDBConnection(async (session) => {
    const rows = await session.run(sql, bindParams(session, params));
    return rows.map((row) => schema.parse(row));
  });
}

/**
 * Tracked accounts matching a name, across the servers the asker belongs to.
 *
 * A standalone lookup, deliberately not a join into the facts CTE. The
 * no-accounts-join rule in global scope exists because accounts rows are
 * per `(server_id, puuid)`, so joining fans a player out once per server that
 * tracks them and doubles every aggregate. Reading the dimension on its own
 * fans out nothing — the result is a PUUID set, and a PUUID appears once in it
 * however many servers track it.
 *
 * Scoped to the asker's own servers so this cannot be used to discover who
 * some other server tracks.
 */
async function lookupTrackedAccounts(
  accountsParquet: string | undefined,
  guildIds: string[],
  needle: string,
): Promise<z.infer<typeof AccountRowSchema>[]> {
  if (accountsParquet === undefined || guildIds.length === 0) return [];
  return await runQuery(
    // Two hops on purpose. Matching `account_alias` finds one account, but the
    // question is who that account belongs to, so the match is a seed and the
    // person's other accounts come back with it. Without this, searching by an
    // account alias undercounts exactly the multi-account players this exists
    // to handle.
    `WITH scoped AS (
       SELECT * FROM read_parquet(?) WHERE server_id IN (SELECT unnest(?))
     ),
     seed AS (
       SELECT server_id, player_id, discord_id FROM scoped
        WHERE lower(player_alias) = ? OR lower(account_alias) = ?
     )
     SELECT DISTINCT server_id, puuid, player_id, player_alias, discord_id
       FROM scoped
      WHERE (server_id, player_id) IN (SELECT server_id, player_id FROM seed)
         OR (discord_id IS NOT NULL
             AND discord_id IN (SELECT discord_id FROM seed WHERE discord_id IS NOT NULL))`,
    [
      listParam([accountsParquet]),
      listParam(guildIds),
      scalarParam(needle),
      scalarParam(needle),
    ],
    AccountRowSchema,
  );
}

/**
 * Every account belonging to the same tracked people as `puuids`.
 *
 * Two hops: the PUUID identifies a player row, and that player's other
 * accounts come back with it. Restricted to the asker's servers, so this
 * cannot reveal that some other server tracks the account.
 */
async function lookupAccountsByPuuids(
  accountsParquet: string | undefined,
  guildIds: string[],
  puuids: string[],
): Promise<z.infer<typeof AccountRowSchema>[]> {
  if (
    accountsParquet === undefined ||
    guildIds.length === 0 ||
    puuids.length === 0
  ) {
    return [];
  }
  return await runQuery(
    `WITH scoped AS (
       SELECT * FROM read_parquet(?) WHERE server_id IN (SELECT unnest(?))
     ),
     seed AS (
       SELECT server_id, player_id, discord_id FROM scoped
        WHERE puuid IN (SELECT unnest(?))
     )
     SELECT DISTINCT server_id, puuid, player_id, player_alias, discord_id
       FROM scoped
      WHERE (server_id, player_id) IN (SELECT server_id, player_id FROM seed)
         -- discord_id is the cross-server key; without this a person tracked
         -- in two servers keeps two player_ids and stays split here, even
         -- though the alias path unions them.
         OR (discord_id IS NOT NULL
             AND discord_id IN (SELECT discord_id FROM seed WHERE discord_id IS NOT NULL))`,
    [listParam([accountsParquet]), listParam(guildIds), listParam(puuids)],
    AccountRowSchema,
  );
}

/** Every Riot ID a PUUID set has played under, with counts and bounds. */
async function riotIdHistory(
  source: SqlFragment,
  puuids: string[],
): Promise<z.infer<typeof IdentityRowSchema>[]> {
  return await runQuery(
    `SELECT puuid,
            concat_ws('#', riot_id_game_name, riot_id_tagline) AS riot_id,
            count(*) AS games,
            CAST(min(game_creation_at) AS VARCHAR) AS first_seen,
            CAST(max(game_creation_at) AS VARCHAR) AS last_seen
       FROM (${source.sql})
      WHERE puuid IN (SELECT unnest(?))
      GROUP BY 1, 2
      ORDER BY max(game_creation_at) DESC`,
    [...source.params, listParam(puuids)],
    IdentityRowSchema,
  );
}

/** PUUIDs whose recorded Riot ID matches, either `Name#TAG` or a bare name. */
async function lookupByRiotId(
  source: SqlFragment,
  needle: string,
): Promise<string[]> {
  const rows = await runQuery(
    `SELECT DISTINCT puuid
       FROM (${source.sql})
      WHERE lower(concat_ws('#', riot_id_game_name, riot_id_tagline)) = ?
         OR lower(riot_id_game_name) = ?`,
    [...source.params, scalarParam(needle), scalarParam(needle)],
    z.object({ puuid: z.string() }),
  );
  return rows.map((row) => row.puuid);
}

function groupAccountsByPerson(
  accounts: z.infer<typeof AccountRowSchema>[],
): z.infer<typeof AccountRowSchema>[][] {
  let groups: z.infer<typeof AccountRowSchema>[][] = [];
  for (const account of accounts) {
    const connected = groups.filter((group) =>
      group.some(
        (existing) =>
          existing.puuid === account.puuid ||
          (existing.discord_id !== null &&
            existing.discord_id === account.discord_id) ||
          (existing.server_id === account.server_id &&
            existing.player_id === account.player_id),
      ),
    );
    groups = [
      ...groups.filter((group) => !connected.includes(group)),
      [...connected.flat(), account],
    ];
  }
  return groups;
}

type IdentityCandidate = {
  puuids: string[];
  matchedBy: ResolvedIdentity["matchedBy"];
  trackedAlias: string | undefined;
};

function historyByPuuid(
  rows: z.infer<typeof IdentityRowSchema>[],
): Map<string, z.infer<typeof IdentityRowSchema>[]> {
  const grouped = new Map<string, z.infer<typeof IdentityRowSchema>[]>();
  for (const row of rows) {
    grouped.set(row.puuid, [...(grouped.get(row.puuid) ?? []), row]);
  }
  return grouped;
}

function summarise(
  rows: z.infer<typeof IdentityRowSchema>[],
  matchedBy: ResolvedIdentity["matchedBy"],
  trackedAlias: string | undefined,
): ResolvedIdentity | undefined {
  if (rows.length === 0) return undefined;
  // Each PUUID's history is ordered by the lake query, but a tracked person can
  // span several PUUID partitions. Re-sort the combined rows so the display
  // name, Riot-ID order, and lastSeen all describe the newest account event.
  const ordered = [...rows].sort((left, right) =>
    right.last_seen.localeCompare(left.last_seen),
  );
  const mostRecent = ordered[0];
  if (mostRecent === undefined) return undefined;
  return {
    displayName: trackedAlias ?? mostRecent.riot_id,
    puuids: [...new Set(ordered.map((row) => row.puuid))],
    riotIds: [...new Set(ordered.map((row) => row.riot_id))],
    games: ordered.reduce((total, row) => total + row.games, 0),
    firstSeen:
      ordered
        .map((row) => row.first_seen)
        .sort((left, right) => left.localeCompare(right))[0] ??
      mostRecent.first_seen,
    lastSeen: mostRecent.last_seen,
    matchedBy,
    trackedAlias,
  };
}

/**
 * Resolve a name to the people it could mean, best match first.
 *
 * Returns every candidate rather than guessing: "Long" is a tracked player's
 * alias *and* a substring of another player's old Riot ID, and silently
 * picking one is the failure this whole mechanism exists to prevent.
 */
export async function resolvePlayerIdentities(input: {
  query: string;
  /** The asker's Discord servers. Empty means Riot-ID lookup only. */
  guildIds: string[];
  lakeDir?: string | undefined;
}): Promise<ResolvedIdentity[]> {
  const needle = input.query.trim().toLowerCase();
  if (needle.length === 0) return [];

  const files = await resolveLakeFiles(input.lakeDir ?? resolveLakeDir());
  const source = buildMatchesSource(files, { sql: "TRUE", params: [] });
  if (source === undefined) return [];

  const candidates: IdentityCandidate[] = [];

  // Tracked players first: an alias is an intentional label a server chose,
  // so it outranks an incidental Riot ID collision.
  const accounts = await lookupTrackedAccounts(
    files.accountsParquet,
    input.guildIds,
    needle,
  );
  // A PUUID joins duplicate tracking rows across servers; Discord identity
  // joins separate accounts across servers; and (server, player) joins the
  // accounts of one unlinked tracked player inside a server.
  for (const group of groupAccountsByPerson(accounts)) {
    candidates.push({
      puuids: [...new Set(group.map((account) => account.puuid))],
      matchedBy: "alias",
      trackedAlias: group[0]?.player_alias,
    });
  }

  const claimed = new Set(candidates.flatMap((candidate) => candidate.puuids));
  const riotIdMatches = await lookupByRiotId(source, needle);
  // Expand every tracked Riot-ID match in one accounts scan. The old loop did
  // one accounts query and one complete match-history scan per candidate, so a
  // common bare name made latency grow with the number of matching accounts.
  const expandedAccounts = await lookupAccountsByPuuids(
    files.accountsParquet,
    input.guildIds,
    riotIdMatches.filter((puuid) => !claimed.has(puuid)),
  );
  const ownerByPuuid = new Map<string, z.infer<typeof AccountRowSchema>[]>();
  for (const group of groupAccountsByPerson(expandedAccounts)) {
    for (const account of group) ownerByPuuid.set(account.puuid, group);
  }

  for (const puuid of riotIdMatches) {
    // Re-check after each expansion: two matching accounts may belong to the
    // same person, and the first one claims the whole account set.
    if (claimed.has(puuid)) continue;
    // A Riot ID that belongs to a tracked account resolves to the whole
    // person, not that one account. "GexIsAngry" is one of Aaron's three
    // names across two accounts; answering for 160 of his 447 games would be
    // the same under-count by a different route.
    const owner = ownerByPuuid.get(puuid);
    const candidatePuuids =
      owner === undefined
        ? [puuid]
        : [...new Set(owner.map((account) => account.puuid))];
    for (const claimedPuuid of candidatePuuids) claimed.add(claimedPuuid);
    candidates.push({
      puuids: candidatePuuids,
      matchedBy: owner === undefined ? "riot_id" : "alias",
      trackedAlias: owner?.[0]?.player_alias,
    });
  }

  // One history scan for every candidate, then partition in memory. Resolution
  // now performs a fixed number of lake reads regardless of how common a bare
  // Riot game name is.
  if (candidates.length === 0) return [];
  const history = historyByPuuid(
    await riotIdHistory(source, [
      ...new Set(candidates.flatMap((candidate) => candidate.puuids)),
    ]),
  );
  return candidates.flatMap((candidate) => {
    const identity = summarise(
      candidate.puuids.flatMap((puuid) => history.get(puuid) ?? []),
      candidate.matchedBy,
      candidate.trackedAlias,
    );
    return identity === undefined ? [] : [identity];
  });
}

/**
 * The PUUIDs each `player('…')` reference resolves to, keyed by its index in
 * `plan.playerRefs` — a plan may hold several references, and each predicate
 * node names the one it meant.
 *
 * Unresolvable names throw rather than returning an empty set: an empty
 * `puuid IN ()` silently answers "no games", which is indistinguishable from a
 * real zero and is exactly the kind of confidently-wrong answer this change
 * exists to stop.
 */
export async function resolvePlayerRefPuuids(input: {
  playerRefs: string[];
  guildIds: string[];
  /** False when the caller has no asker, e.g. a scheduled report. */
  aliasScopeAvailable?: boolean;
  lakeDir?: string | undefined;
}): Promise<Map<number, string[]>> {
  const byIndex = new Map<number, string[]>();
  for (const [index, ref] of input.playerRefs.entries()) {
    const identities = await resolvePlayerIdentities({
      query: ref,
      guildIds: input.guildIds,
      lakeDir: input.lakeDir,
    });
    if (identities.length === 0) {
      throw new Error(
        input.aliasScopeAvailable === false
          ? `"${ref}" did not match a Riot ID, and Scout aliases cannot be resolved here — a scheduled report has no asker whose servers would scope them. Use a full Riot ID.`
          : `No player matches "${ref}". Call resolve_player to find the right name.`,
      );
    }
    if (identities.length > 1) {
      const names = identities
        .map((identity) => identity.displayName)
        .join(", ");
      throw new Error(
        `"${ref}" matches more than one player (${names}). Use the exact Riot ID of the one you mean.`,
      );
    }
    byIndex.set(index, [...new Set(identities[0]?.puuids)]);
  }
  return byIndex;
}
