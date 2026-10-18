import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScoutClientHistoryView } from "./scout-client-history.tsx";
import { recoveredGamesFixture } from "./scout-client-history.fixture.ts";

const meta = {
  title: "Routes/Scout Client History",
  component: ScoutClientHistoryView,
  args: { data: recoveredGamesFixture },
} satisfies Meta<typeof ScoutClientHistoryView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const RecoveredGames: Story = {};
export const TerminalScoreboard: Story = {
  args: {
    data: {
      conflicts: [],
      results: recoveredGamesFixture.results.map((game) => ({
        ...game,
        queueId: 4310,
        gameMode: "JADE",
        gameType: "MATCHED_GAME",
        gameCreation: null,
        completedAt: Date.parse("2026-10-18T04:06:53Z"),
        participants: game.participants.map((player) => ({
          ...player,
          participantId: null,
        })),
      })),
    },
  },
};
export const Empty: Story = { args: { data: { results: [], conflicts: [] } } };
