import classNames from "classnames";
import React from "react";

export enum Status {
  LOADING,
  SUCCESS,
  ERROR,
}

export interface Notification {
  status: Status;
  message?: string;
}

export default function Notification({ status, message }: Notification): React.ReactElement {
  return (
    <div
      className={classNames({
        notification: true,
        "is-danger": status === Status.ERROR,
        "is-primary": status === Status.SUCCESS,
      })}
    >
      {message}
    </div>
  );
}
