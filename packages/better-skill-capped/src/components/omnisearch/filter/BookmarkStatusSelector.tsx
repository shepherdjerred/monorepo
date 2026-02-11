import React from "react";

export interface BookmarkStatusSelectorProps {
  onlyShowBookmarked: boolean;
  onlyShowUnbookmarked: boolean;
  onSelectionChange: (onlyShowBookmarked: boolean, onlyShowUnbookmarked: boolean) => void;
}

export default function BookmarkStatusSelector({
  onlyShowBookmarked,
  onlyShowUnbookmarked,
  onSelectionChange,
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
                checked={onlyShowBookmarked}
                onChange={() => {
                  onSelectionChange(!onlyShowBookmarked, onlyShowUnbookmarked);
                }}
              />{" "}
              Only show bookmarked
            </label>
          </div>
          <div className="field">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={onlyShowUnbookmarked}
                onChange={() => {
                  onSelectionChange(onlyShowBookmarked, !onlyShowUnbookmarked);
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
