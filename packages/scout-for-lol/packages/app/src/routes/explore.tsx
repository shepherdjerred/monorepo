import { Loaded } from "@shepherdjerred/loaded";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "react-router";
import { ArrowDown } from "lucide-react";
import { Button } from "@scout-for-lol/design-system/components/button";
import { ExploreSuggestionChips } from "#src/components/explore/transcript/explore-suggestion-chips.tsx";
import { ExploreErrorBanner } from "#src/components/explore/transcript/explore-error-banner.tsx";
import { ExploreComposer } from "#src/components/explore/explore-composer.tsx";
import { ExploreHeader } from "#src/components/explore/explore-header.tsx";
import { ExploreShareRow } from "#src/components/explore/explore-share.tsx";
import { ExploreTranscript } from "#src/components/explore/transcript/explore-transcript.tsx";
import type { ExploreTranscriptActions } from "#src/components/explore/transcript/explore-transcript-actions.ts";
import { ForbiddenPanel } from "#src/components/chrome/forbidden-panel.tsx";
import { ErrorPanel } from "#src/components/chrome/route-error-panel.tsx";
import { SectionSkeleton } from "#src/components/chrome/section-skeleton.tsx";
import { useExploreConversation } from "#src/hooks/use-explore-conversation.ts";
import { useExploreModel } from "#src/hooks/use-explore-model.ts";
import { ExploreModelControls } from "#src/components/explore/inspection/explore-model-controls.tsx";
import { useExploreTurnActions } from "#src/hooks/use-explore-turn-actions.ts";
import {
  exploreTurnIsActive,
  shouldShowExploreSuggestions,
  visiblePending,
} from "#src/lib/explore/explore-turn-state.ts";
import {
  conversationToMarkdown,
  downloadMarkdown,
  exportFilename,
} from "#src/lib/explore/explore-export.ts";
import { analyticsMeta, track } from "#src/lib/analytics.ts";
import { useExploreParams } from "#src/lib/routes/route-params.ts";
import { useExploreShare } from "#src/hooks/use-explore-share.ts";
import { useExploreRuns } from "#src/components/explore/explore-runs-context.ts";
import { usePinnedScroll } from "#src/hooks/use-pinned-scroll.ts";
import { useTRPC } from "#src/lib/query/trpc.ts";

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
const EXPLORE_CONTAINER_CLASS =
  "mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-5xl flex-col gap-4 px-6 py-8 sm:px-8 sm:py-12 [overscroll-behavior:none]";

function conversationLayout(empty: boolean, composerHeight: number) {
  return {
    transcriptClass: empty ? "space-y-4" : "min-h-0 flex-1 space-y-4 pb-4",
    transcriptStyle:
      composerHeight === 0 || empty
        ? undefined
        : { paddingBottom: `${composerHeight.toString()}px` },
    composerClass: empty
      ? "w-full pb-4"
      : "sticky bottom-0 w-full pointer-events-none pt-8 pb-4 explore-composer-fade",
  };
}

