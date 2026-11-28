import { useCallback } from "react";
import {
  deploymentPath,
  flagPath,
  flagText,
  listState,
  splitDeploymentId,
} from "@shepherdjerred/flags/client/model.ts";
import {
  Button,
  Card,
  PageBody,
  PageHeading,
  SeverityBadge,
  SummaryGrid,
} from "@shepherdjerred/console-ui";
import { RefreshCwIcon } from "lucide-react";
import { Link, useLocation } from "react-router";
import {
  DRIFT_CATEGORIES,
  DRIFT_HINT,
  DRIFT_LABEL,
  DRIFT_SEVERITY,
  deploymentCounts,
  driftSeverity,
  itemCount,
  remedy,
  totalCounts,
  worstFirst,
  type DeploymentDrift,
  type DriftCategory,
} from "./drift-model.ts";
import { FlagDiff } from "./flag-diff.tsx";
import { useDrift } from "./views-api.ts";

function FlagLink({
  id,
  flagKey,
}: {
  readonly id: string;
  readonly flagKey: string;
}): React.JSX.Element {
  const { catalog, stage } = splitDeploymentId(id);
  return (
    <Link
      className="ui-mono fl-drift-key"
      to={flagPath(catalog, stage, flagKey)}
    >
      {flagKey}
    </Link>
  );
}

