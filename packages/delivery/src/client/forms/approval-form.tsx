import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { z } from "zod";
import { errorMessage } from "#client/components/notices.tsx";

const DecisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().min(1, "Record a reason for your decision"),
});
export type Decision = z.infer<typeof DecisionSchema>;

function Buttons({ override }: { override: boolean }) {
  const { pending } = useFormStatus();
  return (
    <div className="button-row">
      <button
        type="submit"
        name="decision"
        value="approve"
        className="primary-button"
        disabled={pending}
      >
        {override ? "Approve override" : "Approve release"}
      </button>
      <button
        type="submit"
        name="decision"
        value="reject"
        className="secondary-button danger"
        disabled={pending}
      >
        Reject
      </button>
      {pending && <span role="status">Recording decision…</span>}
    </div>
  );
}

/**
 * A native form: the browser enforces the required reason, the clicked
 * button names the decision, and the server's answer appears in place.
 */
export function ApprovalForm({
  override = false,
  onDecision,
}: {
  /** The frozen set revision is not eligible; the decision is recorded as an override (H4). */
  override?: boolean;
  onDecision: (decision: Decision) => Promise<void>;
}) {
  const [state, submit] = useActionState(
    async (_previous: { error: string | null }, form: FormData) => {
      const parsed = DecisionSchema.safeParse({
        decision: form.get("decision"),
        reason: form.get("reason"),
      });
      if (!parsed.success)
        return { error: parsed.error.issues[0]?.message ?? "Invalid decision" };
      try {
        await onDecision(parsed.data);
        return { error: null };
      } catch (error) {
        return { error: errorMessage(error) };
      }
    },
    { error: null },
  );
  return (
    <form className="approval-form" action={submit}>
      <h2>Production approval</h2>
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
      <label>
        Reason
        <textarea
          name="reason"
          required
          maxLength={4000}
          rows={3}
          placeholder="Record the reason for your decision"
        />
      </label>
      {state.error !== null && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
      <Buttons override={override} />
    </form>
  );
}
