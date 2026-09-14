import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "#src/components/button.tsx";
import { ChartFrame, InteractiveVisualization } from "./visualization.tsx";

const meta = {
  title: "Domain/Visualization",
  component: ChartFrame,
  tags: ["autodocs"],
} satisfies Meta<typeof ChartFrame>;

export default meta;

type Story = StoryObj<typeof meta>;

const championWinRates = [
  { champion: "Ahri", games: 7, winRate: 71 },
  { champion: "Syndra", games: 3, winRate: 67 },
  { champion: "Orianna", games: 2, winRate: 50 },
  { champion: "Viktor", games: 4, winRate: 25 },
  { champion: "Yasuo", games: 1, winRate: 0 },
];

function WinRateBars() {
  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      {championWinRates.map((entry) => (
        <div
          key={entry.champion}
          style={{
            display: "grid",
            gridTemplateColumns: "6rem 1fr 7rem",
            alignItems: "center",
            gap: "0.75rem",
          }}
        >
          <span>{entry.champion}</span>
          <span
            aria-hidden="true"
            style={{
              display: "block",
              height: "0.75rem",
              width: `${entry.winRate.toString()}%`,
              minWidth: "2px",
              borderRadius: "4px",
              background: "var(--scout-color-chart1)",
            }}
          />
          <span>
            {entry.winRate.toString()}% · {entry.games.toString()} games
          </span>
        </div>
      ))}
    </div>
  );
}

const lpTrend = [0, 18, 39, 17, 35, 56, 42, 61];

function LpSparkline() {
  const points = lpTrend
    .map((value, index) => {
      const x = (index / (lpTrend.length - 1)) * 280;
      const y = 80 - (value / 70) * 70;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox="0 0 280 80"
      width="100%"
      height="80"
      aria-hidden="true"
      focusable="false"
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--scout-color-chart2)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const WinRateByChampion: Story = {
  args: {
    title: "Win rate by champion",
    description: <p>Ranked Solo/Duo, last twelve games.</p>,
    children: null,
  },
  render: (args) => (
    <ChartFrame {...args}>
      <WinRateBars />
    </ChartFrame>
  ),
};

export const WithActions: Story = {
  args: {
    title: "LP earned this split",
    description: <p>Bearded Lyfe #NA1 · Emerald II</p>,
    actions: (
      <Button variant="outline" size="sm">
        Export CSV
      </Button>
    ),
    children: null,
  },
  render: (args) => (
    <ChartFrame {...args}>
      <WinRateBars />
    </ChartFrame>
  ),
};

export const Sparkline: Story = {
  args: { title: "LP trend", children: null },
  parameters: { controls: { disable: true } },
  render: () => (
    <InteractiveVisualization label="LP trend over the last eight ranked games, rising from 0 to plus 61 LP with a dip after game four.">
      <LpSparkline />
    </InteractiveVisualization>
  ),
};

export const FramedVisualization: Story = {
  args: {
    title: "LP trend",
    description: <p>Net LP after each Ranked Solo/Duo game this week.</p>,
    children: null,
  },
  render: (args) => (
    <ChartFrame {...args}>
      <InteractiveVisualization label="LP trend over the last eight ranked games, rising from 0 to plus 61 LP with a dip after game four.">
        <LpSparkline />
      </InteractiveVisualization>
    </ChartFrame>
  ),
};

export const FallbackWhenEmpty: Story = {
  args: {
    title: "Lane distribution",
    description: <p>Needs at least five ranked games in the window.</p>,
    children: null,
  },
  render: (args) => (
    <ChartFrame {...args}>
      <InteractiveVisualization
        label="Lane distribution chart is unavailable"
        fallback={<p>Not enough ranked games yet — play five to unlock.</p>}
      >
        {null}
      </InteractiveVisualization>
    </ChartFrame>
  ),
};
