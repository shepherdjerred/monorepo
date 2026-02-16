import { faQuestionCircle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import * as React from "react";
import "./TipsButton.css";

export interface TipsButtonProps {
  onClick: () => void;
}

export function TipsButton({ onClick }: TipsButtonProps): React.ReactElement {
  return (
    <div className="tips-button">
      <button className="button is-rounded is-primary is-outlined" onClick={onClick}>
        <span className="is-icon is-small">
          <FontAwesomeIcon icon={faQuestionCircle} />
        </span>
      </button>
    </div>
  );
}
