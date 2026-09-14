import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ExploreMatchCardSchema,
  ExploreTraceEntrySchema,
  ReportAiPreviewSummarySchema,
  type ExploreMatchCard,
  type ExploreTraceEntry,
  type ReportAiPreviewSummary,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";
import {
  championWinRatePreview,
  championWinRateRow,
  winRateByPatchChart,
} from "#src/lib/storybook/story-fixtures.ts";
import { SingleRowResult } from "./explore-result.tsx";
import { ExploreMatchCards } from "./explore-match-cards.tsx";
import { ExploreVisualResult } from "./explore-visual-result.tsx";
import { ExploreToolTrace } from "./explore-tool-trace.tsx";

/**
 * What an answered turn attaches to its prose: the result as figures, as a
 * table or chart, the match cards the agent chose to surface, and the tool
 * trace that shows how it got there.
 */
const meta = {
  title: "Explore/Results",
  component: ExploreVisualResult,
  tags: ["autodocs"],
} satisfies Meta<typeof ExploreVisualResult>;

export default meta;

type Story = StoryObj<typeof meta>;

const GROUPED_PREVIEW: ReportAiPreviewSummary = championWinRatePreview({
  rows: [
    championWinRateRow("Ahri", 412, 0.537),
    championWinRateRow("Lee Sin", 388, 0.481),
    championWinRateRow("Jinx", 355, 0.512),
  ],
  rowsScanned: 1155,
  renderKind: "BAR_CHART",
});

/**
 * A query with no GROUP BY: one row describing everything, headed by the
 * engine's ungrouped label column, which is what turns it into figures.
 */
const UNGROUPED_PREVIEW: ReportAiPreviewSummary =
  ReportAiPreviewSummarySchema.parse({
    columns: [
      { key: "label", label: "Label", format: "text" },
      { key: "matches", label: "Matches ingested", format: "integer" },
      { key: "win_rate", label: "Blue-side win rate", format: "percent" },
    ],
    rows: [
      {
        label: "All",
        values: [
          { column: "matches", value: 184_203 },
          { column: "win_rate", value: 0.507 },
        ],
      },
    ],
    visualizationRows: [],
    rowsReturned: 1,
    rowsScanned: 184_203,
    renderKind: "TABLE",
  });

const LINE_CHART: VisualizationSnapshot = winRateByPatchChart({
  title: "Ahri win rate by patch",
  points: [
    {
      patch: "16.15",
      start: "2026-07-16T00:00:00.000Z",
      end: "2026-07-30T00:00:00.000Z",
      value: 0.512,
      sampleSize: 130,
    },
    {
      patch: "16.16",
      start: "2026-07-30T00:00:00.000Z",
      end: "2026-08-13T00:00:00.000Z",
      value: 0.529,
      sampleSize: 148,
    },
    {
      patch: "16.17",
      start: "2026-08-13T00:00:00.000Z",
      end: "2026-08-27T00:00:00.000Z",
      value: 0.537,
      sampleSize: 134,
    },
  ],
});

function matchCard(size: "S" | "M" | "L", matchId: string): ExploreMatchCard {
  return ExploreMatchCardSchema.parse({
    size,
    match: {
      matchId,
      gameCreationMs: 1_788_627_280_000,
      gameDurationSeconds: 1728,
      queue: "Ranked Solo",
      queueId: 420,
      gameMode: "CLASSIC",
      gameType: "MATCHED_GAME",
      gameVersion: "16.17.1",
      mapId: 11,
      teams: [
        {
          teamId: 100,
          win: true,
          kills: 41,
          objectives: { turrets: 8, inhibitors: 1, barons: 1, dragons: 3 },
          participants: [
            {
              participantId: 1,
              riotId: { gameName: "Hide on bush", tagLine: "KR1" },
              championId: 103,
              championName: "Ahri",
              position: "MIDDLE",
              kills: 12,
              deaths: 4,
              assists: 10,
              creepScore: 210,
              goldEarned: 14_000,
              visionScore: 22,
              damageToChampions: 24_000,
              killParticipation: 0.54,
              damageShare: 0.31,
              objectives: { turrets: 2, inhibitors: 0, barons: 0, dragons: 0 },
            },
          ],
        },
        {
          teamId: 200,
          win: false,
          kills: 28,
          objectives: { turrets: 3, inhibitors: 0, barons: 0, dragons: 1 },
          participants: [
            {
              participantId: 6,
              riotId: { gameName: "Chovy", tagLine: "KR2" },
              championId: 157,
              championName: "Yasuo",
              position: "MIDDLE",
              kills: 11,
              deaths: 8,
              assists: 8,
              creepScore: 194,
              goldEarned: 13_200,
              visionScore: 18,
              damageToChampions: 22_000,
              killParticipation: 0.48,
              damageShare: 0.27,
              objectives: { turrets: 1, inhibitors: 0, barons: 0, dragons: 0 },
            },
          ],
        },
      ],
    },
  });
}

