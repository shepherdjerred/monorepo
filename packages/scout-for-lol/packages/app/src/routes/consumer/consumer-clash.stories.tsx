import type { Meta, StoryObj } from "@storybook/react-vite";
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
        cups: [],
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
