import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ALL_PERMISSIONS,
  ExploreMentionCandidateSchema,
  ExploreMessageSchema,
  ExploreTraceEntrySchema,
  type ExploreMentionCandidate,
  type ExploreMessage,
  type ExploreTraceEntry,
  type ReportAiPreviewSummary,
} from "@scout-for-lol/data";
import {
  championWinRatePreview,
  championWinRateRow,
} from "#src/lib/storybook/story-fixtures.ts";
import type { StorySeed } from "#src/lib/storybook/trpc-stub.ts";
import type { ExploreTranscriptActions } from "./explore-transcript-actions.ts";
import { ExploreTranscript } from "./explore-transcript.tsx";
import { AssistantTurn } from "./explore-assistant-turn.tsx";
import { ExploreSuggestionChips } from "./explore-suggestion-chips.tsx";
import { ExploreMentionPicker } from "./explore-mention-picker.tsx";

/**
 * One path through a conversation: the persisted turns, the turn currently
 * streaming, the empty-state suggestions, and the `@` mention list the
 * composer opens over itself.
 */
const meta = {
  title: "Explore/Transcript",
  component: ExploreTranscript,
  tags: ["autodocs"],
} satisfies Meta<typeof ExploreTranscript>;

export default meta;

type Story = StoryObj<typeof meta>;

function noop(): void {
  // Story callbacks: the catalog drives no navigation, mutation or stream.
}

const QUESTION_ID = "33333333-3333-4333-8333-333333333333";
const ANSWER_ID = "44444444-4444-4444-8444-444444444444";
const FOLLOW_UP_ID = "55555555-5555-4555-8555-555555555555";

const PREVIEW: ReportAiPreviewSummary = championWinRatePreview({
  rows: [
    championWinRateRow("Ahri", 412, 0.537),
    championWinRateRow("Lee Sin", 388, 0.481),
  ],
  rowsScanned: 800,
  renderKind: "TABLE",
});

const TRACE: ExploreTraceEntry[] = [
  ExploreTraceEntrySchema.parse({
    toolCallId: "call-validate-1",
    toolName: "validate_query",
    message: "Checked the query before running it.",
    status: "succeeded",
    durationMs: 96,
    details: {
      kind: "validation",
      queryText:
        "SELECT champion, win_rate() FROM matches WHERE queue = 'RANKED_SOLO' GROUP BY champion",
      ok: true,
      diagnostics: [],
      formattedQueryText: null,
    },
    rawInput: null,
    rawOutput: null,
  }),
  ExploreTraceEntrySchema.parse({
    toolCallId: "call-execute-1",
    toolName: "run_query",
    message: "Got results.",
    status: "succeeded",
    durationMs: 2140,
    details: {
      kind: "execution",
      queryText:
        "SELECT champion, win_rate() FROM matches WHERE queue = 'RANKED_SOLO' GROUP BY champion",
      ok: true,
      rowsReturned: 2,
      rowsScanned: 800,
      renderKind: "TABLE",
    },
    rawInput: null,
    rawOutput: null,
  }),
];

const QUESTION: ExploreMessage = ExploreMessageSchema.parse({
  id: QUESTION_ID,
  role: "user",
  parentId: null,
  content: "Which mid-laners have the best Ranked Solo/Duo win rate right now?",
  createdAt: "2026-08-14T12:00:00.000Z",
});

const ANSWER: ExploreMessage = ExploreMessageSchema.parse({
  id: ANSWER_ID,
  role: "assistant",
  parentId: QUESTION_ID,
  content:
    "**Ahri** leads at 53.7% over 412 games, with **Lee Sin** trailing at 48.1% over 388.",
  queryText:
    "SELECT champion, win_rate() FROM matches WHERE queue = 'RANKED_SOLO' GROUP BY champion",
  caveats: ["Only matches Scout has ingested for Patch 16.17 are counted."],
  followUps: [
    "Break that down by rank",
    "How does Ahri do into Yasuo?",
    "Same question for Patch 16.16",
  ],
  preview: PREVIEW,
  trace: TRACE,
  createdAt: "2026-08-14T12:00:30.000Z",
});

