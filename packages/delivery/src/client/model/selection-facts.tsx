import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { UseQueryResult } from "@tanstack/react-query";
import type { Selection } from "#shared/model/contract.ts";
import { ErrorNotice } from "#client/components/notices.tsx";
import { selectionCoordinates } from "./view.ts";
import { Fact, Facts } from "#client/components/facts.tsx";
import {
  Identifier,
  Revision,
  revisionLabel,
  shortIdentifier,
} from "#client/components/identifier.tsx";

/** Version-set id to revision number, for the set revisions a page has loaded. */
export type RevisionNumbers = ReadonlyMap<string, number>;

/** The revision number a deployment page has loaded: its own set revision's. */
export function deploymentRevisions(detail: {
  versionSet: { id: string; revision: number };
}): RevisionNumbers {
  return new Map([[detail.versionSet.id, detail.versionSet.revision]]);
}

/** A set revision's name as text, for an accessible name or a title: `r274`, else its short id. */
export function releaseName(id: string, revisions?: RevisionNumbers) {
  const revision = revisions?.get(id);
  return revision === undefined ? shortIdentifier(id) : revisionLabel(revision);
}

/**
 * A set revision as people say it: `r274` when the page has loaded its
 * number, else the short form of its id, whole in the title.
 */
export function SetRevision({
  id,
  revisions,
}: {
  id: string;
  revisions?: RevisionNumbers | undefined;
}) {
  const revision = revisions?.get(id);
  return revision === undefined ? (
    <Identifier value={id} />
  ) : (
    <Revision revision={revision} id={id} />
  );
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
  label,
}: {
  id: string;
  short?: boolean;
  /** Words that name the deployment, such as "the deploy of r391", in place of its id. */
  label?: string;
}) {
  return label === undefined ? (
    <Link
      to="/deployments/$deploymentId"
      params={{ deploymentId: id }}
      className="mono"
    >
      {short ? <Identifier value={id} /> : id}
    </Link>
  ) : (
    <Link to="/deployments/$deploymentId" params={{ deploymentId: id }}>
      {label}
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
