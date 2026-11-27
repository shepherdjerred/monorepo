import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, test } from "vitest";
import type { ChallengeRun } from "#src/components/player-profile/about-more.tsx";
import {
  ProfileView,
  type SplitSection,
} from "#src/components/player-profile/profile-view.tsx";
import { feedRows, splitClimb } from "#src/lib/player/player-feed.ts";
import {
  historyEntry,
  matchId,
  NOW_MS,
  PLAYER_ID,
  playerSummary,
  rankPoint,
  type PopulatedSummary,
} from "#src/lib/player/player-fixtures.ts";

function render(node: ReactNode): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
}

function NOOP(): void {
  // A handler the test never fires.
}

function view(
  summary: PopulatedSummary,
  options: {
    feed?: ReturnType<typeof feedRows>;
    split?: SplitSection;
    feedFailed?: { onRetry: () => void };
    challenges?: ChallengeRun[];
  } = {},
): string {
  return render(
    <ProfileView
      playerId={PLAYER_ID}
      summary={summary}
      filters={{ games: "all", queues: ["solo", "flex", "ranked 5s", "clash"] }}
      onFilters={NOOP}
      feed={options.feed ?? feedRows([historyEntry()], NOW_MS)}
      feedFailed={options.feedFailed}
      split={options.split ?? { kind: "none" }}
      challenges={options.challenges ?? []}
      nowMs={NOW_MS}
    />,
  );
}

describe("ProfileView", () => {
  test("the hero names the player, their ranks, where they play and who they play", () => {
    const html = view(playerSummary());
    expect(html).toContain("<h1");
    expect(html).toContain("Northstar");
    expect(html).toContain("Emerald");
    expect(html).toContain("Platinum I, 12 LP in Flex");
    expect(html).toContain("Mid main in Rift Study Group.");
    expect(html).toContain("Mostly plays");
    expect(html).toContain('href="/champions/134"');
    expect(html).toContain('href="/players"');
    expect(html).toContain("Find another player");
  });

  test("Lately is a sentence and a strip of every game", () => {
    const html = view(playerSummary());
    expect(html).toContain("Won 12 of the last 20");
    expect(html).toContain(
      "On a 3-game win streak, with a 60% win rate and a 3.42 KDA.",
    );
    expect(html).toContain("20 games ago");
    expect(html).toContain('role="img"');
  });

  test("Recent games are sentences that link to the match, behind real controls", () => {
    const html = view(playerSummary(), {
      feed: feedRows(
        [
          historyEntry({ largestMultiKill: 4 }),
          historyEntry({
            matchId: matchId(2),
            win: false,
            leaguePointsDelta: -18,
          }),
        ],
        NOW_MS,
      ),
    });
    expect(html).toContain("Recent games");
    expect(html).toContain("as Ahri, 9/2/11, +21 LP");
    expect(html).toContain("−18 LP");
    expect(html).toContain("Ranked Solo");
    expect(html).toContain("2 hours ago");
    expect(html).toContain("Quadra kill");
    expect(html).toContain(`href="/players/7/matches/${matchId(1)}"`);
    expect(html).toContain('aria-label="Which games to show"');
    expect(html).toContain("More filters");
  });

  test("only six games show until See all games", () => {
    const entries = Array.from({ length: 9 }, (_, index) =>
      historyEntry({ matchId: matchId(index + 10) }),
    );
    const html = view(playerSummary(), { feed: feedRows(entries, NOW_MS) });
    expect(html.match(/as Ahri, 9\/2\/11/g)).toHaveLength(6);
    expect(html).toContain("See all games");
    const few = view(playerSummary(), {
      feed: feedRows(entries.slice(0, 4), NOW_MS),
    });
    expect(few).not.toContain("See all games");
  });

  test("a failed feed keeps the controls and offers a retry", () => {
    const html = view(playerSummary(), {
      feed: [],
      feedFailed: { onRetry: NOOP },
    });
    expect(html).toContain("Recent games could not be loaded.");
    expect(html).toContain("Retry");
    expect(html).toContain('aria-label="Which games to show"');
  });

  test("no games is one plain label", () => {
    expect(view(playerSummary(), { feed: [] })).toContain("No games");
  });
});

