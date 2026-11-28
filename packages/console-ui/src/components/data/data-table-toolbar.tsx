import { useState } from "react";
import type { RowData } from "@tanstack/react-table";
import {
  ExportButtons,
  copyText,
  type ExportFormat,
} from "@shepherdjerred/console-ui/components/data/data-table-export.tsx";
import {
  fallbackExportColumns,
  formatDataTableCsv,
  formatDataTableJson,
  type DataTableColumn,
  type DataTableExportColumn,
  type DataTableFilter,
} from "@shepherdjerred/console-ui/components/data/data-table-model.ts";
import {
  FilterBar,
  filtersActive,
  type CountNoun,
} from "@shepherdjerred/console-ui/components/data/filter-bar.tsx";
import { Tabs } from "@shepherdjerred/console-ui/components/tabs.tsx";

export type DataTableToolbarProps<T extends RowData> = {
  readonly caption: string;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly searchable: boolean;
  readonly searchPlaceholder: string | undefined;
  readonly filters: readonly DataTableFilter[];
  readonly shown: readonly T[];
  readonly total: number;
  readonly countNoun: CountNoun | undefined;
  readonly columns: readonly DataTableColumn<T>[];
  readonly exportFilename: string | undefined;
  readonly exportColumns: readonly DataTableExportColumn<T>[] | undefined;
  readonly announce: (message: string) => void;
};

function defaultOf(filter: DataTableFilter): string {
  return filter.defaultValue ?? filter.options[0]?.value ?? "";
}

function FilterTabs({
  filters,
}: {
  readonly filters: readonly DataTableFilter[];
}): React.JSX.Element {
  return (
    <>
      {filters.map((filter) => (
        <Tabs
          key={filter.key}
          label={filter.label}
          options={filter.options.map((option) => ({
            value: option.value,
            label: option.label,
            ...(option.count === undefined ? {} : { count: option.count }),
          }))}
          value={filter.value}
          onChange={filter.onChange}
        />
      ))}
    </>
  );
}

/**
 * The DataTable's `FilterBar`: search, filter tabs, the "N of M" count,
 * "Clear filters" and the copy buttons, which copy the rows as filtered and
 * sorted.
 */
export function DataTableToolbar<T extends RowData>(
  props: DataTableToolbarProps<T>,
): React.JSX.Element | null {
  const { filters, exportFilename, exportColumns, announce } = props;
  const [copied, setCopied] = useState<ExportFormat | null>(null);
  const canExport = exportFilename !== undefined || exportColumns !== undefined;
  if (!canExport && !props.searchable && filters.length === 0) {
    return null;
  }

  async function copy(format: ExportFormat): Promise<void> {
    const columns = exportColumns ?? fallbackExportColumns(props.columns);
    const text =
      format === "csv"
        ? formatDataTableCsv(props.shown, columns)
        : formatDataTableJson(props.shown, columns);
    const ok = await copyText(text);
    setCopied(ok ? format : null);
    const target = exportFilename === undefined ? "" : ` (${exportFilename})`;
    announce(
      ok
        ? `Copied ${String(props.shown.length)} rows as ${format.toUpperCase()}${target}`
        : "Could not copy: the browser blocked clipboard access",
    );
  }

  return (
    <FilterBar
      {...(props.searchable
        ? {
            search: {
              value: props.query,
              onChange: props.onQueryChange,
              label: `Search ${props.caption}`,
              placeholder: props.searchPlaceholder ?? "Search…",
            },
          }
        : {})}
      filters={
        filters.length === 0 ? undefined : <FilterTabs filters={filters} />
      }
      count={{
        shown: props.shown.length,
        total: props.total,
        noun: props.countNoun,
      }}
      active={filtersActive({
        search: props.query,
        filters: filters.map((filter) => ({
          value: filter.value,
          defaultValue: defaultOf(filter),
        })),
      })}
      onClear={() => {
        props.onQueryChange("");
        for (const filter of filters) {
          if (filter.value !== defaultOf(filter)) {
            filter.onChange(defaultOf(filter));
          }
        }
      }}
      end={
        canExport ? (
          <ExportButtons
            copied={copied}
            onCopy={(format) => {
              void copy(format);
            }}
          />
        ) : undefined
      }
    />
  );
}
