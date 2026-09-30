import {
  ClashPositionSchema,
  ClashRoleSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  PlatformRouteSchema,
  clashCalendarDateForPlatform,
  clashIsoWeekKey,
  getChampionDisplayName,
  type LeaguePuuid,
  type PlatformRoute,
  type RawClashTeam,
  type RawClashTournament,
  type Region,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import {
  clashScheduleSightingWindow,
  formatClashThemeLabel,
} from "#src/league/clash/theme.ts";

export async function archiveClashMembership(input: {
  puuid: LeaguePuuid;
  region: Region;
  platform: PlatformRoute;
  team: RawClashTeam;
  tournament: RawClashTournament;
  position: string;
  role: string;
  seenAt: Date;
}): Promise<void> {
  const window = clashScheduleSightingWindow(input.tournament.schedule);
  if (window === undefined) {
    return;
  }
  const puuid = LeaguePuuidSchema.parse(input.puuid);
  const position = ClashPositionSchema.parse(input.position);
  const role = ClashRoleSchema.parse(input.role);
  await prisma.clashMembershipHistory.upsert({
    where: {
      puuid_platform_tournamentRiotId: {
        puuid,
        platform: input.platform,
        tournamentRiotId: input.tournament.id,
      },
    },
    create: {
      puuid,
      region: input.region,
      platform: input.platform,
      tournamentRiotId: input.tournament.id,
      teamRiotId: input.team.id,
      teamName: input.team.name,
      teamAbbreviation: input.team.abbreviation,
      position,
      role,
      nameKey: input.tournament.nameKey,
      nameKeySecondary: input.tournament.nameKeySecondary,
      windowStartAt: new Date(window.startMs),
      windowEndAt: new Date(window.endMs),
      firstSeenAt: input.seenAt,
      lastSeenAt: input.seenAt,
    },
    update: {
      teamRiotId: input.team.id,
      teamName: input.team.name,
      teamAbbreviation: input.team.abbreviation,
      position,
      role,
      nameKey: input.tournament.nameKey,
      nameKeySecondary: input.tournament.nameKeySecondary,
      windowStartAt: new Date(window.startMs),
      windowEndAt: new Date(window.endMs),
      lastSeenAt: input.seenAt,
    },
  });
}

export type ClashHistorySighting = {
  platform: string;
  gameId: string;
  observedAt: string;
  championId: number;
  championName: string;
  queue: string;
  matchIndex: number;
  outcome: "lobby" | "win" | "loss";
};

export type ClashHistoryPlayer = {
  puuid: string;
  playerAlias: string;
  teamName: string | undefined;
  teamAbbreviation: string | undefined;
  sightings: ClashHistorySighting[];
};

export type ClashHistoryCup = {
  id: string;
  cupKey: string | undefined;
  cupDay: string | undefined;
  themeLabel: string;
  queue: string;
  players: ClashHistoryPlayer[];
};

export type ClashHistorySightingRecord = {
  platform: string;
  gameId: string;
  puuid: string;
  source: string;
  queue: string;
  championId: number;
  observedAt: Date;
  win: boolean | null;
  teamRiotId: string | null;
  cupKey: string | null;
  cupDay: string | null;
};

export type ClashHistoryMembershipRecord = {
  puuid: string;
  platform: string;
  teamRiotId: string;
  teamName: string;
  teamAbbreviation: string;
  windowStartAt: Date;
  windowEndAt: Date;
};

type MembershipRow = ClashHistoryMembershipRecord;
type SightingRow = ClashHistorySightingRecord;

export async function readClashHistoryForGuild(
  guildId: string,
): Promise<ClashHistoryCup[]> {
  const accounts = await prisma.account.findMany({
    where: { serverId: DiscordGuildIdSchema.parse(guildId) },
    select: { puuid: true, alias: true },
  });
  if (accounts.length === 0) {
    return [];
  }
  const puuids = accounts.map((account) => account.puuid);
  const [sightings, memberships] = await Promise.all([
    prisma.clashGameSighting.findMany({
      where: { puuid: { in: puuids } },
      orderBy: [{ observedAt: "asc" }],
    }),
    prisma.clashMembershipHistory.findMany({
      where: { puuid: { in: puuids } },
    }),
  ]);
  if (sightings.length === 0) {
    return [];
  }
  return groupClashHistory({
    sightings,
    memberships,
    aliasByPuuid: new Map(
      accounts.map((account) => [account.puuid, account.alias]),
    ),
  });
}

export function groupClashHistory(input: {
  sightings: readonly SightingRow[];
  memberships: readonly MembershipRow[];
  aliasByPuuid: ReadonlyMap<string, string>;
}): ClashHistoryCup[] {
  const cups = new Map<string, ClashHistoryCup>();
  const matchIndexByPlayerCup = new Map<string, number>();
  for (const sighting of input.sightings) {
    const alias = input.aliasByPuuid.get(sighting.puuid);
    if (alias === undefined) {
      continue;
    }
    const groupKey = clashHistoryGroupKey(sighting);
    const cup = cupForSighting(cups, sighting, groupKey);
    const player = playerOnCup(cup, sighting.puuid, alias);
    const membership = membershipForSighting(input.memberships, sighting);
    applyMembershipLabels(player, membership);
    const playerCupKey = `${groupKey}:${sighting.puuid}`;
    const nextIndex = (matchIndexByPlayerCup.get(playerCupKey) ?? 0) + 1;
    matchIndexByPlayerCup.set(playerCupKey, nextIndex);
    player.sightings.push({
      platform: sighting.platform,
      gameId: sighting.gameId,
      observedAt: sighting.observedAt.toISOString(),
      championId: sighting.championId,
      championName: getChampionDisplayName(sighting.championId),
      queue: sighting.queue,
      matchIndex: nextIndex,
      outcome: sightingOutcome(sighting),
    });
  }
  return [...cups.values()].toSorted((left, right) =>
    cupSortKey(right).localeCompare(cupSortKey(left)),
  );
}

function clashHistoryGroupKey(sighting: SightingRow): string {
  const platform = PlatformRouteSchema.parse(sighting.platform);
  const week = clashIsoWeekKey(
    clashCalendarDateForPlatform(sighting.observedAt, platform),
  );
  return `${week}:${sighting.cupKey ?? ""}:${sighting.cupDay ?? ""}:${sighting.queue}`;
}

function cupForSighting(
  cups: Map<string, ClashHistoryCup>,
  sighting: SightingRow,
  groupKey: string,
): ClashHistoryCup {
  const existing = cups.get(groupKey);
  if (existing !== undefined) {
    return existing;
  }
  const created: ClashHistoryCup = {
    id: groupKey,
    cupKey: sighting.cupKey ?? undefined,
    cupDay: sighting.cupDay ?? undefined,
    themeLabel: clashHistoryThemeLabel(sighting.cupKey, sighting.cupDay),
    queue: sighting.queue,
    players: [],
  };
  cups.set(groupKey, created);
  return created;
}

function playerOnCup(
  cup: ClashHistoryCup,
  puuid: string,
  playerAlias: string,
): ClashHistoryPlayer {
  const existing = cup.players.find((player) => player.puuid === puuid);
  if (existing !== undefined) {
    return existing;
  }
  const created: ClashHistoryPlayer = {
    puuid,
    playerAlias,
    teamName: undefined,
    teamAbbreviation: undefined,
    sightings: [],
  };
  cup.players.push(created);
  return created;
}

function applyMembershipLabels(
  player: ClashHistoryPlayer,
  membership: MembershipRow | undefined,
): void {
  if (membership === undefined || player.teamName !== undefined) {
    return;
  }
  player.teamName = membership.teamName.trim() || undefined;
  player.teamAbbreviation = membership.teamAbbreviation.trim() || undefined;
}

function membershipForSighting(
  memberships: readonly MembershipRow[],
  sighting: SightingRow,
): MembershipRow | undefined {
  return memberships.find((membership) => {
    return (
      membership.puuid === sighting.puuid &&
      membership.platform === sighting.platform &&
      (sighting.teamRiotId === null ||
        membership.teamRiotId === sighting.teamRiotId) &&
      sighting.observedAt >= membership.windowStartAt &&
      sighting.observedAt <= membership.windowEndAt
    );
  });
}

function sightingOutcome(
  sighting: Pick<SightingRow, "source" | "win">,
): ClashHistorySighting["outcome"] {
  if (sighting.source !== "match" || sighting.win === null) {
    return "lobby";
  }
  return sighting.win ? "win" : "loss";
}

function clashHistoryThemeLabel(
  cupKey: string | null,
  cupDay: string | null,
): string {
  if (cupKey === null || cupKey.length === 0) {
    return "Clash";
  }
  return cupDay === null || cupDay.length === 0
    ? formatClashThemeLabel(cupKey, "weekend")
    : formatClashThemeLabel(cupKey, cupDay);
}

function cupSortKey(cup: ClashHistoryCup): string {
  const latest = cup.players
    .flatMap((player) => player.sightings)
    .map((sighting) => sighting.observedAt)
    .toSorted()
    .at(-1);
  return latest ?? "";
}
