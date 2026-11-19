import { useState } from "react";
import { useSearchParams } from "react-router";
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";
import { EnumPicker } from "#client/controls/enum-picker.tsx";
import {
  boardSortOptions,
  searchSortOptions,
  sortDirectionSummary,
  sortOptions,
} from "#client/controls/property-options.tsx";
import {
  BoardSortSchema,
  defaultSortDirection,
  hasSearchQuery,
  oppositeSortDirection,
  readDisplay,
  SortSchema,
  writeDisplay,
  type BoardSort,
} from "./display-options.ts";

/**
 * First-class toolbar sort selector and direction toggle for Issues, Project
 * issues and Board views, backed by URL `sort` and `dir` parameters.
 */
export function SortControl({ board }: { board: boolean }) {
  const [params, setParams] = useSearchParams();
  const [announcement, setAnnouncement] = useState("");
  const display = readDisplay(params);
  const searching = !board && hasSearchQuery(params);
  const activeSort: BoardSort = board ? display.boardSort : display.sort;
  const activeDir = board ? display.boardSortDir : display.sortDir;
  const selectedValue =
    searching && !display.hasExplicitSort ? "relevance" : activeSort;
  const options = board
    ? boardSortOptions
    : searching
      ? searchSortOptions
      : sortOptions;
  const currentOption = options.find(({ value }) => value === activeSort);
  const dirSummary = sortDirectionSummary(activeSort, activeDir);

  return (
    <div className="sort-control">
      <EnumPicker
        id="sort-picker"
        label="Sort issues"
        value={selectedValue}
        options={options}
        onChange={(value) => {
          if (board) {
            const nextSort = BoardSortSchema.parse(value);
            const nextDir = defaultSortDirection(nextSort);
            const label =
              boardSortOptions.find((option) => option.value === nextSort)
                ?.label ?? nextSort;
            setParams(writeDisplay(params, { boardSort: nextSort }), {
              preventScrollReset: true,
            });
            setAnnouncement(
              `Sorted by ${label}, ${sortDirectionSummary(nextSort, nextDir)}`,
            );
          } else if (value === "relevance") {
            setParams(writeDisplay(params, { clearSort: true }), {
              preventScrollReset: true,
            });
            setAnnouncement("Sorted by Relevance");
          } else {
            const nextSort = SortSchema.parse(value);
            const nextDir = defaultSortDirection(nextSort);
            const label =
              sortOptions.find((option) => option.value === nextSort)?.label ??
              nextSort;
            setParams(writeDisplay(params, { sort: nextSort }), {
              preventScrollReset: true,
            });
            setAnnouncement(
              `Sorted by ${label}, ${sortDirectionSummary(nextSort, nextDir)}`,
            );
          }
        }}
      />
      {selectedValue !== "board" && selectedValue !== "relevance" && (
        <button
          type="button"
          id="sort-direction"
          className="toolbar-button sort-dir-button"
          aria-label={`Sort direction: ${dirSummary}`}
          onClick={() => {
            const nextDir = oppositeSortDirection(activeDir);
            setParams(
              writeDisplay(
                params,
                board
                  ? { boardSort: activeSort, sortDir: nextDir }
                  : { sort: display.sort, sortDir: nextDir },
              ),
              { preventScrollReset: true },
            );
            setAnnouncement(
              `Sorted by ${currentOption?.label ?? activeSort}, ${sortDirectionSummary(activeSort, nextDir)}`,
            );
          }}
        >
          {activeDir === "desc" ? (
            <ArrowDownWideNarrow size={14} aria-hidden="true" />
          ) : (
            <ArrowUpNarrowWide size={14} aria-hidden="true" />
          )}
        </button>
      )}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
    </div>
  );
}
