import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ReportRunIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { ReportDeliveriesPanel } from "./report-deliveries-panel.tsx";

const meta = {
  title: "Operations/Report deliveries",
  component: ReportDeliveriesPanel,
  args: {
    pending: false,
    error: null,
    canStart: true,
    onStart: () => {
      /* Stories never execute operator actions. */
    },
  },
} satisfies Meta<typeof ReportDeliveriesPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const UnknownDelivery: Story = {
  args: {
    chunks: [
      {
        reportRunId: ReportRunIdSchema.parse(42),
        channelId: DiscordChannelIdSchema.parse("100000000000000001"),
        serverId: DiscordGuildIdSchema.parse("100000000000000002"),
        chunkIndex: 0,
        content:
          "Ranked activity this week\n1. Ashe — 12 games\n2. Lux — 9 games",
        nonce: "1234567890abcdef12345678",
        state: "UNKNOWN",
        messageId: null,
        attachmentKey: null,
        attachmentName: null,
        attachmentDigest: null,
        sendStartedAt: "2026-10-01T00:00:00.000Z",
        deliveredAt: null,
        lastError:
          "Response lost after the request reached Discord. Check the channel before answering.",
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      },
    ],
  },
};
export const Empty: Story = { args: { chunks: [] } };
