import {
  LeaguePuuidSchema,
  PlatformRouteSchema,
  RegionSchema,
  regionToPlatformRoute,
  type LeaguePuuid,
  type PlatformRoute,
  type RawClashPlayer,
  type RawClashTeam,
  type RawClashTournament,
  type Region,
} from "@scout-for-lol/data";
import { riotClient } from "#src/league/api/api.ts";
import { extractHttpStatus } from "#src/league/api/client/errors.ts";
import { prisma } from "#src/database/index.ts";
import { clashSnapshotEnabledGuildIds } from "#src/league/clash/access.ts";
import { archiveClashMembership } from "#src/league/clash/history.ts";
import { backfillClashSightingsFromLake } from "#src/league/clash/backfill.ts";
import {
  deleteOrphanClashTeams,
  replacePlatformTournaments,
  replaceRegistrationsForAccount,
  upsertClashTeam,
} from "#src/league/clash/store.ts";
import { isClashPlayerPollWindow } from "#src/league/clash/theme.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("clash-snapshot");

type TrackedAccount = {
  puuid: LeaguePuuid;
  region: Region;
  platform: PlatformRoute;
};

type PendingClashPoll = {
  account: TrackedAccount;
  players: RawClashPlayer[];
};

export function platformsAbsentFromEnabledAccounts(
  stored: readonly PlatformRoute[],
  enabled: readonly PlatformRoute[],
): PlatformRoute[] {
  const live = new Set(enabled);
  return [...new Set(stored)].filter((platform) => !live.has(platform));
}

export function splitClashPollAccounts(
  accounts: readonly TrackedAccount[],
  pollPlayersByPlatform: ReadonlyMap<PlatformRoute, boolean>,
): { poll: TrackedAccount[]; clear: TrackedAccount[] } {
  const poll: TrackedAccount[] = [];
  const clear: TrackedAccount[] = [];
  for (const account of accounts) {
    if (pollPlayersByPlatform.get(account.platform) === true) {
      poll.push(account);
    } else {
      clear.push(account);
    }
  }
  return { poll, clear };
}

export async function runClashSnapshot(): Promise<void> {
  const enabledGuildIds = await clashSnapshotEnabledGuildIds();
  if (enabledGuildIds.length === 0) {
    logger.info("Clash snapshot skipped: no guild has clash_surface");
    return;
  }
  const accounts = uniqueAccounts(
    await prisma.account.findMany({
      where: { serverId: { in: enabledGuildIds } },
      select: { puuid: true, region: true },
    }),
  );
  const platforms = [...new Set(accounts.map((account) => account.platform))];
  const fetchedAt = new Date();
  const storedRows = await prisma.clashTournament.findMany({
    distinct: ["platform"],
    select: { platform: true },
  });
  const storedPlatforms = storedRows.map((row) =>
    PlatformRouteSchema.parse(row.platform),
  );
  for (const platform of platformsAbsentFromEnabledAccounts(
    storedPlatforms,
    platforms,
  )) {
    await replacePlatformTournaments({
      platform,
      tournaments: [],
      fetchedAt,
    });
  }
  const pollPlayersByPlatform = new Map<PlatformRoute, boolean>();
  const tournamentsByKey = new Map<string, RawClashTournament>();

  for (const platform of platforms.toSorted((left, right) =>
    left.localeCompare(right),
  )) {
    const tournaments = await riotClient.clash.tournaments(platform);
    await replacePlatformTournaments({ platform, tournaments, fetchedAt });
    for (const tournament of tournaments) {
      tournamentsByKey.set(`${platform}:${String(tournament.id)}`, tournament);
    }
    pollPlayersByPlatform.set(
      platform,
      tournaments.some((tournament) =>
        isClashPlayerPollWindow(tournament.schedule, fetchedAt.getTime()),
      ),
    );
  }

  const { poll: accountsToPoll, clear: accountsToClear } =
    splitClashPollAccounts(accounts, pollPlayersByPlatform);
  const pending = await pollRegisteredPlayers(accountsToPoll);
  const teams = await refreshRegisteredTeams(pending, fetchedAt);
  await writePendingRegistrations(pending, teams, tournamentsByKey, fetchedAt);
  await clearInactiveRegistrations(accountsToClear, fetchedAt);
  await deleteOrphanClashTeams();
  await backfillClashSightingsFromLake();
}

