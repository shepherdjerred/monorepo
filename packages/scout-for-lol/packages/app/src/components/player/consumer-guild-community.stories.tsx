import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlayerIdSchema } from "@scout-for-lol/data";
import { PeopleTab } from "./consumer-guild-community.tsx";

const meta = {
  title: "Player/Guild Community",
  component: PeopleTab,
  parameters: { layout: "padded" },
} satisfies Meta<typeof PeopleTab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Relationships: Story = {
  args: {
    overview: {
      players: [
        { id: PlayerIdSchema.parse(1), alias: "Alpha" },
        { id: PlayerIdSchema.parse(2), alias: "Beta" },
        { id: PlayerIdSchema.parse(3), alias: "Gamma" },
      ],
      insights: {
        recentlyPlayedWith: [
          {
            playerId: 1,
            key: "player:2",
            guildPlayerId: 2,
            name: "Beta",
            games: 14,
            wins: 9,
            lastMatchId: "NA1_123",
            lastMatchMs: 1_800_000_000_000,
          },
          {
            playerId: 1,
            key: "puuid:stranger",
            guildPlayerId: null,
            name: "Friendly#NA1",
            games: 4,
            wins: 3,
            lastMatchId: "NA1_122",
            lastMatchMs: 1_799_000_000_000,
          },
        ],
        rivalries: [
          {
            playerId: 1,
            key: "player:3",
            guildPlayerId: 3,
            name: "Gamma",
            games: 7,
            wins: 3,
            lastMatchId: "NA1_121",
            lastMatchMs: 1_798_000_000_000,
          },
          {
            playerId: 1,
            key: "puuid:rival",
            guildPlayerId: null,
            name: "Rival#NA1",
            games: 3,
            wins: 2,
            lastMatchId: "NA1_120",
            lastMatchMs: 1_797_000_000_000,
          },
        ],
        pairs: [
          {
            firstId: 1,
            secondId: 2,
            games: 14,
            wins: 9,
            lastMatchId: "NA1_123",
            lastMatchMs: 1_800_000_000_000,
          },
          {
            firstId: 2,
            secondId: 3,
            games: 5,
            wins: 2,
            lastMatchId: "NA1_119",
            lastMatchMs: 1_796_000_000_000,
          },
        ],
      },
    },
  },
};
