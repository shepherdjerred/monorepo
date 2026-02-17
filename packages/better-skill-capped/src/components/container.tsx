import classNames from "classnames";
import React from "react";

export type ContainerProps = {
  sidebar?: React.ReactNode;
  children: React.ReactNode;
};

export function Container({
  children,
  sidebar,
}: ContainerProps): React.ReactElement {
  const mainColumnClasses: string = classNames({
    column: true,
    "is-three-fifths": sidebar !== undefined,
    "is-four-fifths": sidebar === undefined,
    "is-offset-1": sidebar === undefined,
  });
  return (
    <section className="section">
      <div className="columns">
        {sidebar !== undefined && (
          <div className="column is-one-fifth is-offset-1">{sidebar}</div>
        )}
        <div className={mainColumnClasses}>{children}</div>
      </div>
    </section>
  );
}
