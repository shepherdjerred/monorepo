import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChampionCard, type ChampionCardProps } from "./champion-card.tsx";

const meta = {
  title: "Domain/ChampionCard",
  component: ChampionCard,
  tags: ["autodocs"],
  args: {
    champion: "Jinx",
    href: "#jinx",
    lane: { label: "Bot", icon: "adc" },
    winRate: 52.9,
    games: 9840,
    laneWinRate: 53.8,
    laneGames: 1970,
    tier: "S tier",
  },
} satisfies Meta<typeof ChampionCard>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A single card at the width of one column of the index. */
const oneColumn: Story["render"] = (args) => (
  <div style={{ maxWidth: "13rem" }}>
    <ChampionCard {...args} />
  </div>
);

export const Default: Story = {
  render: oneColumn,
};

export const WithoutLane: Story = {
  render: oneColumn,
  args: { champion: "Ahri", winRate: 51.8, games: 12_480 },
};

export const LongName: Story = {
  render: oneColumn,
  args: {
    champion: "Nunu",
    lane: { label: "Jungle", icon: "jungle" },
    tier: "B tier",
  },
};

export const SmallSample: Story = {
  render: oneColumn,
  args: {
    champion: "Aatrox",
    winRate: 60,
    games: 5,
    laneWinRate: 100,
    laneGames: 1,
  },
};

const cards: ChampionCardProps[] = [
  {
    champion: "Jinx",
    href: "#a",
    lane: { label: "Bot", icon: "adc" },
    winRate: 52.9,
    games: 9840,
    laneWinRate: 53.8,
    laneGames: 1970,
    tier: "S tier",
  },
  {
    champion: "Thresh",
    href: "#b",
    lane: { label: "Support", icon: "support" },
    winRate: 52.4,
    games: 11_200,
    laneWinRate: 50.6,
    laneGames: 2240,
    tier: "S tier",
  },
  {
    champion: "Ahri",
    href: "#c",
    lane: { label: "Mid", icon: "middle" },
    winRate: 51.8,
    games: 12_480,
    laneWinRate: 52.4,
    laneGames: 2460,
    tier: "A tier",
  },
  {
    champion: "Nunu",
    href: "#d",
    lane: { label: "Jungle", icon: "jungle" },
    winRate: 50.2,
    games: 4120,
  },
  {
    champion: "Renata",
    href: "#e",
    lane: { label: "Support", icon: "support" },
    winRate: 49.1,
    games: 3870,
    laneWinRate: 48.7,
    laneGames: 770,
    tier: "C tier",
  },
  {
    champion: "Garen",
    href: "#f",
    lane: { label: "Top", icon: "top" },
    winRate: 50.9,
    games: 8120,
    tier: "B tier",
  },
];

export const Index: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <ul
      className="scout-row-list"
      style={{
        gridTemplateColumns: "repeat(auto-fill, minmax(10.5rem, 1fr))",
        gap: "1rem",
      }}
    >
      {cards.map((card) => (
        <li key={card.champion} style={{ display: "grid" }}>
          <ChampionCard {...card} />
        </li>
      ))}
    </ul>
  ),
};
