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

  // An empty result set still has one (empty) page, so the controls always
  // have a valid range to render.
  const numberOfPages = Math.max(1, Math.ceil(results.length / itemsPerPage));
  // `page` comes from the URL and can be hand-edited or left stale by a
  // filter change, so clamp it rather than rendering an empty slice while
  // results exist.
  const safePage = Math.min(Math.max(page, 1), numberOfPages);

  const start = itemsPerPage * (safePage - 1);
  const pageResults = results.slice(start, start + itemsPerPage);

  return (
    <>
      {pageResults.map((result) => render(result))}
      <PaginationControls
        currentPage={safePage}
        lastPage={numberOfPages}
        onPageChange={onPageChange}
      />
    </>
  );
}
