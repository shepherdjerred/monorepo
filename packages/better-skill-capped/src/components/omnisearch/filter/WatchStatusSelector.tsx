import React from "react";

export interface WatchStatusSelectorProps {
  onlyShowUnwatched: boolean;
  onlyShowWatched: boolean;
  onSelectionChange: (onlyShowUnwatched: boolean, onlyShowWatched: boolean) => void;
}

export default function WatchStatusSelector({
  onlyShowUnwatched,
  onlyShowWatched,
  onSelectionChange,
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
                checked={onlyShowUnwatched}
                onChange={() => {
                  onSelectionChange(!onlyShowUnwatched, onlyShowWatched);
                }}
              />{" "}
              Only show unwatched
            </label>
          </div>
          <div className="field">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={onlyShowWatched}
                onChange={() => {
                  onSelectionChange(onlyShowUnwatched, !onlyShowWatched);
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
