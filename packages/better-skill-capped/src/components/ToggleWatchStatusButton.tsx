import React from "react";
import { ToggleButton } from "./ToggleButton";
import { Watchable } from "../model/WatchStatus";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEye, faEyeSlash } from "@fortawesome/free-solid-svg-icons";

export interface ToggleWatchStatusButtonProps {
  item: Watchable;
  isWatched: boolean;
  onToggleWatchStatus: (item: Watchable) => void;
}

export function ToggleWatchStatusButton(props: ToggleWatchStatusButtonProps): React.ReactElement {
  const { item, isWatched, onToggleWatchStatus } = props;
  const watchToggleIcon = isWatched ? faEyeSlash : faEye;

  return (
    <ToggleButton
      status={isWatched}
      onToggle={() => {
        onToggleWatchStatus(item);
      }}
      buttonText={(status) => {
        return (
          <React.Fragment>
            <span className="icon is-small">
              <FontAwesomeIcon icon={watchToggleIcon} />
            </span>
            <span>{status ? "Mark as unwatched" : "Mark as watched"}</span>
          </React.Fragment>
        );
      }}
    />
  );
}
