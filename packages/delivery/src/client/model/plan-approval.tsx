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
import { ExactTime } from "#client/components/time.tsx";
import { ReasonField, useReason } from "#client/forms/decision.tsx";
import { SelectionFacts, deploymentRevisions } from "./selection-facts.tsx";
import { waitingPlan } from "./view.ts";
import { Fact, Facts } from "#client/components/facts.tsx";

type SavedPlan = NonNullable<ReturnType<typeof waitingPlan>>;

function PlanFacts({ plan }: { plan: SavedPlan }) {
  const { changes } = plan;
  return (
    <Facts>
      <Fact label="Plan digest" mono>
        {plan.planDigest}
      </Fact>
      <Fact label="Stack">
        {plan.stack} · state serial {plan.state.serial}
      </Fact>
      <Fact label="Changes">
        Create {changes.create} · update {changes.update} · delete{" "}
        {changes.delete} · replace {changes.replace}
      </Fact>
      <Fact label="Expires">
        <ExactTime value={plan.expiresAt} />
      </Fact>
    </Facts>
  );
}

/** What each decision on a saved plan did, as the page states it afterwards. */
export const PLAN_OUTCOMES = {
  approved: "Plan approved. Apply runs this exact plan.",
  rejected:
    "Plan rejected. The saved plan is discarded and the deployment ends without applying it.",
} as const;

/**
 * The approve step of a model `tofu` recipe (section 5): the saved plan the
 * plan step produced, and the deployment's one decision on it (4.13). An
 * approval lets apply run this exact plan; a rejection discards it and ends
 * the deployment failed without applying (H3).
 */
export function PlanApproval({
  detail,
  principal,
  onDecided,
}: {
  detail: DeploymentDetailV2;
  principal: Principal;
  /** Runs once a decision is recorded, with what it did in words. */
  onDecided?: (outcome: string) => void;
}) {
  const queryClient = useQueryClient();
  const reason = useReason();
  const decide = useMutation({
    mutationFn: (input: ApproveTofuPlan) =>
      delivery.approvePlan(detail.deployment.id, input),
    onSuccess: async (_result, input) => {
      onDecided?.(PLAN_OUTCOMES[input.decision]);
      await queryClient.invalidateQueries();
    },
  });
  const plan = waitingPlan(detail);
  if (plan === null) return null;
  const send = (decision: ApproveTofuPlan["decision"]) => {
    decide.mutate({
      decision,
      planDigest: plan.planDigest,
      reason: reason.value,
    });
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
      {selection !== null && (
        <SelectionFacts
          selection={selection}
          revisions={deploymentRevisions(detail)}
        />
      )}
      {canApprove(principal) ? (
        <>
          <form
            className="approval-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (
                !decide.isPending &&
                reason.require("Record why this plan is safe to apply")
              )
                send("approved");
            }}
          >
            <ReasonField
              reason={reason}
              placeholder="Record why this plan is safe to apply, or why it must not be"
            />
            {decide.error !== null && <ErrorNotice error={decide.error} />}
            <div className="button-row">
              <button
                type="submit"
                className="primary-button"
                aria-disabled={decide.isPending ? true : undefined}
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
              pending={decide.isPending}
              check={() =>
                reason.require("Record why this plan must not be applied")
              }
              onConfirm={() => {
                send("rejected");
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
