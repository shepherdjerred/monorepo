import type { Meta, StoryObj } from "@storybook/react-vite";
import { DiscordUser } from "./discord-user.tsx";
import { ConsumerGuildAvatar } from "./consumer-guild-avatar.tsx";
import { ConceptCards } from "./concept-cards.tsx";
import { ClipboardError } from "./clipboard-error.tsx";

const GUILDS = [
  { name: "Scout Test Server", size: "large" as const },
  { name: "Weekly Flex", size: "compact" as const },
  { name: "aram night", size: "compact" as const },
];

const meta = {
  title: "Components/Identity",
  component: DiscordUser,
  tags: ["autodocs"],
} satisfies Meta<typeof DiscordUser>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ResolvedUser: Story = {
  args: {
    id: "193138290672074762",
    name: { username: "baldbard", displayName: "Bald Bard" },
  },
};

export const UnresolvedUser: Story = {
  args: { id: "462734967650320384" },
};

export const NoLinkedUser: Story = {
  args: { id: null },
};

export const GuildAvatars: Story = {
  args: { id: null },
  render: () => (
    <ul className="space-y-3">
      {GUILDS.map((guild) => (
        <li key={guild.name} className="flex items-center gap-3">
          <ConsumerGuildAvatar name={guild.name} size={guild.size} />
          <span className="text-sm">{guild.name}</span>
        </li>
      ))}
    </ul>
  ),
};

export const Concepts: Story = {
  args: { id: null },
  render: () => <ConceptCards />,
};

export const ClipboardFailure: Story = {
  args: { id: null },
  render: () => (
    <div className="space-y-3">
      <ClipboardError visible />
      <p className="text-sm text-scout-subtle">
        Hidden state renders nothing at all:
      </p>
      <ClipboardError visible={false} />
    </div>
  ),
};
