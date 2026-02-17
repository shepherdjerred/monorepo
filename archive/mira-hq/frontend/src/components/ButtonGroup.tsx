import React from "react";

export interface ButtonGroupProps {
  children: React.ReactNode[];
}

export function ButtonGroup({
  children,
}: ButtonGroupProps): React.ReactElement {
  return <div className={"space-x-1"}>{children}</div>;
}
