import { RiotMatchIdSchema } from "@scout-for-lol/data";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, test } from "vitest";
import { MatchupsPanel } from "#src/components/champions/champion-matchups.tsx";
import { ChampionView } from "#src/components/champions/champion-view.tsx";
import {
  ChampionsIndexView,
  type ChampionsIndexData,
} from "#src/components/champions/champions-index-view.tsx";
import {
  MIDNIGHT_SCRIMS,
  RIFT_STUDY_GROUP,
  comparisonRow,
  indexChampion,
  matchupEntry,
  matchupTally,
} from "#src/lib/champions/champion-fixtures.ts";

function render(node: ReactNode): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
}

const SERVERS = [
  { guildId: RIFT_STUDY_GROUP, name: "Rift Study Group" },
  { guildId: MIDNIGHT_SCRIMS, name: "Midnight Scrims" },
];

function indexData(champions: ChampionsIndexData["champions"]) {
  return { qualifyingGames: 10, availableGuilds: SERVERS, champions };
}

function NOOP(): void {
  // A handler the test never fires.
}

describe("ChampionsIndexView", () => {
  const champions = [
    indexChampion({
      bestFriend: {
        playerId: 2,
        alias: "RiverQuartz",
        guilds: [],
        games: 34,
        wins: 22,
        winRate: 22 / 34,
        qualified: true,
      },
      you: { games: 8, wins: 6, winRate: 0.75, lastPlayedMs: 0 },
    }),
    indexChampion({
      championId: 157,
      name: "Yasuo",
      friendCount: 5,
      you: { games: 3, wins: 1, winRate: 1 / 3, lastPlayedMs: 0 },
    }),
  ];

  test("shows the hero, the viewer's champions and the friends' picks", () => {
    const html = render(
      <ChampionsIndexView
        data={indexData(champions)}
        guildIds={undefined}
        onGuildIds={NOOP}
        find=""
        onFind={NOOP}
      />,
    );
    expect(html).toContain("Ahri is the favourite in your servers.");
    expect(html).toContain(
      "6 friends play Ahri, and RiverQuartz is the best of them at 64.7%.",
    );
    expect(html).toContain("Yours");
    expect(html).toContain("8 games");
    expect(html).toContain("Small sample");
    expect(html).toContain("Popular with your friends");
    expect(html).toContain("Played by 5 friends");
    expect(html).toContain('href="/champions/157"');
    expect(html).toContain('aria-label="Which servers to include"');
    expect(html).toContain('aria-pressed="true"');
  });

  test("a search narrows the picks and says so when nothing matches", () => {
    const html = render(
      <ChampionsIndexView
        data={indexData(champions)}
        guildIds={undefined}
        onGuildIds={NOOP}
        find="zzz"
        onFind={NOOP}
      />,
    );
    expect(html).toContain("No champions match.");
    expect(html).not.toContain("Played by 5 friends");
  });

  test("is an empty page, with the servers still choosable, when nobody has played", () => {
    const html = render(
      <ChampionsIndexView
        data={indexData([])}
        guildIds={[RIFT_STUDY_GROUP]}
        onGuildIds={NOOP}
        find=""
        onFind={NOOP}
      />,
    );
    expect(html).toContain("No champion games yet");
    expect(html).toContain("Midnight Scrims");
    expect(html).not.toContain("Popular with your friends");
  });

  test("leaves out the lines that explain the page", () => {
    const html = render(
      <ChampionsIndexView
        data={indexData(champions)}
        guildIds={undefined}
        onGuildIds={NOOP}
        find=""
        onFind={NOOP}
      />,
    );
    expect(html).not.toContain("From your last");
    expect(html).not.toContain("What most of your friends play");
  });
});

describe("ChampionView", () => {
  const last10 = Array.from({ length: 10 }, (_, index) => ({
    matchId: RiotMatchIdSchema.parse(
      `NA1_58000000${index.toString().padStart(2, "0")}`,
    ),
    win: index < 7,
    playedAtMs: index,
  }));
  const qualified = [
    comparisonRow({ last10 }),
    comparisonRow({
      playerId: 2,
      alias: "Northstar",
      viewerLinked: true,
      games: 41,
      wins: 25,
      winRate: 25 / 41,
      last10,
    }),
  ];
  const small = [
    comparisonRow({
      playerId: 3,
      alias: "Oakheart",
      games: 7,
      wins: 5,
      losses: 2,
      winRate: 5 / 7,
    }),
  ];

  function view(overrides: {
    qualified?: typeof qualified;
    small?: typeof small;
    mastery?: ReactNode;
  }) {
    return render(
      <ChampionView
        championId={103}
        name="Ahri"
        qualifyingGames={10}
        qualified={overrides.qualified ?? qualified}
        small={overrides.small ?? small}
        truncated={false}
        servers={null}
        matchups={null}
        mastery={overrides.mastery ?? null}
      />,
    );
  }

  test("ranks friends with games, form and win rate, and lists who is warming up", () => {
    const html = view({});
    expect(html).toContain("Who&#x27;s best on Ahri");
    expect(html).toContain(
      "You have the 2nd best win rate of 2 in your servers.",
    );
    expect(html).toContain("34 games");
    expect(html).toContain("Won 7 of the last 10");
    expect(html).toContain('data-you="true"');
    expect(html).toContain("Still warming up");
    expect(html).toContain("5 wins, 2 losses");
    expect(html).toContain('href="/players/1"');
    expect(html).toContain("Change champion");
  });

  test("leaves no placeholder for the later waves", () => {
    const html = view({});
    expect(html).not.toMatch(/tips/i);
    expect(html).not.toContain("How your friends build");
    expect(html).not.toContain("Playing Ahri");
  });

  test("with nobody on the champion it is an empty page", () => {
    const html = view({ qualified: [], small: [] });
    expect(html).toContain("Nobody in your servers has played Ahri");
    expect(html).not.toContain("Who&#x27;s best");
  });
});

describe("MatchupsPanel", () => {
  const matchups = [
    matchupEntry(157, "Yasuo", matchupTally(5, 6, 5, 6)),
    matchupEntry(134, "Syndra", matchupTally(1, 5, 1, 5)),
  ];

  test("labels ahead at 15 minutes with its own game count", () => {
    const html = render(
      <MatchupsPanel
        matchups={matchups}
        lanes={["middle"]}
        lane="middle"
        onLane={NOOP}
      />,
    );
    expect(html).toContain("Good against Yasuo, rough against Syndra");
    expect(html).toContain("Won 5 of 6 games");
    expect(html).toContain("Ahead at 15 minutes in 5 of 6 lane games");
    expect(html).toContain("Does well against");
    expect(html).toContain("Has a hard time against");
    expect(html).not.toContain('aria-label="Lane"');
  });

  test("offers the other lanes a champion plays", () => {
    const html = render(
      <MatchupsPanel
        matchups={matchups}
        lanes={["middle", "top"]}
        lane="top"
        onLane={NOOP}
      />,
    );
    expect(html).toContain('aria-label="Lane"');
    expect(html).toContain("Mid");
    expect(html).toContain("Top");
  });

  test("shows nothing when the one lane has no matchup with enough games", () => {
    expect(
      render(
        <MatchupsPanel
          matchups={[matchupEntry(1, "Annie", matchupTally(1, 2, 1, 2))]}
          lanes={["middle"]}
          lane="middle"
          onLane={NOOP}
        />,
      ),
    ).toBe("");
  });
});
