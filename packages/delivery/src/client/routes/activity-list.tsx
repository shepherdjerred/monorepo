import type {
  ActivityEntry,
  ActivitySubject,
} from "#shared/hub/hub-contract.ts";
import {
  CatalogReconcileRecordSchema,
  type CatalogReconcileRecord,
} from "#shared/model/route-contract.ts";
import { Link } from "@tanstack/react-router";
import { RelativeTime } from "#client/components/time.tsx";
import { ShortSha, TargetLink } from "#client/components/links.tsx";
import { Fact, Facts } from "#client/components/facts.tsx";
import { Disclosure } from "#client/components/disclosure.tsx";
import {
  Identifier,
  Revision,
  isOpaqueIdentifier,
} from "#client/components/identifier.tsx";
import {
  CatalogName,
  catalogNames,
  type CatalogNames,
} from "#client/components/catalog-name.tsx";
import { Status } from "#client/components/status.tsx";
import type { CatalogService } from "./catalog-filter.ts";
import {
  DecisionActivitySchema,
  PublishedActivitySchema,
  RequestedActivitySchema,
  foldActivity,
  latestStages,
  outcomeOf,
} from "./activity-fold.ts";
import { actionLabel } from "./activity-labels.ts";

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

/**
 * Where an entry's deployment, build or version set belongs: its environment
 * (or service) by name and the release it carries, when the list read them.
 */
function Subject({
  subject,
  names,
  release,
}: {
  subject: ActivitySubject;
  names: CatalogNames;
  /** Whether to name the release here; a version set entry already shows it as its link. */
  release: boolean;
}) {
  return (
    <span className="activity-where">
      {subject.environmentId === null ? (
        <CatalogName
          name={names.service(subject.serviceId)}
          slug={subject.serviceId}
        />
      ) : (
        <CatalogName
          name={names.environment(subject.environmentId)}
          slug={subject.environmentId}
        />
      )}
      {release && subject.revision !== null && (
        <>
          {" · "}
          <Revision revision={subject.revision} />
        </>
      )}
    </span>
  );
}

/**
 * What the entry is about, linked when the app has a page for it, with the
 * service, environment and release it belongs to beside it. A version set is
 * named by its release number.
 */
function Entity({
  entry,
  names,
  where = true,
}: {
  entry: ActivityEntry;
  names: CatalogNames;
  /** Whether to say where the entity belongs; a request names it itself. */
  where?: boolean;
}) {
  const subject = entry.subject ?? null;
  // A version set is named by its release number when the list read it.
  const release =
    entry.target?.kind === "versionSet" ? (subject?.revision ?? null) : null;
  const asRelease = release !== null;
  const text =
    release === null ? (
      <Id value={entry.entityId} />
    ) : (
      <Revision revision={release} />
    );
  return (
    <span className="activity-entity">
      {entry.target === null ? (
        text
      ) : (
        <TargetLink
          target={entry.target}
          label={`${TARGET_NAMES[entry.target.kind]} ${entry.entityId}`}
        >
          {text}
        </TargetLink>
      )}
      {where && subject !== null && (
        <Subject subject={subject} names={names} release={!asRelease} />
      )}
    </span>
  );
}

/** Whether an action records something that failed or now needs an operator. */
export function isFailure(action: string) {
  return /[._]failed$/u.test(action) || action.endsWith("recovery_required");
}

/**
 * The action in plain words, its recorded code in the title; a failure
 * carries the failed status beside it. `count` is how many times a folded
 * run repeated it.
 */
function Action({ action, count }: { action: string; count?: number }) {
  const label = actionLabel(action);
  return (
    <span className="activity-action" title={action}>
      {isFailure(action) ? <Status value="failed" label={label} /> : label}
      {count !== undefined && count > 1 && (
        <span className="activity-count"> ×{count}</span>
      )}
    </span>
  );
}

