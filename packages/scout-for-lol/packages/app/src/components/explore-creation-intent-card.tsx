import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import type { CreationIntentKind } from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  ConfirmationOutcomeMessage,
  ExploreConfirmationCard,
} from "#src/components/explore-confirmation-card.tsx";
import { useNow } from "#src/hooks/use-now.ts";
import { track } from "#src/lib/analytics.ts";
import {
  confirmationCardState,
  creationCardHeading,
  creationConfirmedEvent,
  createdEntityLink,
  type CreationIntentCardData,
} from "#src/lib/explore-intent-cards.ts";
import {
  classifyCreationIntentConfirmation,
  type CreationConfirmationOutcome,
} from "#src/lib/intent-confirmation.ts";
import { useTRPC } from "#src/lib/trpc.ts";

/**
 * The card that turns a prepared report, subscription or competition into a
 * real one.
 *
 * The model minted an intent and nothing else. Confirming is a CSRF-protected
 * mutation that re-runs the whole authorization decision server-side, so this
 * card is exactly one button and the honest reporting of one answer — it never
 * predicts success, and it never offers a retry for an answer that consumed
 * the intent.
 */

function CreatedEntityLink(props: { outcome: CreationConfirmationOutcome }) {
  if (props.outcome.status !== "confirmed") return null;
  const link = createdEntityLink(props.outcome.created);
  return (
    <Link
      to={link.href}
      className="text-sm font-medium text-scout-primary underline"
    >
      {link.label}
    </Link>
  );
}

export function CreationConfirmationView(props: {
  intent: CreationIntentCardData;
  /**
   * The server's answer, once there is one. Every creation refusal arrives as
   * a result rather than an error, which means the claim committed and the
   * intent is spent — so an answer is final and no retry is offered.
   */
  outcome: CreationConfirmationOutcome | null;
  /** Time left on the intent, for the clock. */
  expiresInMs: number;
  /** The browser clock or the server's own status says it is out of time. */
  expired: boolean;
  confirming: boolean;
  /** A transport or authorization failure, which never consumes the intent. */
  errorMessage: string | null;
  onConfirm: () => void;
}) {
  const state = confirmationCardState({
    outcome: props.outcome,
    confirming: props.confirming,
    expired: props.expired,
  });
  return (
    <ExploreConfirmationCard
      state={state}
      heading={creationCardHeading(props.intent.kind, state)}
      expiresInMs={props.expiresInMs}
      footer={
        <>
          {props.outcome === null ? (
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={props.confirming || props.expired}
                onClick={props.onConfirm}
              >
                {props.confirming ? "Creating…" : "Confirm"}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <ConfirmationOutcomeMessage
                status={props.outcome.status}
                message={props.outcome.message}
              />
              <CreatedEntityLink outcome={props.outcome} />
            </div>
          )}
          {props.errorMessage !== null && (
            <p className="text-sm text-scout-danger">{props.errorMessage}</p>
          )}
        </>
      }
    >
      <p className="whitespace-pre-wrap text-sm">{props.intent.summary}</p>
      <p className="text-xs text-scout-subtle">
        Nothing has been created yet. Scout checks your permissions again when
        you confirm.
      </p>
    </ExploreConfirmationCard>
  );
}

/**
 * Report the outcome with bounded properties only.
 *
 * The registry permits `guild_id` and nothing else that identifies anything,
 * so a success carries the server-confirmed guild and a failure carries the
 * refusal's own kind — never the server's message, an entity id, a channel, or
 * an alias.
 */
function trackCreationOutcome(
  kind: CreationIntentKind,
  outcome: CreationConfirmationOutcome,
): void {
  if (outcome.status === "confirmed") {
    track(creationConfirmedEvent(outcome.created.entity), {
      guild_id: outcome.created.guildId,
    });
    return;
  }
  track("explore_creation_confirm_failed", { kind, reason: outcome.reason });
}

function createdListPathKey(
  trpc: ReturnType<typeof useTRPC>,
  entity: CreationIntentKind,
): readonly unknown[] {
  switch (entity) {
    case "report":
      return trpc.report.list.pathKey();
    case "subscription":
      return trpc.subscription.list.pathKey();
    case "competition":
      return trpc.competition.list.pathKey();
  }
}

export function ExploreCreationIntentCard(props: {
  intent: CreationIntentCardData;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const nowMs = useNow();
  const [outcome, setOutcome] = useState<CreationConfirmationOutcome | null>(
    null,
  );
  const mutation = useMutation(
    trpc.explore.confirmCreationIntent.mutationOptions(),
  );
  const persisted = useQuery(
    trpc.explore.creationIntentStatus.queryOptions({
      intentId: props.intent.intentId,
    }),
  );
  const expiresInMs = new Date(props.intent.expiresAt).getTime() - nowMs;
  const displayedOutcome =
    outcome ?? replayedCreationOutcome(props.intent.kind, persisted.data);

  function confirm(): void {
    mutation.mutate(
      { intentId: props.intent.intentId },
      {
        onSuccess: (result) => {
          const classified = classifyCreationIntentConfirmation(
            props.intent.kind,
            result,
          );
          setOutcome(classified);
          trackCreationOutcome(props.intent.kind, classified);
          if (classified.status === "confirmed") {
            void queryClient.invalidateQueries({
              queryKey: createdListPathKey(trpc, classified.created.entity),
            });
          }
          void queryClient.invalidateQueries({
            queryKey: trpc.explore.creationIntentStatus.queryKey({
              intentId: props.intent.intentId,
            }),
          });
        },
        onError: () => {
          track("explore_creation_confirm_failed", {
            kind: props.intent.kind,
            reason: "error",
          });
        },
      },
    );
  }

  return (
    <CreationConfirmationView
      intent={props.intent}
      outcome={displayedOutcome}
      expiresInMs={expiresInMs}
      expired={expiresInMs <= 0 || persisted.data?.state === "expired"}
      confirming={mutation.isPending}
      errorMessage={mutation.error?.message ?? persisted.error?.message ?? null}
      onConfirm={confirm}
    />
  );
}

/**
 * The answer a previous confirmation already recorded, so reloading the
 * conversation shows what happened rather than a live-looking button.
 *
 * An intent that merely ran out of time is not an answer: it is reported
 * through the card's `expired` state instead, so an untouched confirmation
 * never reads as something that was attempted and refused.
 */
function replayedCreationOutcome(
  kind: CreationIntentKind,
  status:
    { state: "consumed" | "expired" | "pending"; result: unknown } | undefined,
): CreationConfirmationOutcome | null {
  if (status?.state !== "consumed") return null;
  return classifyCreationIntentConfirmation(kind, {
    kind: "already_consumed",
    result: status.result,
  });
}
