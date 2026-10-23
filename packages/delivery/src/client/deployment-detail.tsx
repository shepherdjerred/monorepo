import type {
  DeploymentDetail as Detail,
  Principal,
} from "#shared/contract.ts";
import { Status } from "#client/components/status.tsx";
import { Duration, RelativeTime } from "#client/components/time.tsx";
import { isTerminal } from "./presentation.ts";
import { SelectedArtifacts } from "./artifacts.tsx";
import { FrozenWorkerPool } from "./worker-pool.tsx";
import { FrozenPlatform } from "./frozen-platform.tsx";
import { FrozenControlPlane } from "./frozen-control-plane.tsx";
import {
  PlatformRecovery,
  type RecoveryDecision,
} from "./platform-recovery.tsx";
import { MinecraftRecovery } from "./minecraft-recovery.tsx";
import { FrozenForumBaseline } from "./forum-baseline.tsx";
import { ContentRecovery } from "./content-recovery.tsx";

export function sourceLabel(detail: Detail) {
  const deployment = detail.deployment;
  if (deployment.controlPlaneSnapshot !== null)
    return deployment.controlPlaneSnapshot.source.id;
  return deployment.platformSnapshot === null
    ? deployment.versionSetRevisionId
    : deployment.platformSnapshot.source.id;
}

function FrozenInputs({ detail }: { detail: Detail }) {
  const { deployment } = detail;
  return (
    <>
      {deployment.controlPlaneSnapshot === null ? (
        deployment.platformSnapshot === null ? (
          <SelectedArtifacts version={detail.versionSet} />
        ) : (
          <FrozenPlatform snapshot={deployment.platformSnapshot} />
        )
      ) : (
        <FrozenControlPlane snapshot={deployment.controlPlaneSnapshot} />
      )}
      {deployment.workerSnapshot !== null && (
        <FrozenWorkerPool
          snapshot={deployment.workerSnapshot}
          kind={deployment.kind}
        />
      )}
    </>
  );
}

function StageTimeline({ detail }: { detail: Detail }) {
  if (detail.stages.length === 0)
    return <p className="empty">No stages have started.</p>;
  const stages = detail.stages.toSorted((left, right) =>
    (left.startedAt ?? left.updatedAt).localeCompare(
      right.startedAt ?? right.updatedAt,
    ),
  );
  return (
    <ol className="stages">
      {stages.map((stage) => (
        <li key={stage.id} className={`stage-${stage.status}`}>
          <div>
            <strong>{stage.key}</strong>
            <Status value={stage.status} />
            {stage.startedAt !== null && (
              <Duration
                start={stage.startedAt}
                end={stage.status === "running" ? null : stage.updatedAt}
              />
            )}
          </div>
          {stage.message !== "" && <p>{stage.message}</p>}
          <small className="mono">{stage.operationId}</small>
        </li>
      ))}
    </ol>
  );
}

function Evidence({ detail }: { detail: Detail }) {
  if (detail.evidence.length === 0)
    return <p className="empty">No verification evidence recorded.</p>;
  return (
    <ul className="evidence">
      {detail.evidence.map((item) => (
        <li key={item.id}>
          <span className="eyebrow">{item.kind}</span>
          <p>{item.summary}</p>
          {item.url !== undefined && (
            <a href={item.url}>
              View evidence<span aria-hidden="true"> ↗</span>
            </a>
          )}
          <RelativeTime value={item.createdAt} />
        </li>
      ))}
    </ul>
  );
}

/** Everything recorded about one deployment; actions live on the page. */
export function DeploymentRecord({
  detail,
  principal,
  pending,
  onRecoveryDecision,
}: {
  detail: Detail;
  principal: Principal;
  pending: boolean;
  onRecoveryDecision: (decision: RecoveryDecision) => void;
}) {
  const { deployment } = detail;
  return (
    <>
      {deployment.message !== null && (
        <p
          className={`notice ${deployment.status === "failed" ? "error" : ""}`}
        >
          {deployment.message}
        </p>
      )}
      {deployment.cancelRequested && !isTerminal(deployment) && (
        <p className="notice">
          Cancellation requested. Waiting for the next safe boundary.
        </p>
      )}
      {deployment.recoveryRequired && (
        <p className="notice error">
          Operator recovery is required. This environment remains locked until
          the external operation has been inspected.
        </p>
      )}
      <PlatformRecovery
        detail={detail}
        principal={principal}
        pending={pending}
        onDecision={onRecoveryDecision}
      />
      <MinecraftRecovery detail={detail} />
      <ContentRecovery detail={detail} />
      <FrozenForumBaseline detail={detail} />
      <div className="detail-grid">
        <section className="panel" aria-labelledby="progress-heading">
          <h2 id="progress-heading">Steps</h2>
          <StageTimeline detail={detail} />
        </section>
        <section className="panel" aria-labelledby="evidence-heading">
          <h2 id="evidence-heading">Evidence</h2>
          <Evidence detail={detail} />
        </section>
      </div>
      <section className="panel" aria-labelledby="inputs-heading">
        <h2 id="inputs-heading">Frozen inputs</h2>
        <details>
          <summary>Pinned pipeline and configuration</summary>
          <pre>
            {JSON.stringify(
              {
                pipeline: detail.pipeline,
                configuration: detail.configuration,
              },
              null,
              2,
            )}
          </pre>
        </details>
        <FrozenInputs detail={detail} />
      </section>
    </>
  );
}
