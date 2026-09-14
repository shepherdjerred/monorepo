import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  OperationsConfirmation,
  type PreparedOperation,
} from "#src/components/operations/operations-confirmation-card.tsx";
import { OperationsRequestForm } from "#src/components/operations/operations-request-form.tsx";
import {
  buildOperationsPayload,
  type OperationsRequestDraft,
} from "#src/lib/operations/operations-payloads.ts";
import { useTRPC } from "#src/lib/query/trpc.ts";

/**
 * One operation, from the row it was started on to the answer it produced.
 *
 * The two halves are deliberately separate calls. `prepare` writes nothing but
 * an intent, so an operator who changes their mind has spent nothing;
 * `confirm` claims that intent with a guarded write and is the only thing that
 * can move durable state. Keeping them apart in the UI is what makes the card
 * between them a real review rather than a decoration over a single request.
 *
 * The console runs one of these at a time. An operations intent lives five
 * minutes because it is prepared against a view of the queues that moves, and
 * two pending confirmations on one screen is how an operator confirms the one
 * they did not mean to.
 */

export function OperationsRequestPanel(props: {
  initialDraft: OperationsRequestDraft;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const [draft, setDraft] = useState<OperationsRequestDraft>(
    props.initialDraft,
  );
  const [prepared, setPrepared] = useState<PreparedOperation | null>(null);
  const mutation = useMutation(trpc.operations.prepare.mutationOptions());
  const built = buildOperationsPayload(draft);

  if (prepared !== null) {
    return (
      <OperationsConfirmation
        prepared={prepared}
        draft={draft}
        onDismiss={props.onClose}
      />
    );
  }

  function prepare(): void {
    if (built.status !== "valid") return;
    mutation.mutate(
      { payload: built.payload },
      {
        onSuccess: (created) => {
          setPrepared(created);
        },
      },
    );
  }

  return (
    <OperationsRequestForm
      draft={draft}
      onChange={setDraft}
      onPrepare={prepare}
      onCancel={props.onClose}
      preparing={mutation.isPending}
      invalid={built.status === "invalid" ? built.message : null}
      errorMessage={mutation.error?.message ?? null}
    />
  );
}
