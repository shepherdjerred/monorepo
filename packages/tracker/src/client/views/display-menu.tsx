import { useSearchParams } from "react-router";
import { Popover } from "@base-ui/react/popover";
import { SlidersHorizontal } from "lucide-react";
import { EnumPicker } from "#client/controls/enum-picker.tsx";
import {
  groupOptions,
  sortOptions,
} from "#client/controls/property-options.tsx";
import {
  GroupBySchema,
  readDisplay,
  rowProperties,
  SortSchema,
  writeDisplay,
  type DisplayOptions,
  type RowProperty,
} from "./display-options.ts";

const propertyNames: Record<RowProperty, string> = {
  labels: "Labels",
  project: "Project",
  date: "Updated",
  due: "Due date",
  assignee: "Assignee",
};

/**
 * Grouping, ordering and which properties rows show. Every choice is in the
 * address, so the view can be shared; the board orders by its columns.
 */
export function DisplayMenu({ board }: { board: boolean }) {
  const [params, setParams] = useSearchParams();
  const display = readDisplay(params);
  const write = (change: Partial<DisplayOptions>) => {
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
          <Popover.Popup className="picker-popup display-popover">
            <Popover.Title className="popover-title">Display</Popover.Title>
            {!board && (
              <>
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
                <label className="display-row">
                  <span>Ordering</span>
                  <EnumPicker
                    id="display-sort"
                    label="Ordering"
                    value={display.sort}
                    options={sortOptions}
                    onChange={(value) => {
                      write({ sort: SortSchema.parse(value) });
                    }}
                  />
                </label>
              </>
            )}
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
