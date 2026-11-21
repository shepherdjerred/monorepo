import { Link } from "@tanstack/react-router";
import type { ApprovalQueueItem } from "#shared/model/contract.ts";
import { Status } from "#client/components/status.tsx";
import {
  RelativeTime,
  relativeTime,
  useNow,
} from "#client/components/time.tsx";
import {
  Identifier,
  Revision,
  revisionLabel,
  shortIdentifier,
} from "#client/components/identifier.tsx";
import { Disclosure } from "#client/components/disclosure.tsx";
import { awaitsDecision } from "./view.ts";

/** The catalog names an approval row leads with: a service and its environments. */
export type ApprovalCatalog = readonly {
  id: string;
  title: string;
  environments: readonly { id: string; name: string }[];
}[];

/** A deployment whose list row carries its set revision's number. */
export type KnownRevision = { id: string; versionSetRevision: number };

type Names = {
  service: (item: ApprovalQueueItem) => string;
  environment: (item: ApprovalQueueItem) => string;
  revision: (item: ApprovalQueueItem) => number | undefined;
};

function namesFrom(
  services: ApprovalCatalog,
  revisions: readonly KnownRevision[],
): Names {
  const titles = new Map(
    services.map((service) => [service.id, service.title]),
  );
  const environments = new Map(
    services.flatMap((service) =>
      service.environments.map((environment) => [
        environment.id,
        environment.name,
      ]),
    ),
  );
  const numbers = new Map(
    revisions.map((row) => [row.id, row.versionSetRevision]),
  );
  return {
    service: (item) => titles.get(item.serviceId) ?? item.serviceId,
    environment: (item) =>
      environments.get(item.environmentId) ?? item.environmentId,
    revision: (item) => numbers.get(item.id),
  };
}

function ApprovalState({ item }: { item: ApprovalQueueItem }) {
  return (
    <span className="detail-summary">
      <Status value={item.approval?.status ?? item.status} />
      {item.approval?.override === true && (
        <span className="badge badge-override">Override</span>
      )}
      {item.awaitingPlanDecision && (
        <span className="badge">Saved plan awaits decision</span>
      )}
    </span>
  );
}

/** The set revision the deployment would select: its number when known, else its short id. */
function Release({
  item,
  number,
}: {
  item: ApprovalQueueItem;
  number: number | undefined;
}) {
  const id = item.selection?.versionSetRevisionId ?? item.versionSetRevisionId;
  const label =
    number === undefined ? shortIdentifier(id) : revisionLabel(number);
  return (
    <>
      <Link
        to="/versions/$versionSetId"
        params={{ versionSetId: id }}
        aria-label={`Version set ${label}`}
      >
        {number === undefined ? (
          <Identifier value={id} />
        ) : (
          <Revision revision={number} />
        )}
      </Link>
      {item.selection !== null && (
        <small>
          recipe <Identifier value={item.selection.recipeRevisionId} /> ·
          configuration{" "}
          <Identifier value={item.selection.configurationRevisionId} />
        </small>
      )}
    </>
  );
}

function ApprovalRow({
  item,
  names,
}: {
  item: ApprovalQueueItem;
  names: Names;
}) {
  const at = useNow();
  const number = names.revision(item);
  const release = number === undefined ? "" : ` ${revisionLabel(number)}`;
  return (
    <tr>
      <th scope="row">
        <Link
          to="/deployments/$deploymentId"
          params={{ deploymentId: item.id }}
          aria-label={`Deployment to ${item.environmentId}, ${item.kind}${release}, requested ${relativeTime(item.createdAt, at)}`}
        >
          {names.service(item)} · {names.environment(item)}
        </Link>
        <small>
          {item.kind}
          {release}
        </small>
      </th>
      <td data-label="Approval">
        <ApprovalState item={item} />
      </td>
      <td data-label="Release">
        <Release item={item} number={number} />
      </td>
      <td data-label="Requested">
        <RelativeTime value={item.createdAt} />
        <small>{item.requestedBy}</small>
      </td>
    </tr>
  );
}

function ApprovalTable({
  items,
  caption,
  names,
}: {
  items: ApprovalQueueItem[];
  caption: string;
  names: Names;
}) {
  return (
    <div className="table-scroll stack-table">
      <table>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Deployment</th>
            <th scope="col">Approval</th>
            <th scope="col">Release</th>
            <th scope="col">Requested</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <ApprovalRow key={item.id} item={item} names={names} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Approvals waiting for a decision first and apart, then those recently
 * decided, then the expired ones collapsed behind their count (4.13). Each row
 * leads with its service and environment as the overview names them.
 */
export function ApprovalQueue({
  items,
  services = [],
  revisions = [],
}: {
  items: ApprovalQueueItem[];
  services?: ApprovalCatalog;
  revisions?: readonly KnownRevision[];
}) {
  const names = namesFrom(services, revisions);
  const waiting = items.filter((item) => awaitsDecision(item));
  const expired = items.filter((item) => item.approval?.status === "expired");
  const decided = items.filter(
    (item) =>
      item.approval?.status === "granted" ||
      item.approval?.status === "rejected",
  );
  return (
    <>
      <section
        className={waiting.length === 0 ? "panel" : "panel panel-waiting"}
        aria-labelledby="waiting-heading"
      >
        <h2 id="waiting-heading">
          Waiting for a decision
          {waiting.length > 0 && (
            <span className="muted"> ({waiting.length})</span>
          )}
        </h2>
        {waiting.length === 0 ? (
          <p className="empty">Nothing is waiting for approval.</p>
        ) : (
          <>
            {waiting.some((item) => item.approval?.override === true) && (
              <p className="muted">
                An override approval admits a set revision that is not eligible
                for an ordinary deploy.
              </p>
            )}
            <ApprovalTable
              items={waiting}
              caption="Waiting for a decision"
              names={names}
            />
          </>
        )}
      </section>
      {decided.length > 0 && (
        <section className="panel" aria-labelledby="decided-heading">
          <h2 id="decided-heading">Recently decided</h2>
          <ApprovalTable
            items={decided}
            caption="Recently decided approvals"
            names={names}
          />
        </section>
      )}
      {expired.length > 0 && (
        <section className="panel" aria-labelledby="expired-heading">
          <h2 id="expired-heading">Expired</h2>
          <p className="muted">
            An approval expires when the environment&apos;s binding generation
            moves after the request; request the release again to decide it.
          </p>
          <Disclosure summary="Expired approvals" count={expired.length}>
            <ApprovalTable
              items={expired}
              caption="Expired approvals"
              names={names}
            />
          </Disclosure>
        </section>
      )}
    </>
  );
}
