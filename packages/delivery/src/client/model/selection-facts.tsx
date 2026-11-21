import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { UseQueryResult } from "@tanstack/react-query";
import type { Selection } from "#shared/model/contract.ts";
import { ErrorNotice } from "#client/components/notices.tsx";
import { selectionCoordinates } from "./view.ts";
import { Fact, Facts } from "#client/components/facts.tsx";
import { Identifier, Revision } from "#client/components/identifier.tsx";

/** Version-set id to revision number, for the set revisions a page has loaded. */
export type RevisionNumbers = ReadonlyMap<string, number>;

/**
 * A set revision as people say it. With the page's revision numbers it reads
 * `r274`, or a short id when the page has not loaded that set revision;
 * without them it is the id itself.
 */
export function SetRevision({
  id,
  revisions,
}: {
  id: string;
  revisions?: RevisionNumbers | undefined;
}) {
  const revision = revisions?.get(id);
  if (revision !== undefined) return <Revision revision={revision} />;
  return revisions === undefined ? id : <Identifier value={id} />;
}

/** A set revision linked to its version page. */
export function SetRevisionLink({
  id,
  revisions,
}: {
  id: string;
  revisions?: RevisionNumbers | undefined;
}) {
  return (
    <Link
      to="/versions/$versionSetId"
      params={{ versionSetId: id }}
      className={revisions?.has(id) === true ? undefined : "mono"}
    >
      <SetRevision id={id} revisions={revisions} />
    </Link>
  );
}

/** One selection (4.9): set revision, recipe revision and configuration revision. */
export function SelectionFacts({
  selection,
  revisions,
}: {
  selection: Selection;
  revisions?: RevisionNumbers | undefined;
}) {
  const [set, ...coordinates] = selectionCoordinates(selection);
  return (
    <Facts>
      <Fact label={set.label}>
        <SetRevisionLink id={set.value} revisions={revisions} />
      </Fact>
      {coordinates.map((coordinate) => (
        <Fact key={coordinate.label} label={coordinate.label} mono>
          {coordinate.value}
        </Fact>
      ))}
    </Facts>
  );
}

/**
 * The deployment that froze a selection; within an environment it names it
 * (L1). `short` shows the id's short form and keeps the whole id in the
 * link's name and title.
 */
export function DeploymentLink({
  id,
  short = false,
}: {
  id: string;
  short?: boolean;
}) {
  return (
    <Link
      to="/deployments/$deploymentId"
      params={{ deploymentId: id }}
      className="mono"
    >
      {short ? <Identifier value={id} /> : id}
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
