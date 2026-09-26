import { describe, expect, it } from "vitest";
import {
  parseStreamEastEvents,
  parseTVSportsLiveEvents,
  sportsEventTimeLabel,
} from "@shepherdjerred/streambot/sports/parse-events.ts";
import { matchSportsEvents } from "@shepherdjerred/streambot/sports/sports-service.ts";
import type { SportsEvent } from "@shepherdjerred/streambot/sports/types.ts";

const NOW = new Date("2026-09-26T19:00:00.000Z");

describe("sports listings", () => {
  it("parses today's StreamEast cards and drops a card from another local day", () => {
    const events = parseStreamEastEvents(
      '<div class="m-card m-card--live" data-match-id="abc" data-time="1790449200"><a class="m-card__link" href="/nfl/bears-vs-packers/" aria-label="Bears vs Packers"></a></div>' +
        '<div class="m-card" data-match-id="old" data-time="1790362800"><a class="m-card__link" href="/nfl/old-game/" aria-label="Old Game"></a></div>',
      NOW,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: "streameast",
      title: "Bears vs Packers",
      status: "live",
      pageUrl: "https://v2.streameast.ga/nfl/bears-vs-packers/",
    });
  });

  it("treats undated current-feed items as Later today", () => {
    const events = parseTVSportsLiveEvents(
      '<article><h2 class="entry-title"><a href="https://tvsportslive.fr/game/">Ducks vs Kings</a></h2><p>Watch live</p></article>',
      NOW,
    );
    expect(events).toHaveLength(1);
    expect(sportsEventTimeLabel(events[0]!)).toBe("Later today");
  });

  it("prefers a live provider copy over a scheduled copy but preserves provider-specific requests", () => {
    const events: SportsEvent[] = [
      {
        id: "stream:game",
        provider: "streameast",
        title: "Bears vs Packers",
        status: "scheduled",
        startsAt: null,
        pageUrl: "https://v2.streameast.ga/nfl/bears-vs-packers/",
      },
      {
        id: "tv:game",
        provider: "tvsportslive",
        title: "Bears vs Packers",
        status: "live",
        startsAt: null,
        pageUrl: "https://tvsportslive.fr/game/",
      },
    ];
    expect(matchSportsEvents("Bears Packers", events, "auto")).toMatchObject({
      kind: "found",
      events: [{ provider: "tvsportslive", status: "live" }],
    });
    expect(
      matchSportsEvents("Bears Packers", events, "streameast"),
    ).toMatchObject({
      kind: "upcoming",
      event: { provider: "streameast" },
    });
  });
});
