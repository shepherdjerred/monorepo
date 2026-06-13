import { faSpinner } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import React from "react";

export default function Spinner(): React.ReactElement {
  return <FontAwesomeIcon icon={faSpinner} className={"animate-spin"} />;
}
