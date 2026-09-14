import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { StorySeed } from "#src/lib/storybook/trpc-stub.ts";
import { ReportDataExplorer } from "./report-data-explorer.tsx";
import { ReportQueryPreview } from "./report-query-preview.tsx";
import { ReportQueryViewer } from "./report-query-viewer.tsx";
import { ReportAiEditor } from "./report-ai-editor.tsx";
import {
  EMPTY_REPORT_STATE,
  STARTER_REPORT_QUERY,
} from "./report-form-fields.tsx";

const GUILD_ID = "377554990325301252";
const PREVIEW_TITLE = "Weekly activity leaders";

/**
 * The explorer's default column selection is whatever the seeded schema marks
 * `defaultVisible`, and its first sort is the table's `defaultSort` — so this
 * fixture is also what decides the `browseData` key seeded below.
 */
const DEFAULT_COLUMN_IDS = [
  "player_alias",
  "game_creation_at",
  "queue",
  "champion_name",
  "win",
  "kills",
  "deaths",
  "assists",
];
const DEFAULT_SORT = "game_creation_at";

const EXPLORER_COLUMNS = [
  {
    id: "player_alias",
    label: "Player",
    type: "string",
    description: "Tracked Scout player.",
    group: "Core",
    defaultVisible: true,
  },
  {
    id: "game_creation_at",
    label: "Played at",
    type: "timestamp",
    description: "Match creation time.",
    group: "Core",
    defaultVisible: true,
  },
  {
    id: "queue",
    label: "Queue",
    type: "string",
    description: "Normalized queue type.",
    group: "Core",
    defaultVisible: true,
  },
  {
    id: "champion_name",
    label: "Champion",
    type: "string",
    description: "Champion display name.",
    group: "Core",
    defaultVisible: true,
  },
  {
    id: "win",
    label: "Win",
    type: "boolean",
    description: "Whether the player's team won.",
    group: "Core",
    defaultVisible: true,
  },
  {
    id: "kills",
    label: "Kills",
    type: "number",
    description: "Champion kills.",
    group: "Core",
    defaultVisible: true,
  },
  {
    id: "deaths",
    label: "Deaths",
    type: "number",
    description: "Champion deaths.",
    group: "Core",
    defaultVisible: true,
  },
  {
    id: "assists",
    label: "Assists",
    type: "number",
    description: "Champion assists.",
    group: "Core",
    defaultVisible: true,
  },
  {
    id: "kda",
    label: "KDA",
    type: "number",
    description: "(Kills + assists) / deaths.",
    group: "Core",
    defaultVisible: false,
  },
] as const;

const EXPLORER_ROWS = [
  {
    player_alias: "sjerred",
    game_creation_at: "2026-09-13T01:12:00.000Z",
    queue: "solo",
    champion_name: "LeeSin",
    win: true,
    kills: 9,
    deaths: 3,
    assists: 14,
  },
  {
    player_alias: "Chovy",
    game_creation_at: "2026-09-12T23:40:00.000Z",
    queue: "flex",
    champion_name: "Ahri",
    win: false,
    kills: 4,
    deaths: 6,
    assists: 8,
  },
  {
    player_alias: "nightblue",
    game_creation_at: "2026-09-12T21:02:00.000Z",
    queue: "clash",
    champion_name: "Thresh",
    win: true,
    kills: 1,
    deaths: 5,
    assists: 22,
  },
];

const seedExplorer: StorySeed = (trpc, queryClient) => {
  queryClient.setQueryData(
    trpc.report.dataExplorerSchema.queryOptions({ guildId: GUILD_ID }).queryKey,
    [
      {
        id: "match_participants",
        label: "Match participants",
        description: "One tracked player row per completed match.",
        defaultSort: DEFAULT_SORT,
        columns: [...EXPLORER_COLUMNS],
      },
    ],
  );
  queryClient.setQueryData(
    trpc.report.browseData.queryOptions({
      guildId: GUILD_ID,
      table: "match_participants",
      columns: DEFAULT_COLUMN_IDS,
      filters: [],
      sort: { column: DEFAULT_SORT, direction: "desc" },
      cursor: 0,
      pageSize: 25,
    }).queryKey,
    {
      columns: EXPLORER_COLUMNS.filter((column) =>
        DEFAULT_COLUMN_IDS.includes(column.id),
      ).map((column) => ({ ...column })),
      rows: EXPLORER_ROWS,
      nextCursor: null,
    },
  );
};

