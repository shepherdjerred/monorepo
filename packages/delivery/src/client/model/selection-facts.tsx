import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { UseQueryResult } from "@tanstack/react-query";
import type { Selection } from "#shared/model/contract.ts";
import { ErrorNotice } from "#client/components/notices.tsx";
import { selectionCoordinates } from "./view.ts";
import { Fact, Facts } from "#client/components/facts.tsx";

/** One selection (4.9): set revision, recipe revision and configuration revision. */
export function SelectionFacts({ selection }: { selection: Selection }) {
  const [set, ...revisions] = selectionCoordinates(selection);
  return (
    <Facts>
      <Fact label={set.label}>
        <Link
          to="/versions/$versionSetId"
          params={{ versionSetId: set.value }}
          className="mono"
        >
          {set.value}
        </Link>
      </Fact>
      {revisions.map((coordinate) => (
        <Fact key={coordinate.label} label={coordinate.label} mono>
          {coordinate.value}
        </Fact>
      ))}
    </Facts>
  );
}

/** The deployment that froze a selection; within an environment it names it (L1). */
export function DeploymentLink({ id }: { id: string }) {
  return (
    <Link
      to="/deployments/$deploymentId"
      params={{ deploymentId: id }}
      className="mono"
    >
      {id}
    </Link>
  );
}

/** A panel whose body is one query; a failed read degrades only this panel. */
export function QueryPanel<T>({
  id,
  title,
  query,
  children,
}: {
  id: string;
  title: string;
  query: Pick<UseQueryResult<T>, "data" | "error">;
  children: (data: T) => ReactNode;
}) {
  const heading = `${id}-heading`;
  return (
    <section className="panel" aria-labelledby={heading}>
      <h2 id={heading}>{title}</h2>
      {query.data === undefined ? (
        query.error === null ? (
          <p className="pending" role="status">
            Loading…
          </p>
        ) : (
          <ErrorNotice error={query.error} />
        )
      ) : (
        children(query.data)
      )}
    </section>
  );
}
