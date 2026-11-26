import type { Meta, StoryObj } from "@storybook/react-vite";
import { Panel } from "#src/components/surfaces/panel.tsx";
import { RankCrest } from "#src/assets/index.tsx";
import { ClimbChart, type ClimbSeries } from "./climb-chart.tsx";

const meta = {
  title: "Domain/ClimbChart",
  component: ClimbChart,
  tags: ["autodocs"],
  args: { series: [] },
  decorators: [
    (story) => <Panel style={{ maxWidth: "42rem" }}>{story()}</Panel>,
  ],
} satisfies Meta<typeof ClimbChart>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A deterministic walk: the same steps every time, so screenshots are stable. */
function walk(start: number, steps: readonly number[]): number[] {
  const points = [start];
  for (const step of steps) points.push((points.at(-1) ?? start) + step);
  return points;
}

const northstar: ClimbSeries = {
  id: "northstar",
  name: "Northstar",
  you: true,
  points: walk(
    1230,
    [
      -4, 21, 19, -18, 22, 20, -17, 21, 18, -19, 20, 22, -15, 19, 21, -18, 20,
      19, -20, 21,
    ],
  ),
};

const halcyon: ClimbSeries = {
  id: "halcyon",
  name: "Halcyon",
  points: walk(
    1180,
    [
      12, -14, 18, 11, -13, 16, -15, 12, 14, -12, 17, 10, -14, 13, 12, -11, 14,
      -10, 12, 11,
    ],
  ),
};

const oakheart: ClimbSeries = {
  id: "oakheart",
  name: "Oakheart",
  points: walk(
    1255,
    [8, 9, -20, 7, 8, -19, 9, 8, -18, 10, 9, -17, 8, 9, -16, 7, 10, 9, -15, 8],
  ),
};

const quillon: ClimbSeries = {
  id: "quillon",
  name: "A friend with a very long summoner name",
  points: walk(
    1100,
    [
      -10, -12, 14, -11, 13, -9, 15, -12, 12, 14, -10, 11, -13, 12, 10, -9, 13,
      11, -8, 12,
    ],
  ),
};

export const One: Story = {
  args: {
    series: [northstar],
    startLabel: (
      <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <RankCrest rank="Platinum" width={40} alt="" />
        <span style={{ display: "grid", lineHeight: 1.3 }}>
          <b>Platinum II</b>
          <span className="scout-muted">Start of the split</span>
        </span>
      </span>
    ),
    nowLabel: (
      <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ display: "grid", lineHeight: 1.3 }}>
          <b>Emerald II</b>
          <span className="scout-muted">Now</span>
        </span>
        <RankCrest rank="Emerald" width={40} alt="" />
      </span>
    ),
    marks: [{ index: 9, label: "Reached Emerald" }],
  },
};

export const Several: Story = {
  args: { series: [northstar, halcyon, oakheart] },
};

export const FourWithALongName: Story = {
  args: { series: [northstar, halcyon, oakheart, quillon] },
  decorators: [(story) => <div style={{ maxWidth: "24rem" }}>{story()}</div>],
};

export const EightLines: Story = {
  args: {
    series: Array.from({ length: 8 }, (_, index) => ({
      id: `p${String(index)}`,
      name: `Player ${String(index + 1)}`,
      points: walk(1000 + index * 40, [
        6 + index,
        -9,
        10,
        8 - index,
        -7,
        11,
        index,
        -8,
        9,
        12,
      ]),
    })),
  },
};

export const Falling: Story = {
  args: {
    series: [
      {
        id: "falling",
        name: "Northstar",
        you: true,
        points: walk(1400, [-18, -20, 12, -19, -22, 10, -17, -21, -18, 11]),
      },
    ],
  },
};

export const Flat: Story = {
  args: {
    series: [
      { id: "flat", name: "Northstar", you: true, points: [1200, 1200, 1200] },
    ],
  },
};

export const OneGame: Story = {
  args: {
    series: [{ id: "one", name: "Northstar", you: true, points: [1230] }],
  },
};

export const NoHistory: Story = {
  args: { series: [{ id: "none", name: "Northstar", you: true, points: [] }] },
};
