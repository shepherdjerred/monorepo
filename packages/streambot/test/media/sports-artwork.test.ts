import { expect, test } from "vitest";
import { parseStreamEastEvents } from "@shepherdjerred/streambot/sports/parse-events.ts";
import { isSportsArtworkUrl } from "@shepherdjerred/streambot/sports/artwork.ts";

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
