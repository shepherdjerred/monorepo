import type { Meta, StoryObj } from "@storybook/react-vite";
import { Panel } from "#src/components/surfaces/panel.tsx";
import {
  GameSentenceRow,
  type GameSentenceRowProps,
} from "./game-sentence-row.tsx";

const meta = {
  title: "Domain/GameSentenceRow",
  component: GameSentenceRow,
  tags: ["autodocs"],
  args: { result: "win", champion: "Ahri" },
  decorators: [
    (story) => <Panel style={{ maxWidth: "40rem" }}>{story()}</Panel>,
  ],
} satisfies Meta<typeof GameSentenceRow>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Win: Story = {
  args: {
    href: "#game",
    kda: { kills: 9, deaths: 2, assists: 11 },
    lpChange: 21,
    detail: "Ranked Solo",
    when: "2 hours ago",
  },
};

export const Loss: Story = {
  args: {
    result: "loss",
    champion: "Orianna",
    href: "#game",
    kda: { kills: 3, deaths: 6, assists: 8 },
    lpChange: -18,
    detail: "Ranked Solo",
    when: "Yesterday",
  },
};

export const WithHighlight: Story = {
  args: {
    champion: "Jinx",
    href: "#game",
    kda: { kills: 12, deaths: 3, assists: 8 },
    lpChange: 19,
    highlight: "Quadra kill",
    detail: "Ranked Solo",
    when: "Yesterday",
  },
};

export const FriendsGame: Story = {
  args: {
    champion: "Jinx",
    person: "RiverQuartz",
    suffix: "with you",
    kda: { kills: 10, deaths: 3, assists: 9 },
    href: "#game",
    when: "2 hours ago",
  },
};

export const LongNames: Story = {
  args: {
    champion: "Nunu",
    person: "A friend with a very long summoner name",
    result: "loss",
    kda: { kills: 1, deaths: 4, assists: 18 },
    href: "#game",
    when: "2 hours ago",
  },
};

export const NoDetails: Story = { args: { champion: "Garen" } };

const games: GameSentenceRowProps[] = [
  {
    result: "win",
    champion: "Ahri",
    kda: { kills: 9, deaths: 2, assists: 11 },
    lpChange: 21,
    detail: "Ranked Solo",
    when: "2 hours ago",
  },
  {
    result: "win",
    champion: "Syndra",
    kda: { kills: 11, deaths: 4, assists: 6 },
    lpChange: 22,
    detail: "Ranked Solo",
    when: "4 hours ago",
  },
  {
    result: "loss",
    champion: "Orianna",
    kda: { kills: 3, deaths: 6, assists: 8 },
    lpChange: -18,
    detail: "Ranked Solo",
    when: "Yesterday",
  },
  {
    result: "win",
    champion: "Jinx",
    kda: { kills: 12, deaths: 3, assists: 8 },
    lpChange: 19,
    highlight: "Quadra kill",
    detail: "Ranked Solo",
    when: "Yesterday",
  },
];

export const RecentGames: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <ul className="scout-row-list">
      {games.map((game) => (
        <li key={`${String(game.champion)}-${game.when ?? ""}`}>
          <GameSentenceRow {...game} href="#game" />
        </li>
      ))}
    </ul>
  ),
};

export const HomeFeed: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <ul className="scout-row-list">
      <li>
        <GameSentenceRow
          result="win"
          champion="Jinx"
          person="RiverQuartz"
          suffix="with you"
          kda={{ kills: 10, deaths: 3, assists: 9 }}
          when="2 hours ago"
          href="#game"
        />
      </li>
      <li>
        <GameSentenceRow
          result="loss"
          champion="Thresh"
          person="TidalWren"
          kda={{ kills: 1, deaths: 4, assists: 18 }}
          when="2 hours ago"
          href="#game"
        />
      </li>
      <li>
        <GameSentenceRow
          result="win"
          champion="Yasuo"
          person="Quillon"
          kda={{ kills: 14, deaths: 6, assists: 5 }}
          when="Yesterday"
          href="#game"
        />
      </li>
    </ul>
  ),
};
