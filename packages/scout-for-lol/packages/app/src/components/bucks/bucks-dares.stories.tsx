import type { Meta, StoryObj } from "@storybook/react-vite";
import { Loaded } from "@shepherdjerred/loaded";
import {
  DarePollHealthSchema,
  DareProgressSchema,
  type DareDeadlineSpecV2,
} from "@scout-for-lol/data";
import { BucksDareActions } from "./bucks-dare-actions.tsx";
import {
  DareFact,
  DareStatePill,
  isNonterminalDareState,
} from "./bucks-dare-display.tsx";
import { BucksDareEditor } from "./bucks-dare-editor.tsx";
import {
  DareEditorReview,
  type ValidatedDareDraft,
} from "./bucks-dare-editor-review.tsx";
import {
  DareActivationHealthPanel,
  DareProcessingHealthPanel,
  DareProgressPanel,
} from "./bucks-dare-progress.tsx";
import { DareList, type DareSummary } from "./dare-list.tsx";

const noop = () => {
  // Stories never mutate a Dare.
};

const GUILD_ID = "1084396924348997663";

const CLIMB_PROGRESS = DareProgressSchema.parse({
  value: null,
  final: false,
  finalityReason: "deadline_not_reached",
  matchedGames: 6,
  eligibleGames: 9,
  evidenceGames: 9,
  conditions: [
    {
      key: "solo_wins",
      kind: "countable",
      label: "Ranked Solo/Duo wins on Ahri",
      targetKeys: ["jerred"],
      gameSet: "ranked_solo_games",
      operator: ">=",
      current: 6,
      target: 10,
      remaining: 4,
      matchedGames: 6,
      eligibleGames: 9,
      unknownGames: 0,
      value: null,
    },
    {
      key: "peak_rank",
      kind: "rank",
      label: "Peak Ranked Solo/Duo rank",
      targetKeys: ["jerred"],
      gameSet: null,
      operator: ">=",
      current: "Gold II",
      target: "Platinum IV",
      remaining: null,
      matchedGames: 9,
      eligibleGames: 9,
      unknownGames: 0,
      value: null,
    },
  ],
  targets: [
    {
      targetKey: "jerred",
      conditionKeys: ["solo_wins", "peak_rank"],
      matchedGames: 6,
      eligibleGames: 9,
      value: null,
    },
  ],
  coverageGaps: [
    {
      matchId: "NA1_5021840022",
      gameEndAt: "2026-09-11T02:41:00.000Z",
      sourceReferences: ["s3://scout-matches/NA1_5021840022.json"],
      targetKeys: ["jerred"],
      reason: "Timeline payload is still pending from Riot.",
    },
  ],
  latestMaterialChange: {
    kind: "advance",
    matchId: "NA1_5021846713",
    occurredAt: "2026-09-12T22:14:00.000Z",
    summary: "jerred won a Ranked Solo/Duo game on Ahri.",
    conditionKeys: ["solo_wins"],
  },
  summary: "6 of 10 Ranked Solo/Duo wins on Ahri, peak rank Gold II.",
});

const SETTLED_PROGRESS = DareProgressSchema.parse({
  value: true,
  final: true,
  finalityReason: "conditions_met",
  matchedGames: 10,
  eligibleGames: 10,
  evidenceGames: 10,
  conditions: [
    {
      key: "flex_games",
      kind: "countable",
      label: "Ranked Flex games with bryan",
      targetKeys: ["bryan"],
      gameSet: "ranked_flex_games",
      operator: ">=",
      current: 10,
      target: 10,
      remaining: 0,
      matchedGames: 10,
      eligibleGames: 10,
      unknownGames: 0,
      value: true,
    },
  ],
  targets: [
    {
      targetKey: "bryan",
      conditionKeys: ["flex_games"],
      matchedGames: 10,
      eligibleGames: 10,
      value: true,
    },
  ],
  coverageGaps: [],
  latestMaterialChange: null,
  summary: "10 of 10 Ranked Flex games played.",
});

const DARES: readonly DareSummary[] = [
  {
    id: 91,
    state: "active",
    originalText:
      "jerred has to hit Platinum on Ahri in Ranked Solo/Duo before the split ends. Opening stake: 500 BB.",
    displayTitle: null,
    statusPhrases: { ranked_solo_games: "Ranked Solo/Duo wins on Ahri" },
    targetAliases: ["jerred"],
    potTotal: 1500,
    updatedAt: "2026-09-12T22:14:00.000Z",
    progress: CLIMB_PROGRESS,
    requiresViewerAction: false,
  },
  {
    id: 88,
    state: "pending_accept",
    originalText: "bryan plays 10 Ranked Flex games with the group this week.",
    displayTitle: "Ten Flex games with the group",
    statusPhrases: null,
    targetAliases: ["bryan"],
    potTotal: 750,
    updatedAt: "2026-09-11T18:02:00.000Z",
    progress: SETTLED_PROGRESS,
    requiresViewerAction: true,
  },
];

