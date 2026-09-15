import type { Meta, StoryObj } from "@storybook/react-vite";
import { Separator } from "./separator.tsx";

const meta = {
  title: "Components/Separator",
  component: Separator,
  tags: ["autodocs"],
} satisfies Meta<typeof Separator>;

export default meta;

type Story = StoryObj<typeof meta>;

// A vertical separator is `height: 100%`, so it only has a size when its row
// gives it one. Every horizontal row below sets an explicit height for that
// reason.
const row = {
  display: "flex",
  alignItems: "center",
  gap: "0.75rem",
  height: "1.5rem",
} as const;

export const Horizontal: Story = {
  args: { orientation: "horizontal", style: { marginBlock: "0.75rem" } },
  render: (args) => (
    <div>
      <p style={{ margin: 0 }}>Ranked solo queue · Emerald II · 47 LP</p>
      <Separator {...args} />
      <p style={{ margin: 0 }}>Ranked flex · Platinum IV · 12 LP</p>
    </div>
  ),
};

export const Vertical: Story = {
  args: { orientation: "vertical" },
  parameters: { controls: { disable: true } },
  render: () => (
    <div style={row}>
      <span>NA1</span>
      <Separator orientation="vertical" />
      <span>Patch 15.4</span>
      <Separator orientation="vertical" />
      <span>32:14</span>
    </div>
  ),
};

export const Semantic: Story = {
  args: { decorative: false, style: { marginBlock: "0.75rem" } },
  render: (args) => (
    <div>
      <p style={{ margin: 0 }}>Match history synced 4 minutes ago.</p>
      <Separator {...args} />
      <p style={{ margin: 0 }}>
        Report subscriptions are evaluated after each game.
      </p>
    </div>
  ),
};

export const InSummary: Story = {
  args: { orientation: "horizontal" },
  parameters: { controls: { disable: true } },
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div>
        <h3 style={{ margin: 0 }}>Rift Wardens</h3>
        <p style={{ margin: 0 }}>Discord guild · 14 tracked summoners</p>
      </div>
      <Separator />
      <div style={row}>
        <span>128 reports</span>
        <Separator orientation="vertical" />
        <span>3 subscriptions</span>
        <Separator orientation="vertical" />
        <span>2 channels</span>
      </div>
    </div>
  ),
};
