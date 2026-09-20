import {
  LeaguePuuidSchema,
  PlatformRouteSchema,
  RegionSchema,
  regionToPlatformRoute,
  type LeaguePuuid,
  type PlatformRoute,
  type RawClashPlayer,
  type RawClashTeam,
  type Region,
} from "@scout-for-lol/data";
import { riotClient } from "#src/league/api/api.ts";
import { extractHttpStatus } from "#src/league/api/client/errors.ts";
import { prisma } from "#src/database/index.ts";
import { clashSnapshotShouldRun } from "#src/league/clash/access.ts";
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

export async function runClashSnapshot(): Promise<void> {
  if (!(await clashSnapshotShouldRun())) {
    logger.info("Clash snapshot skipped: no guild has clash_surface");
    return;
  }
  const accounts = uniqueAccounts(
    await prisma.account.findMany({
      select: { puuid: true, region: true },
    }),
  );
  const platforms = [...new Set(accounts.map((account) => account.platform))];
  const fetchedAt = new Date();
  const pollPlayersByPlatform = new Map<PlatformRoute, boolean>();

  for (const platform of platforms.toSorted((left, right) =>
    left.localeCompare(right),
  )) {
    const tournaments = await riotClient.clash.tournaments(platform);
    await replacePlatformTournaments({ platform, tournaments, fetchedAt });
    pollPlayersByPlatform.set(
      platform,
      tournaments.some((tournament) =>
        isClashPlayerPollWindow(tournament.schedule, fetchedAt.getTime()),
      ),
    );
  }

  const pending = await pollRegisteredPlayers(accounts, pollPlayersByPlatform);
  const teams = await refreshRegisteredTeams(pending, fetchedAt);
  await writePendingRegistrations(pending, teams, fetchedAt);
  await deleteOrphanClashTeams();
}

async function pollRegisteredPlayers(
  accounts: readonly TrackedAccount[],
  pollPlayersByPlatform: ReadonlyMap<PlatformRoute, boolean>,
): Promise<PendingClashPoll[]> {
  const pending: PendingClashPoll[] = [];
  for (const account of accounts) {
    if (pollPlayersByPlatform.get(account.platform) !== true) {
      continue;
    }
    const players = await riotClient.clash.playersByPuuid(
      account.puuid,
      account.platform,
    );
    pending.push({ account, players });
  }
  return pending;
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
  fetchedAt: Date,
): Promise<void> {
  for (const { account, players } of pending) {
    const registrations = [];
    for (const player of players) {
      const team = teams.get(`${account.platform}:${player.teamId}`);
      if (team === undefined) {
        continue;
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
