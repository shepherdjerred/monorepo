import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { ChampionComparisonTable } from "#src/components/champion-comparison-table.tsx";
import { MatchScoreboards } from "#src/components/match-scoreboard.tsx";
import { retainedEventFields } from "#src/components/match-timeline.tsx";
import { FRAME_COLUMNS } from "#src/components/timeline-frame-table.tsx";
import {
  ChampionPoolTable,
  MatchHistoryList,
  RankValue,
} from "#src/components/player-profile-sections.tsx";

function router(children: React.ReactNode): React.ReactNode {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe("player profile details", () => {
  test("renders an existing crest and paginates champion links ten at a time", () => {
    const rank = renderToStaticMarkup(
      <RankValue
        rank={{ tier: "platinum", division: 1, lp: 44, wins: 10, losses: 8 }}
      />,
    );
    expect(rank).toContain("Rank=Platinum.png");
    expect(rank).toContain("Platinum I");
    expect(rank).toContain("44 LP");

    const champions = renderToStaticMarkup(
      router(
        <ChampionPoolTable
          rows={Array.from({ length: 11 }, (_, index) => ({
            championId: index + 1,
            championName: `Champion${index.toString()}`,
            games: 12,
            wins: 7,
            winRate: 7 / 12,
            kda: 3,
            csPerMinute: 7,
            lowSample: false,
          }))}
          minGamesForRate={10}
          profileSearch="?games=50&amp;queue=solo"
        />,
      ),
    );
    expect(champions.match(/\/champions\//g)).toHaveLength(10);
    expect(champions).toContain("Next");
  });

  test("links match cards to details while preserving profile filters", () => {
    const html = renderToStaticMarkup(
      router(
        <MatchHistoryList
          playerId={7}
          profileSearch="?games=all&amp;queue=flex"
          entries={[
            {
              matchId: "NA1_123",
              gameCreationMs: Date.now(),
              gameDurationSeconds: 1800,
              queue: "flex",
              championName: "Ashe",
              teamPosition: "BOTTOM",
              win: true,
              kills: 5,
              deaths: 2,
              assists: 8,
              creepScore: 180,
              csPerMinute: 6,
              killParticipation: 0.6,
              leaguePointsDelta: 20,
              account: { gameName: "Player", tagLine: "NA1", region: "NA" },
            },
          ]}
        />,
      ),
    );
    expect(html).toContain("/players/7/matches/NA1_123");
    expect(html).toContain("games=all");
  });
});

describe("champion comparison and match timeline", () => {
  test("shows viewer highlighting, guild labels, and accessible profile links", () => {
    const html = renderToStaticMarkup(
      router(
        <ChampionComparisonTable
          rows={[
            {
              playerId: 4,
              alias: "Me",
              guild: { guildId: "guild", name: "Friends" },
              viewerLinked: true,
              games: 20,
              wins: 12,
              losses: 8,
              winRate: 0.6,
              kda: 3,
              csPerMinute: 7,
              damagePerMinute: 600,
              goldPerMinute: 420,
              visionPerMinute: 1.2,
            },
          ]}
          profileSearch="?queue=solo"
          page={0}
          hasNextPage={false}
          pending={false}
          empty="Empty"
          onPrevious={vi.fn()}
          onNext={vi.fn()}
        />,
      ),
    );
    expect(html).toContain("Friends");
    expect(html).toContain("You");
    expect(html).toContain("/players/4?queue=solo");
  });

  test("keeps unknown event fields and enumerates every frame field", () => {
    expect(
      retainedEventFields({
        event_id: "event",
        event_type: "NEW_RIOT_EVENT",
        event_timestamp_ms: 100,
        gold_gain: 42,
        monster_type: null,
      }),
    ).toContainEqual(["gold gain", "42"]);
    expect(FRAME_COLUMNS).toContain("total_damage_done_to_champions");
    expect(FRAME_COLUMNS).toHaveLength(28);
  });

  test("renders both team scoreboards and marks the launching player", () => {
    const participant = {
      participantId: 1,
      teamId: 100,
      selectedPlayer: true,
      riotId: { gameName: "Launch", tagLine: "NA1" },
      championId: 22,
      championName: "Ashe",
      position: "BOTTOM",
      win: true,
      kills: 5,
      deaths: 2,
      assists: 8,
      creepScore: 180,
      goldEarned: 12_000,
      visionScore: 22,
      damageToChampions: 20_000,
      killParticipation: 0.6,
      damageShare: 0.4,
      objectives: { turrets: 1, inhibitors: 0, barons: 0, dragons: 0 },
      scoutAliases: [{ playerId: 4, alias: "Me", guildName: "Friends" }],
    };
    const html = renderToStaticMarkup(
      router(
        <MatchScoreboards
          teams={[
            {
              teamId: 100,
              win: true,
              participants: [participant],
              objectives: { turrets: 1, inhibitors: 0, barons: 0, dragons: 0 },
            },
            {
              teamId: 200,
              win: false,
              participants: [
                {
                  ...participant,
                  participantId: 2,
                  teamId: 200,
                  selectedPlayer: false,
                  win: false,
                },
              ],
              objectives: { turrets: 0, inhibitors: 0, barons: 0, dragons: 0 },
            },
          ]}
        />,
      ),
    );
    expect(html).toContain("Team 100");
    expect(html).toContain("Team 200");
    expect(html).toContain("Selected");
    expect(html).toContain("Me (Friends)");
  });
});
