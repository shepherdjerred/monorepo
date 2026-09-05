import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Copy,
  Download,
  Search,
} from "lucide-react";
import {
  isLowSampleGameCount,
  formatReportDisplayValue,
  type ReportResultColumn,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import { Input } from "@scout-for-lol/design-system/components/field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@scout-for-lol/design-system/components/table";
import { tableToCsv, downloadCsv } from "#src/lib/table-export.ts";

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
  interactive?: boolean;
  onRowClick?: (row: PreviewRow) => void;
}) {
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [filterText, setFilterText] = useState("");
  const [copied, setCopied] = useState(false);

  const isInteractive = props.interactive === true;

  const handleSort = (columnKey: string) => {
    if (!isInteractive) return;
    if (sortColumn !== columnKey) {
      setSortColumn(columnKey);
      const col = props.columns.find((c) => c.key === columnKey);
      setSortDirection(col?.format === "text" ? "asc" : "desc");
    } else if (sortDirection === "desc") {
      setSortDirection("asc");
    } else {
      setSortColumn(null);
      setSortDirection("desc");
    }
  };

  const hasGamesColumn = useMemo(
    () =>
      props.columns.some((col) => {
        const label = col.label.toLowerCase();
        return (
          col.key === "games" || label === "games" || label === "game count"
        );
      }),
    [props.columns],
  );

  const indexedRows = useMemo(() => {
    let result = props.rows.map((row, originalIndex) => ({
      row,
      originalIndex,
    }));

    if (filterText.trim().length > 0) {
      const query = filterText.toLowerCase();
      result = result.filter(({ row, originalIndex }) => {
        if (row.label.toLowerCase().includes(query)) return true;
        return props.columns.some((col) => {
          const cellStr = formatCell(
            col,
            row,
            props.evidence?.[originalIndex],
            hasGamesColumn,
          );
          return cellStr.toLowerCase().includes(query);
        });
      });
    }

    if (sortColumn !== null) {
      result = [...result].sort((a, b) => {
        const valA =
          sortColumn === "label"
            ? a.row.label
            : (a.row.values.find((e) => e.column === sortColumn)?.value ??
              null);
        const valB =
          sortColumn === "label"
            ? b.row.label
            : (b.row.values.find((e) => e.column === sortColumn)?.value ??
              null);

        if (valA === null) return 1;
        if (valB === null) return -1;

        const cmp =
          typeof valA === "number" && typeof valB === "number"
            ? valA - valB
            : String(valA).localeCompare(String(valB));

        return sortDirection === "asc" ? cmp : -cmp;
      });
    }

    return result;
  }, [
    props.rows,
    props.columns,
    props.evidence,
    filterText,
    sortColumn,
    sortDirection,
    hasGamesColumn,
  ]);

  const handleCopyCsv = async () => {
    const csv = tableToCsv(
      props.columns,
      indexedRows.map((r) => r.row),
    );
    await navigator.clipboard.writeText(csv);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  const handleDownloadCsv = () => {
    const csv = tableToCsv(
      props.columns,
      indexedRows.map((r) => r.row),
    );
    downloadCsv("scout-report-data", csv);
  };

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

      {isInteractive && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="relative max-w-xs flex-1">
            <Search className="absolute left-2.5 top-2.5 size-3.5 text-scout-subtle" />
            <Input
              type="search"
              placeholder="Search rows…"
              value={filterText}
              onChange={(e) => {
                setFilterText(e.target.value);
              }}
              className="h-8 pl-8 text-xs"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs text-scout-subtle hover:text-scout-ink"
              onClick={() => {
                void handleCopyCsv();
              }}
              title="Copy table data as CSV"
            >
              {copied ? (
                <Check className="size-3.5 text-scout-success" />
              ) : (
                <Copy className="size-3.5" />
              )}
              {copied ? "Copied" : "Copy CSV"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs text-scout-subtle hover:text-scout-ink"
              onClick={handleDownloadCsv}
              title="Download table data as CSV"
            >
              <Download className="size-3.5" />
              CSV
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              {props.columns.map((column) => {
                const isSorted = sortColumn === column.key;
                return (
                  <TableHead
                    key={column.key}
                    aria-sort={
                      isSorted
                        ? sortDirection === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                  >
                    {isInteractive ? (
                      <button
                        type="button"
                        onClick={() => {
                          handleSort(column.key);
                        }}
                        className="inline-flex items-center gap-1 font-medium hover:text-scout-ink focus-visible:outline-none"
                      >
                        <span>{column.label}</span>
                        {isSorted ? (
                          sortDirection === "asc" ? (
                            <ArrowUp className="size-3 text-scout-ink" />
                          ) : (
                            <ArrowDown className="size-3 text-scout-ink" />
                          )
                        ) : (
                          <ArrowUpDown className="size-3 text-scout-subtle opacity-40 hover:opacity-100" />
                        )}
                      </button>
                    ) : (
                      column.label
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {indexedRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={props.columns.length}
                  className="py-6 text-center text-xs text-scout-subtle"
                >
                  No matching rows found.
                </TableCell>
              </TableRow>
            ) : (
              indexedRows.map(({ row, originalIndex }) => (
                <TableRow
                  key={`${row.label}-${originalIndex.toString()}`}
                  onClick={
                    props.onRowClick === undefined
                      ? undefined
                      : () => {
                          props.onRowClick?.(row);
                        }
                  }
                  className={
                    props.onRowClick === undefined
                      ? undefined
                      : "cursor-pointer hover:bg-scout-surface-hover"
                  }
                >
                  {props.columns.map((column) => {
                    const cellValue = formatCell(
                      column,
                      row,
                      props.evidence?.[originalIndex],
                      hasGamesColumn,
                    );
                    return (
                      <TableCell
                        key={column.key}
                        className={
                          column.key === "label" ? "font-medium" : undefined
                        }
                      >
                        {props.onRowClick !== undefined &&
                        column.key === "label" ? (
                          <button
                            type="button"
                            aria-label={`Explore ${row.label}`}
                            className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-scout-accent"
                            onClick={(event) => {
                              event.stopPropagation();
                              props.onRowClick?.(row);
                            }}
                          >
                            {cellValue}
                          </button>
                        ) : (
                          cellValue
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
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
