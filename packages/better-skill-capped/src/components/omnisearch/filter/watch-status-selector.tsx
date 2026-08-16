import React from "react";
import type { WatchedFilter } from "./filters.ts";

export type WatchStatusSelectorProps = {
  value: WatchedFilter;
  onChange: (newValue: WatchedFilter) => void;
};

export default function WatchStatusSelector({
  value,
  onChange,
}: WatchStatusSelectorProps): React.ReactElement {
  return (
    <nav className="panel">
      <p className="panel-heading">Watch Status</p>
      <div className="panel-block">
        <div className="control">
          <div className="field">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={value === "unwatched"}
                onChange={() => {
                  onChange(value === "unwatched" ? "any" : "unwatched");
                }}
              />{" "}
              Only show unwatched
            </label>
          </div>
          <div className="field">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={value === "watched"}
                onChange={() => {
                  onChange(value === "watched" ? "any" : "watched");
                }}
              />{" "}
              Only show watched
            </label>
          </div>
        </div>
      </div>
    </nav>
  );
}
