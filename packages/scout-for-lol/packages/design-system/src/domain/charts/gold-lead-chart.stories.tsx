import type { Meta, StoryObj } from "@storybook/react-vite";
import { GoldLeadChart, type GoldLeadPoint } from "./gold-lead-chart.tsx";

const meta = {
  title: "Domain/GoldLeadChart",
  component: GoldLeadChart,
  tags: ["autodocs"],
  args: { points: [] },
  decorators: [(story) => <div style={{ maxWidth: "42rem" }}>{story()}</div>],
} satisfies Meta<typeof GoldLeadChart>;

export default meta;

type Story = StoryObj<typeof meta>;

const leads = [
  0, 120, 310, 260, 540, 880, 1210, 1480, 1320, 1710, 2240, 2890, 3420, 3180,
  3940, 4610, 5230, 5810,
];

const swing = [
  0, -150, -420, -380, 260, 710, 1280, 980, 340, -520, -1360, -2210, -1740,
  -820, 640, 1930, 3120, 4380,
];

function toPoints(values: readonly number[]): GoldLeadPoint[] {
  return values.map((lead, index) => ({ timeMs: index * 120_000, lead }));
}

export const BlueAhead: Story = {
  args: { points: toPoints(leads), cursorMs: 960_000 },
};

export const Swing: Story = {
  args: { points: toPoints(swing), cursorMs: 1_320_000 },
};

export const RedAhead: Story = {
  args: { points: toPoints(leads.map((lead) => -lead)) },
};

export const NamedTeams: Story = {
  args: {
    points: toPoints(swing),
    positiveName: "Your",
    negativeName: "Their",
  },
};

export const MissingValues: Story = {
  args: {
    points: [
      { timeMs: 0, lead: 0 },
      { timeMs: 120_000, lead: 220 },
      { timeMs: 240_000, lead: null },
      { timeMs: 360_000, lead: null },
      { timeMs: 480_000, lead: 910 },
      { timeMs: 600_000, lead: 1220 },
    ],
  },
};

export const Unavailable: Story = {
  args: {
    points: [
      { timeMs: 0, lead: null },
      { timeMs: 120_000, lead: null },
    ],
  },
};

export const EvenGame: Story = {
  args: { points: toPoints([0, 0, 0, 0, 0]) },
};
