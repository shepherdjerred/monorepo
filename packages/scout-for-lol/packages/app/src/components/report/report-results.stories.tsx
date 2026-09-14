import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReportIdSchema, type ReportResultColumn } from "@scout-for-lol/data";
import { ReportResultTable } from "./report-result-table.tsx";
import { ReportRunHistory } from "./report-run-history.tsx";
import { ReportQueryDocs } from "./report-query-docs.tsx";

function noop(): void {
  // Story callbacks are deliberately inert.
}

const GUILD_ID = "377554990325301252";
const REPORT_ID = ReportIdSchema.parse(1);

const COLUMNS: ReportResultColumn[] = [
  { key: "label", label: "Player", format: "text" },
  { key: "games", label: "Games", format: "integer" },
  { key: "win_rate", label: "Win rate", format: "percent" },
  { key: "kda", label: "KDA", format: "decimal" },
];

const ROWS = [
  {
    label: "Faker",
    games: 41,
    values: [
      { column: "games", value: 41 },
      { column: "win_rate", value: 0.65 },
      { column: "kda", value: 4.12 },
    ],
  },
  {
    label: "Chovy",
    games: 38,
    values: [
      { column: "games", value: 38 },
      { column: "win_rate", value: 0.62 },
      { column: "kda", value: 5.03 },
    ],
  },
  {
    label: "sjerred",
    games: 6,
    values: [
      { column: "games", value: 6 },
      { column: "win_rate", value: 0.5 },
      { column: "kda", value: 2.41 },
    ],
  },
];

const ACTIVITY_QUERY = `SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate
FROM match_participants
WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
GROUP BY player
ORDER BY games DESC
LIMIT 10
RENDER leaderboard`;

const RUNS = [
  {
    id: 3,
    trigger: "SCHEDULE",
    status: "SUCCESS",
    startedAt: "2026-09-13T12:00:00.000Z",
    durationMs: 1842,
    rowsReturned: 10,
    rowsScanned: 48_211,
    errorMessage: null,
    renderedContent: null,
    hasImage: false,
    visualization: null,
    querySnapshot: ACTIVITY_QUERY,
  },
  {
    id: 2,
    trigger: "MANUAL",
    status: "FAILED",
    startedAt: "2026-09-12T12:00:00.000Z",
    durationMs: 412,
    rowsReturned: 0,
    rowsScanned: 0,
    errorMessage: "Unknown identifier `win_ratio` on match_participants.",
    renderedContent: null,
    hasImage: false,
    visualization: null,
    querySnapshot: "SELECT AVG(win_ratio) FROM match_participants",
  },
  {
    id: 1,
    trigger: "SCHEDULE",
    status: "SUCCESS",
    startedAt: "2026-09-06T12:00:00.000Z",
    durationMs: 1501,
    rowsReturned: 10,
    rowsScanned: 45_903,
    errorMessage: null,
    renderedContent: "1. Faker — 65% over 41 games\n2. Chovy — 62% over 38",
    hasImage: false,
    visualization: null,
    querySnapshot: null,
  },
];

const meta = {
  title: "Report/Results",
  component: ReportResultTable,
  tags: ["autodocs"],
} satisfies Meta<typeof ReportResultTable>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ResultTable: Story = {
  args: { columns: COLUMNS, rows: ROWS },
};

export const ResultTableInteractive: Story = {
  args: { columns: COLUMNS, rows: ROWS, interactive: true, rowsReturned: 3 },
};

export const ResultTableEmpty: Story = {
  args: { columns: COLUMNS, rows: [] },
};

export const ResultTableDrillDown: Story = {
  args: {
    columns: COLUMNS,
    rows: ROWS,
    onRowClick: noop,
    evidence: [
      {
        label: "sjerred",
        games: 6,
        values: [{ column: "win_rate", sampleSize: 6 }],
      },
    ],
  },
};

export const RunHistory: Story = {
  args: { columns: COLUMNS, rows: [] },
  render: () => (
    <ReportRunHistory guildId={GUILD_ID} reportId={REPORT_ID} runs={RUNS} />
  ),
};

export const RunHistoryEmpty: Story = {
  args: { columns: COLUMNS, rows: [] },
  render: () => (
    <ReportRunHistory guildId={GUILD_ID} reportId={REPORT_ID} runs={[]} />
  ),
};

export const QueryDocs: Story = {
  args: { columns: COLUMNS, rows: [] },
  render: () => <ReportQueryDocs />,
};
