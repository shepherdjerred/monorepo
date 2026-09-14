import type { Meta, StoryObj } from "@storybook/react-vite";
import { resolveGameAssetUrl } from "#src/assets/index.tsx";
import { DiscordIdentity } from "./discord-identity.tsx";

const meta = {
  title: "Domain/DiscordIdentity",
  component: DiscordIdentity,
  tags: ["autodocs"],
} satisfies Meta<typeof DiscordIdentity>;

export default meta;

type Story = StoryObj<typeof meta>;

const avatar = (champion: string): string =>
  resolveGameAssetUrl("champion", champion);

export const Default: Story = {
  args: {
    displayName: "beardedlyfe",
    detail: "Bearded Lyfe #NA1 · Emerald II",
  },
};

export const WithAvatar: Story = {
  args: {
    displayName: "Scout",
    avatarUrl: avatar("Ahri"),
    detail: "Application · Bearded Lyfe guild",
  },
};

export const NameOnly: Story = {
  args: { displayName: "unlinked_member" },
};

export const UnlinkedAccount: Story = {
  args: {
    displayName: "kaisa.enjoyer",
    detail: "No League account linked yet",
  },
};

export const GuildRoster: Story = {
  args: { displayName: "roster" },
  render: () => (
    <div className="scout-stack">
      <DiscordIdentity
        displayName="beardedlyfe"
        avatarUrl={avatar("Garen")}
        detail="Bearded Lyfe #NA1 · Emerald II · 42 LP"
      />
      <DiscordIdentity
        displayName="midordiff"
        avatarUrl={avatar("Syndra")}
        detail="Mid Or Diff #NA1 · Diamond IV · 8 LP"
      />
      <DiscordIdentity
        displayName="smitecheck"
        avatarUrl={avatar("Leesin")}
        detail="Smite Check #EUW · Platinum I · 77 LP"
      />
      <DiscordIdentity
        displayName="wardsarefree"
        detail="Invited — link pending"
      />
    </div>
  ),
};
