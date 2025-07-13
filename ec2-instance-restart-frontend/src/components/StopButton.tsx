import React from "react";
import Button from "./Button";

export interface StopButtonProps {
  onClick: () => void;
  isLoading: boolean;
  isActive: boolean;
}

export default function StopButton(props: StopButtonProps): React.ReactElement {
  return <Button text="Stop" classes={"is-danger"} {...props} />;
}
