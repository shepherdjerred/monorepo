import { LolMatchSchema } from "@shepherdjerred/streambot/sports/lolesports.ts";
export function lolMatch() {
  return LolMatchSchema.parse({
    id: "115660540726095049",
    type: "match",
    startTime: "2026-10-26T17:00:00Z",
    state: "unstarted",
    league: {
      slug: "worlds",
      name: "Worlds",
      image:
        "http://static.lolesports.com/leagues/1592594612171_WorldsDarkBG.png",
    },
    matchTeams: [
      {
        name: "T1",
        code: "T1",
        image:
          "http://static.lolesports.com/teams/1726801573959_539px-T1_2019_full_allmode.png",
      },
      {
        name: "Gen.G",
        code: "GEN",
        image:
          "http://static.lolesports.com/teams/1773829250929_GENGLOGO_GOLD.png",
      },
    ],
    match: { strategy: { type: "bestOf", count: 3 } },
    streams: [
      {
        id: "1",
        provider: "twitch",
        parameter: "riotgames",
        mediaLocale: { locale: "en-US" },
        countries: [],
      },
      {
        id: "2",
        provider: "youtube",
        parameter: "5fD8Ker-Bic",
        mediaLocale: { locale: "en-US" },
        countries: [],
      },
      {
        id: "3",
        provider: "kick",
        parameter: "riotgames",
        mediaLocale: { locale: "en-US" },
        countries: [],
      },
    ],
  });
}