/** What a request recorded: where it deploys, which release, and any override. */
function Requested({
  entry,
  names,
}: {
  entry: ActivityEntry;
  names: CatalogNames;
}) {
  const requested = RequestedActivitySchema.parse(entry.metadata);
  const revision = entry.subject?.revision ?? null;
  return (
    <>
      {requested.environmentId !== undefined && (
        <span>
          to{" "}
          <Link
            to="/environments/$"
            params={{ _splat: requested.environmentId }}
          >
            <CatalogName
              name={names.environment(requested.environmentId)}
              slug={requested.environmentId}
            />
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
            {revision === null ? (
              <Id value={requested.versionSetRevisionId} />
            ) : (
              <Revision revision={revision} />
            )}
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

/** What the common actions recorded beside their entity. */
function Recorded({
  entry,
  names,
}: {
  entry: ActivityEntry;
  names: CatalogNames;
}) {
  const outcome = outcomeOf(entry.action);
  // A failure already shows its status beside the action, so it says why.
  if (outcome === "failed" || entry.action === "deployment.recovery_required")
    return entry.reason == null ? null : (
      <span className="activity-reason">{entry.reason}</span>
    );
  if (outcome !== null) return <Status value={outcome} />;
  switch (entry.action) {
    case "deployment.requested": {
      return <Requested entry={entry} names={names} />;
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
          {published.serviceId !== undefined && entry.subject == null && (
            <CatalogName
              name={names.service(published.serviceId)}
              slug={published.serviceId}
            />
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

/** A run of entries spans more than a moment when its ends are a minute apart. */
const SPAN_MS = 60_000;

/** When a row happened: its clock reading and age, and where a run began. */
function When({ entries }: { entries: [ActivityEntry, ...ActivityEntry[]] }) {
  const [newest] = entries;
  const oldest = entries.at(-1) ?? newest;
  const spans =
    Date.parse(newest.occurredAt) - Date.parse(oldest.occurredAt) >= SPAN_MS;
  return (
    <span className="activity-when">
      <RelativeTime value={newest.occurredAt} clock />
      {spans && (
        <small className="muted">
          {" "}
          from <RelativeTime value={oldest.occurredAt} clock />
        </small>
      )}
    </span>
  );
}

/**
 * One deployment's consecutive stage writes: each stage once, at what its
 * newest write made it, newest first. A stage written more than once says
 * how many writes it folds.
 */
function StageRun({
  entries,
  names,
}: {
  entries: [ActivityEntry, ...ActivityEntry[]];
  names: CatalogNames;
}) {
  const [newest] = entries;
  return (
    <li>
      <When entries={entries} />
      <Action action={newest.action} />
      <span className="activity-actor">{newest.actor}</span>
      <span className="activity-subject">
        <Entity entry={newest} names={names} />
        <ol className="activity-stages">
          {latestStages(entries).map((stage) => (
            <li key={stage.entry.id}>
              <span className="mono">{stage.stage}</span>
              <Status value={stage.status} />
              {stage.writes > 1 && (
                <small className="muted">{stage.writes} updates</small>
              )}
            </li>
          ))}
        </ol>
      </span>
    </li>
  );
}

/** One routine build record repeated by one actor: a count, with every entry behind it. */
function RepeatedRun({
  entries,
  names,
}: {
  entries: [ActivityEntry, ...ActivityEntry[]];
  names: CatalogNames;
}) {
  const [newest] = entries;
  return (
    <li>
      <When entries={entries} />
      <Action action={newest.action} count={entries.length} />
      <span className="activity-actor">{newest.actor}</span>
      <span className="activity-subject">
        {entries.length === 1 ? (
          <>
            <Entity entry={newest} names={names} />
            <Recorded entry={newest} names={names} />
          </>
        ) : (
          <Disclosure summary={`${String(entries.length)} builds`}>
            <ul className="activity-repeated">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <Entity entry={entry} names={names} />
                  <Recorded entry={entry} names={names} />
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
      </span>
    </li>
  );
}

/**
 * The activity filter's scope: everything or only problems, and how far back.
 * Each select is a search parameter, so the URL carries the choice.
 */
export function ActivityScope({
  search,
}: {
  search: { problems?: string | undefined; within?: string | undefined };
}) {
  return (
    <>
      <label>
        Show
        <select name="problems" defaultValue={search.problems ?? ""}>
          <option value="">Everything</option>
          <option value="only">Problems only</option>
        </select>
      </label>
      <label>
        Time range
        <select name="within" defaultValue={search.within ?? ""}>
          <option value="hour">Last hour</option>
          <option value="day">Last 24 hours</option>
          <option value="">Any time</option>
        </select>
      </label>
    </>
  );
}

/**
 * The audit trail, one row per entry or folded run: when, what, who, and
 * what it was about. The column labels are for sight; each row reads in
 * order. `services` names the catalog ids the entries carry.
 */
export function ActivityList({
  entries,
  services = [],
}: {
  entries: ActivityEntry[];
  services?: readonly CatalogService[];
}) {
  if (entries.length === 0) return <p className="empty">No activity yet.</p>;
  const names = catalogNames(services);
  const rows = foldActivity(entries);
  return (
    <div className="activity-table">
      <div className="activity-columns" aria-hidden="true">
        <span>When</span>
        <span>Action</span>
        <span>By</span>
        <span>About</span>
      </div>
      <ol className="activity">
        {rows.map((row) => {
          if (row.kind === "stages")
            return (
              <StageRun
                key={row.entries[0].id}
                entries={row.entries}
                names={names}
              />
            );
          if (row.kind === "repeated")
            return (
              <RepeatedRun
                key={row.entries[0].id}
                entries={row.entries}
                names={names}
              />
            );
          const { entry } = row;
          const catalog =
            entry.action === "catalog.reconciled"
              ? CatalogReconcileRecordSchema.parse(entry.metadata)
              : null;
          return (
            <li key={entry.id}>
              <When entries={[entry]} />
              <Action action={entry.action} />
              <span className="activity-actor">{entry.actor}</span>
              <span className="activity-subject">
                <Entity
                  entry={entry}
                  names={names}
                  where={entry.action !== "deployment.requested"}
                />
                <Recorded entry={entry} names={names} />
              </span>
              {catalog !== null && <CatalogReconcile result={catalog} />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
