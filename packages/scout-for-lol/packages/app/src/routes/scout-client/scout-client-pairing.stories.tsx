import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScoutClientPairingCard } from "#src/routes/scout-client-pairing.tsx";

const pending = {
  deviceName: "windows Scout Client",
  platform: "windows",
  architecture: "x86_64",
  appVersion: "0.1.0",
  scopes: ["ingest"],
  upgrade: false,
  matchCode: null,
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

/** A `pairings/v2` request from Scout Desktop, asking for Explore too. */
export const DesktopExploreApproval: Story = {
  args: {
    pairing: {
      ...pending,
      deviceName: "Scout Desktop on DESKTOP-7Q2",
      appVersion: "0.4.0",
      scopes: ["ingest", "explore"],
      matchCode: "K7M-4QX",
    },
  },
};

/** An already paired Scout Desktop asking to add chat to its own device. */
export const ScopeUpgradeApproval: Story = {
  args: {
    pairing: {
      ...pending,
      deviceName: "Scout Desktop on DESKTOP-7Q2",
      appVersion: "0.4.0",
      scopes: ["explore"],
      upgrade: true,
      matchCode: "R4N-8WD",
    },
  },
};

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
