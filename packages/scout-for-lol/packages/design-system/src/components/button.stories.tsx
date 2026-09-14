import type { Meta, StoryObj } from "@storybook/react-vite";
import { Info } from "lucide-react";
import { Button, IconButton } from "./button.tsx";

const meta = {
  title: "Components/Button",
  component: Button,
  tags: ["autodocs"],
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { children: "Primary action" } };

export const Secondary: Story = {
  args: { children: "Secondary action", variant: "secondary" },
};

export const Outline: Story = {
  args: { children: "Outline action", variant: "outline" },
};

export const Ghost: Story = {
  args: { children: "Ghost action", variant: "ghost" },
};

export const Link: Story = {
  args: { children: "Link action", variant: "link" },
};

export const Destructive: Story = {
  args: { children: "Delete report", variant: "destructive" },
};

export const Sizes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
      <Button size="sm">Small</Button>
      <Button>Default</Button>
      <Button size="lg">Large</Button>
    </div>
  ),
};

export const Disabled: Story = {
  args: { children: "Disabled", disabled: true },
};

export const Icon: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <IconButton label="Show details">
      <Info />
    </IconButton>
  ),
};
