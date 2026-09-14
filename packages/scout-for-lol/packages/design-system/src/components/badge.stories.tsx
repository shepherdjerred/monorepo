import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./badge.tsx";

const meta = {
  title: "Components/Badge",
  component: Badge,
  tags: ["autodocs"],
} satisfies Meta<typeof Badge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { children: "Emerald II" } };

export const Secondary: Story = {
  args: { children: "Ranked Solo", variant: "secondary" },
};

export const Outline: Story = {
  args: { children: "Patch 15.4", variant: "outline" },
};

export const Destructive: Story = {
  args: { children: "Loss streak", variant: "destructive" },
};

export const AllVariants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "0.5rem",
      }}
    >
      <Badge>Challenger</Badge>
      <Badge variant="secondary">Flex queue</Badge>
      <Badge variant="outline">NA1</Badge>
      <Badge variant="destructive">Dodged</Badge>
    </div>
  ),
};

export const ChampionTags: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "0.5rem",
      }}
    >
      <Badge variant="secondary">Ahri</Badge>
      <Badge variant="secondary">Lee Sin</Badge>
      <Badge variant="secondary">Thresh</Badge>
      <Badge variant="secondary">Jinx</Badge>
      <Badge variant="outline">+8 more</Badge>
    </div>
  ),
};
