import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScoutClientPairingCard } from "#src/routes/scout-client-pairing.tsx";

const pending = {
  deviceName: "windows Scout Client",
  platform: "windows",
  architecture: "x86_64",
  appVersion: "0.1.0",
  state: "PENDING",
} as const;

const meta = {
  title: "Routes/Scout Client Pairing",
  component: ScoutClientPairingCard,
  tags: ["autodocs"],
  parameters: { router: "none" },
  args: {
    pairing: pending,
    approvalState: "idle",
    onApprove: () => {
      // The static pairing stories do not call the approval mutation.
    },
  },
} satisfies Meta<typeof ScoutClientPairingCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Approval: Story = {};

export const Approving: Story = {
  args: { approvalState: "pending" },
};

export const Approved: Story = {
  args: { pairing: { ...pending, state: "APPROVED" } },
};

export const Expired: Story = {
  args: { pairing: { ...pending, state: "EXPIRED" } },
};

export const ApprovalFailed: Story = {
  args: { approvalState: "error" },
};
