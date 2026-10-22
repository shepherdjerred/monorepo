import { Link } from "@tanstack/react-router";
import type { ApprovalQueueItem } from "#shared/model/contract.ts";
import { Status } from "#client/components/status.tsx";
import { RelativeTime } from "#client/components/time.tsx";
import { awaitsDecision } from "./view.ts";

function ApprovalState({ item }: { item: ApprovalQueueItem }) {
  return (
    <span className="detail-summary">
      <Status value={item.approval?.status ?? item.status} />
      {item.approval?.override === true && (
        <span className="badge badge-override">Override</span>
      )}
    </span>
  );
}

function ApprovalTable({
  items,
  caption,
}: {
  items: ApprovalQueueItem[];
  caption: string;
}) {
  return (
    <div className="table-scroll">
      <table>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Deployment</th>
            <th scope="col">Approval</th>
            <th scope="col">Selection</th>
            <th scope="col">Requested</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <th scope="row">
                <Link
                  to="/deployments/$deploymentId"
                  params={{ deploymentId: item.id }}
                >
                  {item.environmentId}
                </Link>
                <small>{item.kind}</small>
              </th>
              <td>
                <ApprovalState item={item} />
              </td>
              <td className="mono">
                {item.selection === null ? (
                  item.versionSetRevisionId
                ) : (
                  <>
                    {item.selection.versionSetRevisionId}
                    <small>
                      {item.selection.recipeRevisionId} ·{" "}
                      {item.selection.configurationRevisionId}
                    </small>
                  </>
                )}
              </td>
              <td>
                <RelativeTime value={item.createdAt} />
                <small>{item.requestedBy}</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Approvals waiting for a decision, then those that lapsed or were decided (4.13). */
export function ApprovalQueue({ items }: { items: ApprovalQueueItem[] }) {
  const waiting = items.filter((item) => awaitsDecision(item));
  const expired = items.filter((item) => item.approval?.status === "expired");
  const decided = items.filter(
    (item) =>
      item.approval?.status === "granted" ||
      item.approval?.status === "rejected",
  );
  return (
    <>
      <section className="panel" aria-labelledby="waiting-heading">
        <h2 id="waiting-heading">Waiting for a decision</h2>
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
            <ApprovalTable items={waiting} caption="Waiting for a decision" />
          </>
        )}
      </section>
      {expired.length > 0 && (
        <section className="panel" aria-labelledby="expired-heading">
          <h2 id="expired-heading">Expired</h2>
          <p className="muted">
            An approval expires when the environment&apos;s binding generation
            moves after the request; request the release again to decide it.
          </p>
          <ApprovalTable items={expired} caption="Expired approvals" />
        </section>
      )}
      {decided.length > 0 && (
        <section className="panel" aria-labelledby="decided-heading">
          <h2 id="decided-heading">Recently decided</h2>
          <ApprovalTable items={decided} caption="Recently decided approvals" />
        </section>
      )}
    </>
  );
}
