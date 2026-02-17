import React from "react";

export interface ButtonProps {
  children: React.ReactElement | React.ReactElement[];
}

export default function Buttons({ children }: ButtonProps): React.ReactElement {
  return <div className="field is-grouped">{children}</div>;
}
