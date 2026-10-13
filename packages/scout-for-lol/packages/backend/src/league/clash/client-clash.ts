import { z } from "zod";
import {
  LcuClashBracketSchema,
  LcuClashRosterSchema,
  clashIsoWeekKey,
  type DiscordGuildId,
  type LcuClashBracket,
  type LcuClashRoster,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { withRiotIdentities } from "#src/scout-client/identity-alias.ts";
import { enrichClashTeamResults } from "./client-clash-results.ts";
import { MatchDataSourceSchema } from "@scout-for-lol/domain/match-processing/states.ts";
import type {
  ClientClashLabels,
  ClientClashOpponent,
  ClientClashMatch,
  ClientClashTeam,
  ClientClashBracket,
} from "./client-clash-types.ts";

/**
 * Clash as the Scout Client saw it: a roster's bracket and results, which
 * Riot's Clash-V1 API never publishes.
 *
 * Read from independently addressed client entities rather than
 * projected into the `ClashTeam`/`ClashRegistration` tables. Those belong to
 * the Riot `clash-snapshot` schedule, which replaces them wholesale on every
 * run, and client observations keep their own provenance.
 */

/** A Clash weekend, plus a day of slack: anything older is a past cup. */
const CLIENT_CLASH_FRESHNESS_MS = 3 * 24 * 60 * 60 * 1000;

const RosterPayloadSchema = z.object({
  resource: z.string().regex(/^clash_roster(?::[^:]+)?$/u),
  data: LcuClashRosterSchema,
});

const BracketPayloadSchema = z.object({
  resource: z.string().regex(/^clash_bracket(?::[^:]+)?$/u),
  data: LcuClashBracketSchema,
});

function bracketMatches(
  rosterId: string,
  bracket: LcuClashBracket | null,
): ClientClashMatch[] {
  if (bracket === null) return [];
  const labels = new Map(
    (bracket.rosters ?? []).flatMap((roster) => {
      const named = clashLabels(roster.name, roster.shortName);
      return named === null || roster.rosterId === undefined
        ? []
        : [[roster.rosterId, named] as const];
    }),
  );
  return (bracket.matches ?? [])
    .flatMap((match) => {
      const sides = [match.rosterId1, match.rosterId2];
      if (!sides.includes(rosterId)) return [];
      return [
        {
          round: match.roundId ?? null,
          opponent: opponentOf(
            sides.find((side) => side !== rosterId),
            labels,
            match.isBye === true,
          ),
          result: matchResult(rosterId, match.winnerId, sides),
          status: match.status ?? null,
          gameIds: [
            ...new Set([
              ...(match.gameIds ?? []),
              ...(match.gameId === undefined ? [] : [match.gameId]),
            ]),
          ],
        },
      ];
    })
    .toSorted((left, right) => (left.round ?? 0) - (right.round ?? 0));
}

/** A bye has no second roster; a second roster may still go unnamed. */
function opponentOf(
  opponentId: string | undefined,
  labels: ReadonlyMap<string, ClientClashLabels>,
  isBye: boolean,
): ClientClashOpponent {
  if (opponentId === undefined) return { kind: isBye ? "bye" : "unknown" };
  const named = labels.get(opponentId);
  return named === undefined ? { kind: "unknown" } : { kind: "team", ...named };
}

function matchResult(
  rosterId: string,
  winnerId: string | undefined,
  sides: readonly (string | undefined)[],
): ClientClashMatch["result"] {
  if (winnerId === undefined || !sides.includes(winnerId)) return "pending";
  return winnerId === rosterId ? "won" : "lost";
}

/** A name and short name, each standing in for the other when it's blank. */
function clashLabels(
  name: string | undefined,
  shortName: string | undefined,
): ClientClashLabels | null {
  const full = name?.trim() ?? "";
  const short = shortName?.trim() ?? "";
  if (full === "" && short === "") return null;
  return {
    name: full === "" ? short : full,
    abbreviation: short === "" ? full : short,
  };
}

/**
 * One roster and, when the client read it, the bracket it plays in. A roster
 * without an ID or any name can't be shown and projects to nothing.
 */
export function projectClientClashTeam(input: {
  readonly roster: LcuClashRoster;
  readonly bracket: LcuClashBracket | null;
  readonly capturedAt: Date;
  readonly platformId?: string | null;
}): ClientClashTeam | null {
  const { roster } = input;
  const labels = clashLabels(roster.name, roster.shortName);
  if (labels === null || roster.id === undefined) {
    return null;
  }
  return {
    platformId: input.platformId ?? null,
    rosterId: roster.id,
    tournamentId: roster.tournamentId ?? null,
    ...labels,
    tier: roster.tier ?? null,
    memberPuuids: (roster.members ?? []).flatMap((member) =>
      member.puuid === undefined ? [] : [member.puuid],
    ),
    matches: bracketMatches(roster.id, input.bracket),
    capturedAt: input.capturedAt,
  };
}

/** The named team in the roster's undecided bracket match, if there is one. */
export function currentClientClashOpponent(
  team: ClientClashTeam,
): ClientClashLabels | null {
  const opponent = team.matches.find(
    (match) => match.result === "pending",
  )?.opponent;
  return opponent?.kind === "team"
    ? { name: opponent.name, abbreviation: opponent.abbreviation }
    : null;
}

/**
 * The rosters these players' clients saw this Clash weekend, one per roster,
 * from whichever member's client saw it most recently.
 */
export async function readClientClashTeams(
  puuids: readonly string[],
  now: Date,
  includeHistory = false,
): Promise<ClientClashTeam[]> {
  if (puuids.length === 0) return [];
  const capturedAt = includeHistory
    ? {}
    : { gte: new Date(now.getTime() - CLIENT_CLASH_FRESHNESS_MS) };
  const entities = await prisma.scoutClientClashEntity.findMany({
    where: {
      observerPuuid: { in: [...puuids] },
      resource: { in: ["clash_roster", "clash_bracket"] },
      capturedAt,
    },
    include: { observation: { select: { payload: true } } },
    orderBy: [{ capturedAt: "desc" }, { observationId: "asc" }],
  });
  const legacy = await prisma.scoutClientPlayerSnapshot.findMany({
    where: {
      localPuuid: { in: [...puuids] },
      resource: { in: ["clash_roster", "clash_bracket"] },
      capturedAt,
    },
    include: { observation: { select: { payload: true, platformId: true } } },
    orderBy: [{ capturedAt: "desc" }, { observationId: "asc" }],
  });
  const snapshots: {
    platformId: string | null;
    capturedAt: Date;
    isPrimary: boolean;
    observation: { payload: unknown };
  }[] = [
    ...entities.map((entity) => ({
      ...entity,
      localPuuid: entity.observerPuuid,
    })),
    ...legacy.map((snapshot) => ({
      ...snapshot,
      platformId: snapshot.observation.platformId,
      isPrimary: snapshot.resource === "clash_roster",
    })),
  ];
  const { rosters, brackets } = await parseClashEvidence(snapshots);
  const teams = new Map<string, ClientClashTeam>();
  for (const entry of rosters) {
    if (
      !entry.primary &&
      !(
        entry.roster.members?.some(
          (member) =>
            member.puuid !== undefined && puuids.includes(member.puuid),
        ) ?? false
      )
    )
      continue;
    const enrichedBracket = joinClashBracket(entry, brackets, rosters);
    const team = projectClientClashTeam({
      roster: entry.roster,
      bracket: enrichedBracket,
      capturedAt: entry.capturedAt,
      platformId: entry.platform,
    });
    if (team === null) continue;
    const key = [
      entry.platform,
      team.tournamentId ??
        `observed:${clashIsoWeekKey(entry.capturedAt.toISOString().slice(0, 10))}`,
      team.rosterId,
    ].join(":");
    const seen = teams.get(key);
    if (seen === undefined || seen.capturedAt < team.capturedAt)
      teams.set(key, team);
  }
  const retained = [...teams.values()].sort(
    (left, right) => right.capturedAt.getTime() - left.capturedAt.getTime(),
  );
  return await readClashResults(retained, puuids);
}

async function readClashResults(
  retained: ClientClashTeam[],
  puuids: readonly string[],
): Promise<ClientClashTeam[]> {
  const games = retained.flatMap(({ platformId, matches }) =>
    platformId === null
      ? []
      : matches.flatMap((match) =>
          match.gameIds.map((gameId) => ({ platform: platformId, gameId })),
        ),
  );
  if (games.length === 0) return retained;
  const results = await prisma.clashGameSighting.findMany({
    where: { OR: games, source: "match", puuid: { in: [...puuids] } },
  });
  const evidence = results.map((row) => ({
    ...row,
    resultSource: MatchDataSourceSchema.parse(row.resultSource),
  }));
  return retained.map((team) => enrichClashTeamResults(team, evidence));
}

async function parseClashEvidence(
  snapshots: readonly ClashSnapshot[],
): Promise<{ rosters: RosterEvidence[]; brackets: BracketEvidence[] }> {
  const rosters: RosterEvidence[] = [];
  const brackets: BracketEvidence[] = [];
  for (const snapshot of snapshots) {
    const payload = await withRiotIdentities(snapshot.observation.payload);
    const roster = RosterPayloadSchema.safeParse(payload);
    if (roster.success)
      rosters.push({
        roster: roster.data.data,
        platform: snapshot.platformId,
        capturedAt: snapshot.capturedAt,
        primary: snapshot.isPrimary,
      });
    const bracket = BracketPayloadSchema.safeParse(payload);
    if (bracket.success)
      brackets.push({
        bracket: bracket.data.data,
        platform: snapshot.platformId,
        capturedAt: snapshot.capturedAt,
      });
  }
  return { rosters, brackets };
}

type ClashSnapshot = {
  platformId: string | null;
  capturedAt: Date;
  isPrimary: boolean;
  observation: { payload: unknown };
};
type RosterEvidence = {
  roster: LcuClashRoster;
  platform: string | null;
  capturedAt: Date;
  primary: boolean;
};
type BracketEvidence = {
  bracket: LcuClashBracket;
  platform: string | null;
  capturedAt: Date;
};

function bracketAgrees(
  entry: RosterEvidence,
  candidate: BracketEvidence,
): boolean {
  if (entry.platform !== candidate.platform) return false;
  const { roster } = entry;
  const { bracket } = candidate;
  if (roster.tournamentId !== undefined && bracket.tournamentId !== undefined) {
    if (roster.tournamentId !== bracket.tournamentId) return false;
  } else if (
    Math.abs(candidate.capturedAt.getTime() - entry.capturedAt.getTime()) >
    CLIENT_CLASH_FRESHNESS_MS
  )
    return false;
  return roster.bracketId === undefined
    ? (bracket.matches?.some(
        (match) =>
          match.rosterId1 === roster.id || match.rosterId2 === roster.id,
      ) ?? false)
    : roster.bracketId === bracket.id;
}

function joinClashBracket(
  entry: RosterEvidence,
  brackets: readonly BracketEvidence[],
  rosters: readonly RosterEvidence[],
): LcuClashBracket | null {
  const bracket = brackets
    .filter((candidate) => bracketAgrees(entry, candidate))
    .sort(
      (left, right) => right.capturedAt.getTime() - left.capturedAt.getTime(),
    )[0]?.bracket;
  if (bracket === undefined) return null;
  const namedRosters = rosters.filter(
    (candidate) =>
      candidate.platform === entry.platform &&
      candidate.roster.tournamentId === entry.roster.tournamentId &&
      (entry.roster.tournamentId !== undefined ||
        Math.abs(candidate.capturedAt.getTime() - entry.capturedAt.getTime()) <=
          CLIENT_CLASH_FRESHNESS_MS),
  );
  return {
    ...bracket,
    rosters: [
      ...namedRosters.flatMap(({ roster }) =>
        roster.id === undefined
          ? []
          : [
              {
                rosterId: roster.id,
                name: roster.name,
                shortName: roster.shortName,
              },
            ],
      ),
      ...(bracket.rosters ?? []),
    ],
  };
}

/** The rosters and brackets this guild's tracked players' clients saw. */
export async function readClientClashBracketsForGuild(
  guildId: DiscordGuildId,
  includeHistory = false,
): Promise<ClientClashBracket[]> {
  const accounts = await prisma.account.findMany({
    where: { serverId: guildId },
    select: { puuid: true, alias: true },
  });
  // Keyed by plain string: roster members carry unbranded PUUIDs.
  const aliasByPuuid = new Map<string, string>(
    accounts.map((account) => [account.puuid, account.alias]),
  );
  const teams = await readClientClashTeams(
    [...aliasByPuuid.keys()],
    new Date(),
    includeHistory,
  );
  return teams.map((team) => ({
    platformId: team.platformId,
    tournamentId: team.tournamentId,
    rosterId: team.rosterId,
    name: team.name,
    abbreviation: team.abbreviation,
    tier: team.tier,
    memberAliases: team.memberPuuids.flatMap((puuid) => {
      const alias = aliasByPuuid.get(puuid);
      return alias === undefined ? [] : [alias];
    }),
    matches: team.matches,
    capturedAt: team.capturedAt.toISOString(),
  }));
}
