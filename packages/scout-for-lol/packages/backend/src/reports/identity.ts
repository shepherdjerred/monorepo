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
       SELECT player_id, discord_id FROM scoped
        WHERE lower(player_alias) = ? OR lower(account_alias) = ?
     )
     SELECT DISTINCT puuid, player_id, player_alias, discord_id
       FROM scoped
      WHERE player_id IN (SELECT player_id FROM seed)
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
 * Every account belonging to the same tracked person as `puuid`.
 *
 * Two hops: the PUUID identifies a player row, and that player's other
 * accounts come back with it. Restricted to the asker's servers, so this
 * cannot reveal that some other server tracks the account.
 */
async function lookupAccountsByPuuid(
  accountsParquet: string | undefined,
  guildIds: string[],
  puuid: string,
): Promise<z.infer<typeof AccountRowSchema>[]> {
  if (accountsParquet === undefined || guildIds.length === 0) return [];
  return await runQuery(
    `WITH scoped AS (
       SELECT * FROM read_parquet(?) WHERE server_id IN (SELECT unnest(?))
     ),
     seed AS (SELECT player_id, discord_id FROM scoped WHERE puuid = ?)
     SELECT DISTINCT puuid, player_id, player_alias, discord_id
       FROM scoped
      WHERE player_id IN (SELECT player_id FROM seed)
         -- discord_id is the cross-server key; without this a person tracked
         -- in two servers keeps two player_ids and stays split here, even
         -- though the alias path unions them.
         OR (discord_id IS NOT NULL
             AND discord_id IN (SELECT discord_id FROM seed WHERE discord_id IS NOT NULL))`,
    [listParam([accountsParquet]), listParam(guildIds), scalarParam(puuid)],
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

function summarise(
  rows: z.infer<typeof IdentityRowSchema>[],
  matchedBy: ResolvedIdentity["matchedBy"],
  trackedAlias: string | undefined,
): ResolvedIdentity | undefined {
  if (rows.length === 0) return undefined;
  // Ordered by last_seen DESC, so the first row is the most recent Riot ID —
  // the right thing to show for an untracked account, and far better than the
  // arbitrary pick a plain aggregate would give.
  const mostRecent = rows[0];
  if (mostRecent === undefined) return undefined;
  return {
    displayName: trackedAlias ?? mostRecent.riot_id,
    puuids: [...new Set(rows.map((row) => row.puuid))],
    riotIds: [...new Set(rows.map((row) => row.riot_id))],
    games: rows.reduce((total, row) => total + row.games, 0),
    firstSeen:
      [...rows]
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

  const identities: ResolvedIdentity[] = [];

  // Tracked players first: an alias is an intentional label a server chose,
  // so it outranks an incidental Riot ID collision.
  const accounts = await lookupTrackedAccounts(
    files.accountsParquet,
    input.guildIds,
    needle,
  );
  // `player_id` is per-server, so the same human tracked in two servers gets
  // two of them. `discord_id` is the cross-server key when it is linked; fall
  // back to the per-server id when it is not, which keeps two genuinely
  // different people apart at the cost of possibly splitting one person.
  const groups = new Map<string, z.infer<typeof AccountRowSchema>[]>();
  for (const account of accounts) {
    const key = account.discord_id ?? `player:${account.player_id.toString()}`;
    groups.set(key, [...(groups.get(key) ?? []), account]);
  }
  for (const group of groups.values()) {
    const rows = await riotIdHistory(
      source,
      group.map((account) => account.puuid),
    );
    const identity = summarise(rows, "alias", group[0]?.player_alias);
    if (identity !== undefined) identities.push(identity);
  }

  const claimed = new Set(identities.flatMap((identity) => identity.puuids));
  const riotIdMatches = await lookupByRiotId(source, needle);
  const byRiotId = riotIdMatches.filter((puuid) => !claimed.has(puuid));
  for (const puuid of byRiotId) {
    // A Riot ID that belongs to a tracked account resolves to the whole
    // person, not that one account. "GexIsAngry" is one of Aaron's three
    // names across two accounts; answering for 160 of his 447 games would be
    // the same under-count by a different route.
    const owner = await lookupAccountsByPuuid(
      files.accountsParquet,
      input.guildIds,
      puuid,
    );
    const group = owner.length > 0 ? owner : undefined;
    const rows = await riotIdHistory(
      source,
      group === undefined ? [puuid] : group.map((account) => account.puuid),
    );
    const identity = summarise(
      rows,
      group === undefined ? "riot_id" : "alias",
      group?.[0]?.player_alias,
    );
    if (identity === undefined) continue;
    for (const claimedPuuid of identity.puuids) claimed.add(claimedPuuid);
    identities.push(identity);
  }

  return identities;
}

/**
 * The PUUIDs a `player('…')` reference resolves to, for the executor.
 *
 * Unresolvable names throw rather than returning an empty set: an empty
 * `puuid IN ()` silently answers "no games", which is indistinguishable from a
 * real zero and is exactly the kind of confidently-wrong answer this change
 * exists to stop.
 */
export async function resolvePlayerRefsToPuuids(input: {
  playerRefs: string[];
  guildIds: string[];
  /** False when the caller has no asker, e.g. a scheduled report. */
  aliasScopeAvailable?: boolean;
  lakeDir?: string | undefined;
}): Promise<string[]> {
  const puuids: string[] = [];
  for (const ref of input.playerRefs) {
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
    puuids.push(...(identities[0]?.puuids ?? []));
  }
  return [...new Set(puuids)];
}
