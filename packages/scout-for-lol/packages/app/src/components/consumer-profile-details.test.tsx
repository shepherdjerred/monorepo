import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { MatchLoadoutSchema } from "@scout-for-lol/data";
import { ChampionComparisonTable } from "#src/components/match/champion-comparison-table.tsx";
import {
  MatchScoreboards,
  RolePairedMatchScoreboard,
} from "#src/components/match/match-scoreboard.tsx";
import { retainedEventFields } from "#src/components/match/match-timeline.tsx";
import { FRAME_COLUMNS } from "#src/components/match/timeline-frame-table.tsx";
import { ChampionPoolTable } from "#src/components/player/champion-pool-table.tsx";
import {
  MatchHistoryList,
  PlayerSummaryCards,
  RankValue,
} from "#src/components/player/player-profile-sections.tsx";

const loadout = MatchLoadoutSchema.parse({
  itemIds: [6672, 3006, 3031, 3085, 3072, 0, 3340],
  summonerSpellIds: [4, 6],
  runes: {
    primaryStyleId: 8000,
    primaryRuneIds: [8005, 9111, 9104, 8017],
    secondaryStyleId: 8100,
    secondaryRuneIds: [8139, 8135],
    statShardIds: { offense: 5005, flex: 5008, defense: 5002 },
  },
});

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
  loadout,
};

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

    const emptyPool = renderToStaticMarkup(
      router(
        <ChampionPoolTable rows={[]} minGamesForRate={10} profileSearch="" />,
      ),
    );
    expect(emptyPool).toContain("No games in Scout");
    expect(emptyPool).not.toContain("Previous");
  });

  test("omits unranked queue cards and an empty summary row", () => {
    expect(
      renderToStaticMarkup(<PlayerSummaryCards ranks={{}} recentForm={null} />),
    ).toBe("");

    const html = renderToStaticMarkup(
      <PlayerSummaryCards
        ranks={{
          solo: { tier: "gold", division: 2, lp: 12, wins: 8, losses: 4 },
        }}
        recentForm={null}
      />,
    );
    expect(html).toContain("Ranked solo/duo");
    expect(html).toContain("Gold");
    expect(html).not.toContain("Ranked flex");
    expect(html).not.toContain("Unranked");
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
              loadout,
              account: { gameName: "Player", tagLine: "NA1", region: "NA" },
            },
          ]}
        />,
      ),
    );
    expect(html).toContain("/players/7/matches/NA1_123");
    expect(html).toContain("games=all");
    expect(html).toContain("View full rune page");
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
    const html = renderToStaticMarkup(
      router(
        <MatchScoreboards
          showLoadout
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
    expect(html).toContain("Blue team");
    expect(html).toContain("Red team");
    expect(html).toContain("Selected");
    expect(html).toContain("Me (Friends)");
  });

  test("renders a side-by-side lane matchup with 15-minute deltas", () => {
    const roles = ["top", "jungle", "middle", "adc", "support"] as const;
    const blueParticipants = roles.map((role, index) => ({
      ...participant,
      participantId: index + 1,
      teamId: 100,
      position: role,
      selectedPlayer: index === 0,
    }));
    const redParticipants = roles.map((role, index) => ({
      ...participant,
      participantId: index + 6,
      teamId: 200,
      position: role,
      selectedPlayer: false,
      win: false,
    }));
    const html = renderToStaticMarkup(
      router(
        <RolePairedMatchScoreboard
          teams={[
            {
              teamId: 100,
              win: true,
              participants: blueParticipants,
              objectives: { turrets: 5, inhibitors: 1, barons: 1, dragons: 3 },
            },
            {
              teamId: 200,
              win: false,
              participants: redParticipants,
              objectives: { turrets: 2, inhibitors: 0, barons: 0, dragons: 1 },
            },
          ]}
          matchups={roles.map((role, index) => ({
            role,
            blueParticipantId: index + 1,
            redParticipantId: index + 6,
            at15: {
              timestampMs: 900_000,
              goldDelta: 500,
              creepScoreDelta: 10,
              xpDelta: 300,
            },
          }))}
        />,
      ),
    );
    expect(html).toContain("Lane matchup");
    expect(html).toContain("advantage · 15m");
    expect(html).toContain("+500 gold");
    expect(html).toContain("+10 CS");
    expect(html).toContain("+300 XP");
    expect(html).toContain("View full rune page");
  });
});
