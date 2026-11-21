import type { SubmitEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { errorMessage } from "#client/components/notices.tsx";
import { ConfirmButton } from "#client/components/confirm-dialog.tsx";
import { ReasonField, useReason } from "./decision.tsx";

export type Decision = { decision: "approve" | "reject"; reason: string };

/**
 * A native form: the browser enforces the required reason, approval submits
 * it, and rejection asks first. The reason is kept when the server refuses
 * the decision, and the refusal appears in place.
 */
export function ApprovalForm({
  override = false,
  onDecision,
}: {
  /** The frozen set revision is not eligible; the decision is recorded as an override (H4). */
  override?: boolean;
  onDecision: (decision: Decision) => Promise<void>;
}) {
  const reason = useReason();
  const decide = useMutation({
    mutationFn: (decision: Decision) => onDecision(decision),
  });
  function approve(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (decide.isPending || !reason.require("Record why this release may run"))
      return;
    decide.mutate({ decision: "approve", reason: reason.value });
  }
  return (
    <form
      className="approval-form"
      aria-labelledby="approval-form-heading"
      onSubmit={approve}
    >
      <h2 id="approval-form-heading">Production approval</h2>
      <p>
        Approval applies to this exact release, configuration, pipeline, and
        frozen worker pool or saved platform plan when present.
      </p>
      {override && (
        <p className="notice">
          This deploy asked for an override: its set revision is not eligible
          for an ordinary deploy, so approving it is recorded as an override.
        </p>
      )}
      <ReasonField
        reason={reason}
        placeholder="Record the reason for your decision"
      />
      {decide.error !== null && (
        <p className="notice error" role="alert">
          {errorMessage(decide.error)}
        </p>
      )}
      <div className="button-row">
        <button
          type="submit"
          className="primary-button"
          aria-disabled={decide.isPending ? true : undefined}
        >
          {override ? "Approve override" : "Approve release"}
        </button>
        <ConfirmButton
          label="Reject"
          title="Reject this release?"
          confirmLabel="Reject release"
          danger
          pending={decide.isPending}
          check={() => reason.require("Record why this release is rejected")}
          onConfirm={() => {
            decide.mutate({ decision: "reject", reason: reason.value });
          }}
        >
          <p>
            The deployment is canceled and never runs. Request a new deployment
            to release this version later.
          </p>
        </ConfirmButton>
        {decide.isPending && <span role="status">Recording decision…</span>}
      </div>
    </form>
  );
}
