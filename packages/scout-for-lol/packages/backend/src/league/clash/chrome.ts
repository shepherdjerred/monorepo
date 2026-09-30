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
    return {};
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
  const blueTeam = bannerFor("blue");
  const redTeam = bannerFor("red");
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
