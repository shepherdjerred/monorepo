import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Principal } from "#shared/contract.ts";
import type {
  ApproveTofuPlan,
  DeploymentDetailV2,
} from "#shared/model/contract.ts";
import { delivery } from "#client/api.ts";
import { canApprove } from "#client/presentation.ts";
import { ConfirmButton } from "#client/components/confirm-dialog.tsx";
import { ErrorNotice } from "#client/components/notices.tsx";
import { RelativeTime } from "#client/components/time.tsx";
import { SelectionFacts } from "./selection-facts.tsx";
import { waitingPlan } from "./view.ts";

type SavedPlan = NonNullable<ReturnType<typeof waitingPlan>>;

function PlanFacts({ plan }: { plan: SavedPlan }) {
  const { changes } = plan;
  return (
    <dl className="facts">
      <div>
        <dt>Plan digest</dt>
        <dd className="mono">{plan.planDigest}</dd>
      </div>
      <div>
        <dt>Stack</dt>
        <dd>
          {plan.stack} · state serial {plan.state.serial}
        </dd>
      </div>
      <div>
        <dt>Changes</dt>
        <dd>
          Create {changes.create} · update {changes.update} · delete{" "}
          {changes.delete} · replace {changes.replace}
        </dd>
      </div>
      <div>
        <dt>Expires</dt>
        <dd>
          <RelativeTime value={plan.expiresAt} />
        </dd>
      </div>
    </dl>
  );
}

/**
 * The approve step of a model `tofu` recipe (section 5): the saved plan the
 * plan step produced, and the deployment's one decision on it (4.13). An
 * approval lets apply run this exact plan; a rejection discards it and ends
 * the deployment failed without applying (H3).
 */
export function PlanApproval({
  detail,
  principal,
}: {
  detail: DeploymentDetailV2;
  principal: Principal;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: (input: ApproveTofuPlan) =>
      delivery.approvePlan(detail.deployment.id, input),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const plan = waitingPlan(detail);
  if (plan === null) return null;
  const submit = (decision: ApproveTofuPlan["decision"]) => {
    if (reason.trim() === "") {
      setProblem(
        decision === "approved"
          ? "Record why this plan is safe to apply"
          : "Record why this plan must not be applied",
      );
      return;
    }
    setProblem(null);
    decide.mutate({ decision, planDigest: plan.planDigest, reason });
  };
  const { selection } = detail.deployment;
  return (
    <section
      className="panel panel-waiting"
      aria-labelledby="plan-approval-heading"
    >
      <h2 id="plan-approval-heading">Plan approval</h2>
      <p>
        The approve step waits for a human to approve or reject this exact saved
        plan. Apply runs only the plan with this digest, and only before it
        expires.
      </p>
      <PlanFacts plan={plan} />
      {selection !== null && <SelectionFacts selection={selection} />}
      {canApprove(principal) ? (
        <>
          <form
            className="approval-form"
            onSubmit={(event) => {
              event.preventDefault();
              submit("approved");
            }}
          >
            <label>
              Reason
              <textarea
                name="reason"
                required
                maxLength={4000}
                rows={3}
                value={reason}
                onChange={(event) => {
                  setReason(event.currentTarget.value);
                }}
                placeholder="Record why this plan is safe to apply, or why it must not be"
              />
            </label>
            {problem !== null && (
              <p className="notice error" role="alert">
                {problem}
              </p>
            )}
            {decide.error !== null && <ErrorNotice error={decide.error} />}
            <div className="button-row">
              <button
                type="submit"
                className="primary-button"
                disabled={decide.isPending}
              >
                Approve plan
              </button>
              {decide.isPending && (
                <span role="status">Recording decision…</span>
              )}
            </div>
          </form>
          <div className="button-row detail-actions">
            <ConfirmButton
              label="Reject plan"
              title="Reject this plan?"
              confirmLabel="Reject and discard plan"
              danger
              disabled={decide.isPending}
              onConfirm={() => {
                submit("rejected");
              }}
            >
              <p>
                The rejection is the one approval decision this deployment
                takes. The saved plan is discarded and the deployment ends
                failed without applying. Request a new deployment for a fresh
                plan.
              </p>
            </ConfirmButton>
          </div>
        </>
      ) : (
        <p className="notice">
          A human with approval access must approve or reject this plan.
        </p>
      )}
    </section>
  );
}