async function pollRegisteredPlayers(
  accounts: readonly TrackedAccount[],
): Promise<PendingClashPoll[]> {
  const pending: PendingClashPoll[] = [];
  for (const account of accounts) {
    const players = await riotClient.clash.playersByPuuid(
      account.puuid,
      account.platform,
    );
    pending.push({ account, players });
  }
  return pending;
}

async function clearInactiveRegistrations(
  accounts: readonly TrackedAccount[],
  fetchedAt: Date,
): Promise<void> {
  for (const account of accounts) {
    await replaceRegistrationsForAccount({
      puuid: account.puuid,
      region: account.region,
      platform: account.platform,
      registrations: [],
      fetchedAt,
    });
  }
}

async function refreshRegisteredTeams(
  pending: readonly PendingClashPoll[],
  fetchedAt: Date,
): Promise<Map<string, RawClashTeam>> {
  const teamKeys = new Map<
    string,
    { platform: PlatformRoute; teamId: string }
  >();
  for (const { account, players } of pending) {
    for (const player of players) {
      if (player.teamId === undefined) {
        continue;
      }
      teamKeys.set(`${account.platform}:${player.teamId}`, {
        platform: account.platform,
        teamId: player.teamId,
      });
    }
  }
  const teams = new Map<string, RawClashTeam>();
  for (const { platform, teamId } of teamKeys.values()) {
    const team = await fetchClashTeam(platform, teamId);
    if (team === undefined) {
      continue;
    }
    await upsertClashTeam({ platform, team, fetchedAt });
    teams.set(`${platform}:${team.id}`, team);
  }
  return teams;
}

async function writePendingRegistrations(
  pending: readonly PendingClashPoll[],
  teams: ReadonlyMap<string, RawClashTeam>,
  tournamentsByKey: ReadonlyMap<string, RawClashTournament>,
  fetchedAt: Date,
): Promise<void> {
  for (const { account, players } of pending) {
    const registrations = [];
    for (const player of players) {
      if (player.teamId === undefined) {
        continue;
      }
      const team = teams.get(`${account.platform}:${player.teamId}`);
      if (team === undefined) {
        continue;
      }
      const tournament = tournamentsByKey.get(
        `${account.platform}:${String(team.tournamentId)}`,
      );
      if (tournament !== undefined) {
        await archiveClashMembership({
          puuid: account.puuid,
          region: account.region,
          platform: account.platform,
          team,
          tournament,
          position: player.position,
          role: player.role,
          seenAt: fetchedAt,
        });
      }
      registrations.push({
        teamId: player.teamId,
        tournamentId: team.tournamentId,
        position: player.position,
        role: player.role,
      });
    }
    await replaceRegistrationsForAccount({
      puuid: account.puuid,
      region: account.region,
      platform: account.platform,
      registrations,
      fetchedAt,
    });
  }
}

async function fetchClashTeam(
  platform: PlatformRoute,
  teamId: string,
): Promise<RawClashTeam | undefined> {
  try {
    return await riotClient.clash.teamById(teamId, platform);
  } catch (error) {
    if (extractHttpStatus(error) === 404) {
      logger.info(`Clash team ${teamId} on ${platform} was 404`);
      return undefined;
    }
    throw error;
  }
}

function uniqueAccounts(
  accounts: readonly { puuid: string; region: string }[],
): TrackedAccount[] {
  const seen = new Set<string>();
  const unique: TrackedAccount[] = [];
  for (const account of accounts) {
    const key = `${account.region}:${account.puuid}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const region = RegionSchema.parse(account.region);
    unique.push({
      puuid: LeaguePuuidSchema.parse(account.puuid),
      region,
      platform: PlatformRouteSchema.parse(regionToPlatformRoute(region)),
    });
  }
  return unique;
}