const seedPreview: StorySeed = (trpc, queryClient) => {
  queryClient.setQueryData(
    trpc.report.previewQuery.queryOptions({
      guildId: GUILD_ID,
      queryText: STARTER_REPORT_QUERY,
      title: PREVIEW_TITLE,
      sourceCompetitionId: null,
    }).queryKey,
    {
      columns: [
        { key: "label", label: "Player", format: "text" },
        { key: "games", label: "Games", format: "integer" },
        { key: "win_rate", label: "Win rate", format: "percent" },
      ],
      rows: [
        {
          label: "Faker",
          dimensions: ["Faker"],
          keys: ["Faker"],
          mentionIdentity: null,
          values: [
            { column: "games", value: 41 },
            { column: "win_rate", value: 0.65 },
          ],
        },
        {
          label: "Chovy",
          dimensions: ["Chovy"],
          keys: ["Chovy"],
          mentionIdentity: null,
          values: [
            { column: "games", value: 38 },
            { column: "win_rate", value: 0.62 },
          ],
        },
      ],
      rowsScanned: 48_211,
      renderKind: "LEADERBOARD",
      imageBase64: null,
      visualization: null,
      evidence: [],
    },
  );
};

const seedAiReady: StorySeed = (trpc, queryClient) => {
  queryClient.setQueryData(
    trpc.report.aiEditStatus.queryOptions({ guildId: GUILD_ID }).queryKey,
    {
      enabled: true,
      disabledReason: null,
      model: "claude-sonnet-4-5",
      exempt: false,
      quota: [
        {
          scope: "user_guild",
          window: "minute",
          used: 1,
          limit: 3,
          remaining: 2,
          resetsAt: "2026-09-13T12:01:00.000Z",
        },
      ],
      activeRun: false,
    },
  );
};

const seedAiExhausted: StorySeed = (trpc, queryClient) => {
  queryClient.setQueryData(
    trpc.report.aiEditStatus.queryOptions({ guildId: GUILD_ID }).queryKey,
    {
      enabled: false,
      disabledReason: "Rate limit reached — try again in a minute.",
      model: "claude-sonnet-4-5",
      exempt: false,
      quota: [
        {
          scope: "user_guild",
          window: "minute",
          used: 3,
          limit: 3,
          remaining: 0,
          resetsAt: "2026-09-13T12:01:00.000Z",
        },
      ],
      activeRun: false,
    },
  );
};

function ExplorerHarness() {
  const [inserted, setInserted] = useState<string[]>([]);
  return (
    <div className="space-y-3">
      <ReportDataExplorer
        guildId={GUILD_ID}
        onInsertIdentifier={(identifier) => {
          setInserted((current) => [...current, identifier]);
        }}
      />
      <p className="text-sm text-scout-subtle" role="status">
        {inserted.length === 0
          ? "Nothing inserted into the query yet."
          : `Inserted: ${inserted.join(", ")}`}
      </p>
    </div>
  );
}

function AiEditorHarness() {
  const [applied, setApplied] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <ReportAiEditor
        guildId={GUILD_ID}
        state={{
          ...EMPTY_REPORT_STATE,
          title: PREVIEW_TITLE,
          channelId: "1102938475610293847",
        }}
        onApplyDraft={(draft) => {
          setApplied(draft.title);
        }}
      />
      <p className="text-sm text-scout-subtle" role="status">
        {applied === null ? "No draft applied yet." : `Applied: ${applied}`}
      </p>
    </div>
  );
}

const meta = {
  title: "Report/Explorer",
  component: ReportQueryViewer,
  tags: ["autodocs"],
} satisfies Meta<typeof ReportQueryViewer>;

export default meta;

type Story = StoryObj<typeof meta>;

export const QueryViewer: Story = {
  args: { queryText: STARTER_REPORT_QUERY },
};

export const QueryViewerUnparseable: Story = {
  args: {
    queryText: "SELECT COUNT(*) FROM match_participants RENDER wombat WITH (",
  },
};

export const DataExplorer: Story = {
  args: { queryText: STARTER_REPORT_QUERY },
  parameters: { seedQueries: [seedExplorer] },
  render: () => <ExplorerHarness />,
};

export const DataExplorerLoading: Story = {
  args: { queryText: STARTER_REPORT_QUERY },
  render: () => <ExplorerHarness />,
};

export const QueryPreview: Story = {
  args: { queryText: STARTER_REPORT_QUERY },
  parameters: { seedQueries: [seedPreview] },
  render: () => (
    <ReportQueryPreview
      guildId={GUILD_ID}
      queryText={STARTER_REPORT_QUERY}
      title={PREVIEW_TITLE}
      sourceCompetitionId={null}
    />
  ),
};

export const QueryPreviewEmptyQuery: Story = {
  args: { queryText: STARTER_REPORT_QUERY },
  render: () => (
    <ReportQueryPreview
      guildId={GUILD_ID}
      queryText=""
      title={PREVIEW_TITLE}
      sourceCompetitionId={null}
    />
  ),
};

export const AiEditor: Story = {
  args: { queryText: STARTER_REPORT_QUERY },
  parameters: { seedQueries: [seedAiReady] },
  render: () => <AiEditorHarness />,
};

export const AiEditorRateLimited: Story = {
  args: { queryText: STARTER_REPORT_QUERY },
  parameters: { seedQueries: [seedAiExhausted] },
  render: () => <AiEditorHarness />,
};
