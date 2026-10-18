import { useState } from "react";
import { tofuStackPolicy } from "@shepherdjerred/ops-model/platform-policy.ts";
import type {
  DeploymentDetail,
  Principal,
  PlatformRecoveryIntent,
} from "#shared/contract.ts";
import { Status } from "#client/components/status.tsx";
import { canApprove } from "./presentation.ts";

export type RecoveryDecision = {
  intentId: string;
  planFingerprint: string;
  decision: "approved" | "rejected";
  reason: string;
};
function RecoveryPlan({
  intent,
  principal,
  pending,
  onDecision,
}: {
  intent: PlatformRecoveryIntent;
  principal: Principal;
  pending: boolean;
  onDecision: (decision: RecoveryDecision) => void;
}) {
  const [reason, setReason] = useState("");
  const plan = intent.planReceipt;
  if (plan === null) return null;
  const reviewed = tofuStackPolicy(plan.stack).mode === "reviewed-plan";
  return (
    <>
      <dl className="component-list">
        <div>
          <dt>Recovery plan digest</dt>
          <dd className="mono">
            {plan.planDigest}
            <small>Fingerprint {intent.planFingerprint}</small>
          </dd>
        </div>
        <div>
          <dt>State identity</dt>
          <dd className="mono">
            {plan.state.lineage}
            <small>Serial {plan.state.serial}</small>
          </dd>
        </div>
        <div>
          <dt>Plan changes</dt>
          <dd>
            Create {plan.changes.create} · update {plan.changes.update} · delete{" "}
            {plan.changes.delete} · replace {plan.changes.replace}
          </dd>
        </div>
        <div>
          <dt>Original recovery plan Job</dt>
          <dd className="mono">
            {plan.nativeJob.name}
            <small>UID {plan.nativeJob.uid}</small>
            <small>{plan.nativeJob.specFingerprint}</small>
          </dd>
        </div>
        <div>
          <dt>Expiration</dt>
          <dd>{plan.expiresAt}</dd>
        </div>
      </dl>
      {intent.planApproval === null ? (
        reviewed &&
        intent.status === "pending" &&
        canApprove(principal) &&
        intent.planFingerprint !== null ? (
          <form
            className="approval-form"
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            <label>
              Recovery approval reason
              <input
                aria-label="Recovery approval reason"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
              />
            </label>
            <div className="button-row">
              {(["approved", "rejected"] as const).map((decision) => (
                <button
                  key={decision}
                  disabled={pending || reason.trim() === ""}
                  onClick={() => {
                    if (intent.planFingerprint !== null)
                      onDecision({
                        intentId: intent.id,
                        planFingerprint: intent.planFingerprint,
                        decision,
                        reason: reason.trim(),
                      });
                  }}
                >
                  {decision === "approved"
                    ? "Approve exact recovery plan"
                    : "Reject recovery plan"}
                </button>
              ))}
            </div>
          </form>
        ) : (
          <p>
            {reviewed
              ? "Exact plan requires a trusted human decision."
              : "Existing automatic stack policy applies to this exact saved plan."}
          </p>
        )
      ) : (
        <p>
          Plan {intent.planApproval.decision} by {intent.planApproval.actorId}:{" "}
          {intent.planApproval.reason}
        </p>
      )}
    </>
  );
}
export function PlatformRecovery({
  detail,
  principal,
  pending,
  onDecision,
}: {
  detail: DeploymentDetail;
  principal: Principal;
  pending: boolean;
  onDecision: (decision: RecoveryDecision) => void;
}) {
  if (
    detail.deployment.platformSnapshot === null &&
    detail.deployment.controlPlaneSnapshot === null
  )
    return null;
  return (
    <section aria-label="Independent infrastructure recovery">
      <h3>Independent infrastructure recovery</h3>
      {detail.deployment.recoveryRequired && (
        <p className="notice">
          The failed result is preserved. Native operations and exact target
          settlement must be independently verified before ownership is
          released.
        </p>
      )}
      {detail.platformRecoveries.length === 0 ? (
        <p className="muted">
          No independent infrastructure recovery requested.
        </p>
      ) : (
        detail.platformRecoveries.map((intent) => (
          <article key={intent.id}>
            <div className="section-heading">
              <strong className="mono">{intent.id}</strong>
              <Status value={intent.status} />
            </div>
            <p>{intent.reason}</p>
            <p className="mono">
              Environment generation {intent.expectedEnvironmentGeneration}
              <small>Snapshot {intent.snapshotFingerprint}</small>
            </p>
            <RecoveryPlan
              intent={intent}
              principal={principal}
              pending={pending}
              onDecision={onDecision}
            />
            <details>
              <summary>Native recovery checkpoints</summary>
              <pre>{JSON.stringify(intent.nativeReceipts, null, 2)}</pre>
            </details>
            {intent.message !== null && <p>{intent.message}</p>}
          </article>
        ))
      )}
    </section>
  );
}
