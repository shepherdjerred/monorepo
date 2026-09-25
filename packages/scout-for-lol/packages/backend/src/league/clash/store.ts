import {
  ClashPositionSchema,
  ClashRoleSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  RawClashTournamentPhaseSchema,
  RegionSchema,
  type LeaguePuuid,
  type PlatformRoute,
  type RawClashTeam,
  type RawClashTournament,
  type RawClashTournamentPhase,
  type Region,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { formatClashThemeLabel } from "#src/league/clash/theme.ts";

export async function replacePlatformTournaments(input: {
  platform: PlatformRoute;
  tournaments: readonly RawClashTournament[];
  fetchedAt: Date;
}): Promise<void> {
  const keepIds = input.tournaments.map((tournament) => tournament.id);
  await prisma.$transaction(async (tx) => {
    if (keepIds.length === 0) {
      await tx.clashTournament.deleteMany({
        where: { platform: input.platform },
      });
      return;
    }
    await tx.clashTournament.deleteMany({
      where: {
        platform: input.platform,
        riotId: { notIn: keepIds },
      },
    });
    for (const tournament of input.tournaments) {
      await tx.clashTournament.upsert({
        where: {
          platform_riotId: {
            platform: input.platform,
            riotId: tournament.id,
          },
        },
        create: {
          platform: input.platform,
          riotId: tournament.id,
          themeId: tournament.themeId,
          nameKey: tournament.nameKey,
          nameKeySecondary: tournament.nameKeySecondary,
          scheduleJson: JSON.stringify(tournament.schedule),
          fetchedAt: input.fetchedAt,
        },
        update: {
          themeId: tournament.themeId,
          nameKey: tournament.nameKey,
          nameKeySecondary: tournament.nameKeySecondary,
          scheduleJson: JSON.stringify(tournament.schedule),
          fetchedAt: input.fetchedAt,
        },
      });
    }
  });
}

export async function upsertClashTeam(input: {
  platform: PlatformRoute;
  team: RawClashTeam;
  fetchedAt: Date;
}): Promise<void> {
  await prisma.clashTeam.upsert({
    where: {
      platform_riotId: {
        platform: input.platform,
        riotId: input.team.id,
      },
    },
    create: {
      platform: input.platform,
      riotId: input.team.id,
      tournamentRiotId: input.team.tournamentId,
      name: input.team.name,
      abbreviation: input.team.abbreviation,
      iconId: input.team.iconId,
      tier: input.team.tier,
      fetchedAt: input.fetchedAt,
    },
    update: {
      tournamentRiotId: input.team.tournamentId,
      name: input.team.name,
      abbreviation: input.team.abbreviation,
      iconId: input.team.iconId,
      tier: input.team.tier,
      fetchedAt: input.fetchedAt,
    },
  });
}

export async function replaceRegistrationsForAccount(input: {
  puuid: LeaguePuuid;
  region: Region;
  platform: PlatformRoute;
  registrations: readonly {
    teamId: string;
    tournamentId: number;
    position: string;
    role: string;
  }[];
  fetchedAt: Date;
}): Promise<void> {
  const puuid = LeaguePuuidSchema.parse(input.puuid);
  const region = RegionSchema.parse(input.region);
  const keepTournamentIds = input.registrations.map(
    (registration) => registration.tournamentId,
  );
  await prisma.$transaction(async (tx) => {
    if (keepTournamentIds.length === 0) {
      await tx.clashRegistration.deleteMany({
        where: { puuid, region },
      });
      return;
    }
    await tx.clashRegistration.deleteMany({
      where: {
        puuid,
        region,
        tournamentRiotId: { notIn: keepTournamentIds },
      },
    });
    for (const registration of input.registrations) {
      await tx.clashRegistration.upsert({
        where: {
          puuid_region_tournamentRiotId: {
            puuid,
            region,
            tournamentRiotId: registration.tournamentId,
          },
        },
        create: {
          puuid,
          region,
          platform: input.platform,
          teamRiotId: registration.teamId,
          tournamentRiotId: registration.tournamentId,
          position: registration.position,
          role: registration.role,
          fetchedAt: input.fetchedAt,
        },
        update: {
          platform: input.platform,
          teamRiotId: registration.teamId,
          position: registration.position,
          role: registration.role,
          fetchedAt: input.fetchedAt,
        },
      });
    }
  });
}

export async function deleteOrphanClashTeams(): Promise<void> {
  const registered = await prisma.clashRegistration.findMany({
    distinct: ["platform", "teamRiotId"],
    select: { platform: true, teamRiotId: true },
  });
  if (registered.length === 0) {
    await prisma.clashTeam.deleteMany();
    return;
  }
  await prisma.clashTeam.deleteMany({
    where: {
      NOT: {
        OR: registered.map((row) => ({
          platform: row.platform,
          riotId: row.teamRiotId,
        })),
      },
    },
  });
}

function parseSchedule(scheduleJson: string): RawClashTournamentPhase[] {
  return RawClashTournamentPhaseSchema.array().parse(JSON.parse(scheduleJson));
}

export type ClashSchedulePhase = {
  id: number;
  registrationTime: number;
  startTime: number;
  cancelled: boolean;
};

export type ClashScheduleTournament = {
  platform: string;
  riotId: number;
  themeLabel: string;
  phases: ClashSchedulePhase[];
};

export async function readClashSchedule(): Promise<ClashScheduleTournament[]> {
  const rows = await prisma.clashTournament.findMany({
    orderBy: [{ platform: "asc" }, { riotId: "asc" }],
  });
  return rows.map((row) => ({
    platform: row.platform,
    riotId: row.riotId,
    themeLabel: formatClashThemeLabel(row.nameKey, row.nameKeySecondary),
    phases: parseSchedule(row.scheduleJson),
  }));
}

export type ClashRosterMember = {
  puuid: string;
  playerAlias: string;
  riotGameName: string | null;
  riotTagLine: string | null;
  position: string;
  role: string;
};

export type ClashRosterTeam = {
  platform: string;
  teamRiotId: string;
  tournamentRiotId: number;
  themeLabel: string;
  name: string;
  abbreviation: string;
  tier: number;
  members: ClashRosterMember[];
};

export async function readClashRosterForGuild(
  guildId: string,
): Promise<ClashRosterTeam[]> {
  const accounts = await prisma.account.findMany({
    where: { serverId: DiscordGuildIdSchema.parse(guildId) },
    select: {
      puuid: true,
      riotGameName: true,
      riotTagLine: true,
      alias: true,
    },
  });
  if (accounts.length === 0) {
    return [];
  }
  const puuids = accounts.map((account) => account.puuid);
  const registrations = await prisma.clashRegistration.findMany({
    where: { puuid: { in: puuids } },
    orderBy: [{ platform: "asc" }, { teamRiotId: "asc" }],
  });
  if (registrations.length === 0) {
    return [];
  }
  const { teamByKey, tournamentByKey } =
    await loadClashTeamAndTournamentMaps(registrations);
  const accountByPuuid = new Map(
    accounts.map((account) => [account.puuid, account]),
  );
  const grouped = groupRosterTeams({
    registrations,
    teamByKey,
    tournamentByKey,
    accountByPuuid,
  });
  return [...grouped.values()];
}

function groupRosterTeams(input: {
  registrations: Awaited<ReturnType<typeof prisma.clashRegistration.findMany>>;
  teamByKey: Map<
    string,
    Awaited<ReturnType<typeof prisma.clashTeam.findMany>>[number]
  >;
  tournamentByKey: Map<
    string,
    Awaited<ReturnType<typeof prisma.clashTournament.findMany>>[number]
  >;
  accountByPuuid: Map<
    string,
    {
      puuid: string;
      alias: string;
      riotGameName: string | null;
      riotTagLine: string | null;
    }
  >;
}): Map<string, ClashRosterTeam> {
  const grouped = new Map<string, ClashRosterTeam>();
  for (const registration of input.registrations) {
    const account = input.accountByPuuid.get(registration.puuid);
    if (account === undefined) {
      continue;
    }
    const key = `${registration.platform}:${registration.teamRiotId}`;
    const team = input.teamByKey.get(key);
    if (team === undefined) {
      continue;
    }
    const labels = clashTeamLabels(team);
    if (labels === undefined) {
      continue;
    }
    const tournament = input.tournamentByKey.get(
      `${registration.platform}:${String(registration.tournamentRiotId)}`,
    );
    const existing = grouped.get(key);
    const member: ClashRosterMember = {
      puuid: registration.puuid,
      playerAlias: account.alias,
      riotGameName: account.riotGameName,
      riotTagLine: account.riotTagLine,
      position: ClashPositionSchema.parse(registration.position),
      role: ClashRoleSchema.parse(registration.role),
    };
    if (existing !== undefined) {
      existing.members.push(member);
      continue;
    }
    grouped.set(key, {
      platform: registration.platform,
      teamRiotId: registration.teamRiotId,
      tournamentRiotId: registration.tournamentRiotId,
      themeLabel: clashThemeLabel(tournament),
      name: labels.name,
      abbreviation: labels.abbreviation,
      tier: team.tier,
      members: [member],
    });
  }
  return grouped;
}

export async function loadClashTeamAndTournamentMaps(
  registrations: readonly {
    platform: string;
    teamRiotId: string;
    tournamentRiotId: number;
  }[],
): Promise<{
  teamByKey: Map<
    string,
    Awaited<ReturnType<typeof prisma.clashTeam.findMany>>[number]
  >;
  tournamentByKey: Map<
    string,
    Awaited<ReturnType<typeof prisma.clashTournament.findMany>>[number]
  >;
}> {
  const teams = await prisma.clashTeam.findMany({
    where: {
      OR: registrations.map((registration) => ({
        platform: registration.platform,
        riotId: registration.teamRiotId,
      })),
    },
  });
  const tournaments = await prisma.clashTournament.findMany({
    where: {
      OR: registrations.map((registration) => ({
        platform: registration.platform,
        riotId: registration.tournamentRiotId,
      })),
    },
  });
  return {
    teamByKey: new Map(
      teams.map((team) => [`${team.platform}:${team.riotId}`, team]),
    ),
    tournamentByKey: new Map(
      tournaments.map((tournament) => [
        `${tournament.platform}:${String(tournament.riotId)}`,
        tournament,
      ]),
    ),
  };
}

export function clashTeamLabels(team: {
  name: string;
  abbreviation: string;
}): { name: string; abbreviation: string } | undefined {
  const name = team.name.trim();
  const abbreviation = team.abbreviation.trim();
  if (name.length === 0 && abbreviation.length === 0) {
    return undefined;
  }
  return {
    name: name.length > 0 ? name : abbreviation,
    abbreviation: abbreviation.length > 0 ? abbreviation : name,
  };
}

function clashThemeLabel(
  tournament:
    | Awaited<ReturnType<typeof prisma.clashTournament.findMany>>[number]
    | undefined,
): string {
  return tournament === undefined
    ? "Clash"
    : formatClashThemeLabel(tournament.nameKey, tournament.nameKeySecondary);
}