describe("ProfileView sections", () => {
  const friends = [
    { playerId: 2, alias: "RiverQuartz", games: 9, wins: 6, lastGameMs: 1 },
  ];

  test("Plays with and Best champions show their facts", () => {
    const html = view(
      playerSummary({ playsWith: { windowDays: 90, friends } }),
    );
    expect(html).toContain("Plays with");
    expect(html).toContain("Mostly with RiverQuartz");
    expect(html).toContain("9 games together, won 6");
    expect(html).toContain('href="/players/2"');
    expect(html).toContain("Best champions");
    expect(html).toContain("8 games");
    expect(html).toContain("Won 75%");
    expect(html).toContain("Small sample");
  });

  test("Plays with and Highlights are absent without anything to show", () => {
    const html = view(playerSummary());
    expect(html).not.toContain("Plays with");
    expect(html).not.toContain("Highlights");
  });

  test("a multi-kill in the newest game is a Highlight", () => {
    const summary = playerSummary();
    const html = view({
      ...summary,
      highlights: {
        ...summary.highlights,
        latestGame: {
          matchId: matchId(1),
          win: true,
          championId: 222,
          championName: "Jinx",
          teamPosition: "BOTTOM",
          kills: 12,
          deaths: 3,
          assists: 8,
          largestMultiKill: 4,
          queue: "solo",
          queueId: 420,
          gameCreationMs: NOW_MS - 3_600_000,
          gameDurationSeconds: 1800,
          placement: null,
          leaguePointsDelta: 19,
        },
      },
    });
    expect(html).toContain("Highlights");
    expect(html).toContain("Quadra kill as Jinx");
    expect(html).toContain("1 hour ago");
  });

  test("This split draws the climb, or says the rank history failed", () => {
    const climb = splitClimb({
      currentSplit: {
        id: "s",
        displayName: "S",
        start: "2026-09-01T00:00:00.000Z",
        end: "2026-12-31T00:00:00.000Z",
      },
      queues: {
        solo: {
          series: [
            {
              accountLabel: "A",
              points: [
                rankPoint("platinum", 2, 30, "2026-09-02T00:00:00.000Z"),
                rankPoint("emerald", 2, 64, "2026-09-05T00:00:00.000Z"),
              ],
            },
          ],
          previous: [],
        },
        flex: { series: [], previous: [] },
        "ranked 5s": { series: [], previous: [] },
      },
    });
    if (climb === null) throw new Error("The fixture has a climb");
    const drawn = view(playerSummary(), { split: { kind: "climb", climb } });
    expect(drawn).toContain("This split");
    expect(drawn).toContain(
      "Climbed from Platinum II to Emerald II in 1 ranked game.",
    );
    expect(drawn).toContain("Start of the split");
    expect(drawn).toContain("Reached Emerald");
    const failed = view(playerSummary(), {
      split: { kind: "failed", onRetry: NOOP },
    });
    expect(failed).toContain("Rank history could not be loaded.");
    expect(view(playerSummary())).not.toContain("This split");
  });

  test("More about folds hold accounts and, with mastery, mastery", () => {
    const summary = playerSummary();
    const html = view(summary);
    expect(html).toContain("More about Northstar");
    expect(html).toContain("Accounts (1)");
    expect(html).toContain("Northstar#NA1, in North America.");
    expect(html).not.toContain("Mastery");
  });

  test("Challenges are a fold of links to the runs, when there are any", () => {
    const html = view(playerSummary(), {
      challenges: [
        {
          id: "run-1",
          title: "Climb to Gold",
          status: "active",
          recomputing: false,
        },
        {
          id: "run-2",
          title: "Ahri only",
          status: "active",
          recomputing: true,
        },
      ],
    });
    expect(html).toContain("Challenges (2)");
    expect(html).toContain('href="/challenge-runs/run-1"');
    expect(html).toContain("Updating now");
    expect(view(playerSummary())).not.toContain("Challenges");
  });

  test("an unranked player with no games still gets a page", () => {
    const summary = playerSummary();
    const html = view(
      {
        ...summary,
        ranks: {},
        championPool: [],
        highlights: {
          ...summary.highlights,
          lately: null,
          bestChampion: null,
        },
      },
      { feed: [] },
    );
    expect(html).toContain("Unranked");
    expect(html).not.toContain("Lately");
    expect(html).not.toContain("Best champions");
    expect(html).toContain("No games");
  });
});