const STRANDED_QUESTION: ExploreMessage = ExploreMessageSchema.parse({
  id: FOLLOW_UP_ID,
  role: "user",
  parentId: ANSWER_ID,
  content: "Now compare that to Patch 16.16.",
  createdAt: "2026-08-14T12:01:10.000Z",
});

const ACTIONS: ExploreTranscriptActions = {
  onFollowUp: noop,
  onEdit: noop,
  onRegenerate: noop,
  onSelectVersion: noop,
  onRetry: noop,
};

const MENTION_CANDIDATES: ExploreMentionCandidate[] = [
  {
    kind: "player",
    label: "Hide on bush#KR1",
    insertText: "Hide on bush#KR1",
    detail: "1,204 games",
  },
  {
    kind: "player",
    label: "Chovy#KR2",
    insertText: "Chovy#KR2",
    detail: "988 games",
  },
  { kind: "champion", label: "Ahri", insertText: "Ahri", detail: null },
  {
    kind: "queue",
    label: "Ranked Solo/Duo",
    insertText: "Ranked Solo",
    detail: null,
  },
].map((candidate) => ExploreMentionCandidateSchema.parse(candidate));

const seedSuggestionContext: StorySeed = (trpc, queryClient) => {
  queryClient.setQueryData(trpc.bucks.status.queryOptions().queryKey, {
    state: "available",
    guilds: [
      {
        id: "1337623164146155593",
        name: "Summoner's Lounge",
        daresAvailable: true,
      },
    ],
  });
  queryClient.setQueryData(trpc.challenge.status.queryOptions().queryKey, {
    enabled: true,
  });
  queryClient.setQueryData(trpc.mvpVotes.status.queryOptions().queryKey, {
    state: "available",
    guilds: [
      {
        id: "1337623164146155593",
        name: "Summoner's Lounge",
        icon: null,
      },
    ],
  });
  queryClient.setQueryData(trpc.guild.listManageable.queryOptions().queryKey, [
    {
      id: "1337623164146155593",
      name: "Summoner's Lounge",
      icon: null,
      isOwner: true,
      isDiscordAdmin: true,
      customNightsEnabled: true,
      hallOfFameEnabled: true,
      mvpVotesEnabled: true,
      permissions: [...ALL_PERMISSIONS],
    },
  ]);
};

export const AnsweredTurn: Story = {
  args: {
    messages: [QUESTION, ANSWER],
    showRawTrace: true,
    actions: ACTIONS,
  },
};

/** Mid-turn: the question is optimistic, prose is arriving, steps are live. */
export const Streaming: Story = {
  args: {
    messages: [QUESTION, ANSWER],
    pendingQuestion: "Now compare that to Patch 16.16.",
    pendingAnswer: "On Patch 16.16 Ahri sat at **52.9%**",
    activity: "Scanning ingested matches…",
    pendingTrace: TRACE,
    turnActive: true,
    showRawTrace: true,
    actions: ACTIONS,
  },
};

/** A question whose turn was abandoned before it said anything. */
export const InterruptedQuestion: Story = {
  args: {
    messages: [QUESTION, ANSWER, STRANDED_QUESTION],
    turnActive: false,
    actions: ACTIONS,
  },
};

export const AssistantTurnAlone: Story = {
  args: { messages: [] },
  render: () => (
    <AssistantTurn
      message={ANSWER}
      actions={ACTIONS}
      showRawTrace
      showFollowUps
    />
  ),
};

/** The empty conversation's prompt starters, with every feature gate open. */
export const SuggestionChips: Story = {
  args: { messages: [] },
  parameters: { seedQueries: [seedSuggestionContext] },
  render: () => <ExploreSuggestionChips onSelect={noop} />,
};

export const MentionPicker: Story = {
  args: { messages: [] },
  render: () => (
    <div className="relative mt-72 w-96">
      <ExploreMentionPicker
        id="story-mention-list"
        candidates={MENTION_CANDIDATES}
        activeIndex={0}
        loading={false}
        optionId={(index) => `story-mention-option-${String(index)}`}
        onSelect={noop}
      />
    </div>
  ),
};
