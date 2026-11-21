import type { ActivityEntry } from "#shared/hub/hub-contract.ts";
import {
  CatalogReconcileRecordSchema,
  type CatalogReconcileRecord,
} from "#shared/model/route-contract.ts";
import { Link } from "@tanstack/react-router";
import { RelativeTime } from "#client/components/time.tsx";
import { ShortSha, TargetLink } from "#client/components/links.tsx";
import { Fact, Facts } from "#client/components/facts.tsx";
import {
  Identifier,
  isOpaqueIdentifier,
} from "#client/components/identifier.tsx";
import { Status } from "#client/components/status.tsx";
import {
  DecisionActivitySchema,
  PublishedActivitySchema,
  RequestedActivitySchema,
  StageActivitySchema,
  foldActivity,
  outcomeOf,
} from "./activity-fold.ts";

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
        <Facts>
          {changed.map(([label, ids]) => (
            <Fact
              key={label}
              label={
                <>
                  {label} ({ids.length})
                </>
              }
              mono
            >
              {ids.join(", ")}
            </Fact>
          ))}
        </Facts>
      )}
      <p className="muted">
        {result.unchanged} unchanged · {result.edges} prerequisite edges ·{" "}
        {result.references} component references
      </p>
    </div>
  );
}

/** An id as people read it: a UUID or digest short, a name as written. */
function Id({ value }: { value: string }) {
  return isOpaqueIdentifier(value) ? (
    <Identifier value={value} />
  ) : (
    <span className="mono">{value}</span>
  );
}

const TARGET_NAMES = {
  build: "Build",
  deployment: "Deployment",
  environment: "Environment",
  versionSet: "Version set",
} as const;

/** What the entry is about, linked when the app has a page for it. */
function Entity({ entry }: { entry: ActivityEntry }) {
  return (
    <span className="activity-entity">
      {entry.target === null ? (
        <Id value={entry.entityId} />
      ) : (
        <TargetLink
          target={entry.target}
          label={`${TARGET_NAMES[entry.target.kind]} ${entry.entityId}`}
        >
          <Id value={entry.entityId} />
        </TargetLink>
      )}
    </span>
  );
}

/** Whether an action records something that failed or now needs an operator. */
export function isFailure(action: string) {
  return /[._]failed$/u.test(action) || action.endsWith("recovery_required");
}

/** The action as recorded; a failure carries the failed status beside it. */
function Action({ action }: { action: string }) {
  return (
    <span className="activity-action">
      {isFailure(action) ? <Status value="failed" label={action} /> : action}
    </span>
  );
}

/** What the common actions recorded beside their entity. */
function Recorded({ entry }: { entry: ActivityEntry }) {
  const outcome = outcomeOf(entry.action);
  // A failure already shows its status beside the action.
  if (outcome !== null)
    return outcome === "failed" ? null : <Status value={outcome} />;
  switch (entry.action) {
    case "deployment.requested": {
      const requested = RequestedActivitySchema.parse(entry.metadata);
      return (
        <>
          {requested.environmentId !== undefined && (
            <span>
              to{" "}
              <Link
                to="/environments/$"
                params={{ _splat: requested.environmentId }}
              >
                {requested.environmentId}
              </Link>
            </span>
          )}
          {requested.versionSetRevisionId !== undefined && (
            <span>
              version set{" "}
              <Link
                to="/versions/$versionSetId"
                params={{ versionSetId: requested.versionSetRevisionId }}
                aria-label={`Version set ${requested.versionSetRevisionId}`}
              >
                <Id value={requested.versionSetRevisionId} />
              </Link>
            </span>
          )}
          {requested.override !== undefined && (
            <span>
              <span className="badge badge-override">Override</span>{" "}
              {requested.override.join("; ")}
            </span>
          )}
        </>
      );
    }
    case "deployment.approve":
    case "deployment.reject": {
      const decision = DecisionActivitySchema.parse(entry.metadata);
      return (
        <>
          <Status
            value={
              entry.action === "deployment.approve" ? "granted" : "rejected"
            }
          />
          {decision.override === true && (
            <span className="badge badge-override">Override</span>
          )}
          {decision.decidedAtPlan === true && <span>at the saved plan</span>}
        </>
      );
    }
    case "build.published": {
      const published = PublishedActivitySchema.parse(entry.metadata);
      return (
        <>
          {published.serviceId !== undefined && (
            <span>{published.serviceId}</span>
          )}
          {published.sourceRevision !== undefined && (
            <span>
              source <ShortSha sha={published.sourceRevision} />
            </span>
          )}
        </>
      );
    }
    default: {
      return null;
    }
  }
}

/** A run of stage writes spans more than a moment when its ends are a minute apart. */
const SPAN_MS = 60_000;

/** One deployment's consecutive stage writes: each stage and what it became, newest first. */
function StageRun({
  entries,
}: {
  entries: [ActivityEntry, ...ActivityEntry[]];
}) {
  const [newest] = entries;
  const oldest = entries.at(-1) ?? newest;
  const spans =
    Date.parse(newest.occurredAt) - Date.parse(oldest.occurredAt) >= SPAN_MS;
  return (
    <li>
      <span className="activity-when">
        <RelativeTime value={newest.occurredAt} />
        {spans && (
          <small className="muted">
            {" "}
            from <RelativeTime value={oldest.occurredAt} />
          </small>
        )}
      </span>
      <Action action={newest.action} />
      <span className="activity-actor">{newest.actor}</span>
      <span className="activity-subject">
        <Entity entry={newest} />
        <ol className="activity-stages">
          {entries.map((entry) => {
            const recorded = StageActivitySchema.parse(entry.metadata);
            return (
              <li key={entry.id}>
                <span className="mono">{recorded.stage}</span>
                <Status value={recorded.status} />
              </li>
            );
          })}
        </ol>
      </span>
    </li>
  );
}

/**
 * The audit trail, one row per entry or stage run: when, what, who, and what
 * it was about. The column labels are for sight; each row reads in order.
 */
export function ActivityList({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) return <p className="empty">No activity yet.</p>;
  return (
    <div className="activity-table">
      <div className="activity-columns" aria-hidden="true">
        <span>When</span>
        <span>Action</span>
        <span>By</span>
        <span>About</span>
      </div>
      <ol className="activity">
        {foldActivity(entries).map((row) => {
          if (row.kind === "stages")
            return <StageRun key={row.entries[0].id} entries={row.entries} />;
          const { entry } = row;
          const catalog =
            entry.action === "catalog.reconciled"
              ? CatalogReconcileRecordSchema.parse(entry.metadata)
              : null;
          return (
            <li key={entry.id}>
              <span className="activity-when">
                <RelativeTime value={entry.occurredAt} />
              </span>
              <Action action={entry.action} />
              <span className="activity-actor">{entry.actor}</span>
              <span className="activity-subject">
                <Entity entry={entry} />
                <Recorded entry={entry} />
              </span>
              {catalog !== null && <CatalogReconcile result={catalog} />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
