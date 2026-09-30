import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlayerBehavior } from "./player-behavior.tsx";

const meta = {
  title: "Player/Playing Patterns",
  component: PlayerBehavior,
  parameters: { layout: "padded" },
} satisfies Meta<typeof PlayerBehavior>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RecordedForm: Story = {
  args: {
    behavior: {
      roleShare: [
        { position: "JUNGLE", games: 14, percentage: 70 },
        { position: "TOP", games: 6, percentage: 30 },
      ],
      activityTimes: Array.from({ length: 20 }, (_, index) =>
        new Date(2026, 8, 20 + (index % 7), 18 + (index % 4)).getTime(),
      ),
      streak: { result: "win", games: 4, atLeast: false },
      recent20: { games: 20, wins: 13, kda: 3.4, csPerMinute: 6.9 },
      currentAct: {
        name: "Example Act",
        form: { games: 58, wins: 32, kda: 2.8, csPerMinute: 6.3 },
      },
    },
  },
};

export const ActUnavailable: Story = {
  args: {
    behavior: {
      roleShare: [{ position: "BOTTOM", games: 2, percentage: 100 }],
      activityTimes: [
        new Date(2026, 8, 22, 21).getTime(),
        new Date(2026, 8, 24, 20).getTime(),
      ],
      streak: { result: "loss", games: 2, atLeast: false },
      recent20: { games: 2, wins: 0, kda: 1.1, csPerMinute: 5.2 },
      currentAct: null,
    },
  },
};
