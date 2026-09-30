import type { Meta, StoryObj } from "@storybook/react-vite";
import { MatchMvpTally } from "./match-mvp-tally.tsx";

const meta = {
  title: "Match/MVP Tally",
  component: MatchMvpTally,
  tags: ["autodocs"],
} satisfies Meta<typeof MatchMvpTally>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Community: Story = {
  args: {
    tally: {
      showGuildNames: false,
      guilds: [
        {
          guildId: "1337623164146155593",
          guildName: "Scout Test Server",
          blue: [
            {
              displayName: "bald",
              championName: "Aatrox",
              voteCount: 3,
              reasons: [
                {
                  voterName: "Jungle Diff",
                  justification: "split the map in half",
                },
              ],
            },
          ],
          red: [
            {
              displayName: "Player9#NA1",
              championName: "Jinx",
              voteCount: 2,
              reasons: [],
            },
          ],
        },
      ],
    },
  },
};
