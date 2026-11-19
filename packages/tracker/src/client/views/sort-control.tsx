import { useState } from "react";
import { useSearchParams } from "react-router";
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";
import { EnumPicker } from "#client/controls/enum-picker.tsx";
import {
  boardSortOptions,
  sortDirectionSummary,
  sortOptions,
} from "#client/controls/property-options.tsx";
import {
  BoardSortSchema,
  defaultSortDirection,
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
  const activeSort: BoardSort = board ? display.boardSort : display.sort;
  const activeDir = board ? display.boardSortDir : display.sortDir;
  const options = board ? boardSortOptions : sortOptions;
  const currentOption = options.find(({ value }) => value === activeSort);
  const dirSummary = sortDirectionSummary(activeSort, activeDir);

  return (
    <div className="sort-control">
      <EnumPicker
        id="sort-picker"
        label="Sort issues"
        value={activeSort}
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
      {activeSort !== "board" && (
        <button
          type="button"
          id="sort-direction"
          className="toolbar-button sort-dir-button"
          aria-label={`Sort direction: ${dirSummary}`}
          onClick={() => {
            const nextDir = oppositeSortDirection(activeDir);
            setParams(writeDisplay(params, { sortDir: nextDir }), {
              preventScrollReset: true,
            });
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
      <span role="status" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
