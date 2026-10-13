import type { Meta, StoryObj } from "@storybook/react-vite";
import { OperationsQueuePanel } from "./operations-queue-panel.tsx";
import {
  operationsQueues,
  type OperationsQueuesData,
} from "#src/lib/operations/operations-queues.ts";

const DUEL_ID = "00000000-0000-4000-8000-000000000903";
const NOW = Date.parse("2026-09-14T12:00:00.000Z");
const NO_MORE = { hasMore: false, cursor: null } as const;

const data: OperationsQueuesData = {
  stalledMatchProcessing: [],
  stalledNotifications: [
    {
      intentKey: "duel-status:duel-invited:operations-904",
      duelId: DUEL_ID,
      state: "ready",
      freshnessDeadline: "2026-09-14T12:30:00.000Z",
      attemptCount: 0,
    },
    {
      intentKey: "dare-status:dare-902:recipient-1",
      dareId: 902,
      state: "ready",
      freshnessDeadline: "2026-09-14T12:30:00.000Z",
      attemptCount: 0,
    },
  ],
  unknownDeliveries: [
    {
      intentKey: "duel-status:duel-code-ready:operations-903",
      duelId: DUEL_ID,
      state: "unknown-delivery",
      attemptCount: 1,
      attemptNonce: "duel-run-903:attempt-1",
    },
    {
      intentKey: "dare-status:dare-902:recipient-2",
      dareId: 902,
      state: "unknown-delivery",
      attemptCount: 1,
      attemptNonce: "dare-run-902:attempt-1",
    },
  ],
  unprojectedMatches: [],
  liveRecoveryBatches: [],
  unacceptedWorkflowStarts: [],
  pages: {
    stalledMatchProcessing: NO_MORE,
    stalledNotifications: NO_MORE,
    unknownDeliveries: NO_MORE,
    unprojectedMatches: NO_MORE,
    liveRecoveryBatches: NO_MORE,
    unacceptedWorkflowStarts: NO_MORE,
  },
};

const subjectQueues = operationsQueues(data, NOW).filter(
  (queue) =>
    queue.id === "stalled-notifications" || queue.id === "unknown-deliveries",
);
const [firstQueue] = subjectQueues;
if (firstQueue === undefined) {
  throw new Error("Notification queue fixture is empty");
}

function noop(): void {
  // Stories do not execute operator actions.
}

const meta = {
  title: "Operations/NotificationQueues",
  component: OperationsQueuePanel,
  tags: ["autodocs"],
  args: {
    queue: firstQueue,
    onStart: noop,
    onInspect: noop,
    canStart: () => true,
    onLoadMore: noop,
    loadingMore: false,
    searchActive: false,
  },
} satisfies Meta<typeof OperationsQueuePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DuelAndDareSubjects: Story = {
  render: () => (
    <div className="space-y-6">
      {subjectQueues.map((queue) => (
        <OperationsQueuePanel
          key={queue.id}
          queue={queue}
          onStart={noop}
          onInspect={noop}
          canStart={() => true}
          onLoadMore={noop}
          loadingMore={false}
          searchActive={false}
        />
      ))}
    </div>
  ),
};

const announcementQueue = operationsQueues(
  {
    ...data,
    unknownDeliveries: [
      {
        intentKey: "product-announcement:competition-start-1",
        announcementId: "competition-start-1",
        state: "unknown-delivery",
        attemptCount: 1,
        attemptNonce: "announcement-run-1:attempt-1",
      },
    ],
  },
  NOW,
).find((queue) => queue.id === "unknown-deliveries");
if (announcementQueue === undefined) {
  throw new Error("Announcement queue fixture is empty");
}

export const ProductAnnouncements: Story = {
  args: { queue: announcementQueue },
};
