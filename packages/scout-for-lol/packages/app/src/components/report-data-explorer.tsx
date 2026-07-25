import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Copy, CornerDownLeft, Plus, Trash2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "#src/components/ui/button.tsx";
import { Input } from "#src/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#src/components/ui/select.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#src/components/ui/table.tsx";
import { useTRPC } from "#src/lib/trpc.ts";

type ExplorerTableId = "match_participants" | "prematch_participants";
type ExplorerOperator = "eq" | "contains" | "gte" | "lte";
type ExplorerFilter = {
  id: string;
  column: string;
  operator: ExplorerOperator;
  value: string;
};

export function ReportDataExplorer(props: {
  guildId: string;
  onInsertIdentifier: (identifier: string) => void;
}) {
  const trpc = useTRPC();
  const [tableId, setTableId] = useState<ExplorerTableId>("match_participants");
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [filters, setFilters] = useState<ExplorerFilter[]>([]);
  const [sortColumn, setSortColumn] = useState("");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [cursor, setCursor] = useState(0);
  const pageSize = 25;

  const schemaQuery = useQuery(
    trpc.report.dataExplorerSchema.queryOptions({ guildId: props.guildId }),
  );
  const table = schemaQuery.data?.find((entry) => entry.id === tableId);

  useEffect(() => {
    if (table === undefined) {
      return;
    }
    setSelectedColumns(table.columns.map((column) => column.id));
    setSortColumn(table.defaultSort);
    setFilters([]);
    setCursor(0);
  }, [table]);

  const browseQuery = useQuery(
    trpc.report.browseData.queryOptions(
      {
        guildId: props.guildId,
        table: tableId,
        columns:
          selectedColumns.length === 0 ? ["player_alias"] : selectedColumns,
        filters: filters
          .filter((filter) => filter.value.trim().length > 0)
          .map((filter) => ({
            column: filter.column,
            operator: filter.operator,
            value: filter.value,
          })),
        sort:
          sortColumn.length === 0
            ? null
            : { column: sortColumn, direction: sortDirection },
        cursor,
        pageSize,
      },
      { enabled: table !== undefined && selectedColumns.length > 0 },
    ),
  );

  return (
    <section className="space-y-4 border-t border-border pt-6">
      <div>
        <h3 className="text-base font-semibold">Data explorer</h3>
        <p className="text-sm text-muted-foreground">
          {table?.description ?? "Loading report data schema…"}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(12rem,0.7fr)_1fr]">
        <Select
          value={tableId}
          onValueChange={(value) => {
            if (
              value === "match_participants" ||
              value === "prematch_participants"
            ) {
              setTableId(value);
            }
          }}
        >
          <SelectTrigger aria-label="Data table">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(schemaQuery.data ?? []).map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex flex-wrap gap-2">
          {(table?.columns ?? []).map((column) => (
            <label
              key={column.id}
              className="flex items-center gap-2 rounded border border-border px-2 py-1 text-xs"
              title={column.description}
            >
              <input
                type="checkbox"
                checked={selectedColumns.includes(column.id)}
                onChange={() => {
                  setSelectedColumns((current) =>
                    current.includes(column.id)
                      ? current.filter((id) => id !== column.id)
                      : [...current, column.id],
                  );
                  setCursor(0);
                }}
              />
              {column.label}
              <button
                type="button"
                title={`Copy ${column.id}`}
                onClick={() => {
                  void navigator.clipboard.writeText(column.id);
                }}
              >
                <Copy className="size-3" />
              </button>
              <button
                type="button"
                title={`Insert ${column.id} into query`}
                onClick={() => {
                  props.onInsertIdentifier(column.id);
                }}
              >
                <CornerDownLeft className="size-3" />
              </button>
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {filters.map((filter) => (
          <div
            key={filter.id}
            className="grid gap-2 sm:grid-cols-[1fr_9rem_1fr_auto]"
          >
            <Select
              value={filter.column}
              onValueChange={(column) => {
                updateFilter(filters, setFilters, filter.id, { column });
                setCursor(0);
              }}
            >
              <SelectTrigger aria-label="Filter column">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(table?.columns ?? []).map((column) => (
                  <SelectItem key={column.id} value={column.id}>
                    {column.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filter.operator}
              onValueChange={(operator) => {
                if (
                  operator === "eq" ||
                  operator === "contains" ||
                  operator === "gte" ||
                  operator === "lte"
                ) {
                  updateFilter(filters, setFilters, filter.id, { operator });
                  setCursor(0);
                }
              }}
            >
              <SelectTrigger aria-label="Filter operator">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="eq">Equals</SelectItem>
                <SelectItem value="contains">Contains</SelectItem>
                <SelectItem value="gte">At least</SelectItem>
                <SelectItem value="lte">At most</SelectItem>
              </SelectContent>
            </Select>
            <Input
              aria-label="Filter value"
              value={filter.value}
              onChange={(event) => {
                updateFilter(filters, setFilters, filter.id, {
                  value: event.target.value,
                });
                setCursor(0);
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="Remove filter"
              onClick={() => {
                setFilters((current) =>
                  current.filter((entry) => entry.id !== filter.id),
                );
                setCursor(0);
              }}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={table === undefined || filters.length >= 5}
          onClick={() => {
            const firstColumn = table?.columns[0]?.id;
            if (firstColumn !== undefined) {
              setFilters((current) => [
                ...current,
                {
                  id: globalThis.crypto.randomUUID(),
                  column: firstColumn,
                  operator: "eq",
                  value: "",
                },
              ]);
            }
          }}
        >
          <Plus />
          Add filter
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={sortColumn}
          onValueChange={(column) => {
            setSortColumn(column);
            setCursor(0);
          }}
        >
          <SelectTrigger className="w-48" aria-label="Sort column">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(table?.columns ?? []).map((column) => (
              <SelectItem key={column.id} value={column.id}>
                {column.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={sortDirection}
          onValueChange={(direction) => {
            if (direction === "asc" || direction === "desc") {
              setSortDirection(direction);
              setCursor(0);
            }
          }}
        >
          <SelectTrigger className="w-36" aria-label="Sort direction">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="desc">Descending</SelectItem>
            <SelectItem value="asc">Ascending</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {browseQuery.error !== null && (
        <p className="text-sm text-destructive">{browseQuery.error.message}</p>
      )}
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              {(browseQuery.data?.columns ?? []).map((column) => (
                <TableHead key={column.id}>{column.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(browseQuery.data?.rows ?? []).map((row, rowIndex) => (
              <TableRow key={rowIndex.toString()}>
                {(browseQuery.data?.columns ?? []).map((column) => (
                  <TableCell key={column.id} className="whitespace-nowrap">
                    {formatExplorerValue(row[column.id])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {browseQuery.isPending && (
        <p className="text-sm text-muted-foreground">Loading rows…</p>
      )}
      <div className="flex justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={cursor === 0}
          onClick={() => {
            setCursor(Math.max(0, cursor - pageSize));
          }}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={usableCursor(browseQuery.data?.nextCursor) === null}
          onClick={() => {
            const next = usableCursor(browseQuery.data?.nextCursor);
            if (next !== null) {
              setCursor(next);
            }
          }}
        >
          Next
        </Button>
      </div>
    </section>
  );
}

function usableCursor(value: number | null | undefined): number | null {
  return typeof value === "number" ? value : null;
}

function updateFilter(
  filters: ExplorerFilter[],
  setFilters: Dispatch<SetStateAction<ExplorerFilter[]>>,
  id: string,
  update: Partial<Pick<ExplorerFilter, "column" | "operator" | "value">>,
): void {
  setFilters(
    filters.map((filter) =>
      filter.id === id ? { ...filter, ...update } : filter,
    ),
  );
}

function formatExplorerValue(
  value: string | number | boolean | null | undefined,
): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (typeof value === "number") {
    return value.toLocaleString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
