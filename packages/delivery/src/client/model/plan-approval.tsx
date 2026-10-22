import { useActionState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Principal } from "#shared/contract.ts";
import type { DeploymentDetailV2 } from "#shared/model/contract.ts";
import { delivery } from "#client/api.ts";
import { canApprove, canDeploy } from "#client/presentation.ts";
import { ConfirmButton } from "#client/components/confirm-dialog.tsx";
import { ErrorNotice, errorMessage } from "#client/components/notices.tsx";
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

function ApprovePlan({
  deploymentId,
  plan,
}: {
  deploymentId: string;
  plan: SavedPlan;
}) {
  const queryClient = useQueryClient();
  const [state, submit, pending] = useActionState(
    async (_previous: { error: string | null }, form: FormData) => {
      const reason = form.get("reason");
      if (typeof reason !== "string" || reason.trim() === "")
        return { error: "Record why this plan is safe to apply" };
      try {
        await delivery.approvePlan(deploymentId, {
          planDigest: plan.planDigest,
          reason,
        });
        await queryClient.invalidateQueries();
        return { error: null };
      } catch (error) {
        return { error: errorMessage(error) };
      }
    },
    { error: null },
  );
  return (
    <form className="approval-form" action={submit}>
      <label>
        Reason
        <textarea
          name="reason"
          required
          maxLength={4000}
          rows={3}
          placeholder="Record why this plan is safe to apply"
        />
      </label>
      {state.error !== null && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
      <div className="button-row">
        <button type="submit" className="primary-button" disabled={pending}>
          Approve plan
        </button>
        {pending && <span role="status">Recording approval…</span>}
      </div>
    </form>
  );
}

/**
 * The approve step of a model `tofu` recipe (section 5): the saved plan the
 * plan step produced, approved by a human against its exact digest, or
 * rejected by canceling the deployment so the plan is never applied.
 */
export function PlanApproval({
  detail,
  principal,
}: {
  detail: DeploymentDetailV2;
  principal: Principal;
}) {
  const queryClient = useQueryClient();
  const reject = useMutation({
    mutationFn: () => delivery.cancel(detail.deployment.id),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const plan = waitingPlan(detail);
  if (plan === null) return null;
  const { selection } = detail.deployment;
  return (
    <section
      className="panel panel-waiting"
      aria-labelledby="plan-approval-heading"
    >
      <h2 id="plan-approval-heading">Plan approval</h2>
      <p>
        The approve step waits for a human to approve this exact saved plan.
        Apply runs only the plan with this digest, and only before it expires.
      </p>
      <PlanFacts plan={plan} />
      {selection !== null && <SelectionFacts selection={selection} />}
      {canApprove(principal) ? (
        <ApprovePlan deploymentId={detail.deployment.id} plan={plan} />
      ) : (
        <p className="notice">
          A human with approval access must approve this plan.
        </p>
      )}
      {reject.error !== null && <ErrorNotice error={reject.error} />}
      {canDeploy(principal) && (
        <div className="button-row detail-actions">
          <ConfirmButton
            label="Reject plan"
            title="Reject this plan?"
            confirmLabel="Reject and cancel"
            danger
            disabled={reject.isPending || detail.deployment.cancelRequested}
            onConfirm={() => {
              reject.mutate();
            }}
          >
            <p>
              The deployment is canceled at its approve step, so the saved plan
              is never applied. Request a new deployment for a fresh plan.
            </p>
          </ConfirmButton>
        </div>
      )}
    </section>
  );
}
