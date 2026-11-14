import type { DiscordGuildId } from "@scout-for-lol/domain/identity/discord.ts";
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
  type RiotMatchId,
  type Region,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { isFeatureHardDisabled } from "#src/configuration/flags.ts";
import {
  canonicalClashGameIds,
  clashGameKey,
  clashMatchPageIds,
} from "#src/league/clash/identity.ts";
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
  outcome: "lobby" | "win" | "loss" | "unresolved";
  /** The game's match page; null for a lobby with no finished game. */
  matchId: RiotMatchId | null;
};

export type ClashHistoryPlayer = {
  puuid: LeaguePuuid;
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
  puuid: LeaguePuuid;
  source: string;
  resultSource?: string;
  queue: string;
  championId: number;
  observedAt: Date;
  win: boolean | null;
  teamRiotId: string | null;
  cupKey: string | null;
  cupDay: string | null;
};

export type ClashHistoryMembershipRecord = {
  puuid: LeaguePuuid;
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
  guildId: DiscordGuildId,
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
      where: {
        puuid: { in: puuids },
        ...(isFeatureHardDisabled("scout_client_ingestion")
          ? { resultSource: "RIOT" }
          : {}),
      },
      orderBy: [{ observedAt: "asc" }],
    }),
    prisma.clashMembershipHistory.findMany({
      where: { puuid: { in: puuids } },
    }),
  ]);
  if (sightings.length === 0) {
    return [];
  }
  const resolved = collapseClashAliasSightings(
    sightings,
    await canonicalClashGameIds(sightings),
  );
  return groupClashHistory({
    sightings: resolved,
    memberships,
    aliasByPuuid: new Map(
      accounts.map((account) => [account.puuid, account.alias]),
    ),
    matchPageIds: await clashMatchPageIds(
      resolved.filter((sighting) => sighting.source === "match"),
    ),
  });
}

function sightingRank(sighting: SightingRow): number {
  if (sighting.source !== "match") return 0;
  return sighting.resultSource === "RIOT" ? 2 : 1;
}

/**
 * One row per game and player: a row still under Riot's alias id (written
 * before the alias was known and not yet merged) joins its live game, and
 * the finished, Riot-sourced row wins over a client row or a lobby.
 */
export function collapseClashAliasSightings(
  sightings: readonly SightingRow[],
  canonicalByGame: ReadonlyMap<string, string>,
): SightingRow[] {
  const rows = new Map<string, SightingRow>();
  for (const sighting of sightings) {
    const gameId =
      canonicalByGame.get(clashGameKey(sighting)) ?? sighting.gameId;
    const row = { ...sighting, gameId };
    const key = `${clashGameKey(row)}:${row.puuid}`;
    const existing = rows.get(key);
    if (existing === undefined || sightingRank(row) > sightingRank(existing))
      rows.set(key, row);
  }
  return [...rows.values()].toSorted(
    (left, right) => left.observedAt.getTime() - right.observedAt.getTime(),
  );
}

export function groupClashHistory(input: {
  sightings: readonly SightingRow[];
  memberships: readonly MembershipRow[];
  aliasByPuuid: ReadonlyMap<string, string>;
  matchPageIds?: ReadonlyMap<string, RiotMatchId>;
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
      matchId:
        sighting.source === "match"
          ? (input.matchPageIds?.get(clashGameKey(sighting)) ?? null)
          : null,
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
  puuid: LeaguePuuid,
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
  if (sighting.source !== "match") {
    return "lobby";
  }
  if (sighting.win === null) return "unresolved";
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
