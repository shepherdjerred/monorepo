import {
  isLowSampleGameCount,
  formatReportDisplayValue,
  type ReportResultColumn,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@scout-for-lol/design-system/components/table";

// Accepts both the AI preview rows (non-null values) and the live tRPC preview
// rows, whose values are nullable when a column is absent for a row.
type PreviewRow = {
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

type PreviewEvidence = {
  label: string;
  games: number;
  values: {
    column: string;
    sampleSize: number;
  }[];
};

export function ReportResultTable(props: {
  columns: ReportResultColumn[];
  rows: PreviewRow[];
  visualization?: VisualizationSnapshot | null;
  evidence?: PreviewEvidence[];
}) {
  if (props.rows.length === 0) {
    return (
      <div className="rounded-md border border-border p-4 text-sm text-scout-subtle">
        No rows matched this query.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {props.visualization?.display.sparkline === true && (
        <SnapshotSparklines snapshot={props.visualization} />
      )}
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              {props.columns.map((column) => (
                <TableHead key={column.key}>{column.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(() => {
              const hasGamesColumn = props.columns.some(
                (column) =>
                  column.key === "games" ||
                  column.label.toLowerCase() === "games" ||
                  column.label.toLowerCase() === "game count",
              );
              return props.rows.map((row, rowIndex) => (
                <TableRow key={`${row.label}-${rowIndex.toString()}`}>
                  {props.columns.map((column) => (
                    <TableCell
                      key={column.key}
                      className={
                        column.key === "label" ? "font-medium" : undefined
                      }
                    >
                      {formatCell(
                        column,
                        row,
                        props.evidence?.[rowIndex],
                        hasGamesColumn,
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ));
            })()}
          </TableBody>
        </Table>
      </div>
      {hasThinRateRows(props.columns, props.rows, props.evidence) && (
        <p className="text-xs text-scout-subtle">
          Fewer than 10 games — treat this rate as indicative only.
        </p>
      )}
    </div>
  );
}

function SnapshotSparklines(props: { snapshot: VisualizationSnapshot }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {props.snapshot.series.map((series) => {
        const values = series.points.map((point) => point.value);
        return (
          <div key={series.id} className="rounded-md border border-border p-2">
            <div className="mb-1 truncate text-xs text-scout-subtle">
              {series.label}
            </div>
            <svg
              viewBox="0 0 120 28"
              className="h-7 w-full"
              role="img"
              aria-label={`${series.label} sparkline`}
            >
              {sparklineSegments(values).map((points, index) => (
                <polyline
                  key={index}
                  points={points}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          </div>
        );
      })}
    </div>
  );
}

export function sparklineSegments(values: (number | null)[]): string[] {
  const numericValues = values.flatMap((value) =>
    value === null ? [] : [value],
  );
  if (numericValues.length === 0) return [];
  const minimum = Math.min(...numericValues);
  const maximum = Math.max(...numericValues);
  const range = maximum - minimum;
  const segments: string[][] = [];
  let segment: string[] = [];
  for (const [index, value] of values.entries()) {
    if (value === null) {
      if (segment.length > 0) segments.push(segment);
      segment = [];
      continue;
    }
    const x = values.length === 1 ? 60 : (index / (values.length - 1)) * 120;
    const y = range === 0 ? 14 : 26 - ((value - minimum) / range) * 24;
    segment.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  if (segment.length > 0) segments.push(segment);
  return segments.map((points) => {
    if (points.length !== 1) return points.join(" ");
    const onlyPoint = points[0];
    if (onlyPoint === undefined) {
      throw new Error("A one-point sparkline segment is missing its point.");
    }
    return `${onlyPoint} ${onlyPoint}`;
  });
}

function formatCell(
  column: ReportResultColumn,
  row: PreviewRow,
  evidenceRow: PreviewEvidence | undefined,
  hasGamesColumn: boolean,
): string {
  if (column.key === "label") {
    return row.label;
  }
  const result = row.values.find((entry) => entry.column === column.key);
  if (result?.value === undefined || result.value === null) return "—";
  const details: string[] = [];
  const games = evidenceRow?.games ?? row.games;
  const isIdentifier =
    column.key.endsWith("_id") ||
    column.key === "id" ||
    column.key === "key" ||
    column.key === "slug";
  if (
    !hasGamesColumn &&
    !isIdentifier &&
    games !== undefined &&
    column.key !== "games"
  ) {
    details.push(`Based on ${games.toString()} games`);
  }
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
  const suffix = details.length === 0 ? "" : ` (${details.join(" · ")})`;
  return `${formatReportDisplayValue(column, result.value)}${suffix}`;
}

function hasThinRateRows(
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
