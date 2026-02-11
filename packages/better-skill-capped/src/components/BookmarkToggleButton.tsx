import { Bookmarkable } from "../model/Bookmark";
import React from "react";
import { ToggleButton } from "./ToggleButton";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBookmark } from "@fortawesome/free-solid-svg-icons";

export interface BookmarkButtonProps {
  item: Bookmarkable;
  isBookmarked: boolean;
  onToggleBookmark: (item: Bookmarkable) => void;
}

export function ToggleBookmarkButton(props: BookmarkButtonProps): React.ReactElement {
  const { item, isBookmarked, onToggleBookmark } = props;

  return (
    <ToggleButton
      status={isBookmarked}
      onToggle={() => {
        onToggleBookmark(item);
      }}
      buttonText={(status) => {
        return (
          <React.Fragment>
            <span className="icon is-small">
              <FontAwesomeIcon icon={faBookmark} />
            </span>
            <span>{status ? "Unbookmark" : "Bookmark"}</span>
          </React.Fragment>
        );
      }}
      classes={"is-warning is-light"}
    />
  );
}