const TRACE: ExploreTraceEntry[] = [
  ExploreTraceEntrySchema.parse({
    toolCallId: "call-reference-1",
    toolName: "read_reference",
    message: "Read the ScoutQL reference.",
    status: "succeeded",
    durationMs: 42,
    details: {
      kind: "reference",
      sources: 6,
      functions: 31,
      renderKinds: 7,
      renderOptions: 12,
      queues: 9,
      presets: 4,
      columns: 88,
      aggregateFunctions: 14,
      scalarFunctions: 17,
      idioms: 5,
      metrics: null,
      groupBys: null,
      filters: null,
    },
    rawInput: null,
    rawOutput: null,
  }),
  ExploreTraceEntrySchema.parse({
    toolCallId: "call-validate-1",
    toolName: "validate_query",
    message: "Checked the query before running it.",
    status: "succeeded",
    durationMs: 118,
    details: {
      kind: "validation",
      queryText:
        "SELECT champion, win_rate() FROM matches WHERE queue = 'RANKED_SOLO' GROUP BY champion",
      ok: true,
      diagnostics: [],
      formattedQueryText: null,
    },
    rawInput: {
      kind: "value",
      value: { queryText: "SELECT champion, win_rate() FROM matches" },
      byteLength: 48,
    },
    rawOutput: { kind: "value", value: { ok: true }, byteLength: 12 },
  }),
  ExploreTraceEntrySchema.parse({
    toolCallId: "call-execute-1",
    toolName: "run_query",
    message: "Got results.",
    status: "running",
    durationMs: null,
    details: {
      kind: "execution",
      queryText:
        "SELECT champion, win_rate() FROM matches WHERE queue = 'RANKED_SOLO' GROUP BY champion",
      ok: null,
      rowsReturned: null,
      rowsScanned: null,
      renderKind: null,
    },
    rawInput: null,
    rawOutput: null,
  }),
];

export const ResultTable: Story = {
  args: { preview: GROUPED_PREVIEW, visualization: null },
};

export const ResultChart: Story = {
  args: { preview: GROUPED_PREVIEW, visualization: LINE_CHART },
};

/** One ungrouped row reads as figures rather than a degenerate table. */
export const SingleRowFigures: Story = {
  args: { preview: null, visualization: null },
  render: () => <SingleRowResult preview={UNGROUPED_PREVIEW} />,
};

export const MatchCards: Story = {
  args: { preview: null, visualization: null },
  render: () => (
    <ExploreMatchCards
      cards={[
        matchCard("S", "NA1_5635906024"),
        matchCard("M", "NA1_5635906025"),
        matchCard("L", "NA1_5635906026"),
      ]}
    />
  ),
};

export const ToolTrace: Story = {
  args: { preview: null, visualization: null },
  render: () => <ExploreToolTrace trace={TRACE} showRaw={false} />,
};

/** The owner's view while a turn runs: raw payloads expandable, live label. */
export const ToolTraceLiveWithRawPayloads: Story = {
  args: { preview: null, visualization: null },
  render: () => <ExploreToolTrace trace={TRACE} showRaw live />,
};
