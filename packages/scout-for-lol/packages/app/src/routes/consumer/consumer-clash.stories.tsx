import type { Meta, StoryObj } from "@storybook/react-vite";
import { LeaguePuuidSchema, RiotMatchIdSchema } from "@scout-for-lol/data";
import { ClashHistorySection } from "./consumer-clash-history.tsx";

const meta = {
  title: "Consumer/Clash history",
  component: ClashHistorySection,
} satisfies Meta<typeof ClashHistorySection>;
export default meta;
type Story = StoryObj<typeof meta>;

export const RecoveredBracket: Story = {
  args: {
    history: {
      isPending: false,
      isError: false,
      isSuccess: true,
      error: null,
      data: {
        cups: [
          {
            id: "2026-W41:bandle_city:day_2:clash",
            cupKey: "bandle_city",
            cupDay: "day_2",
            themeLabel: "Bandle City Cup · Day 2",
            queue: "clash",
            players: [
              {
                puuid: LeaguePuuidSchema.parse("p".repeat(78)),
                playerAlias: "Scout player",
                teamName: "Baron Hunters",
                teamAbbreviation: "BH",
                sightings: [
                  {
                    platform: "NA1",
                    gameId: "5645340874",
                    observedAt: "2026-10-10T19:05:00.000Z",
                    championId: 157,
                    championName: "Yasuo",
                    queue: "clash",
                    matchIndex: 1,
                    outcome: "win",
                    matchId: RiotMatchIdSchema.parse("NA1_5645340874"),
                  },
                  {
                    platform: "NA1",
                    gameId: "5645412233",
                    observedAt: "2026-10-10T19:52:00.000Z",
                    championId: 238,
                    championName: "Zed",
                    queue: "clash",
                    matchIndex: 2,
                    outcome: "loss",
                    matchId: RiotMatchIdSchema.parse("NA1_5421167767"),
                  },
                  {
                    platform: "NA1",
                    gameId: "5645498810",
                    observedAt: "2026-10-10T20:40:00.000Z",
                    championId: 103,
                    championName: "Ahri",
                    queue: "clash",
                    matchIndex: 3,
                    outcome: "lobby",
                    matchId: null,
                  },
                ],
              },
            ],
          },
        ],
        resultsNote:
          "Past Clash games and client-observed brackets. Results appear when Riot or Scout Client supplies a completed game.",
        brackets: [
          {
            platformId: "NA1",
            tournamentId: "3021",
            rosterId: "fixture-roster",
            name: "Baron Hunters",
            abbreviation: "BH",
            tier: 3,
            memberAliases: ["Scout player"],
            capturedAt: "2026-10-10T20:00:00.000Z",
            matches: [
              {
                round: 1,
                opponent: {
                  kind: "team",
                  name: "Dragon Pit",
                  abbreviation: "DP",
                },
                result: "won",
                status: "completed",
                gameIds: ["123"],
                matchIds: ["NA1_123"],
              },
              {
                round: 2,
                opponent: { kind: "unknown" },
                result: "pending",
                status: null,
                gameIds: [],
              },
            ],
          },
        ],
      },
    },
  },
};
