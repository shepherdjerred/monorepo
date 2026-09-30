import {
  formatReportDisplayValue,
  isLowSampleGameCount,
  reportAssetInfo,
  type ReportAssetKind,
  type ReportResultColumn,
} from "@scout-for-lol/data";
import {
  ChampionPortrait,
  ItemIcon,
  RuneIcon,
  SummonerSpellIcon,
} from "@scout-for-lol/design-system/assets";

// Accepts both the AI preview rows (non-null values) and the live tRPC preview
// rows, whose values are nullable when a column is absent for a row.
export type PreviewRow = {
  label: string;
  games?: number | undefined;
  values: {
    column: string;
    value: string | number | null;
    comparisonValue?: string | number | null;
    absoluteDelta?: number | null;
    percentageDelta?: number | null;
  }[];
};

export type PreviewEvidence = {
  label: string;
  games: number;
  values: {
    column: string;
    sampleSize: number;
  }[];
};

function isIdentifierColumn(column: ReportResultColumn): boolean {
  return (
    column.key.endsWith("_id") ||
    column.key === "id" ||
    column.key === "key" ||
    column.key === "slug"
  );
}

function comparisonDetails(
  column: ReportResultColumn,
  result: PreviewRow["values"][number],
): string[] {
  if (isIdentifierColumn(column)) return [];

  const details: string[] = [];
  if (result.absoluteDelta !== undefined && result.absoluteDelta !== null) {
    details.push(`Δ ${formatReportDisplayValue(column, result.absoluteDelta)}`);
  }
  if (result.percentageDelta !== undefined) {
    details.push(
      result.percentageDelta === null
        ? "Δ% unknown"
        : `Δ ${(result.percentageDelta * 100).toFixed(1)}%`,
    );
  }
  return details;
}

export function ReportAssetIcon(props: {
  kind: ReportAssetKind;
  value: string | number;
}) {
  const asset = reportAssetInfo(props.kind, props.value);
  if (asset.canonicalKey == null) return null;

  const imageProps = {
    alt: "",
    "aria-hidden": true as const,
    className: "size-5 shrink-0 rounded",
  };
  switch (props.kind) {
    case "champion":
      return <ChampionPortrait {...imageProps} champion={asset.canonicalKey} />;
    case "item":
      return <ItemIcon {...imageProps} item={asset.canonicalKey} />;
    case "rune":
    case "rune_tree":
      return <RuneIcon {...imageProps} rune={asset.canonicalKey} />;
    case "spell":
      return <SummonerSpellIcon {...imageProps} spell={asset.canonicalKey} />;
  }
}

export function formatCell(
  column: ReportResultColumn,
  row: PreviewRow,
  evidenceRow: PreviewEvidence | undefined,
  hasGamesColumn: boolean,
): string {
  if (column.key === "label") {
    return column.asset === undefined
      ? row.label
      : formatReportDisplayValue(column, row.label);
  }
  const result = row.values.find((entry) => entry.column === column.key);
  if (result?.value === undefined || result.value === null) return "—";
  const details: string[] = [];
  const games = evidenceRow?.games ?? row.games;
  const isIdentifier = isIdentifierColumn(column);
  if (
    !hasGamesColumn &&
    !isIdentifier &&
    games !== undefined &&
    column.key !== "games"
  ) {
    details.push(`Based on ${games.toString()} games`);
  }
  details.push(...comparisonDetails(column, result));
  const suffix = details.length === 0 ? "" : ` (${details.join(" · ")})`;
  return `${formatReportDisplayValue(column, result.value)}${suffix}`;
}

/** Sort by the same name people see whenever a column represents an asset. */
export function reportRowSortValue(
  column: ReportResultColumn,
  row: PreviewRow,
  evidenceRow: PreviewEvidence | undefined,
  hasGamesColumn: boolean,
): string | number | null {
  if (column.key === "label") {
    return formatCell(column, row, evidenceRow, hasGamesColumn);
  }
  const value = row.values.find((entry) => entry.column === column.key)?.value;
  return value !== null && value !== undefined && column.asset !== undefined
    ? formatReportDisplayValue(column, value)
    : (value ?? null);
}

/** Give drill-down prompts the label shown to the user, not an asset ID. */
export function reportRowForFollowUp(
  columns: ReportResultColumn[],
  row: PreviewRow,
): PreviewRow {
  const labelColumn = columns.find((column) => column.key === "label");
  if (labelColumn?.asset === undefined) return row;
  return {
    ...row,
    label: formatReportDisplayValue(labelColumn, row.label),
  };
}

export function hasThinRateRows(
  columns: ReportResultColumn[],
  rows: PreviewRow[],
  evidence: PreviewEvidence[] | undefined,
): boolean {
  return rows.some((row, rowIndex) => {
    const games = evidence?.[rowIndex]?.games ?? row.games;
    return (
      games !== undefined &&
      isLowSampleGameCount(games) &&
      columns.some((column) => column.format === "percent")
    );
  });
}
