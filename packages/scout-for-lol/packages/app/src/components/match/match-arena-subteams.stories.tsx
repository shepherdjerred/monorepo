import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArenaSubteams } from "./match-arena-subteams.tsx";

const meta = {
  title: "Match/Arena Subteams",
  component: ArenaSubteams,
  tags: ["autodocs"],
} satisfies Meta<typeof ArenaSubteams>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Placements: Story = {
  args: {
    subteams: [
      {
        subteamId: 1,
        participants: [
          {
            participantId: 1,
            placement: 2,
            championName: "Ahri",
            riotId: { gameName: "Nine Tails", tagLine: "NA1" },
            selectedPlayer: true,
            kills: 8,
            deaths: 5,
            assists: 12,
            augments: [
              { id: 4001, name: "Giant Slayer" },
              { id: 4002, name: "Jeweled Gauntlet" },
            ],
            scoutAliases: [
              { playerId: 42, alias: "bald", guildName: "Scout Test Server" },
            ],
          },
          {
            participantId: 2,
            placement: 2,
            championName: "LeeSin",
            riotId: { gameName: "Jungle Diff", tagLine: "NA1" },
            selectedPlayer: false,
            kills: 5,
            deaths: 6,
            assists: 17,
            augments: [{ id: 4003, name: "Bread And Butter" }],
          },
        ],
      },
      {
        subteamId: 2,
        participants: [
          {
            participantId: 3,
            placement: 5,
            championName: "Jinx",
            riotId: { gameName: "Powder", tagLine: "NA1" },
            selectedPlayer: false,
            kills: 7,
            deaths: 8,
            assists: 6,
            augments: [{ id: 4004, name: "Scoped Weapons" }],
          },
          {
            participantId: 4,
            placement: 5,
            championName: "Thresh",
            riotId: { gameName: "Chain Warden", tagLine: "NA1" },
            selectedPlayer: false,
            kills: 1,
            deaths: 9,
            assists: 19,
            augments: [],
          },
        ],
      },
    ],
  },
};
