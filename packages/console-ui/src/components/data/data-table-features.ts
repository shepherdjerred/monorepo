import {
  columnFilteringFeature,
  createFilteredRowModel,
  createSortedRowModel,
  globalFilteringFeature,
  rowExpandingFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
} from "@tanstack/react-table";

/**
 * The TanStack Table features every `DataTable` registers, at module scope
 * so the table instance stays stable. Search is the global filter over one
 * hidden column; view filters stay with the app, which filters `rows`.
 */
export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  rowSelectionFeature,
  rowExpandingFeature,
});

export type DataTableFeatures = typeof dataTableFeatures;
