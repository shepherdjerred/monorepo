import type { Meta, StoryObj } from "@storybook/react-vite";
import { SCOUT_RANKS } from "#src/assets/index.tsx";
import { RankDisplay } from "./rank-display.tsx";

const meta = {
  title: "Domain/RankDisplay",
  component: RankDisplay,
  tags: ["autodocs"],
} satisfies Meta<typeof RankDisplay>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { rank: "Emerald", division: "II", leaguePoints: 42 },
};

export const Apex: Story = {
  args: { rank: "Challenger", leaguePoints: 1284 },
};

export const WithoutLeaguePoints: Story = {
  args: { rank: "Gold", division: "IV" },
};

export const Compact: Story = {
  args: { rank: "Diamond", division: "III", leaguePoints: 67, compact: true },
};

export const Unranked: Story = {
  args: { rank: "Iron", division: "IV", leaguePoints: 0 },
};

export const QueueComparison: Story = {
  args: { rank: "Emerald", division: "II", leaguePoints: 42 },
  render: () => (
    <div className="scout-stack">
      <div className="scout-cluster">
        <span>Ranked Solo/Duo</span>
        <RankDisplay rank="Emerald" division="II" leaguePoints={42} />
      </div>
      <div className="scout-cluster">
        <span>Ranked Flex</span>
        <RankDisplay rank="Platinum" division="I" leaguePoints={88} />
      </div>
    </div>
  ),
};

export const AllTiers: Story = {
  args: { rank: "Iron" },
  render: () => (
    <div className="scout-grid">
      {SCOUT_RANKS.map((rank) => (
        <RankDisplay key={rank} rank={rank} compact />
      ))}
    </div>
  ),
};
