import type { Meta, StoryObj } from "@storybook/react-vite";
import { RankLockup } from "./rank-lockup.tsx";

const meta = {
  title: "Domain/RankLockup",
  component: RankLockup,
  tags: ["autodocs"],
  args: { rank: "Emerald" },
} satisfies Meta<typeof RankLockup>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { division: "II", leaguePoints: 64 },
};

export const WithSecondaryLine: Story = {
  args: {
    division: "II",
    leaguePoints: 64,
    secondary: "Platinum I, 12 LP in Flex",
  },
};

export const Apex: Story = {
  args: {
    rank: "Challenger",
    leaguePoints: 1284,
    secondary: "Peak this split: 1,340 LP",
  },
};

export const WithoutLeaguePoints: Story = {
  args: { rank: "Gold", division: "IV" },
};

export const RankOnly: Story = {
  args: { rank: "Iron" },
};

export const LongSecondaryLine: Story = {
  args: {
    division: "II",
    leaguePoints: 64,
    secondary:
      "Platinum I, 12 LP in Flex, and a long note that has to wrap in a narrow column",
  },
  decorators: [(story) => <div style={{ maxWidth: "18rem" }}>{story()}</div>],
};

export const Smaller: Story = {
  args: {
    division: "II",
    leaguePoints: 64,
    size: 48,
    secondary: "Platinum I, 12 LP in Flex",
  },
};
