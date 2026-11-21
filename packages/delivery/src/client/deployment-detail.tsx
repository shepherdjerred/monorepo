import type {
  DeploymentDetail as Detail,
  Principal,
} from "#shared/contract.ts";
import { isTerminal, messageNotice } from "./presentation.ts";
import { SelectedArtifacts } from "./artifacts.tsx";
import { FrozenWorkerPool } from "./worker-pool.tsx";
import { FrozenPlatform } from "./frozen-platform.tsx";
import { FrozenControlPlane } from "./frozen-control-plane.tsx";
import {
  PlatformRecovery,
  type RecoveryDecision,
} from "./platform-recovery.tsx";
import { FrozenForumBaseline } from "./forum-baseline.tsx";
import { ContentRecovery } from "./content-recovery.tsx";
import { Disclosure } from "#client/components/disclosure.tsx";
import { DeploymentEvidence, StepTimeline } from "./deployment-steps.tsx";
import { explainsFailure } from "./model/deployment-outcome.tsx";

export function sourceLabel(detail: Detail) {
  const deployment = detail.deployment;
  if (deployment.controlPlaneSnapshot !== null)
    return deployment.controlPlaneSnapshot.source.id;
  return deployment.platformSnapshot === null
    ? deployment.versionSetRevisionId
    : deployment.platformSnapshot.source.id;
}

/**
 * What the deployment froze, each part folded away: a finished deployment is
 * read for what happened, and its inputs are one click below. They open on
 * their own while a human is deciding on exactly these inputs.
 */
function FrozenInputs({ detail }: { detail: Detail }) {
  const { deployment } = detail;
  const reviewing = deployment.status === "awaiting_approval";
  return (
    <>
      <p className="muted">
        Pipeline <span className="mono">{detail.pipeline.id}</span> ·
        configuration <span className="mono">{detail.configuration.id}</span>
      </p>
      {deployment.controlPlaneSnapshot === null ? (
        deployment.platformSnapshot === null ? (
          <SelectedArtifacts version={detail.versionSet} />
        ) : (
          <Disclosure summary="Platform release" open={reviewing}>
            <FrozenPlatform snapshot={deployment.platformSnapshot} />
          </Disclosure>
        )
      ) : (
        <Disclosure summary="Control-plane upgrade" open={reviewing}>
          <FrozenControlPlane snapshot={deployment.controlPlaneSnapshot} />
        </Disclosure>
      )}
      {deployment.workerSnapshot !== null && (
        <Disclosure
          summary="Worker pool"
          count={deployment.workerSnapshot.versions.length}
          open={reviewing}
        >
          <FrozenWorkerPool
            snapshot={deployment.workerSnapshot}
            kind={deployment.kind}
          />
        </Disclosure>
      )}
      <Disclosure summary="Pinned pipeline and configuration">
        <pre className="receipt-json">
          <code>
            {JSON.stringify(
              {
                pipeline: detail.pipeline,
                configuration: detail.configuration,
              },
              null,
              2,
            )}
          </code>
        </pre>
      </Disclosure>
    </>
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
  // A failed or locked deployment's message and lock are explained at the
  // top of the page; a decision's reason is the approval's own.
  const explained = explainsFailure(deployment);
  const message =
    explained || deployment.message === detail.approval?.reason
      ? null
      : deployment.message;
  return (
    <>
      {message !== null && (
        <p className={messageNotice(deployment.status)}>{message}</p>
      )}
      {deployment.cancelRequested && !isTerminal(deployment) && (
        <p className="notice">
          Cancellation requested. Waiting for the next safe boundary.
        </p>
      )}
      <PlatformRecovery
        detail={detail}
        principal={principal}
        pending={pending}
        onDecision={onRecoveryDecision}
      />
      <ContentRecovery detail={detail} />
      <FrozenForumBaseline detail={detail} />
      <div className="deployment-record">
        <section
          className="panel deployment-steps"
          aria-labelledby="progress-heading"
        >
          <h2 id="progress-heading">Steps</h2>
          <StepTimeline detail={detail} />
        </section>
        <section
          className="panel deployment-evidence"
          aria-labelledby="evidence-heading"
        >
          <h2 id="evidence-heading">Evidence</h2>
          <DeploymentEvidence detail={detail} />
        </section>
      </div>
      <section className="panel" aria-labelledby="inputs-heading">
        <h2 id="inputs-heading">Frozen inputs</h2>
        <FrozenInputs detail={detail} />
      </section>
    </>
  );
}