function Items({
  category,
  entry,
}: {
  readonly category: DriftCategory;
  readonly entry: DeploymentDrift;
}): React.JSX.Element {
  switch (category) {
    case "invalid": {
      return (
        <ul className="fl-drift-items">
          {entry.invalid.map((item) => (
            <li key={item.key} className="fl-drift-item">
              <FlagLink id={entry.id} flagKey={item.key} />
              <span className="ui-mono fl-drift-value">
                {JSON.stringify(item.value)}
              </span>
              <ul className="fl-drift-issues">
                {item.issues.map((issue) => (
                  <li key={`${issue.path}:${issue.message}`}>
                    {issue.path === "" ? null : (
                      <span className="ui-mono">{issue.path}: </span>
                    )}
                    {issue.message}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      );
    }
    case "drift": {
      return (
        <ul className="fl-drift-items">
          {entry.drift.map((item) => (
            <li key={item.key} className="fl-drift-item">
              <FlagLink id={entry.id} flagKey={item.key} />
              <FlagDiff
                left={flagText(item.declared)}
                right={flagText(item.live)}
                leftLabel="Declared (inventory)"
                rightLabel="Live (Flags)"
              />
            </li>
          ))}
        </ul>
      );
    }
    case "missing": {
      return (
        <ul className="fl-drift-items">
          {entry.missing.map((flag) => (
            <li key={flag.key} className="fl-drift-item fl-drift-row">
              <span className="ui-mono fl-drift-key">{flag.key}</span>
              <span className="ui-muted">
                declared {flag.type} · {listState(flag)}
              </span>
            </li>
          ))}
        </ul>
      );
    }
    case "extra": {
      return (
        <ul className="fl-drift-items">
          {entry.extra.map((key) => (
            <li key={key} className="fl-drift-item fl-drift-row">
              <FlagLink id={entry.id} flagKey={key} />
            </li>
          ))}
        </ul>
      );
    }
  }
}

function Remedy({
  category,
  entry,
}: {
  readonly category: DriftCategory;
  readonly entry: DeploymentDrift;
}): React.JSX.Element {
  const fix = remedy(category, entry, globalThis.location.origin);
  return (
    <div className="fl-remedy">
      <p>{fix.summary}</p>
      {fix.commands.length === 0 ? null : (
        <pre className="fl-command">{fix.commands.join("\n")}</pre>
      )}
    </div>
  );
}

function DeploymentSection({
  entry,
}: {
  readonly entry: DeploymentDrift;
}): React.JSX.Element {
  const counts = deploymentCounts(entry);
  const { catalog, stage } = splitDeploymentId(entry.id);
  const headingId = `drift-${entry.id}`;
  return (
    <Card
      className="fl-drift-section"
      id={entry.id}
      label={`${entry.id} drift`}
    >
      <div className="fl-drift-body">
        <div className="fl-drift-head">
          <h2 className="fl-drift-title" id={headingId}>
            <Link to={deploymentPath(catalog, stage)}>{entry.id}</Link>
          </h2>
          <span className="ui-muted">Revision {entry.revision}</span>
          <SeverityBadge
            severity={driftSeverity(counts)}
            label={`${String(itemCount(counts))} drift`}
          />
        </div>
        {DRIFT_CATEGORIES.filter((category) => counts[category] > 0).map(
          (category) => (
            <div key={category} className="fl-drift-category">
              <h3 className="fl-drift-category-title">
                <SeverityBadge
                  severity={DRIFT_SEVERITY[category]}
                  label={`${DRIFT_LABEL[category]} ${String(counts[category])}`}
                />
                <span className="ui-muted">{DRIFT_HINT[category]}</span>
              </h3>
              <Items category={category} entry={entry} />
              <Remedy category={category} entry={entry} />
            </div>
          ),
        )}
      </div>
    </Card>
  );
}

/**
 * The ref callback for the sections: it scrolls to `#<deployment id>` when the
 * sections mount, which is once the report they name has loaded.
 */
function useHashScroll(): (element: HTMLElement | null) => void {
  const { hash } = useLocation();
  return useCallback(
    (element: HTMLElement | null) => {
      if (element === null || hash.length <= 1) return;
      element.ownerDocument
        .querySelector(`#${CSS.escape(decodeURIComponent(hash.slice(1)))}`)
        ?.scrollIntoView({ block: "start" });
    },
    [hash],
  );
}

/** Every live document compared with the repository's flag inventory. */
export function DriftPage(): React.JSX.Element {
  const drift = useDrift();
  const scrollToHash = useHashScroll();
  const deployments = drift.data?.deployments ?? [];
  const totals = totalCounts(deployments);
  const total = itemCount(totals);
  const dirty = worstFirst(
    deployments.filter((entry) => itemCount(deploymentCounts(entry)) > 0),
  );
  const clean = deployments.filter(
    (entry) => itemCount(deploymentCounts(entry)) === 0,
  );
  return (
    <PageBody>
      <PageHeading
        eyebrow="Inventory"
        title="Drift"
        description="Live Flags documents compared with managed-flag-inventory.json."
        actions={
          <>
            {drift.data === undefined ? null : (
              <SeverityBadge
                size="large"
                severity={driftSeverity(totals)}
                label={total === 0 ? "In sync" : `${String(total)} drifted`}
              />
            )}
            <Button
              size="page"
              disabled={drift.isFetching}
              onClick={() => {
                void drift.refetch();
              }}
            >
              <RefreshCwIcon aria-hidden="true" />
              Refresh
            </Button>
          </>
        }
      />
      {drift.isPending ? (
        <p className="ui-state" role="status">
          Comparing deployments with the inventory…
        </p>
      ) : drift.isError ? (
        <p className="ui-state" role="alert">
          The drift report failed: {drift.error.message}
        </p>
      ) : (
        <>
          <SummaryGrid
            label="Drift totals"
            items={DRIFT_CATEGORIES.map((category) => ({
              label: DRIFT_LABEL[category],
              value: totals[category],
              severity:
                totals[category] === 0 ? "ok" : DRIFT_SEVERITY[category],
            }))}
          />
          <p className="fl-cli">
            The same report from a terminal:{" "}
            <code className="ui-mono">toolkit flags diff</code> (exits 1 while
            anything drifts). The flag-inventory-sync schedule reconciles
            missing and retired keys every two minutes.
          </p>
          <div className="fl-drift-sections" ref={scrollToHash}>
            {dirty.map((entry) => (
              <DeploymentSection key={entry.id} entry={entry} />
            ))}
            {clean.length === 0 ? null : (
              <Card className="fl-drift-section" label="In sync deployments">
                <div className="fl-drift-body">
                  <div className="fl-drift-head">
                    <h2 className="fl-drift-title">In sync</h2>
                    <SeverityBadge severity="ok" label={String(clean.length)} />
                  </div>
                  <ul className="fl-clean">
                    {clean.map((entry) => {
                      const { catalog, stage } = splitDeploymentId(entry.id);
                      return (
                        <li key={entry.id} id={entry.id}>
                          <Link to={deploymentPath(catalog, stage)}>
                            {entry.id}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </Card>
            )}
          </div>
        </>
      )}
    </PageBody>
  );
}
