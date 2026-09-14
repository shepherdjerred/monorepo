import type { Meta, StoryObj } from "@storybook/react-vite";
import { ExploreMessageSchema, type ExploreMessage } from "@scout-for-lol/data";
import { storyConversation } from "#src/lib/storybook/story-fixtures.ts";
import type { StorySeed } from "#src/lib/storybook/trpc-stub.ts";
import { ExploreHeader } from "./explore-header.tsx";
import { ExploreComposer } from "./explore-composer.tsx";
import { Disclosure } from "./explore-disclosure.tsx";
import { ExploreNavigationSection } from "./explore-navigation-section.tsx";
import { ExploreVersionSwitcher } from "./explore-version-switcher.tsx";

/**
 * The frame around an Explore conversation: its title row, the ask box, the
 * collapsed-evidence primitive, the sidebar section wired to the conversation
 * list, and the turn-version arrows.
 */
const meta = {
  title: "Explore/Surfaces",
  component: ExploreHeader,
  tags: ["autodocs"],
} satisfies Meta<typeof ExploreHeader>;

export default meta;

type Story = StoryObj<typeof meta>;

function noop(): void {
  // Story callbacks: the catalog drives no navigation, mutation or stream.
}

const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";
const THIRD_ID = "33333333-3333-4333-8333-333333333333";

const seedConversations: StorySeed = (trpc, queryClient) => {
  queryClient.setQueryData(trpc.explore.list.queryOptions().queryKey, [
    storyConversation(FIRST_ID, "Ahri win rate by patch", 8),
    storyConversation(SECOND_ID, "Who has the most pentakills?", 26 * 60),
    storyConversation(THIRD_ID, "Jungle first-clear timings", 4 * 24 * 60),
  ]);
};

/** A question asked three times, so the arrows have somewhere to go. */
const EDITED_QUESTION: ExploreMessage = ExploreMessageSchema.parse({
  id: SECOND_ID,
  role: "user",
  parentId: null,
  siblingIds: [FIRST_ID, SECOND_ID, THIRD_ID],
  versionIndex: 1,
  versionCount: 3,
  content: "Which jungler has the best first-clear on Patch 16.17?",
  createdAt: "2026-08-14T12:00:00.000Z",
});

export const Header: Story = {
  args: {
    title: "Ahri win rate by patch",
    actions: {
      shared: false,
      sharing: false,
      revoking: false,
      onExport: noop,
      onShare: noop,
      onRevoke: noop,
    },
  },
};

export const HeaderShared: Story = {
  args: {
    title: "Who has the most pentakills?",
    actions: {
      shared: true,
      sharing: false,
      revoking: false,
      onExport: noop,
      onShare: noop,
      onRevoke: noop,
    },
  },
};

export const Composer: Story = {
  args: { title: "unused" },
  render: () => (
    <ExploreComposer
      active={false}
      restoredDraft={null}
      onAsk={noop}
      onStop={noop}
    />
  ),
};

/**
 * Mid-turn: the textarea is disabled and Ask has become Stop. The restored
 * draft is the question a previous failed turn handed back.
 */
export const ComposerStreaming: Story = {
  args: { title: "unused" },
  render: () => (
    <ExploreComposer
      active
      restoredDraft="Compare Lee Sin and Viego clear speed on Patch 16.17."
      onAsk={noop}
      onStop={noop}
    />
  ),
};

export const EvidenceDisclosure: Story = {
  args: { title: "unused" },
  render: () => (
    <Disclosure label="ScoutQL query & Steps (3)">
      <p className="rounded-md border border-scout-border bg-scout-surface p-3 text-xs text-scout-subtle">
        Collapsed by default so the evidence never competes with the answer.
      </p>
    </Disclosure>
  ),
};

export const VersionSwitcher: Story = {
  args: { title: "unused" },
  render: () => (
    <div className="flex justify-end">
      <ExploreVersionSwitcher
        message={EDITED_QUESTION}
        onSelectVersion={noop}
      />
    </div>
  ),
};

/** The sidebar section as the app mounts it, reading the conversation list. */
export const NavigationSection: Story = {
  args: { title: "unused" },
  parameters: {
    routerEntries: [`/explore/${FIRST_ID}`],
    seedQueries: [seedConversations],
  },
  render: () => (
    <div className="h-96 w-72">
      <ExploreNavigationSection activeId={FIRST_ID} />
    </div>
  ),
};
