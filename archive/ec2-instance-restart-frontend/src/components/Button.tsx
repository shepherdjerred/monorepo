import classNames from "classnames";
import React from "react";

export interface ButtonProps {
  text: string;
  classes: string | string[];
  onClick: () => void;
  isLoading: boolean;
  isActive: boolean;
}

export default function Button({ text, classes, onClick, isActive, isLoading }: ButtonProps): React.ReactElement {
  return (
    <p className="control">
      <button
        onClick={onClick}
        className={classNames(classes, {
          button: true,
          "is-loading": isLoading,
        })}
        disabled={isActive}
      >
        {text}
      </button>
    </p>
  );
}
