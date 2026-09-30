import type { Meta, StoryObj } from "@storybook/react-vite";
import { RankSchema } from "@scout-for-lol/data";
import { PlayerRankHistoryCard } from "./player-rank-history.tsx";

const SOLO_RANK = RankSchema.parse({
  tier: "emerald",
  division: 2,
  lp: 64,
  wins: 118,
  losses: 101,
});
const FLEX_RANK = RankSchema.parse({
  tier: "platinum",
  division: 4,
  lp: 12,
  wins: 31,
  losses: 27,
});

const CURRENT_SPLIT = {
  id: "2026_SEASON_3",
  displayName: "2026 Season 3",
  start: new Date("2026-07-29T12:00:00-07:00"),
  end: new Date("2026-09-22T23:59:59-07:00"),
};

const meta = {
  title: "Player/Ranked history",
  component: PlayerRankHistoryCard,
  tags: ["autodocs"],
} satisfies Meta<typeof PlayerRankHistoryCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const CurrentSplit: Story = {
  args: {
    history: {
      currentSplit: CURRENT_SPLIT,
      queues: {
        solo: {
          series: [
            {
              accountLabel: "Aurora#NA1",
              points: [
                {
                  at: new Date("2026-08-02T12:00:00Z"),
                  leaguePoints: 2040,
                  rank: SOLO_RANK,
                },
                {
                  at: new Date("2026-08-20T12:00:00Z"),
                  leaguePoints: 2140,
                  rank: SOLO_RANK,
                },
                {
                  at: new Date("2026-09-10T12:00:00Z"),
                  leaguePoints: 2210,
                  rank: SOLO_RANK,
                },
              ],
            },
          ],
          previous: [
            {
              splitId: "2026_SEASON_2",
              displayName: "2026 Season 2",
              peak: SOLO_RANK,
              last: FLEX_RANK,
            },
          ],
        },
        flex: { series: [], previous: [] },
        "ranked 5s": { series: [], previous: [] },
      },
    },
  },
};

export const EmptyQueues: Story = {
  args: {
    history: {
      currentSplit: CURRENT_SPLIT,
      queues: {
        solo: { series: [], previous: [] },
        flex: { series: [], previous: [] },
        "ranked 5s": { series: [], previous: [] },
      },
    },
  },
};

export const TwoAccounts: Story = {
  args: {
    history: {
      currentSplit: CURRENT_SPLIT,
      queues: {
        solo: {
          series: [
            {
              accountLabel: "Main#NA1",
              points: [
                {
                  at: new Date("2026-08-08T12:00:00Z"),
                  leaguePoints: 2400,
                  rank: SOLO_RANK,
                },
                {
                  at: new Date("2026-09-01T12:00:00Z"),
                  leaguePoints: 2500,
                  rank: SOLO_RANK,
                },
              ],
            },
            {
              accountLabel: "Smurf#NA1",
              points: [
                {
                  at: new Date("2026-08-09T12:00:00Z"),
                  leaguePoints: 1100,
                  rank: FLEX_RANK,
                },
                {
                  at: new Date("2026-09-02T12:00:00Z"),
                  leaguePoints: 1250,
                  rank: FLEX_RANK,
                },
              ],
            },
          ],
          previous: [],
        },
        flex: { series: [], previous: [] },
        "ranked 5s": { series: [], previous: [] },
      },
    },
  },
};
