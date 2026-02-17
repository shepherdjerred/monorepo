import classnames from "classnames";
import React from "react";
import { Type } from "./Type";

export interface ButtonProps {
  text: string;
  type: Type;
  disabled?: boolean;
  onClick?: () => void;
}

export default function Button({
  text,
  type,
  disabled,
  onClick,
}: ButtonProps): React.ReactElement {
  const classes = classnames({
    "py-1": true,
    "px-3": true,
    "rounded-xl": true,
    "my-4": true,
    "cursor-not-allowed dark:bg-gray-500 bg-gray-100": disabled,
    "bg-red-100 dark:bg-red-500 hover:bg-red-400":
      type === Type.DANGER && !disabled,
    "bg-green-100 dark:bg-green-500 hover:bg-green-400":
      type === Type.SUCCESS && !disabled,
    "bg-yellow-100 dark:bg-yellow-500 hover:bg-yellow-400":
      type === Type.WARNING && !disabled,
  });

  return (
    <button className={classes} disabled={disabled} onClick={onClick}>
      {text}
    </button>
  );
}
