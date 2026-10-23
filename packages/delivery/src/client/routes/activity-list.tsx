import type { ActivityEntry } from "#shared/hub/hub-contract.ts";
import {
  CatalogReconcileRecordSchema,
  type CatalogReconcileRecord,
} from "#shared/model/route-contract.ts";
import { RelativeTime } from "#client/components/time.tsx";
import { TargetLink } from "#client/components/links.tsx";

/** One catalog reconcile: what the document created, renamed, rebound, retired and refused (4.1). */
function CatalogReconcile({ result }: { result: CatalogReconcileRecord }) {
  const rows = [
    ["Services created", result.services.created],
    ["Service lineage changed", result.services.lineageChanged],
    ["Services retired", result.services.retired],
    ["Environments created", result.environments.created],
    [
      "Environments renamed",
      result.environments.renamed.map((entry) => `${entry.from} → ${entry.to}`),
    ],
    ["Environments rebound", result.environments.rebound],
    ["Environments retired", result.environments.retired],
    ["Selections carried", result.environments.carried],
    ["Recipe revisions created", result.recipes.created],
    ["Configuration revisions created", result.configurations.created],
    ["Refused", result.refused.map((entry) => `${entry.id}: ${entry.reason}`)],
  ] as const;
  const changed = rows.filter(([, ids]) => ids.length > 0);
  return (
    <div className="catalog-result">
      {changed.length === 0 ? (
        <p className="muted">
          The record already matched the catalog document.
        </p>
      ) : (
        <dl className="facts">
          {changed.map(([label, ids]) => (
            <div key={label}>
              <dt>
                {label} ({ids.length})
              </dt>
              <dd className="mono">{ids.join(", ")}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="muted">
        {result.unchanged} unchanged · {result.edges} prerequisite edges ·{" "}
        {result.references} component references
      </p>
    </div>
  );
}

export function ActivityList({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) return <p className="empty">No activity yet.</p>;
  return (
    <ol className="activity">
      {entries.map((entry) => {
        const catalog =
          entry.action === "catalog.reconciled"
            ? CatalogReconcileRecordSchema.parse(entry.metadata)
            : null;
        return (
          <li key={entry.id}>
            <RelativeTime value={entry.occurredAt} />
            <span className="activity-action">{entry.action}</span>
            <span className="activity-entity mono">
              {entry.target === null ? (
                entry.entityId
              ) : (
                <TargetLink target={entry.target}>{entry.entityId}</TargetLink>
              )}
            </span>
            <span className="muted">{entry.actor}</span>
            {catalog !== null && <CatalogReconcile result={catalog} />}
          </li>
        );
      })}
    </ol>
  );
}
