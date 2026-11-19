import { useSearchParams } from "react-router";
import { Popover } from "@base-ui/react/popover";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  SlidersHorizontal,
} from "lucide-react";
import { EnumPicker } from "#client/controls/enum-picker.tsx";
import {
  boardSortOptions,
  groupOptions,
  sortDirectionSummary,
  sortOptions,
} from "#client/controls/property-options.tsx";
import {
  BoardSortSchema,
  GroupBySchema,
  oppositeSortDirection,
  readDisplay,
  rowProperties,
  SortSchema,
  writeDisplay,
  type DisplayChanges,
  type RowProperty,
} from "./display-options.ts";
import { leavingPopup } from "#client/ui/leaving.tsx";

const propertyNames: Record<RowProperty, string> = {
  labels: "Labels",
  effort: "Effort",
  project: "Project",
  date: "Updated",
  due: "Due date",
  assignee: "Assignee",
};

/**
 * Grouping, ordering and which properties rows or cards show. Every choice is
 * in the address, so the view can be shared.
 */
export function DisplayMenu({ board }: { board: boolean }) {
  const [params, setParams] = useSearchParams();
  const display = readDisplay(params);
  const activeSort = board ? display.boardSort : display.sort;
  const activeDir = board ? display.boardSortDir : display.sortDir;
  const write = (change: DisplayChanges) => {
    setParams(writeDisplay(params, change), { preventScrollReset: true });
  };
  return (
    <Popover.Root>
      <Popover.Trigger id="display-button" className="toolbar-button">
        <SlidersHorizontal size={14} aria-hidden="true" />
        <span>Display</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="picker-positioner"
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={8}
        >
          <Popover.Popup
            className="picker-popup display-popover"
            render={leavingPopup}
          >
            <Popover.Title className="popover-title">Display</Popover.Title>
            {!board && (
              <label className="display-row">
                <span>Grouping</span>
                <EnumPicker
                  id="display-group"
                  label="Grouping"
                  value={display.groupBy}
                  options={groupOptions}
                  onChange={(value) => {
                    write({ groupBy: GroupBySchema.parse(value) });
                  }}
                />
              </label>
            )}
            <div className="display-row">
              <span>Ordering</span>
              <div className="display-order-controls">
                <EnumPicker
                  id="display-sort"
                  label="Ordering"
                  value={activeSort}
                  options={board ? boardSortOptions : sortOptions}
                  onChange={(value) => {
                    if (board) {
                      write({ boardSort: BoardSortSchema.parse(value) });
                    } else {
                      write({ sort: SortSchema.parse(value) });
                    }
                  }}
                />
                {activeSort !== "board" && (
                  <button
                    type="button"
                    id="display-sort-direction"
                    className="toolbar-button sort-dir-button"
                    aria-label={`Ordering direction: ${sortDirectionSummary(activeSort, activeDir)}`}
                    onClick={() => {
                      write({ sortDir: oppositeSortDirection(activeDir) });
                    }}
                  >
                    {activeDir === "desc" ? (
                      <ArrowDownWideNarrow size={14} aria-hidden="true" />
                    ) : (
                      <ArrowUpNarrowWide size={14} aria-hidden="true" />
                    )}
                  </button>
                )}
              </div>
            </div>
            <label className="display-row display-switch">
              <span>Show sub-issues</span>
              <input
                type="checkbox"
                role="switch"
                id="display-subissues"
                checked={display.showSubIssues}
                onChange={(event) => {
                  write({ showSubIssues: event.target.checked });
                }}
              />
            </label>
            <fieldset className="display-properties">
              <legend>Show on {board ? "cards" : "rows"}</legend>
              <div>
                {rowProperties.map((property) => {
                  const shown = !display.hidden.has(property);
                  return (
                    <button
                      type="button"
                      key={property}
                      className="toggle-chip"
                      aria-pressed={shown}
                      onClick={() => {
                        const hidden = new Set(display.hidden);
                        if (shown) {
                          hidden.add(property);
                        } else {
                          hidden.delete(property);
                        }
                        write({ hidden });
                      }}
                    >
                      {propertyNames[property]}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
