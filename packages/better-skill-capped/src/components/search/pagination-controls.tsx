import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "#components/ui/button";

export type PaginationControlsProps = {
  currentPage: number;
  lastPage: number;
  onPageChange: (newPage: number) => void;
};

/**
 * First/current-window/last page buttons with ellipses, matching the old
 * hand-rolled Bulma pagination's behavior in a fraction of the code.
 */
export function PaginationControls({
  currentPage,
  lastPage,
  onPageChange,
}: PaginationControlsProps): React.ReactElement | null {
  if (lastPage <= 1) {
    return null;
  }

  const window = [currentPage - 1, currentPage, currentPage + 1].filter(
    (page) => page >= 1 && page <= lastPage,
  );
  const pages = [...new Set([1, ...window, lastPage])].sort((a, b) => a - b);

  const elements: React.ReactNode[] = [];
  let previous = 0;
  for (const page of pages) {
    if (page - previous > 1) {
      elements.push(
        <span
          key={`gap-${String(page)}`}
          className="px-1 text-muted-foreground"
        >
          …
        </span>,
      );
    }
    elements.push(
      <Button
        key={page}
        variant={page === currentPage ? "default" : "outline"}
        size="sm"
        aria-current={page === currentPage ? "page" : undefined}
        onClick={() => {
          onPageChange(page);
        }}
      >
        {page}
      </Button>,
    );
    previous = page;
  }

  return (
    <nav
      className="mt-6 flex items-center justify-center gap-1.5"
      aria-label="Pagination"
    >
      <Button
        variant="outline"
        size="sm"
        disabled={currentPage <= 1}
        onClick={() => {
          onPageChange(currentPage - 1);
        }}
      >
        <ChevronLeft /> Previous
      </Button>
      {elements}
      <Button
        variant="outline"
        size="sm"
        disabled={currentPage >= lastPage}
        onClick={() => {
          onPageChange(currentPage + 1);
        }}
      >
        Next <ChevronRight />
      </Button>
    </nav>
  );
}
