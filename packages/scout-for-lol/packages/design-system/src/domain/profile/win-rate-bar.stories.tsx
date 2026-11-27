import type { Meta, StoryObj } from "@storybook/react-vite";
import { Panel } from "#src/components/surfaces/panel.tsx";
import { ChampionFace } from "./champion-face.tsx";
import { NameText } from "./name-text.tsx";
import { WinRateBar } from "./win-rate-bar.tsx";

const meta = {
  title: "Domain/WinRateBar",
  component: WinRateBar,
  tags: ["autodocs"],
  args: { value: 56 },
  decorators: [(story) => <div style={{ maxWidth: "28rem" }}>{story()}</div>],
} satisfies Meta<typeof WinRateBar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const You: Story = { args: { value: 65, you: true } };

export const WithEvenMark: Story = { args: { value: 56, even: true } };

export const WithoutValue: Story = { args: { value: 48, showValue: false } };

export const Extremes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <WinRateBar value={0} even />
      <WinRateBar value={50} even />
      <WinRateBar value={100} even />
    </div>
  ),
};

export const Range: Story = {
  args: {
    variant: "range",
    value: 51.8,
    even: true,
    range: { low: 50.9, high: 52.7 },
    domain: [48, 56],
  },
};

export const RangeBelowEven: Story = {
  args: { variant: "range", value: 43.1, even: true, domain: [30, 70] },
};

export const RangeOffTheEdge: Story = {
  args: {
    variant: "range",
    value: 58,
    even: true,
    range: { low: 56.5, high: 59.5 },
    domain: [40, 60],
  },
};

const friends = [
  { name: "Northstar", champion: "Ahri", rate: 65, you: true },
  { name: "RiverQuartz", champion: "Syndra", rate: 61, you: false },
  { name: "MapleCarry", champion: "Orianna", rate: 56, you: false },
  {
    name: "A friend with a very long summoner name",
    champion: "Jinx",
    rate: 48,
    you: false,
  },
  { name: "Quill", champion: "Thresh", rate: 42, you: false },
];

export const FriendsRanking: Story = {
  parameters: { controls: { disable: true } },
  decorators: [
    (story) => <Panel style={{ maxWidth: "36rem" }}>{story()}</Panel>,
  ],
  render: () => (
    <ul
      style={{
        display: "grid",
        gap: "0.5rem",
        listStyle: "none",
        margin: 0,
        padding: 0,
      }}
    >
      {friends.map((friend) => (
        <li
          key={friend.name}
          style={{
            display: "grid",
            gridTemplateColumns: "46px minmax(0, 1fr) 7.5rem",
            alignItems: "center",
            gap: "0.875rem",
            padding: "0.4rem 0.75rem",
            borderRadius: "var(--scout-radius-pill)",
            background: friend.you ? "var(--scout-brand-soft)" : undefined,
          }}
        >
          <ChampionFace champion={friend.champion} alt="" />
          <b style={{ minWidth: 0 }}>
            <NameText>{friend.name}</NameText>
          </b>
          <WinRateBar value={friend.rate} you={friend.you} />
        </li>
      ))}
    </ul>
  ),
};
