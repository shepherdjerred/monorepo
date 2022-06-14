import { Type } from "./Type";
import classnames from "classnames";
import React from "react";

export interface BannerProps {
  message: string;
  type?: Type;
}

export function Banner({
  message,
  type = Type.PRIMARY,
}: BannerProps): React.ReactElement {
  const classes = classnames({
    "py-5": true,
    "px-5": true,
    "rounded-xl": true,
    "my-4": true,
    "text-white": true,
    "bg-red-100 dark:bg-red-500": type === Type.DANGER,
    "bg-green-100 dark:bg-green-500": type === Type.SUCCESS,
    "bg-yellow-100 dark:bg-yellow-500": type === Type.WARNING,
    "bg-blue-100 dark:bg-blue-500": type === Type.PRIMARY,
  });

  return <div className={classes}>{message}</div>;
}
