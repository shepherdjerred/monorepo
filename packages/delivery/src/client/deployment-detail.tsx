import { useState } from "react";
import type {
  DeploymentDetail as Detail,
  Principal,
} from "#shared/contract.ts";
import { canApprove, canDeploy, isTerminal } from "./presentation.ts";
import { Status } from "./components.tsx";
import { SelectedArtifacts } from "./artifacts.tsx";

export type DeploymentAction =
  { kind: "cancel" | "retry" } | { kind: "approve" | "reject"; reason: string };

export function DeploymentDetail({
  detail,
  principal,
  pending,
  onAction,
  onClose,
}: {
  detail: Detail;
  principal: Principal;
  pending: boolean;
  onAction: (action: DeploymentAction) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const { deployment } = detail;
  return (
    <section className="panel" aria-labelledby="deployment-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Deployment details</p>
          <h2 id="deployment-heading">{deployment.environmentId}</h2>
          <p className="mono muted">{deployment.id}</p>
        </div>
        <button
          className="icon-button"
          aria-label="Close deployment details"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="detail-summary">
        <Status value={deployment.status} />
        <span>{deployment.versionSetRevisionId}</span>
        <span>{deployment.kind}</span>
      </div>
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
      <div className="detail-grid">
        <div>
          <h3>Pipeline progress</h3>
          {detail.stages.length === 0 ? (
            <p className="empty">No stages have started.</p>
          ) : (
            <ol className="stages">
              {detail.stages.map((stage) => (
                <li key={stage.id}>
                  <div>
                    <strong>{stage.key}</strong>
                    <Status value={stage.status} />
                  </div>
                  <p>{stage.message}</p>
                  <small className="mono">{stage.operationId}</small>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div>
          <h3>Evidence</h3>
          {detail.evidence.length === 0 ? (
            <p className="empty">No verification evidence recorded.</p>
          ) : (
            <ul className="evidence">
              {detail.evidence.map((item) => (
                <li key={item.id}>
                  <span className="eyebrow">{item.kind}</span>
                  <p>{item.summary}</p>
                  {item.url !== undefined && (
                    <a href={item.url} target="_blank" rel="noreferrer">
                      View evidence ↗
                    </a>
                  )}
                  <small>{new Date(item.createdAt).toLocaleString()}</small>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <details>
        <summary>Pinned pipeline and configuration</summary>
        <pre>
          {JSON.stringify(
            {
              pipeline: detail.pipeline,
              configurationRevision: deployment.configurationRevision,
              configuration: deployment.configuration,
            },
            null,
            2,
          )}
        </pre>
      </details>
      <SelectedArtifacts version={detail.versionSet} />
      {detail.approvals.length > 0 && (
        <div className="approval-history">
          <h3>Approval history</h3>
          {detail.approvals.map((approval) => (
            <p key={approval.id}>
              <strong>{approval.decision}</strong> · {approval.actor}
              <br />
              {approval.reason}
            </p>
          ))}
        </div>
      )}
      {deployment.status === "awaiting_approval" && (
        <div className="approval-form">
          <h3>Production approval</h3>
          <p>
            Approval applies to this exact release, configuration, and pipeline.
          </p>
          {canApprove(principal) ? (
            <>
              <label>
                Reason
                <textarea
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                  }}
                  maxLength={4000}
                  placeholder="Record the reason for your decision"
                />
              </label>
              <div className="button-row">
                <button
                  className="primary-button"
                  disabled={pending || reason.trim() === ""}
                  onClick={() => {
                    onAction({ kind: "approve", reason: reason.trim() });
                  }}
                >
                  Approve release
                </button>
                <button
                  className="secondary-button danger"
                  disabled={pending || reason.trim() === ""}
                  onClick={() => {
                    onAction({ kind: "reject", reason: reason.trim() });
                  }}
                >
                  Reject
                </button>
              </div>
            </>
          ) : (
            <p className="notice">
              A human with approval access must review this deployment.
            </p>
          )}
        </div>
      )}
      {canDeploy(principal) && (
        <div className="button-row detail-actions">
          {!isTerminal(deployment) && (
            <button
              className="secondary-button"
              disabled={pending || deployment.cancelRequested}
              onClick={() => {
                onAction({ kind: "cancel" });
              }}
            >
              Request cancellation
            </button>
          )}
          {["failed", "canceled"].includes(deployment.status) && (
            <button
              className="primary-button"
              disabled={pending || deployment.recoveryRequired}
              onClick={() => {
                onAction({ kind: "retry" });
              }}
            >
              Retry as a new deployment
            </button>
          )}
        </div>
      )}
    </section>
  );
}
