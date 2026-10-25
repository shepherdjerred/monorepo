import { expect, test } from "vitest";
import { parseStreamEastEvents } from "@shepherdjerred/streambot/sports/parse-events.ts";
import { isSportsArtworkUrl } from "@shepherdjerred/streambot/sports/artwork.ts";
import {
  isSportsThumbnailUrl,
  SportsArtworkSchema,
} from "@shepherdjerred/streambot/sports/artwork.ts";
import { isRemoteArtworkUrl } from "@shepherdjerred/streambot/metadata/public-artwork.ts";
import { lolSportsEvent } from "@shepherdjerred/streambot/sports/lolesports.ts";
import { lolMatch } from "#lol-fixture";
import { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";

test("LoL history preserves match artwork while removing scheduled-playback ownership", () => {
  const history = new MediaHistoryStore(":memory:");
  try {
    const event = lolSportsEvent({ ...lolMatch(), state: "inProgress" });
    const media = {
      title: event.title,
      provider: "lolesports" as const,
      source: {
        kind: "url" as const,
        url: event.pageUrl,
        sportsEvent: event,
        scheduleId: crypto.randomUUID(),
      },
    };
    history.addFavorite("3", media);
    history.recordPlaybackStart({
      scope: { guildId: "1", channelId: "2", userId: "3" },
      media,
    });
    const favorite = history.favorites("3")[0]?.source;
    expect(
      favorite?.kind === "url" ? favorite.scheduleId : "wrong source",
    ).toBeUndefined();
    expect(
      favorite?.kind === "url" ? favorite.sportsEvent?.artwork : undefined,
    ).toEqual(event.artwork);
    const run = history.browseRuns({
      userId: "3",
      guildId: "1",
      visibility: "mine",
      query: "",
      provider: "lolesports",
      offset: 0,
    }).items[0];
    expect(
      run?.source.kind === "url" ? run.source.scheduleId : "wrong source",
    ).toBeUndefined();
  } finally {
    history.close();
  }
});

test("LoL artwork uses HTTPS Riot logos and live broadcast thumbnails, with strict CDN paths", () => {
  const match = lolMatch();
  const upcoming = lolSportsEvent(match);
  expect(upcoming.artwork?.teams[0]?.logoUrl).toBe(
    "https://static.lolesports.com/teams/1726801573959_539px-T1_2019_full_allmode.png",
  );
  expect(upcoming.artwork?.league?.logoUrl).toContain(
    "https://static.lolesports.com/leagues/",
  );
  expect(upcoming.artwork?.thumbnailUrl).toBeUndefined();
  const live = lolSportsEvent({ ...match, state: "inProgress" });
  expect(live.artwork?.thumbnailUrl).toBe(
    "https://i.ytimg.com/vi/5fD8Ker-Bic/hqdefault.jpg",
  );
  expect(SportsArtworkSchema.safeParse(live.artwork).success).toBe(true);
  expect(isRemoteArtworkUrl(live.artwork?.teams[0]?.logoUrl ?? "")).toBe(true);
  expect(
    isSportsArtworkUrl(
      "https://static.lolesports.com/teams/logo.png?token=private",
    ),
  ).toBe(false);
  expect(
    isSportsArtworkUrl("https://static.lolesports.com/api/private.png"),
  ).toBe(false);
  expect(
    isSportsArtworkUrl(
      "https://static.lolesports.com.evil.example/teams/logo.png",
    ),
  ).toBe(false);
  expect(
    isSportsThumbnailUrl(
      "https://i.ytimg.com/vi/5fD8Ker-Bic/hqdefault.jpg?token=private",
    ),
  ).toBe(false);
  expect(
    isRemoteArtworkUrl("https://static-cdn.jtvnw.net/private/secret.png"),
  ).toBe(false);
  const untrusted = lolSportsEvent({
    ...match,
    matchTeams: match.matchTeams.map((team) => ({
      ...team,
      image: "https://private.example/logo.png",
    })),
  });
  expect(
    untrusted.artwork?.teams.every((team) => team.logoUrl === undefined),
  ).toBe(true);
});

test("StreamEast cards pair team crests with their league and omit unapproved images", () => {
  const events = parseStreamEastEvents(
    '<img class="se-sport-icon-img--sport" src="/images/cat/nba3.svg" alt="NBA"><div class="m-card m-card--live" data-match-id="one"><a class="m-card__link" href="/game/" aria-label="Miami Heat vs Toronto Raptors"></a><img class="m-card__crest-img" src="/images/miami-heat.svg" alt="Miami Heat"><img class="m-card__crest-img" src="https://private.example/logo.svg" alt="Toronto Raptors"></div>',
  );
  expect(events[0]?.artwork).toEqual({
    teams: [
      {
        name: "Miami Heat",
        logoUrl: "https://v2.streameast.ga/images/miami-heat.svg",
      },
      { name: "Toronto Raptors" },
    ],
    league: {
      name: "NBA",
      logoUrl: "https://v2.streameast.ga/images/cat/nba3.svg",
    },
  });
  expect(
    isSportsArtworkUrl(
      "https://v2.streameast.ga/images/cat/nba3.svg?token=private",
    ),
  ).toBe(false);
  expect(isSportsArtworkUrl("https://v2.streameast.ga/api/private.svg")).toBe(
    false,
  );
});
