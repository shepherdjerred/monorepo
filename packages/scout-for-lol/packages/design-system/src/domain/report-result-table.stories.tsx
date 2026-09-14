import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChampionPortrait } from "#src/assets/index.tsx";
import {
  ReportResultTable,
  type ReportResultColumn,
} from "./report-result-table.tsx";
import { StatusBadge } from "./status-badge.tsx";

type MatchRow = {
  matchId: string;
  champion: string;
  lane: string;
  queue: string;
  kda: string;
  lp: number;
  win: boolean;
};

type MatchTableArgs = {
  rows: MatchRow[];
  columns: ReportResultColumn<MatchRow>[];
  getRowKey: (row: MatchRow) => string;
  caption: string;
};

const meta = {
  title: "Domain/ReportResultTable",
  component: ReportResultTable,
  tags: ["autodocs"],
} satisfies Meta<MatchTableArgs>;

export default meta;

type Story = StoryObj<MatchTableArgs>;

const matches: MatchRow[] = [
  {
    matchId: "NA1_5182340011",
    champion: "Ahri",
    lane: "Mid",
    queue: "Ranked Solo/Duo",
    kda: "14/2/9",
    lp: 21,
    win: true,
  },
  {
    matchId: "NA1_5182302884",
    champion: "Syndra",
    lane: "Mid",
    queue: "Ranked Solo/Duo",
    kda: "8/4/11",
    lp: 18,
    win: true,
  },
  {
    matchId: "NA1_5182199017",
    champion: "Yasuo",
    lane: "Mid",
    queue: "Ranked Flex",
    kda: "2/11/3",
    lp: -22,
    win: false,
  },
  {
    matchId: "NA1_5182044530",
    champion: "LeeSin",
    lane: "Jungle",
    queue: "Ranked Solo/Duo",
    kda: "6/5/14",
    lp: 19,
    win: true,
  },
  {
    matchId: "NA1_5181988112",
    champion: "Thresh",
    lane: "Support",
    queue: "Ranked Solo/Duo",
    kda: "1/6/22",
    lp: -17,
    win: false,
  },
];

const championCell = (row: MatchRow) => (
  <span className="scout-cluster">
    <ChampionPortrait
      champion={row.champion}
      alt=""
      style={{ width: 28, height: 28 }}
    />
    <span>{row.champion}</span>
  </span>
);

const matchColumns: ReportResultColumn<MatchRow>[] = [
  { key: "champion", header: "Champion", render: championCell },
  { key: "lane", header: "Lane", render: (row) => row.lane },
  { key: "queue", header: "Queue", render: (row) => row.queue },
  { key: "kda", header: "K/D/A", render: (row) => row.kda },
  {
    key: "lp",
    header: "LP",
    render: (row) => (row.lp > 0 ? `+${row.lp.toString()}` : row.lp.toString()),
  },
  {
    key: "result",
    header: "Result",
    render: (row) => (
      <StatusBadge status={row.win ? "success" : "danger"}>
        {row.win ? "Win" : "Loss"}
      </StatusBadge>
    ),
  },
];

const compactColumns: ReportResultColumn<MatchRow>[] = [
  { key: "champion", header: "Champion", render: championCell },
  { key: "kda", header: "K/D/A", render: (row) => row.kda },
  {
    key: "result",
    header: "Result",
    render: (row) => (
      <StatusBadge status={row.win ? "success" : "danger"}>
        {row.win ? "Win" : "Loss"}
      </StatusBadge>
    ),
  },
];

const matchKey = (row: MatchRow): string => row.matchId;

export const MatchHistory: Story = {
  args: {
    rows: matches,
    columns: matchColumns,
    getRowKey: matchKey,
    caption: "Ranked matches for Bearded Lyfe #NA1 this week",
  },
};

export const CompactColumns: Story = {
  args: {
    rows: matches,
    columns: compactColumns,
    getRowKey: matchKey,
    caption: "Champion, K/D/A and result for each ranked match",
  },
};

export const SingleResult: Story = {
  args: {
    rows: matches.slice(0, 1),
    columns: matchColumns,
    getRowKey: matchKey,
    caption: "The most recent ranked match for Bearded Lyfe #NA1",
  },
};

export const NoResults: Story = {
  args: {
    rows: [],
    columns: matchColumns,
    getRowKey: matchKey,
    caption: "No ranked matches matched this ScoutQL query",
  },
};
