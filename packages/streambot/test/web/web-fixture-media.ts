import type { PosterFetcher } from "@shepherdjerred/streambot/metadata/tmdb.ts";
import type {
  SportsCatalog,
  SportsEvent,
} from "@shepherdjerred/streambot/sports/types.ts";
import { matchSportsEvents } from "@shepherdjerred/streambot/sports/sports-service.ts";

// Public artwork returned by TMDB; no credentials or live provider I/O enter this fixture.
const POSTERS = new Map([
  ["Arrival", "pEzNVQfdzYDzVK0XqxERIw2x2se.jpg"],
  ["Spirited Away", "jUo8cNmU400WtZiJss45HNXlQ2e.jpg"],
  ["Whiplash", "7fn624j5lj3xTme2SgiLCeuedmO.jpg"],
  ["Severance", "pPHpeI2X1qEd1CS1SeyrdhZ4qnT.jpg"],
  ["The Bear", "eKfVzzEazSIjJMrw9ADa2x8ksLz.jpg"],
]);
export const fixturePoster: PosterFetcher = (title) => {
  const path = POSTERS.get(title);
  return Promise.resolve(
    path === undefined
      ? null
      : {
          tmdbTitle: title,
          posterUrl: "https://image.tmdb.org/t/p/w500/" + path,
        },
  );
};

export const FIXTURE_EVENTS: readonly SportsEvent[] = [
  {
    id: "streameast:seahawks",
    provider: "streameast",
    title: "Seattle Seahawks vs San Francisco 49ers",
    status: "live",
    startsAt: null,
    pageUrl: "https://v2.streameast.ga/seattle-seahawks-san-francisco-49ers-1/",
  },
  {
    id: "streameast:lakers",
    provider: "streameast",
    title: "Los Angeles Lakers vs Golden State Warriors",
    status: "scheduled",
    startsAt: "2030-01-01T22:00:00.000Z",
    pageUrl:
      "https://v2.streameast.ga/los-angeles-lakers-golden-state-warriors-2/",
  },
  {
    id: "tvsportslive:seahawks",
    provider: "tvsportslive",
    title: "Seattle Seahawks vs San Francisco 49ers",
    status: "unknown",
    startsAt: null,
    pageUrl: "https://tvsportslive.fr/seattle-seahawks-san-francisco-49ers/",
  },
];
export const fixtureSports: SportsCatalog = {
  listToday: () => Promise.resolve(FIXTURE_EVENTS),
  search: (query, provider) =>
    Promise.resolve(matchSportsEvents(query, FIXTURE_EVENTS, provider)),
};
