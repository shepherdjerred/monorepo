import type { z } from "zod";
import type { DiscordGuildId } from "@scout-for-lol/data";
import {
  AccountRowSchema,
  groupAccountsByPerson,
  runQuery,
} from "#src/reports/identity.ts";
import { listParam, type SqlFragment } from "#src/reports/duckdb/lake.ts";

/**
 * The tracked people of several servers at once, one row per Riot account.
 *
 * A server's accounts dimension is one row per `(server, account)`, so a
 * player tracked by two of the chosen servers would join every match fact
 * twice and double each aggregate. Each server also keeps its own player row,
 * so the same person would split into two. Both are resolved here, before
 * anything is joined: accounts are merged into people with the same rule
 * `player('…')` resolution uses — a shared puuid, a shared Discord id, or the
 * same player in one server — and each puuid appears exactly once.
 *
 * The merge runs in code rather than SQL because it is transitive: a person
 * linked to a second through one account and to a third through another is
 * one person, which no per-row SQL rule can see.
 */
export type ServerPerson = {
  readonly puuid: string;
  /** The smallest tracked player id in the merged person; stable and numeric. */
  readonly playerId: number;
  /** That player's alias, so a person's label never depends on row order. */
  readonly playerAlias: string;
  readonly discordId: string | null;
};

function representative(
  accounts: readonly z.infer<typeof AccountRowSchema>[],
): z.infer<typeof AccountRowSchema> {
  const [first, ...rest] = accounts;
  if (first === undefined) {
    throw new Error("A merged person has no accounts.");
  }
  return rest.reduce(
    (lowest, account) =>
      account.player_id < lowest.player_id ? account : lowest,
    first,
  );
}

export function mergeServerPeople(
  accounts: readonly z.infer<typeof AccountRowSchema>[],
): ServerPerson[] {
  return groupAccountsByPerson([...accounts]).flatMap((person) => {
    const lead = representative(person);
    const discordId =
      person.find((account) => account.discord_id !== null)?.discord_id ?? null;
    const puuids = [...new Set(person.map((account) => account.puuid))];
    return puuids.map((puuid) => ({
      puuid,
      playerId: lead.player_id,
      playerAlias: lead.player_alias,
      discordId,
    }));
  });
}

export async function loadServerPeople(
  accountsParquet: string | undefined,
  serverIds: readonly DiscordGuildId[],
): Promise<ServerPerson[]> {
  if (accountsParquet === undefined || serverIds.length === 0) return [];
  const accounts = await runQuery(
    "SELECT DISTINCT server_id, puuid, player_id, player_alias, discord_id FROM read_parquet(?) WHERE server_id IN (SELECT unnest(?))",
    [listParam([accountsParquet]), listParam([...serverIds])],
    AccountRowSchema,
  );
  return mergeServerPeople(accounts);
}

/**
 * The people as an accounts-shaped relation, bound rather than read, so the
 * facts CTE joins it exactly as it joins one server's accounts. A missing
 * Discord id travels as '' because a bound list holds no NULLs.
 */
export function buildServerPeopleSource(
  people: readonly ServerPerson[],
): SqlFragment {
  return {
    sql: "SELECT unnest(?) AS puuid, unnest(?) AS player_id, unnest(?) AS player_alias, nullif(unnest(?), '') AS discord_id",
    params: [
      listParam(people.map((person) => person.puuid)),
      listParam(people.map((person) => person.playerId)),
      listParam(people.map((person) => person.playerAlias)),
      listParam(people.map((person) => person.discordId ?? "")),
    ],
  };
}
