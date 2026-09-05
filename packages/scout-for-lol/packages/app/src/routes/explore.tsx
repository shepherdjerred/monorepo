import { Loaded } from "@shepherdjerred/loaded";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import { ChevronDown } from "lucide-react";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@scout-for-lol/design-system/components/collapsible";
import { ExploreComposer } from "#src/components/explore-composer.tsx";
import { ExploreHeader } from "#src/components/explore-header.tsx";
import { ExploreShareRow } from "#src/components/explore-share.tsx";
import { ExploreTranscript } from "#src/components/explore-transcript.tsx";
import type { ExploreTranscriptActions } from "#src/components/explore-transcript-actions.ts";
import { ForbiddenPanel } from "#src/components/forbidden-panel.tsx";
import { SectionSkeleton } from "#src/components/section-skeleton.tsx";
import { useExploreTurnActions } from "#src/hooks/use-explore-turn-actions.ts";
import {
  exploreTurnIsActive,
  visiblePending,
} from "#src/lib/explore-turn-state.ts";
import {
  conversationToMarkdown,
  downloadMarkdown,
  exportFilename,
} from "#src/lib/explore-export.ts";
import { analyticsMeta, track } from "#src/lib/analytics.ts";
import { useExploreParams } from "#src/lib/route-params.ts";
import { useExploreShare } from "#src/hooks/use-explore-share.ts";
import { useExploreRuns } from "#src/components/explore-runs-context.ts";
import { usePinnedScroll } from "#src/hooks/use-pinned-scroll.ts";
import { useTRPC } from "#src/lib/trpc.ts";

/**
 * Explore: ask questions of every match Scout has ingested.
 *
 * Turns stream over SSE while conversation management goes through tRPC, so
 * the transcript is authoritative on the server and this page only mirrors
 * it. The active conversation lives in the URL (`/explore/:conversationId`),
 * so refresh, Back, and deep links keep their place; the in-flight turn's
 * state lives in the route-level Explore provider and is keyed by conversation,
 * so navigation detaches the page without cancelling or misplacing the run.
 */
