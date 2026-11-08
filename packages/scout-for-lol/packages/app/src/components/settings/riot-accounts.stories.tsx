import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { LeaguePuuidSchema } from "@scout-for-lol/data";
import { RiotAccountsSettings } from "./riot-accounts.tsx";

const account = {
  puuid: LeaguePuuidSchema.parse("Q".repeat(78)),
  gameName: "Northstar",
  tagLine: "NA1",
  verifiedAt: "2026-11-07T12:00:00.000Z",
  matchNotificationsEnabled: true,
};
const meta = {
  title: "Settings/League accounts",
  component: RiotAccountsSettings,
  args: {
    data: {
      accounts: [account],
      linkingEnabled: true,
      linkingConfigured: true,
    },
    linking: false,
    savingPuuid: null,
    notice: null,
    error: null,
    onLink: fn(),
    onSetEnabled: fn(),
  },
} satisfies Meta<typeof RiotAccountsSettings>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Verified: Story = {};
export const NotificationsOff: Story = {
  args: {
    data: {
      ...meta.args.data,
      accounts: [{ ...account, matchNotificationsEnabled: false }],
    },
  },
};
export const Empty: Story = {
  args: { data: { ...meta.args.data, accounts: [] } },
};
export const NotConfigured: Story = {
  args: {
    data: {
      ...meta.args.data,
      linkingEnabled: false,
      linkingConfigured: false,
    },
  },
};
export const Conflict: Story = {
  args: {
    error:
      "This Riot account is linked to another Discord login. Contact support to resolve the existing link.",
  },
};
