import {
  LoadingScreenDataSchema,
  LeaguePuuidSchema,
  isClashQueueType,
  type ClashLoadingChrome,
  type ClashTeamBanner,
  type LoadingScreenData,
  type LoadingScreenParticipant,
  type QueueType,
  type Team,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import {
  currentClientClashOpponent,
  readClientClashTeams,
} from "#src/league/clash/client-clash.ts";
import {
  clashTeamLabels,
  loadClashTeamAndTournamentMaps,
} from "#src/league/clash/store.ts";
import { formatClashThemeLabel } from "#src/league/clash/theme.ts";

export async function loadClashChrome(input: {
  queueType: QueueType;
  participants: readonly Pick<LoadingScreenParticipant, "puuid" | "team">[];
}): Promise<ClashLoadingChrome | undefined> {
  if (!isClashQueueType(input.queueType)) {
    return undefined;
  }
  const puuids = input.participants
    .map((participant) => participant.puuid)
    .filter((puuid) => puuid !== null)
    .map((puuid) => LeaguePuuidSchema.parse(puuid));
  if (puuids.length === 0) {
    return {};
  }
  const registrations = await prisma.clashRegistration.findMany({
    where: { puuid: { in: puuids } },
  });
  if (registrations.length === 0) {
    return await clientClashChrome(input.participants, puuids);
  }
  const { teamByKey, tournamentByKey } =
    await loadClashTeamAndTournamentMaps(registrations);
  const bannerFor = (side: Team): ClashTeamBanner | undefined => {
    const sidePuuids = new Set(
      input.participants
        .filter((participant) => participant.team === side)
        .map((participant) => participant.puuid)
        .filter((puuid) => puuid !== null),
    );
    const registration = registrations.find((row) => sidePuuids.has(row.puuid));
    if (registration === undefined) {
      return undefined;
    }
    const team = teamByKey.get(
      `${registration.platform}:${registration.teamRiotId}`,
    );
    return team === undefined ? undefined : clashTeamLabels(team);
  };
  const first = registrations[0];
  const tournament =
    first === undefined
      ? undefined
      : tournamentByKey.get(
          `${first.platform}:${String(first.tournamentRiotId)}`,
        );
  const themeLabel =
    tournament === undefined
      ? undefined
      : formatClashThemeLabel(tournament.nameKey, tournament.nameKeySecondary);
  const riot = { blue: bannerFor("blue"), red: bannerFor("red") };
  const client =
    riot.blue === undefined || riot.red === undefined
      ? await clientClashChrome(input.participants, puuids)
      : {};
  const blueTeam = riot.blue ?? client.blueTeam;
  const redTeam = riot.red ?? client.redTeam;
  return {
    ...(themeLabel === undefined ? {} : { themeLabel }),
    ...(blueTeam === undefined ? {} : { blueTeam }),
    ...(redTeam === undefined ? {} : { redTeam }),
  };
}

export async function attachClashChrome(
  data: LoadingScreenData,
  surfaceEnabled: boolean,
): Promise<LoadingScreenData> {
  if (!surfaceEnabled || data.layout === "classic" || data.layout === "arena") {
    return data;
  }
  const clashChrome = await loadClashChrome({
    queueType: data.queueType,
    participants: data.participants,
  });
  return clashChrome === undefined
    ? data
    : LoadingScreenDataSchema.parse({ ...data, clashChrome });
}

/**
 * The banners the Scout Client can supply: a side whose player's client saw
 * their roster, and — from that roster's bracket — the team they are playing
 * now. Riot publishes neither the bracket nor any opponent it doesn't track.
 */
async function clientClashChrome(
  participants: readonly Pick<LoadingScreenParticipant, "puuid" | "team">[],
  puuids: readonly string[],
): Promise<ClashLoadingChrome> {
  const teams = await readClientClashTeams(puuids, new Date());
  const banners = new Map<Team, ClashTeamBanner>();
  for (const side of ["blue", "red"] as const) {
    const sidePuuids = new Set(
      participants
        .filter((participant) => participant.team === side)
        .map((participant) => participant.puuid),
    );
    const team = teams.find((candidate) =>
      candidate.memberPuuids.some((puuid) => sidePuuids.has(puuid)),
    );
    if (team === undefined) continue;
    banners.set(side, { name: team.name, abbreviation: team.abbreviation });
    const opponent = currentClientClashOpponent(team);
    const otherSide = side === "blue" ? "red" : "blue";
    if (opponent !== null && !banners.has(otherSide)) {
      banners.set(otherSide, opponent);
    }
  }
  const blueTeam = banners.get("blue");
  const redTeam = banners.get("red");
  return {
    ...(blueTeam === undefined ? {} : { blueTeam }),
    ...(redTeam === undefined ? {} : { redTeam }),
  };
}