export function Explore() {
  const { conversationId: routeConversationId } = useExploreParams();
  const conversationId = routeConversationId ?? null;
  const location = useLocation();
  const locationKeyRef = useRef(location.key);
  locationKeyRef.current = location.key;
  const navigate = useNavigate();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [restoredDraft, setRestoredDraft] = useState<string | null>(null);
  const runs = useExploreRuns();

  const {
    status,
    conversationState,
    statusQuery,
    enabled,
    quota,
    transcript,
    messages,
    title,
    shared,
  } = useExploreConversation(conversationId);

  const pendingTurn = runs.pendingTurn(conversationId);
  const turnActive = exploreTurnIsActive(pendingTurn, runs.discoverySettled);

  useEffect(() => {
    if (conversationId === null) return;
    runs.acknowledgeVisibleAnswer(conversationId, messages);
  }, [conversationId, messages, runs]);

  const share = useExploreShare({ conversationId, shareToken: shared });

  const setLeafMutation = useMutation(
    trpc.explore.setLeaf.mutationOptions({
      meta: analyticsMeta("explore_branch_selected"),
    }),
  );
  const refreshList = useCallback(async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: trpc.explore.list.queryKey(),
    });
  }, [queryClient, trpc.explore.list]);

  const refreshConversation = useCallback(
    async (id: string): Promise<void> => {
      await queryClient.invalidateQueries({
        queryKey: trpc.explore.get.queryKey({ conversationId: id }),
      });
      await refreshList();
    },
    [queryClient, refreshList, trpc.explore.get],
  );

  const { ask, handleEdit, handleRegenerate, handleRetry } =
    useExploreTurnActions({
      conversationId,
      messages,
      runs,
      locationKeyRef,
      setRestoredDraft,
      navigate,
    });

  const lastFailedVersionRef = useRef<string | null>(null);

  const handleSelectVersion = useCallback(
    async (messageId: string): Promise<void> => {
      if (conversationId === null) {
        return;
      }
      setError(null);
      lastFailedVersionRef.current = null;
      try {
        await setLeafMutation.mutateAsync({ conversationId, messageId });
        await refreshConversation(conversationId);
      } catch (mutationError) {
        lastFailedVersionRef.current = messageId;
        setError(errorText(mutationError));
      }
    },
    [conversationId, refreshConversation, setLeafMutation],
  );

  const transcriptActions = useMemo<ExploreTranscriptActions>(
    () => ({
      onFollowUp: ask,
      onEdit: handleEdit,
      onRegenerate: handleRegenerate,
      onRetry: handleRetry,
      onSelectVersion: (messageId) => {
        void handleSelectVersion(messageId);
      },
    }),
    [ask, handleEdit, handleRegenerate, handleRetry, handleSelectVersion],
  );

  const retryTarget = useMemo(() => {
    const last = messages.at(-1);
    return last?.role === "user" ? last : null;
  }, [messages]);

  const onRetryError = useCallback(() => {
    if (error !== null) {
      setError(null);
      const failedVersion = lastFailedVersionRef.current;
      if (failedVersion !== null) {
        void handleSelectVersion(failedVersion);
      } else if (conversationId !== null) {
        void refreshConversation(conversationId);
      }
    } else if (runs.error(conversationId) !== null) {
      runs.clearError(conversationId);
      if (retryTarget !== null) {
        handleRetry(retryTarget);
      } else if (conversationId !== null) {
        void refreshConversation(conversationId);
      }
    } else if (share.error !== null) {
      if (shared === null) {
        share.share();
      } else {
        share.revoke();
      }
    }
  }, [
    conversationId,
    error,
    handleRetry,
    handleSelectVersion,
    refreshConversation,
    retryTarget,
    runs,
    share,
    shared,
  ]);

  const {
    pendingQuestion,
    pendingAnswer,
    activity,
    trace: pendingTrace,
  } = visiblePending(pendingTurn, conversationId, messages);

  const { bottomRef, scrollIfPinned } = usePinnedScroll();
  useEffect(() => {
    scrollIfPinned();
  }, [transcript.data, pendingAnswer, activity, pendingTrace, scrollIfPinned]);

  if (status.status === "loading") {
    return <SectionSkeleton />;
  }

  // `strict` above turns a failed transcript refetch into `error`, and
  // `getOrElse` then hands the page `undefined` — which is indistinguishable
  // from "new conversation". Without this branch an existing conversation URL
  // renders as an empty composer, silently discarding the thread.
  if (conversationId !== null && conversationState.status === "error") {
    return (
      <div className="rounded-lg border border-scout-danger/40 bg-scout-surface p-8 text-center">
        <h2 className="text-base font-semibold text-scout-danger">
          This conversation couldn&apos;t load
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-scout-subtle">
          {Loaded.messageOf(conversationState.errors[0].error)}
        </p>
        <div className="mt-4 flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void transcript.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (status.status === "error") {
    // A failed availability check is not a denial — say so, and offer the
    // narrow retry (just this query) rather than a whole-page reload.
    return (
      <div className="rounded-lg border border-scout-danger/40 bg-scout-surface p-8 text-center">
        <h2 className="text-base font-semibold text-scout-danger">
          Explore couldn&apos;t load
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-scout-subtle">
          Checking your access failed. You can try again — if it keeps
          happening, reload the page.
        </p>
        <div className="mt-4 flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void statusQuery.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (!enabled) {
    return (
      <ForbiddenPanel
        title="Explore isn't available yet"
        message="Explore is in a limited rollout and is not available on your account yet."
      />
    );
  }

  const pageError = error ?? runs.error(conversationId) ?? share.error;

  const headerActions =
    conversationId !== null && messages.length > 0
      ? {
          shared: shared !== null,
          sharing: share.sharing,
          revoking: share.revoking,
          onExport: () => {
            track("explore_exported");
            downloadMarkdown(
              exportFilename(title),
              conversationToMarkdown(title, messages),
            );
          },
          onShare: share.share,
          onRevoke: share.revoke,
        }
      : undefined;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-5xl flex-col gap-4 px-6 py-8 sm:px-8 sm:py-12 [overscroll-behavior:none]">
      <ExploreHeader
        title={conversationId === null ? "Explore" : title}
        {...(headerActions === undefined ? {} : { actions: headerActions })}
      />

      {messages.length === 0 && pendingQuestion === null && (
        <div className="space-y-2 rounded-lg border border-dashed p-6">
          <p className="text-sm">
            Ask about champions, queues, positions, patches, or players across
            every match Scout has ingested.
          </p>
          <p className="text-xs text-scout-subtle">
            This is not the whole League ladder — it is the games of tracked
            players and everyone who was in them.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            {EXAMPLES.map((example) => (
              <Button
                key={example}
                variant="outline"
                size="sm"
                onClick={() => {
                  ask(example);
                }}
              >
                {example}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-4 pb-4">
        <ExploreTranscript
          messages={messages}
          pendingQuestion={pendingQuestion}
          pendingAnswer={pendingAnswer}
          activity={activity}
          pendingTrace={pendingTrace}
          turnActive={turnActive}
          showRawTrace
          actions={transcriptActions}
          hasError={pageError !== null}
        />

        {pageError !== null && (
          <ExploreErrorBanner
            pageError={pageError}
            conversationId={conversationId}
            runId={pendingTurn?.runId}
            retryTargetId={retryTarget?.id}
            executedSteps={pendingTrace.length}
            onRetry={onRetryError}
          />
        )}

        {share.showShareLink && share.shareLink !== null && (
          <ExploreShareRow shareLink={share.shareLink} copied={share.copied} />
        )}

        <div ref={bottomRef} />
      </div>

      {/* Pinned to the bottom of the viewport with a translucent gradient fade:
          allows chat text to remain visible below the composer through the fade effect. */}
      <div className="sticky bottom-0 w-full pointer-events-none pt-8 pb-4 bg-gradient-to-t from-scout-canvas/80 via-scout-canvas/30 via-40% to-transparent dark:from-black/75 dark:via-black/30 dark:via-40% dark:to-transparent">
        <div className="pointer-events-auto">
          <ExploreComposer
            active={pendingTurn !== null}
            disabled={!runs.discoverySettled}
            restoredDraft={restoredDraft}
            onAsk={ask}
            onStop={() => {
              runs.stop(conversationId);
            }}
          />
          <ExploreQuota quota={quota} />
        </div>
      </div>
    </div>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * How many questions are left, as one number.
 *
 * `explore.status` has always returned this and the page has never shown it,
 * so the only way to discover the limit was to hit it mid-thought. There are
 * seven windows across two scopes, and listing them is worse than saying
 * nothing — only the one about to stop you is worth a line, and that is
 * whichever has the fewest left. Hidden until a window is actually being
 * consumed, because a full allowance is noise.
 */
function ExploreQuota(props: {
  quota: { window: string; remaining: number; limit: number }[];
}) {
  const binding = props.quota
    .filter((snapshot) => snapshot.remaining < snapshot.limit)
    .reduce<(typeof props.quota)[number] | null>(
      (tightest, snapshot) =>
        tightest === null || snapshot.remaining < tightest.remaining
          ? snapshot
          : tightest,
      null,
    );
  if (binding === null) {
    return null;
  }
  return (
    <p className="pt-1 text-right text-xs text-muted-foreground">
      {binding.remaining.toString()} of {binding.limit.toString()} questions
      left this {binding.window}
    </p>
  );
}

/**
 * Load everything the page reads: availability, the conversation list, and the
 * active transcript with its derived fields.
 *
 * Separated from the component so the route's own logic stays about handling
 * turns rather than unwrapping query state.
 */
function useExploreConversation(conversationId: string | null) {
  const trpc = useTRPC();
  const statusQuery = useQuery(trpc.explore.status.queryOptions());
  // `strict` because `enabled` is the authorization for this page: a stale
  // `enabled: true` read through `getOrElse` would keep the owner-only
  // transcript on screen precisely when Scout could not reverify guild
  // membership. Collapsing `degraded` to `error` makes the recheck failure
  // close the page instead of failing open.
  const status = Loaded.strict(
    Loaded.fromQuery(statusQuery, ["explore.status"]),
  );
  const availability = Loaded.getOrElse(status, undefined);
  const enabled = availability?.enabled === true;
  const transcript = useQuery({
    ...trpc.explore.get.queryOptions({ conversationId: conversationId ?? "" }),
    enabled: enabled && conversationId !== null,
  });

  // The transcript is the owner-only content the status check guards, so it is
  // `strict` for the same reason the check is: a retained conversation must not
  // outlive the authorization that produced it.
  const conversationState = Loaded.strict(
    Loaded.fromQuery(transcript, ["explore.get"]),
  );
  const conversation = Loaded.getOrElse(conversationState, undefined);
  return {
    status,
    conversationState,
    statusQuery,
    enabled,
    quota: availability?.quota ?? [],
    transcript,
    messages: conversation?.messages ?? [],
    title: conversation?.conversation.title ?? "Explore",
    shared: conversation?.conversation.shareToken ?? null,
  };
}

const EXAMPLES = [
  "Which champions have the highest win rate?",
  "How does KDA differ by position?",
  "What is the most played queue this month?",
];

function ExploreErrorBanner(props: {
  readonly pageError: string;
  readonly conversationId: string | null;
  readonly runId?: string | null | undefined;
  readonly retryTargetId?: string | null | undefined;
  readonly executedSteps: number;
  readonly onRetry: () => void;
}) {
  return (
    <div className="rounded-md border border-scout-danger/40 bg-scout-danger/10 p-3 text-sm text-scout-ink space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{props.pageError}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={props.onRetry}
        >
          Retry
        </Button>
      </div>
      <Collapsible className="space-y-1.5 pt-0.5">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded py-0.5 px-1.5 text-xs text-scout-subtle hover:text-scout-ink hover:bg-scout-danger/10 transition-colors group"
          >
            <span>Technical details</span>
            <ChevronDown
              className="size-3 text-scout-subtle transition-transform group-data-[state=open]:rotate-180"
              aria-hidden="true"
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="rounded border border-scout-border/60 bg-scout-surface p-2.5 text-xs font-mono space-y-1 overflow-x-auto select-text">
            <div>
              <span className="text-scout-subtle">Error: </span>
              <span className="text-scout-danger font-semibold">
                {props.pageError}
              </span>
            </div>
            {props.conversationId !== null && (
              <div>
                <span className="text-scout-subtle">Conversation ID: </span>
                <span>{props.conversationId}</span>
              </div>
            )}
            {props.runId !== undefined && props.runId !== null && (
              <div>
                <span className="text-scout-subtle">Run ID: </span>
                <span>{props.runId}</span>
              </div>
            )}
            {props.retryTargetId !== undefined &&
              props.retryTargetId !== null && (
                <div>
                  <span className="text-scout-subtle">Question ID: </span>
                  <span>{props.retryTargetId}</span>
                </div>
              )}
            {props.executedSteps > 0 && (
              <div>
                <span className="text-scout-subtle">Executed steps: </span>
                <span>{props.executedSteps.toString()}</span>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
