import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePenLine } from "lucide-react";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  ConfirmationOutcomeMessage,
  ExploreConfirmationCard,
} from "#src/components/explore-confirmation-card.tsx";
import { ScoutQlCode } from "#src/components/scoutql-code.tsx";
import { useNow } from "#src/hooks/use-now.ts";
import {
  confirmationCardState,
  type DareDraftCardData,
  type DareIntentCardData,
} from "#src/lib/explore-intent-cards.ts";
import {
  classifyDareIntentConfirmation,
  type IntentConfirmationOutcome,
} from "#src/lib/intent-confirmation.ts";
import { useTRPC } from "#src/lib/trpc.ts";

/**
 * The Bryan Bucks half of the Explore confirmation cards.
 *
 * A draft is not a confirmation — nothing is staked until someone funds it —
 * so it keeps its own plain panel and only the intent card wears the shared
 * confirmation shell.
 */

export function ExploreDareDraftCard(props: { draft: DareDraftCardData }) {
  const [showQuery, setShowQuery] = useState(false);
  const queryLabel =
    props.draft.sqlIsBinding === true ? "binding SQL" : "ScoutQL";
  return (
    <section className="space-y-3 rounded-lg border border-scout-border bg-scout-surface p-4">
      <div className="flex items-center gap-2">
        <FilePenLine className="size-4 text-scout-primary" />
        <h3 className="font-medium">
          Dare #{props.draft.dareId.toString()} draft · revision{" "}
          {props.draft.revision.toString()}
        </h3>
      </div>
      <p className="whitespace-pre-wrap text-sm">{props.draft.plainLanguage}</p>
      {props.draft.originalText !== undefined && (
        <p className="text-xs text-scout-subtle">
          Original wording: {props.draft.originalText}
        </p>
      )}
      <dl className="grid gap-1 text-xs text-scout-subtle sm:grid-cols-2">
        <div>
          <dt className="inline font-medium">Targets: </dt>
          <dd className="inline">{props.draft.targetAliases.join(", ")}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Opening stake: </dt>
          <dd className="inline">{props.draft.openingStake.toString()} BB</dd>
        </div>
      </dl>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setShowQuery((shown) => !shown);
        }}
      >
        {showQuery ? `Hide ${queryLabel}` : `Show ${queryLabel}`}
      </Button>
      {showQuery && (
        <div className="space-y-2">
          {props.draft.sqlIsBinding === true && (
            <p className="text-xs font-medium text-scout-primary">
              This canonical SQL is the binding Dare contract.
            </p>
          )}
          <ScoutQlCode queryText={props.draft.canonicalScoutQl} />
        </div>
      )}
    </section>
  );
}

function persistedDareOutcome(
  action: DareIntentCardData["action"],
  status:
    { state: "consumed" | "expired" | "pending"; result: unknown } | undefined,
): IntentConfirmationOutcome | null {
  if (status?.state === "consumed") {
    return classifyDareIntentConfirmation(action, {
      kind: "already_consumed",
      result: status.result,
    });
  }
  if (status?.state === "expired") {
    return classifyDareIntentConfirmation(action, { kind: "intent_expired" });
  }
  return null;
}

function dareIntentHeading(
  action: DareIntentCardData["action"],
  outcome: IntentConfirmationOutcome | null,
): string {
  if (outcome === null) return `Confirm ${action}`;
  return outcome.status === "confirmed"
    ? "Action confirmed"
    : "Action was not confirmed";
}

function DareIntentSummary(props: { intent: DareIntentCardData }) {
  return (
    <>
      <p className="text-sm text-scout-subtle">
        Dare #{props.intent.dareId.toString()}, revision{" "}
        {props.intent.revision.toString()}.
      </p>
      {props.intent.originalText !== undefined && (
        <div className="space-y-2 rounded-md border border-scout-border bg-scout-surface p-3 text-sm">
          <p>
            <span className="font-medium">Original wording:</span>{" "}
            {props.intent.originalText}
          </p>
          <p>{props.intent.plainLanguage}</p>
          {props.intent.semanticProofPlan !== undefined && (
            <p className="whitespace-pre-wrap text-xs text-scout-subtle">
              {props.intent.semanticProofPlan}
            </p>
          )}
          {props.intent.sqlIsBinding === true && (
            <p className="text-xs font-medium text-scout-primary">
              The canonical SQL below is the binding contract.
            </p>
          )}
          {props.intent.canonicalScoutQl !== undefined && (
            <ScoutQlCode queryText={props.intent.canonicalScoutQl} />
          )}
        </div>
      )}
    </>
  );
}

export function ExploreDareIntentCard(props: { intent: DareIntentCardData }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const nowMs = useNow();
  const [outcome, setOutcome] = useState<IntentConfirmationOutcome | null>(
    null,
  );
  const mutation = useMutation(
    trpc.explore.confirmDareIntent.mutationOptions(),
  );
  const persisted = useQuery(
    trpc.explore.intentStatus.queryOptions({ intentId: props.intent.intentId }),
  );
  const expiresInMs = new Date(props.intent.expiresAt).getTime() - nowMs;
  const displayedOutcome =
    outcome ?? persistedDareOutcome(props.intent.action, persisted.data);
  const state = confirmationCardState({
    outcome: displayedOutcome,
    confirming: mutation.isPending,
    expired: expiresInMs <= 0,
  });
  function confirm(): void {
    mutation.mutate(
      { intentId: props.intent.intentId },
      {
        onSuccess: (result) => {
          setOutcome(
            classifyDareIntentConfirmation(props.intent.action, result),
          );
          void queryClient.invalidateQueries({
            queryKey: trpc.bucks.dareList.pathKey(),
          });
          void queryClient.invalidateQueries({
            queryKey: trpc.bucks.dareInspect.pathKey(),
          });
          void queryClient.invalidateQueries({
            queryKey: trpc.explore.intentStatus.queryKey({
              intentId: props.intent.intentId,
            }),
          });
        },
      },
    );
  }

  return (
    <ExploreConfirmationCard
      state={state}
      heading={dareIntentHeading(props.intent.action, displayedOutcome)}
      expiresInMs={expiresInMs}
      footer={
        <>
          {displayedOutcome === null || displayedOutcome.retryable ? (
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={mutation.isPending || expiresInMs <= 0}
                onClick={confirm}
              >
                {mutation.isPending
                  ? "Confirming…"
                  : displayedOutcome === null
                    ? "Confirm"
                    : "Try again"}
              </Button>
            </div>
          ) : (
            <ConfirmationOutcomeMessage
              status={displayedOutcome.status}
              message={displayedOutcome.message}
              capitalize
            />
          )}
          {displayedOutcome?.status === "failed" &&
            displayedOutcome.retryable && (
              <p className="text-sm capitalize text-scout-danger">
                {displayedOutcome.message}
              </p>
            )}
          {persisted.error !== null && (
            <p className="text-sm text-scout-danger">
              {persisted.error.message}
            </p>
          )}
          {outcome?.deliveryWarning !== null &&
            outcome?.deliveryWarning !== undefined && (
              <p className="text-sm text-scout-danger">
                {outcome.deliveryWarning}
              </p>
            )}
          {mutation.error !== null && (
            <p className="text-sm text-scout-danger">
              {mutation.error.message}
            </p>
          )}
        </>
      }
    >
      <DareIntentSummary intent={props.intent} />
    </ExploreConfirmationCard>
  );
}
