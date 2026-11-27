import { useState } from "react";
import { Link } from "react-router";
import {
  Button,
  Card,
  PageBody,
  PageHeading,
  SummaryGrid,
} from "@shepherdjerred/console-ui";
import type { FlagsArchiveResponse } from "@shepherdjerred/feature-flags/flags-wire.ts";
import { useArchive } from "@shepherdjerred/flags/client/management-api.ts";
import {
  deploymentPath,
  splitDeploymentId,
} from "@shepherdjerred/flags/client/model.ts";
import { HistoryPanel } from "./history-panel.tsx";
import {
  actorLabel,
  actorTitle,
  finalText,
  formatInstant,
} from "./history-model.ts";

type ArchivedDeployment = FlagsArchiveResponse["deployments"][number];
type ArchivedFlag = ArchivedDeployment["flags"][number];

/** Retired flags across every deployment, for the sidebar count. */
export function archivedCount(archive: FlagsArchiveResponse): number {
  return archive.deployments.reduce(
    (total, deployment) => total + deployment.flags.length,
    0,
  );
}

function Retirement({ flag }: { readonly flag: ArchivedFlag }) {
  if (flag.basis === "declared-retired") {
    return (
      <p className="ui-muted">
        Retired before audit; final value not recorded.
      </p>
    );
  }
  return (
    <>
      <p className="ui-muted">
        Retired{" "}
        {flag.retiredAt === null ? null : (
          <time dateTime={flag.retiredAt} title={flag.retiredAt}>
            {formatInstant(flag.retiredAt)}
          </time>
        )}
        {flag.retiredBy === null ? null : (
          <>
            {" by "}
            <span className="ui-mono" title={actorTitle(flag.retiredBy)}>
              {actorLabel(flag.retiredBy)}
            </span>
          </>
        )}
        {flag.revision === null ? null : ` · rev ${String(flag.revision)}`}
      </p>
      <pre className="fl-command" aria-label={`${flag.key} final value`}>
        {finalText(flag.final)}
      </pre>
    </>
  );
}

/** One retired key; its history (served although the key is gone) opens inline. */
function ArchivedRow({
  id,
  flag,
}: {
  readonly id: string;
  readonly flag: ArchivedFlag;
}): React.JSX.Element {
  const [showHistory, setShowHistory] = useState(false);
  const { catalog, stage } = splitDeploymentId(id);
  return (
    <li className="fl-drift-item fl-archive-item">
      <div className="fl-drift-row">
        <span className="ui-mono fl-archive-key">{flag.key}</span>
        <Button
          type="button"
          aria-expanded={showHistory}
          onClick={() => {
            setShowHistory(!showHistory);
          }}
        >
          {showHistory ? "Hide history" : "History"}
        </Button>
      </div>
      <Retirement flag={flag} />
      {showHistory ? (
        <HistoryPanel catalog={catalog} stage={stage} flagKey={flag.key} />
      ) : null}
    </li>
  );
}

function DeploymentArchive({
  deployment,
}: {
  readonly deployment: ArchivedDeployment;
}): React.JSX.Element {
  const { catalog, stage } = splitDeploymentId(deployment.id);
  return (
    <Card label={`${deployment.id} archived flags`}>
      <div className="fl-drift-body">
        <div className="fl-drift-head">
          <h2 className="fl-drift-title">
            <Link to={deploymentPath(catalog, stage)}>{deployment.id}</Link>
          </h2>
          <span className="ui-muted">{deployment.flags.length} retired</span>
        </div>
        <ul className="fl-drift-items">
          {deployment.flags.map((flag) => (
            <ArchivedRow key={flag.key} id={deployment.id} flag={flag} />
          ))}
        </ul>
      </div>
    </Card>
  );
}

const RESTORE_HINT =
  "To restore, re-declare the key in managed-flag-inventory.json and remove it from retired-flag-declarations.ts; the inventory sync re-creates it, then restore an old value from its history.";

/** `/archive`: flags retired from each deployment, read-only. */
export function ArchivePage(): React.JSX.Element {
  const archive = useArchive();
  const heading = (
    <PageHeading
      eyebrow="Flags"
      title="Archived"
      description="Flags retired from a deployment, with their last value and history. Read-only."
    />
  );
  if (archive.isPending) {
    return (
      <PageBody>
        {heading}
        <p className="ui-state" role="status">
          Loading the archive…
        </p>
      </PageBody>
    );
  }
  if (archive.isError) {
    return (
      <PageBody>
        {heading}
        <p className="ui-state" role="alert">
          The archive failed to load: {archive.error.message}
        </p>
      </PageBody>
    );
  }
  const deployments = archive.data.deployments;
  const unrecorded = deployments.reduce(
    (total, deployment) =>
      total +
      deployment.flags.filter((flag) => flag.basis === "declared-retired")
        .length,
    0,
  );
  return (
    <PageBody>
      {heading}
      <SummaryGrid
        label="Archive summary"
        items={[
          { label: "Retired flags", value: archivedCount(archive.data) },
          { label: "Deployments", value: deployments.length },
          { label: "Retired before audit", value: unrecorded },
        ]}
      />
      <div className="fl-drift-sections">
        <div className="fl-remedy">
          <p>{RESTORE_HINT}</p>
        </div>
        {deployments.length === 0 ? (
          <p className="ui-state">No flags have been retired.</p>
        ) : (
          deployments.map((deployment) => (
            <DeploymentArchive key={deployment.id} deployment={deployment} />
          ))
        )}
      </div>
    </PageBody>
  );
}
