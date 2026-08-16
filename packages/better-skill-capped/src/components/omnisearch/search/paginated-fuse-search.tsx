import React from "react";
import type { IFuseOptions } from "fuse.js";
import PaginationControls from "./pagination-controls.tsx";
import type { FuseSearchResult } from "./fuse-search.tsx";
import { useFuseSearch } from "./fuse-search.tsx";

export type PaginatedFuseSearchProps<T> = {
  query: string;
  items: T[];
  fuseOptions: IFuseOptions<T>;
  render: (result: FuseSearchResult<T>) => React.ReactNode;
  itemsPerPage: number;
  page: number;
  onPageChange: (newPage: number) => void;
};

export default function PaginatedFuseSearch<T>({
  query,
  items,
  fuseOptions,
  render,
  itemsPerPage,
  page,
  onPageChange,
}: PaginatedFuseSearchProps<T>): React.ReactElement {
  const results = useFuseSearch(items, query, fuseOptions);

  const start = itemsPerPage * (page - 1);
  const pageResults = results.slice(start, start + itemsPerPage);
  const numberOfPages = Math.ceil(results.length / itemsPerPage);

  return (
    <>
      {pageResults.map((result) => render(result))}
      <PaginationControls
        currentPage={page}
        lastPage={numberOfPages}
        onPageChange={onPageChange}
      />
    </>
  );
}