const POLL_HEALTH = DarePollHealthSchema.parse({
  status: "incomplete",
  pollStartedAt: "2026-09-13T17:55:00.000Z",
  pollCompletedAt: "2026-09-13T17:55:12.000Z",
  evidenceWatermarkAt: "2026-09-13T17:40:00.000Z",
  lastSuccessfulProcessingAt: "2026-09-13T17:55:12.000Z",
  failureReason: null,
  incompleteReasons: [
    "NA1_5021840022 is missing its match timeline; Riot has not published it yet.",
  ],
});

const DEADLINE_SPEC: DareDeadlineSpecV2 = { kind: "relative", days: 30 };

const VALIDATED_DRAFT: ValidatedDareDraft = {
  canonicalScoutQl:
    "SELECT count(*) FROM ranked_solo_games WHERE player = 'jerred' AND champion = 'Ahri' AND win",
  plainLanguage:
    "jerred must win 10 Ranked Solo/Duo games on Ahri before the deadline.",
  semanticProofPlan:
    "Counts winning Ranked Solo/Duo games where jerred played Ahri, over the contract window.",
  scoutQlPlanHash: "b7c41f92ad3e5c08117ee2c4",
  scoutQlFacts: {
    cteCount: 2,
    joinedRelations: 3,
    predicates: 4,
    maxExpressionDepth: 3,
    physicalSources: ["matches", "match_participants"],
    functions: ["count"],
    targetKeys: ["jerred"],
  },
};

const meta = {
  title: "Bucks/Dares",
  component: DareList,
  tags: ["autodocs"],
} satisfies Meta<typeof DareList>;

export default meta;

type Story = StoryObj<typeof meta>;

export const List: Story = {
  args: { dares: Loaded.done(DARES), onRetry: noop, onSelect: noop },
};

export const ListEmpty: Story = {
  args: { dares: Loaded.done([]), onRetry: noop, onSelect: noop },
};

export const ListFailed: Story = {
  args: {
    dares: Loaded.failed(new Error("Scout couldn't reach the Dare service.")),
    onRetry: noop,
    onSelect: noop,
  },
};

export const StateSummary: Story = {
  args: { dares: Loaded.done(DARES), onRetry: noop, onSelect: noop },
  render: () => (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {["draft", "pending_accept", "active", "settled", "cancelled"].map(
          (state) => (
            <DareStatePill key={state} state={state} />
          ),
        )}
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        <DareFact label="Target" value="jerred" />
        <DareFact label="Pot" value="1,500 BB" />
        <DareFact
          label="Still open"
          value={isNonterminalDareState("active") ? "Yes" : "No"}
        />
      </dl>
    </div>
  ),
};

export const Progress: Story = {
  args: { dares: Loaded.done(DARES), onRetry: noop, onSelect: noop },
  render: () => (
    <div className="space-y-4">
      <DareProgressPanel progress={CLIMB_PROGRESS} />
      <DareProcessingHealthPanel health={POLL_HEALTH} />
      <DareActivationHealthPanel
        health={{
          status: "retrying",
          requestedAt: "2026-09-13T17:30:00.000Z",
          attemptCount: 3,
          lastAttemptAt: "2026-09-13T17:50:00.000Z",
          nextAttemptAt: "2026-09-13T18:10:00.000Z",
          errorCode: "incomplete_source_coverage",
          completedAt: null,
        }}
      />
    </div>
  ),
};

export const Actions: Story = {
  args: { dares: Loaded.done(DARES), onRetry: noop, onSelect: noop },
  render: () => (
    <BucksDareActions
      guildId={GUILD_ID}
      dareId={91}
      revision={4}
      availableActions={["accept", "decline", "contribute", "cancel"]}
    />
  ),
};

export const EditorReviewDiff: Story = {
  args: { dares: Loaded.done(DARES), onRetry: noop, onSelect: noop },
  render: () => (
    <DareEditorReview
      validated={VALIDATED_DRAFT}
      reviewing={true}
      sqlV3={true}
      currentRevision={4}
      previous={{
        plainLanguage:
          "jerred must win 8 Ranked Solo/Duo games on Ahri before the deadline.",
        originalText: "jerred has to hit Platinum on Ahri this split.",
        deadlineSpec: DEADLINE_SPEC,
        openingStake: 500,
      }}
      next={{
        originalText:
          "jerred has to hit Platinum on Ahri in Ranked Solo/Duo before the split ends.",
        deadlineText: JSON.stringify(DEADLINE_SPEC, null, 2),
        stakeText: "750",
      }}
    />
  ),
};

export const AdvancedEditorTrigger: Story = {
  args: { dares: Loaded.done(DARES), onRetry: noop, onSelect: noop },
  render: () => (
    <BucksDareEditor
      guildId={GUILD_ID}
      dare={{
        id: 91,
        currentRevision: 4,
        originalText: "jerred has to hit Platinum on Ahri this split.",
        deadlineSpec: DEADLINE_SPEC,
        openingStake: 500,
        canonicalScoutQl: VALIDATED_DRAFT.canonicalScoutQl,
        plainLanguage: VALIDATED_DRAFT.plainLanguage,
        compilerVersion: "dare-scoutql-3",
      }}
    />
  ),
};