export function Explore() {
  const { conversationId: routeConversationId } = useExploreParams();
  const conversationId = routeConversationId ?? null;
  const [composerElement, setComposerElement] = useState<HTMLDivElement | null>(
    null,
  );
  const [composerHeight, setComposerHeight] = useState(0);
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
    origin,
    shared,
    modelPickerEnabled,
    preferredModel,
    spending,
  } = useExploreConversation(conversationId);
  const { model, chooseModel, requestModel } = useExploreModel(
    conversationId,
    preferredModel,
    modelPickerEnabled,
  );

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
    async (_id: string): Promise<void> => {
      await queryClient.invalidateQueries({
        queryKey: trpc.explore.get.queryKey(),
      });
      await refreshList();
    },
    [queryClient, refreshList, trpc.explore.get],
  );

  const { ask, handleEdit, handleRegenerate, handleRetry } =
    useExploreTurnActions({
      model: requestModel,
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

  // Memoized because `visiblePending` returns fresh literals — `trace: []`
  // among them — on every call, and those values are the dependencies of the
  // follow-the-stream effect below. Unmemoized, the effect fired on *every*
  // render, including the ones `usePinnedScroll` itself causes when the
  // reader's scroll position crosses the pinned threshold. The result was a
  // page that scrolled itself to the bottom the moment a reader scrolled into
  // the last 120px, with no turn streaming at all.
  const {
    pendingQuestion,
    pendingAnswer,
    activity,
    stopping,
    trace: pendingTrace,
    preview: pendingPreview,
    visualization: pendingVisualization,
  } = useMemo(
    () => visiblePending(pendingTurn, conversationId, messages),
    [pendingTurn, conversationId, messages],
  );

  const { scrollIfPinned, pinned, scrollToBottom } = usePinnedScroll();
  useEffect(() => {
    if (composerElement === null) return;
    const updateHeight = () => {
      setComposerHeight(
        Math.ceil(composerElement.getBoundingClientRect().height),
      );
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(composerElement);
    return () => {
      observer.disconnect();
    };
  }, [composerElement]);
  useEffect(() => {
    scrollIfPinned();
  }, [
    transcript.data,
    pendingAnswer,
    activity,
    pendingTrace,
    pendingPreview,
    scrollIfPinned,
  ]);

  if (status.status === "loading") {
    return (
      <div className={EXPLORE_CONTAINER_CLASS}>
        <SectionSkeleton />
      </div>
    );
  }

  // `strict` above turns a failed transcript refetch into `error`, and
  // `getOrElse` then hands the page `undefined` — which is indistinguishable
  // from "new conversation". Without this branch an existing conversation URL
  // renders as an empty composer, silently discarding the thread.
  if (conversationId !== null && conversationState.status === "error") {
    return (
      <div className={EXPLORE_CONTAINER_CLASS}>
        <ExploreHeader title="Explore" />
        <ErrorPanel
          title="This conversation couldn't load"
          message={Loaded.messageOf(conversationState.errors[0].error)}
          onRetry={() => {
            void transcript.refetch();
          }}
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/explore">New conversation</Link>
            </Button>
          }
        />
      </div>
    );
  }

  if (status.status === "error") {
    // A failed availability check is not a denial — say so, and offer the
    // narrow retry (just this query) rather than a whole-page reload.
    return (
      <div className={EXPLORE_CONTAINER_CLASS}>
        <ExploreHeader title="Explore" />
        <ErrorPanel
          title="Explore couldn't load"
          message="Checking your access failed. You can try again — if it keeps happening, reload the page."
          onRetry={() => {
            void statusQuery.refetch();
          }}
        />
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className={EXPLORE_CONTAINER_CLASS}>
        <ForbiddenPanel
          title="Explore isn't available yet"
          message="Explore is in a limited rollout and is not available on your account yet."
        />
      </div>
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

  const emptyConversation = shouldShowExploreSuggestions({
    messageCount: messages.length,
    pendingQuestion,
    pendingTurn,
  });
  const layout = conversationLayout(emptyConversation, composerHeight);
  return (
    <div className={EXPLORE_CONTAINER_CLASS}>
      <ExploreHeader
        title={conversationId === null ? "Explore" : title}
        voiceConversation={origin === "voice"}
        {...(headerActions === undefined ? {} : { actions: headerActions })}
      />

      {shouldShowExploreSuggestions({
        messageCount: messages.length,
        pendingQuestion,
        pendingTurn,
      }) && <ExploreSuggestionChips onSelect={ask} enabled={enabled} />}

      <div className={layout.transcriptClass} style={layout.transcriptStyle}>
        <ExploreTranscript
          messages={messages}
          pendingQuestion={pendingQuestion}
          pendingAnswer={pendingAnswer}
          activity={activity}
          stopping={stopping}
          pendingTrace={pendingTrace}
          pendingPreview={pendingPreview}
          pendingVisualization={pendingVisualization}
          turnActive={turnActive}
          showRawTrace
          allowIntentActions
          conversationId={conversationId ?? undefined}
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
      </div>

      {/* Pinned to the bottom of the viewport with a translucent gradient fade:
          allows chat text to remain visible below the composer through the fade
          effect. `explore-composer-fade` carries the gradient (see global.css
          for why it is not built from `from-*`/`to-*`); it is the canvas colour
          in every theme, which switches with `data-scout-mode`. */}
      <div ref={setComposerElement} className={layout.composerClass}>
        <ExploreJumpToLatest pinned={pinned} onClick={scrollToBottom} />
        <div className="pointer-events-auto rounded-lg bg-scout-canvas">
          <ExploreModelControls
            enabled={modelPickerEnabled}
            model={model}
            chooseModel={chooseModel}
            spending={spending}
          />
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
 * Only while the reader is away from the bottom, so the idle page is
 * unchanged and nothing overlaps the composer at rest.
 *
 * Absolutely positioned, not a flow sibling of the composer. In flow the pill
 * added its own height to the sticky footer, so appearing and disappearing
 * changed the document's height by ~40px — and it appears and disappears
 * exactly when the reader is scrolling near the bottom, which shunted the page
 * under them in whichever direction they had just moved.
 *
 * It carries its own surface because `outline` is transparent by design: over
 * the transcript it otherwise read as loose text sitting on the conversation.
 */
function ExploreJumpToLatest(props: { pinned: boolean; onClick: () => void }) {
  if (props.pinned) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 -top-2 flex justify-center">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="pointer-events-auto rounded-full bg-scout-surface shadow-sm hover:bg-scout-hover"
        onClick={props.onClick}
      >
        <ArrowDown className="size-3.5" aria-hidden="true" />
        Jump to latest
      </Button>
    </div>
  );
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
