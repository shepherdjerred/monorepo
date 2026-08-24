import type { ExtendedPrismaClient } from "#src/database/index.ts";
import type { DiscordGuildId, Region } from "@scout-for-lol/data/index.ts";
import { TOURNAMENT_MAX_TEAM_SIZE } from "@scout-for-lol/data/index.ts";

/**
 * Turns the `/lobby create` alias lists into PUUIDs.
 *
 * Every participant must be a tracked Player in the calling guild with a
 * resolvable account. That is not gatekeeping — it is what guarantees the
 * post-match cursor picks the game up: the per-player match-history poll is the
 * only ingest path, so a lobby of untracked players would produce a code, a
 * game, and no report. And if nobody is tracked there is no subscribed channel
 * to deliver to anyway, so the constraint costs nothing and removes the failure
 * mode outright.
 */

export type ResolvedSide = {
  readonly aliases: string[];
  readonly puuids: string[];
  readonly region: Region;
};

export type RosterResolution =
  | {
      readonly ok: true;
      readonly blue: ResolvedSide;
      readonly red: ResolvedSide;
    }
  | { readonly ok: false; readonly reason: string };

export function parseAliasList(raw: string): string[] {
  return raw
    .split(",")
    .map((alias) => alias.trim())
    .filter((alias) => alias.length > 0);
}

type PlayerWithAccounts = {
  alias: string;
  // Account.region is branded as Region by brand-prisma-types, so it arrives
  // already narrowed — no conversion, and no assertion, is needed.
  accounts: { puuid: string; region: Region }[];
};

async function resolveSide(
  client: ExtendedPrismaClient,
  serverId: DiscordGuildId,
  aliases: string[],
): Promise<{ side: ResolvedSide } | { missing: string[] }> {
  const players: PlayerWithAccounts[] = await client.player.findMany({
    where: { serverId, alias: { in: aliases } },
    include: { accounts: true },
  });

  const byAlias = new Map(players.map((player) => [player.alias, player]));
  const missing: string[] = [];
  const puuids: string[] = [];
  let region: Region | undefined;

  for (const alias of aliases) {
    const account = byAlias.get(alias)?.accounts[0];
    if (account === undefined) {
      missing.push(alias);
      continue;
    }
    puuids.push(account.puuid);
    // A tournament code is minted for one region. Mixing regions in a lobby is
    // not a thing Riot supports, so the first account's region wins and a
    // mismatch is reported rather than silently dropped.
    region ??= account.region;
  }

  if (missing.length > 0) return { missing };
  if (region === undefined) return { missing: aliases };

  return { side: { aliases, puuids, region } };
}

export async function resolveLobbyRosters(
  client: ExtendedPrismaClient,
  serverId: DiscordGuildId,
  blueRaw: string,
  redRaw: string,
): Promise<RosterResolution> {
  const blueAliases = parseAliasList(blueRaw);
  const redAliases = parseAliasList(redRaw);

  if (blueAliases.length === 0 || redAliases.length === 0) {
    return { ok: false, reason: "Both sides need at least one player." };
  }
  if (
    blueAliases.length > TOURNAMENT_MAX_TEAM_SIZE ||
    redAliases.length > TOURNAMENT_MAX_TEAM_SIZE
  ) {
    return {
      ok: false,
      reason: `A side can hold at most ${TOURNAMENT_MAX_TEAM_SIZE.toString()} players.`,
    };
  }
  if (blueAliases.length !== redAliases.length) {
    // Uneven sides are a legitimate *outcome* — someone dodges — but not a
    // legitimate *intent*, and Riot mints a code for one team size.
    return {
      ok: false,
      reason: "Both sides must have the same number of players.",
    };
  }

  const duplicates = [...blueAliases, ...redAliases].filter(
    (alias, index, all) => all.indexOf(alias) !== index,
  );
  if (duplicates.length > 0) {
    return {
      ok: false,
      reason: `Listed twice: ${[...new Set(duplicates)].join(", ")}`,
    };
  }

  const blue = await resolveSide(client, serverId, blueAliases);
  const red = await resolveSide(client, serverId, redAliases);

  const missing = [
    ...("missing" in blue ? blue.missing : []),
    ...("missing" in red ? red.missing : []),
  ];
  if (missing.length > 0) {
    return {
      ok: false,
      reason:
        `Not tracked in this server (or has no linked account): ${missing.join(", ")}. ` +
        `Add them with /track first — Scout only reports on games it is following.`,
    };
  }
  if (!("side" in blue) || !("side" in red)) {
    return { ok: false, reason: "Could not resolve both sides." };
  }
  if (blue.side.region !== red.side.region) {
    return {
      ok: false,
      reason: "Everyone in a lobby must be on the same region.",
    };
  }

  return { ok: true, blue: blue.side, red: red.side };
}
