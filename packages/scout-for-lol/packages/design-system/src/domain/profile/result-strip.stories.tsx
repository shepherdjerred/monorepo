import type { Meta, StoryObj } from "@storybook/react-vite";
import { Panel } from "#src/components/surfaces/panel.tsx";
import { ResultStrip, type GameResult } from "./result-strip.tsx";

const meta = {
  title: "Domain/ResultStrip",
  component: ResultStrip,
  tags: ["autodocs"],
  decorators: [
    (story) => <Panel style={{ maxWidth: "40rem" }}>{story()}</Panel>,
  ],
} satisfies Meta<typeof ResultStrip>;

export default meta;

type Story = StoryObj<typeof meta>;

const w: GameResult = "win";
const l: GameResult = "loss";

const mixed: GameResult[] = [
  l,
  w,
  l,
  w,
  l,
  w,
  w,
  l,
  w,
  l,
  w,
  w,
  w,
  l,
  l,
  w,
  l,
  w,
  w,
  w,
];

export const WinStreak: Story = { args: { results: mixed } };

export const LossStreak: Story = {
  args: { results: [...mixed.slice(0, 15), w, w, l, l, l] },
};

export const AllWins: Story = {
  args: { results: Array.from({ length: 20 }, () => w) },
};

export const AllLosses: Story = {
  args: { results: Array.from({ length: 20 }, () => l) },
};

export const NoStreak: Story = {
  args: { results: [...mixed.slice(0, 19), l, w] },
};

export const FewGames: Story = { args: { results: [w, l, w, w, w, l, w] } };

export const OneGame: Story = { args: { results: [w] } };

export const NoGames: Story = { args: { results: [] } };

export const MoreThanTwentyKeepsTheNewest: Story = {
  args: { results: [...mixed, l, l, w, w] },
};

export const NarrowColumn: Story = {
  args: { results: mixed },
  decorators: [(story) => <div style={{ maxWidth: "20rem" }}>{story()}</div>],
};
