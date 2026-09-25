import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ReportAiPreviewSummarySchema,
  type ExploreConversation,
  type ReportAiPreviewSummary,
} from "@scout-for-lol/data";
import { storyConversation } from "#src/lib/storybook/story-fixtures.ts";
import { ExploreSidebar } from "./explore-sidebar.tsx";
import { ExploreShareRow } from "./explore-share.tsx";
import { ExploreArtifactDialog } from "./explore-artifact-dialog.tsx";

/**
 * The panels around a conversation: the list it is picked from, the share-link
 * row, and the dialog that gives a wide result more than chat width.
 */
const meta = {
  title: "Explore/Panels",
  component: ExploreSidebar,
  tags: ["autodocs"],
} satisfies Meta<typeof ExploreSidebar>;

export default meta;

type Story = StoryObj<typeof meta>;

const ACTIVE_ID = "11111111-1111-4111-8111-111111111111";

/** Five so the search box appears, spread across every recency bucket. */
const CONVERSATIONS: ExploreConversation[] = [
  storyConversation(ACTIVE_ID, "Ahri win rate by patch", 9),
  storyConversation(
    "22222222-2222-4222-8222-222222222222",
    "Who has the most pentakills?",
    3 * 60,
  ),
  storyConversation(
    "33333333-3333-4333-8333-333333333333",
    "Jungle first-clear timings",
    27 * 60,
  ),
  storyConversation(
    "44444444-4444-4444-8444-444444444444",
    "Baron steals by region",
    4 * 24 * 60,
  ),
  storyConversation(
    "55555555-5555-4555-8555-555555555555",
    "ARAM damage share leaders",
    40 * 24 * 60,
  ),
];

function noop(): void {
  // Story callbacks: the catalog has no navigation or mutations to drive.
}

const SIDEBAR_ARGS = {
  conversations: CONVERSATIONS,
  activeId: ACTIVE_ID,
  onSelect: noop,
  onNew: noop,
  onRename: noop,
  onDelete: noop,
  statusForConversation: () => null,
} satisfies Partial<React.ComponentProps<typeof ExploreSidebar>>;

const ARTIFACT_PREVIEW: ReportAiPreviewSummary =
  ReportAiPreviewSummarySchema.parse({
    columns: [
      { key: "label", label: "Player", format: "text" },
      { key: "games", label: "Games", format: "integer" },
      { key: "kda", label: "KDA", format: "decimal" },
      { key: "win_rate", label: "Win rate", format: "percent" },
    ],
    rows: [
      {
        label: "Hide on bush#KR1",
        games: 214,
        values: [
          { column: "games", value: 214 },
          { column: "kda", value: 4.12 },
          { column: "win_rate", value: 0.565 },
        ],
      },
      {
        label: "Chovy#KR2",
        games: 198,
        values: [
          { column: "games", value: 198 },
          { column: "kda", value: 5.03 },
          { column: "win_rate", value: 0.591 },
        ],
      },
    ],
    visualizationRows: [],
    rowsReturned: 2,
    rowsScanned: 412,
    renderKind: "TABLE",
  });

export const Sidebar: Story = {
  args: { ...SIDEBAR_ARGS },
};

/** The unread markers a background run leaves on a conversation row. */
export const SidebarWithRunStatuses: Story = {
  args: {
    ...SIDEBAR_ARGS,
    statusForConversation: (conversationId) => {
      if (conversationId === ACTIVE_ID) return "running";
      if (conversationId === "22222222-2222-4222-8222-222222222222") {
        return "completed";
      }
      return conversationId === "33333333-3333-4333-8333-333333333333"
        ? "failed"
        : null;
    },
  },
};

export const SidebarEmpty: Story = {
  args: { ...SIDEBAR_ARGS, conversations: [], activeId: null },
};

export const ShareLinkCopied: Story = {
  args: { ...SIDEBAR_ARGS },
  render: () => (
    <ExploreShareRow
      shareLink="https://scout-for-lol.com/app/explore/s/8f1c2b7a4d5e6f0918273645aabbccdd"
      copied
    />
  ),
};

/** Clipboard access refused, so the reader copies the link by hand. */
export const ShareLinkManualCopy: Story = {
  args: { ...SIDEBAR_ARGS },
  render: () => (
    <ExploreShareRow
      shareLink="https://scout-for-lol.com/app/explore/s/8f1c2b7a4d5e6f0918273645aabbccdd"
      copied={false}
    />
  ),
};

/**
 * Opened straight from the turn's action bar. Radix marks everything outside
 * the dialog `aria-hidden` while it is open, so the only thing beside it here
 * is static text.
 */
export const ArtifactDialogOpen: Story = {
  args: { ...SIDEBAR_ARGS },
  render: () => (
    <>
      <p className="text-sm text-scout-subtle">
        The transcript sits behind this dialog at chat width.
      </p>
      <ExploreArtifactDialog
        artifact={{
          title: "Query result",
          preview: ARTIFACT_PREVIEW,
          visualization: null,
        }}
        onClose={noop}
      />
    </>
  ),
};
