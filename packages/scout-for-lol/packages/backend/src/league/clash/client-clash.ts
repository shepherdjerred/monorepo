import { z } from "zod";
import {
  LcuClashBracketSchema,
  LcuClashRosterSchema,
  type DiscordGuildId,
  type LcuClashBracket,
  type LcuClashRoster,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { withRiotIdentities } from "#src/scout-client/identity-alias.ts";

/**
 * Clash as the Scout Client saw it: a roster's bracket and results, which
 * Riot's Clash-V1 API never publishes.
 *
 * Read straight from each player's latest client snapshot rather than
 * projected into the `ClashTeam`/`ClashRegistration` tables. Those belong to
 * the Riot `clash-snapshot` schedule, which replaces them wholesale on every
 * run, and client observations keep their own provenance.
 */

/** A Clash weekend, plus a day of slack: anything older is a past cup. */
const CLIENT_CLASH_FRESHNESS_MS = 3 * 24 * 60 * 60 * 1000;

export type ClientClashLabels = {
  readonly name: string;
  readonly abbreviation: string;
};

export type ClientClashMatch = {
  readonly round: number | null;
  /** Null for a bye, or a roster the bracket doesn't name. */
  readonly opponent: ClientClashLabels | null;
  readonly result: "won" | "lost" | "pending";
};

export type ClientClashTeam = {
  readonly rosterId: string;
  readonly tournamentId: string | null;
  readonly name: string;
  readonly abbreviation: string;
  readonly tier: number | null;
  readonly memberPuuids: readonly string[];
  readonly matches: readonly ClientClashMatch[];
  readonly capturedAt: Date;
};

const RosterPayloadSchema = z.object({
  resource: z.literal("clash_roster"),
  data: LcuClashRosterSchema,
});

const BracketPayloadSchema = z.object({
  resource: z.literal("clash_bracket"),
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
      // A bye has no second roster, and so no opponent to name.
      const opponentId = sides.find((side) => side !== rosterId);
      return [
        {
          round: match.roundId ?? null,
          opponent:
            opponentId === undefined ? null : (labels.get(opponentId) ?? null),
          result: matchResult(rosterId, match.winnerId),
        },
      ];
    })
    .toSorted((left, right) => (left.round ?? 0) - (right.round ?? 0));
}

function matchResult(
  rosterId: string,
  winnerId: string | undefined,
): ClientClashMatch["result"] {
  if (winnerId === undefined) return "pending";
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
}): ClientClashTeam | null {
  const { roster } = input;
  const labels = clashLabels(roster.name, roster.shortName);
  if (labels === null || roster.id === undefined) {
    return null;
  }
  return {
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

/** The opponent in the roster's undecided bracket match, if it has one. */
export function currentClientClashOpponent(
  team: ClientClashTeam,
): ClientClashLabels | null {
  return (
    team.matches.find((match) => match.result === "pending")?.opponent ?? null
  );
}

/**
 * The rosters these players' clients saw this Clash weekend, one per roster,
 * from whichever member's client saw it most recently.
 */
export async function readClientClashTeams(
  puuids: readonly string[],
  now: Date,
): Promise<ClientClashTeam[]> {
  if (puuids.length === 0) return [];
  const snapshots = await prisma.scoutClientPlayerSnapshot.findMany({
    where: {
      localPuuid: { in: [...puuids] },
      resource: { in: ["clash_roster", "clash_bracket"] },
      capturedAt: {
        gte: new Date(now.getTime() - CLIENT_CLASH_FRESHNESS_MS),
      },
    },
    include: { observation: { select: { payload: true } } },
  });
  const byPlayer = new Map<
    string,
    { roster?: LcuClashRoster; bracket?: LcuClashBracket; capturedAt?: Date }
  >();
  for (const snapshot of snapshots) {
    const entry = byPlayer.get(snapshot.localPuuid) ?? {};
    // Roster members name each other by League-client UUID.
    const payload = await withRiotIdentities(snapshot.observation.payload);
    const roster = RosterPayloadSchema.safeParse(payload);
    if (roster.success) {
      entry.roster = roster.data.data;
      entry.capturedAt = snapshot.capturedAt;
    }
    const bracket = BracketPayloadSchema.safeParse(payload);
    if (bracket.success) entry.bracket = bracket.data.data;
    byPlayer.set(snapshot.localPuuid, entry);
  }
  const teams = new Map<string, ClientClashTeam>();
  for (const { roster, bracket = null, capturedAt } of byPlayer.values()) {
    if (roster === undefined || capturedAt === undefined) continue;
    const team = projectClientClashTeam({ roster, bracket, capturedAt });
    if (team === null) continue;
    const seen = teams.get(team.rosterId);
    if (seen === undefined || seen.capturedAt < team.capturedAt) {
      teams.set(team.rosterId, team);
    }
  }
  return [...teams.values()];
}

export type ClientClashBracket = {
  readonly rosterId: string;
  readonly name: string;
  readonly abbreviation: string;
  readonly tier: number | null;
  /** The guild's tracked members, by alias; untracked teammates stay out. */
  readonly memberAliases: readonly string[];
  readonly matches: readonly ClientClashMatch[];
  readonly capturedAt: string;
};

/** The rosters and brackets this guild's tracked players' clients saw. */
export async function readClientClashBracketsForGuild(
  guildId: DiscordGuildId,
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
  );
  return teams.map((team) => ({
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
