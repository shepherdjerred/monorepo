import type { Meta, StoryObj } from "@storybook/react-vite";
import { Panel } from "#src/components/surfaces/panel.tsx";
import { FriendRow, type FriendRowProps } from "./friend-row.tsx";

const meta = {
  title: "Domain/FriendRow",
  component: FriendRow,
  tags: ["autodocs"],
  args: { name: "RiverQuartz" },
  decorators: [
    (story) => <Panel style={{ maxWidth: "40rem" }}>{story()}</Panel>,
  ],
} satisfies Meta<typeof FriendRow>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    href: "#river",
    latest: "Lost as Thresh, 2 hours ago",
    rank: { rank: "Platinum", division: "I", leaguePoints: 80 },
  },
};

export const Live: Story = {
  args: {
    href: "#river",
    live: true,
    latest: "as Ahri",
    rank: { rank: "Emerald", division: "I", leaguePoints: 22 },
  },
};

export const You: Story = {
  args: {
    name: "Northstar",
    you: true,
    href: "#north",
    latest: "Won as Ahri, 2 hours ago",
    rank: { rank: "Emerald", division: "II", leaguePoints: 64 },
  },
};

export const Unranked: Story = {
  args: { latest: "Won as Garen, 2 days ago" },
};

export const NoGamesYet: Story = {
  args: { rank: { rank: "Gold", division: "I" } },
};

export const LongName: Story = {
  args: {
    name: "A friend with a very long summoner name that keeps going",
    href: "#long",
    latest: "Won as Nunu & Willump, yesterday",
    rank: { rank: "Platinum", division: "III", leaguePoints: 12 },
  },
};

const friends: FriendRowProps[] = [
  {
    name: "RiverQuartz",
    live: true,
    latest: "as Ahri",
    rank: { rank: "Emerald", division: "I", leaguePoints: 22 },
  },
  {
    name: "Northstar",
    you: true,
    latest: "Won as Syndra, 2 hours ago",
    rank: { rank: "Emerald", division: "II", leaguePoints: 64 },
  },
  {
    name: "TidalWren",
    latest: "Lost as Thresh, 2 hours ago",
    rank: { rank: "Platinum", division: "I", leaguePoints: 80 },
  },
  {
    name: "Oakheart",
    latest: "Won as Darius, 5 hours ago",
    rank: { rank: "Platinum", division: "II", leaguePoints: 45 },
  },
  { name: "Marrow", latest: "Won as Garen, 2 days ago" },
];

export const Players: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <ul className="scout-row-list">
      {friends.map((friend) => (
        <li key={friend.name}>
          <FriendRow {...friend} href={`#${friend.name}`} />
        </li>
      ))}
    </ul>
  ),
};

export const Ladder: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <ul className="scout-row-list">
      {friends.map((friend, index) => (
        <li key={friend.name}>
          <FriendRow
            name={friend.name}
            place={index + 1}
            href={`#${friend.name}`}
            {...(friend.you === true ? { you: true } : {})}
            {...(friend.rank === undefined ? {} : { rank: friend.rank })}
          />
        </li>
      ))}
    </ul>
  ),
};
