import React from "react";
import type { BookmarkedFilter } from "./filters.ts";

export type BookmarkStatusSelectorProps = {
  value: BookmarkedFilter;
  onChange: (newValue: BookmarkedFilter) => void;
};

export default function BookmarkStatusSelector({
  value,
  onChange,
}: BookmarkStatusSelectorProps): React.ReactElement {
  return (
    <nav className="panel">
      <p className="panel-heading">Bookmark Status</p>
      <div className="panel-block">
        <div className="control">
          <div className="field">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={value === "bookmarked"}
                onChange={() => {
                  onChange(value === "bookmarked" ? "any" : "bookmarked");
                }}
              />{" "}
              Only show bookmarked
            </label>
          </div>
          <div className="field">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={value === "unbookmarked"}
                onChange={() => {
                  onChange(value === "unbookmarked" ? "any" : "unbookmarked");
                }}
              />{" "}
              Only show unbookmarked
            </label>
          </div>
        </div>
      </div>
    </nav>
  );
}
