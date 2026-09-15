import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusBadge } from "./status-badge.tsx";

const meta = {
  title: "Domain/StatusBadge",
  component: StatusBadge,
  tags: ["autodocs"],
} satisfies Meta<typeof StatusBadge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Success: Story = {
  args: { status: "success", children: "Win" },
};

export const Warning: Story = {
  args: { status: "warning", children: "Ingest delayed" },
};

export const Danger: Story = {
  args: { status: "danger", children: "Loss" },
};

export const Info: Story = {
  args: { status: "info", children: "Ranked Solo/Duo" },
};

export const Neutral: Story = {
  args: { status: "neutral", children: "Remake" },
};

export const SubscriptionStates: Story = {
  args: { status: "info", children: "Subscription states" },
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="scout-cluster">
      <StatusBadge status="success">Active</StatusBadge>
      <StatusBadge status="warning">Paused</StatusBadge>
      <StatusBadge status="danger">Riot account unlinked</StatusBadge>
      <StatusBadge status="info">Ranked Flex only</StatusBadge>
      <StatusBadge status="neutral">Draft</StatusBadge>
    </div>
  ),
};

export const MatchOutcomes: Story = {
  args: { status: "success", children: "Match outcomes" },
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="scout-cluster">
      <StatusBadge status="success">Win · +21 LP</StatusBadge>
      <StatusBadge status="danger">Loss · -17 LP</StatusBadge>
      <StatusBadge status="neutral">Remake · 0 LP</StatusBadge>
      <StatusBadge status="info">Promoted to Emerald II</StatusBadge>
    </div>
  ),
};
