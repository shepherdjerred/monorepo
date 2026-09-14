import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OperationsIntentKind } from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  ConfirmationOutcomeMessage,
  ExploreConfirmationCard,
} from "#src/components/explore/intent/explore-confirmation-card.tsx";
import { useNow } from "#src/hooks/use-now.ts";
import { confirmationCardState } from "#src/lib/explore/explore-intent-cards.ts";
import {
  classifyOperationsConfirmation,
  type OperationsConfirmationOutcome,
} from "#src/lib/operations/operations-outcomes.ts";
import {
  operationsCardHeading,
  operationsRequestSummary,
  type OperationsRequestDraft,
} from "#src/lib/operations/operations-payloads.ts";
import { useTRPC } from "#src/lib/query/trpc.ts";

/**
 * An operations confirmation, in the same card every Explore confirmation uses.
 *
 * Reusing `ExploreConfirmationCard` is the point rather than a convenience. A
 * prepared report and a prepared pipeline repair are the same protocol — a
 * single-use, expiring, actor-bound intent a human authorizes — and a second
 * card shape would let "confirmed" and "expired" come to mean two different
 * things depending on which surface minted them. The middle differs; the frame,
 * the clock and the settled states do not.
 *
 * There is no retry control here, in any state, and that is structural. Every
 * answer this card can show is terminal for the intent behind it: a claimed
 * intent is spent, and an expired one cannot be claimed. Wanting the operation
 * again means preparing a new intent from the current queues, which is a fresh
 * authorization rather than a second use of a spent one.
 */

export type PreparedOperation = {
  readonly intentId: string;
  readonly kind: OperationsIntentKind;
  readonly expiresAt: string;
};

function OutcomeFacts(props: { outcome: OperationsConfirmationOutcome }) {
  if (props.outcome.facts.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-scout-subtle">
      {props.outcome.facts.map((fact) => (
        <div key={fact.label} className="contents">
          <dt className="font-medium text-scout-ink">{fact.label}</dt>
          <dd className="break-all font-mono">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function OperationsConfirmationView(props: {
  kind: OperationsIntentKind;
  /** What confirming will do, in the arm's own words. */
  summary: string;
  /**
   * The server's answer, once there is one. Every operations refusal arrives as
   * a result rather than an error, which means the claim committed and the
   * intent is spent — so an answer is final.
   */
  outcome: OperationsConfirmationOutcome | null;
  expiresInMs: number;
  /** The browser clock or the server's own status says it is out of time. */
  expired: boolean;
  confirming: boolean;
  /** A transport or authorization failure, which never consumes the intent. */
  errorMessage: string | null;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const state = confirmationCardState({
    outcome: props.outcome,
    confirming: props.confirming,
    expired: props.expired,
  });
  const outcome = props.outcome;
  return (
    <ExploreConfirmationCard
      state={state}
      heading={outcome?.heading ?? operationsCardHeading(props.kind, state)}
      expiresInMs={props.expiresInMs}
      footer={
        <>
          {outcome === null ? (
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={props.confirming || props.expired}
                onClick={props.onConfirm}
              >
                {props.confirming ? "Confirming…" : "Confirm"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={props.confirming}
                onClick={props.onDismiss}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div
              className="space-y-2"
              // `effect` is what keeps a settled card honest: a replayed or
              // already-accepted answer reads as `none` even though its status
              // is `confirmed`, because this confirmation did not do it.
              data-operations-effect={outcome.effect}
            >
              <ConfirmationOutcomeMessage
                status={outcome.status}
                message={outcome.message}
              />
              <OutcomeFacts outcome={outcome} />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={props.onDismiss}
              >
                Done
              </Button>
            </div>
          )}
          {props.errorMessage !== null && (
            <p className="text-sm text-scout-danger">{props.errorMessage}</p>
          )}
        </>
      }
    >
      {/*
       * The recap is written in the future tense — "confirming authorizes…",
       * "nothing is running yet" — so it is removed the moment there is an
       * answer. Leaving it under a settled outcome puts a stale promise and the
       * thing that actually happened on screen together, and the card would be
       * contradicting itself. Once settled, the heading, message and facts are
       * the whole story.
       */}
      {outcome === null && (
        <>
          <p className="whitespace-pre-wrap text-sm">{props.summary}</p>
          <p className="text-xs text-scout-subtle">
            Nothing has happened yet. Scout re-checks that this account may
            operate the pipeline when you confirm.
          </p>
        </>
      )}
    </ExploreConfirmationCard>
  );
}

export function OperationsConfirmation(props: {
  prepared: PreparedOperation;
  draft: OperationsRequestDraft;
  onDismiss: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const nowMs = useNow();
  const [outcome, setOutcome] = useState<OperationsConfirmationOutcome | null>(
    null,
  );
  const mutation = useMutation(trpc.operations.confirm.mutationOptions());
  const persisted = useQuery(
    trpc.operations.intentStatus.queryOptions({
      intentId: props.prepared.intentId,
    }),
  );
  const expiresInMs = new Date(props.prepared.expiresAt).getTime() - nowMs;

  function confirm(): void {
    mutation.mutate(
      { intentId: props.prepared.intentId },
      {
        onSuccess: (result) => {
          setOutcome(classifyOperationsConfirmation(result));
          // The queues are a view of exactly the state this may have moved, so
          // they are re-read rather than patched from the answer.
          void queryClient.invalidateQueries({
            queryKey: trpc.operations.queues.pathKey(),
          });
          void queryClient.invalidateQueries({
            queryKey: trpc.operations.matchPipeline.pathKey(),
          });
        },
      },
    );
  }

  return (
    <OperationsConfirmationView
      kind={props.prepared.kind}
      summary={operationsRequestSummary(props.draft)}
      outcome={outcome}
      expiresInMs={expiresInMs}
      expired={expiresInMs <= 0 || persisted.data?.state === "expired"}
      confirming={mutation.isPending}
      errorMessage={mutation.error?.message ?? persisted.error?.message ?? null}
      onConfirm={confirm}
      onDismiss={props.onDismiss}
    />
  );
}
