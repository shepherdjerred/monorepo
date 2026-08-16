import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type { ExploreConversation, ExploreMessage } from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import { ExploreComposer } from "#src/components/explore-composer.tsx";
import { ExploreHeader } from "#src/components/explore-header.tsx";
import { ExploreShareRow } from "#src/components/explore-share.tsx";
import { ExploreSidebar } from "#src/components/explore-sidebar.tsx";
import {
  ExploreTranscript,
  type ExploreTranscriptActions,
} from "#src/components/explore-transcript.tsx";
import { ConfirmDeleteDialog } from "#src/components/confirm-delete-dialog.tsx";
import { ForbiddenPanel } from "#src/components/forbidden-panel.tsx";
import { RenameConversationDialog } from "#src/components/rename-conversation-dialog.tsx";
import { SectionSkeleton } from "#src/components/section-skeleton.tsx";
import {
  conversationToMarkdown,
  downloadMarkdown,
  exportFilename,
} from "#src/lib/explore-export.ts";
import {
  pendingTurnLeftTheScreen,
  visiblePending,
} from "#src/lib/explore-turn-state.ts";
import { useExploreParams } from "#src/lib/route-params.ts";
import { useExploreShare } from "#src/hooks/use-explore-share.ts";
import { useExploreTurn } from "#src/hooks/use-explore-turn.ts";
import { usePinnedScroll } from "#src/hooks/use-pinned-scroll.ts";
import { useTRPC } from "#src/lib/trpc.ts";

/**
 * Explore: ask questions of every match Scout has ingested.
 *
 * Turns stream over SSE while conversation management goes through tRPC, so
 * the transcript is authoritative on the server and this page only mirrors
 * it. The active conversation lives in the URL (`/explore/:conversationId`),
 * so refresh, Back, and deep links keep their place; the in-flight turn's
 * state lives in {@link useExploreTurn} and is keyed by conversation, so a
 * stream never renders under a conversation it does not belong to.
 */
export function Explore() {
  const { conversationId: routeConversationId } = useExploreParams();
  const conversationId = routeConversationId ?? null;
  const navigate = useNavigate();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [restoredDraft, setRestoredDraft] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [renaming, setRenaming] = useState<ExploreConversation | null>(null);
  const [deleting, setDeleting] = useState<ExploreConversation | null>(null);

  const {
    status,
    enabled,
    quota,
    conversations,
    transcript,
    messages,
    title,
    shared,
  } = useExploreConversation(conversationId);

  const turn = useExploreTurn({
    conversationId,
    onConversationStarted: (id) => {
      // Replace, not push: the transient blank `/explore` should not be a
      // Back stop in the middle of a conversation.
      void navigate(`/explore/${id}`, { replace: true });
    },
    restoreQuestion: setRestoredDraft,
  });

  const share = useExploreShare({ conversationId, shareToken: shared });

  const setLeafMutation = useMutation(trpc.explore.setLeaf.mutationOptions());
  const deleteMutation = useMutation(trpc.explore.delete.mutationOptions());
  const renameMutation = useMutation(trpc.explore.rename.mutationOptions());

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

  const ask = useCallback(
    (text: string) => {
      setRestoredDraft(null);
      void turn.runTurn({
        question: text,
        attach: { kind: "leaf" },
        displayQuestion: text,
        leafIdAtStart: messages.at(-1)?.id ?? null,
      });
    },
    [messages, turn],
  );

  const handleEdit = useCallback(
    (message: ExploreMessage, edited: string) => {
      // Editing forks the question: a sibling under the same parent, or a
      // new root when the edited question *is* the root — the fork a parent
      // id cannot name, which is why `attach` exists.
      void turn.runTurn({
        question: edited,
        attach:
          message.parentId === null
            ? { kind: "root" }
            : { kind: "message", messageId: message.parentId },
        displayQuestion: edited,
        leafIdAtStart: messages.at(-1)?.id ?? null,
      });
    },
    [messages, turn],
  );

  const handleRegenerate = useCallback(
    (message: ExploreMessage) => {
      // The parent of an answer is the question it belongs to.
      if (message.parentId === null) {
        return;
      }
      void turn.runTurn({
        question: null,
        attach: { kind: "message", messageId: message.parentId },
        displayQuestion: null,
        leafIdAtStart: messages.at(-1)?.id ?? null,
      });
    },
    [messages, turn],
  );

  const handleSelectVersion = useCallback(
    async (messageId: string): Promise<void> => {
      if (conversationId === null) {
        return;
      }
      setError(null);
      try {
        await setLeafMutation.mutateAsync({ conversationId, messageId });
        await refreshConversation(conversationId);
      } catch (mutationError) {
        setError(errorText(mutationError));
      }
    },
    [conversationId, refreshConversation, setLeafMutation],
  );

  const handleRename = useCallback(
    async (conversation: ExploreConversation, nextTitle: string) => {
      setError(null);
      try {
        await renameMutation.mutateAsync({
          conversationId: conversation.id,
          title: nextTitle,
        });
        // Close only on success — a stuck-open dialog with an error banner
        // beats one that swallowed the failure.
        setRenaming(null);
        await refreshConversation(conversation.id);
      } catch (mutationError) {
        setError(errorText(mutationError));
      }
    },
    [refreshConversation, renameMutation],
  );

  const handleDelete = useCallback(
    async (conversation: ExploreConversation) => {
      setError(null);
      if (turn.pendingTurn?.conversationId === conversation.id) {
        turn.abortForNavigation();
      }
      try {
        await deleteMutation.mutateAsync({ conversationId: conversation.id });
        setDeleting(null);
        queryClient.removeQueries({
          queryKey: trpc.explore.get.queryKey({
            conversationId: conversation.id,
          }),
        });
        if (conversation.id === conversationId) {
          void navigate("/explore", { replace: true });
        }
        await refreshList();
      } catch (mutationError) {
        setError(errorText(mutationError));
      }
    },
    [
      conversationId,
      deleteMutation,
      navigate,
      queryClient,
      refreshList,
      trpc.explore.get,
      turn,
    ],
  );

  const openConversation = useCallback(
    (id: string | null) => {
      if (turn.pendingTurn !== null) {
        turn.abortForNavigation();
      }
      void navigate(id === null ? "/explore" : `/explore/${id}`);
      setDrawerOpen(false);
    },
    [navigate, turn],
  );

  // Answer a question whose turn was interrupted. Attaches to the question
  // itself rather than to a parent, because there is no answer to fork from —
  // that is the whole reason it is stranded.
  const handleRetry = useCallback(
    (question: ExploreMessage) => {
      void turn.runTurn({
        question: null,
        attach: { kind: "message", messageId: question.id },
        displayQuestion: null,
        leafIdAtStart: messages.at(-1)?.id ?? null,
      });
    },
    [messages, turn],
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

  const { pendingQuestion, pendingAnswer, activity } = visiblePending(
    turn.pendingTurn,
    conversationId,
    messages,
  );

  // The backstop for every route change the explicit callbacks cannot see —
  // Back and Forward above all, which move the param without passing through
  // `openConversation` or `handleDelete`. Those callbacks stay: they abandon
  // the turn synchronously before navigating, which is a frame earlier than a
  // re-render can, and deleting a conversation must abort before the delete.
  useEffect(() => {
    if (
      pendingTurnLeftTheScreen({
        pendingConversationId: turn.pendingTurn?.conversationId ?? null,
        routeConversationId: conversationId,
      })
    ) {
      turn.abortForNavigation();
    }
  }, [conversationId, turn]);

  const { bottomRef, scrollIfPinned } = usePinnedScroll();
  useEffect(() => {
    scrollIfPinned();
  }, [transcript.data, pendingAnswer, activity, scrollIfPinned]);

  if (status.isLoading) {
    return <SectionSkeleton />;
  }

  if (status.isError) {
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
              void status.refetch();
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

  const pageError = error ?? turn.error ?? share.error;

  const headerActions =
    conversationId !== null && messages.length > 0
      ? {
          shared: shared !== null,
          sharing: share.sharing,
          revoking: share.revoking,
          onExport: () => {
            downloadMarkdown(
              exportFilename(title),
              conversationToMarkdown(title, messages),
            );
          },
          onShare: share.share,
          onRevoke: share.revoke,
        }
      : undefined;

  const sidebar = (
    <ExploreSidebar
      conversations={conversations.data ?? []}
      activeId={conversationId}
      onSelect={openConversation}
      onNew={() => {
        openConversation(null);
      }}
      onRename={setRenaming}
      onDelete={setDeleting}
    />
  );

  return (
    // The page needs its own container: RootLayout provides none, and without
    // one the transcript ran edge-to-edge at the viewport's full width — the
    // same conversation the shared page renders at `max-w-3xl`.
    <div className="mx-auto flex max-w-6xl gap-6 px-4 py-8">
      {/* Sticky because the document is the scroll container: the sidebar's
          own `h-full`/`overflow-y-auto` are inert against a page that scrolls
          as a whole, so the conversation list scrolled away with the content. */}
      <aside className="sticky top-8 hidden h-[calc(100vh-6rem)] w-60 shrink-0 md:block">
        {sidebar}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <ExploreHeader
          title={conversationId === null ? "Explore" : title}
          drawerOpen={drawerOpen}
          onDrawerOpenChange={setDrawerOpen}
          sidebar={sidebar}
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

        {/* Capped independently of the page: a chat is read line by line, and
            the 6xl page width is a ~150-character measure. */}
        <div className="max-w-3xl">
          <ExploreTranscript
            messages={messages}
            pendingQuestion={pendingQuestion}
            pendingAnswer={pendingAnswer}
            activity={activity}
            turnActive={turn.pendingTurn !== null}
            actions={transcriptActions}
          />
        </div>

        {pageError !== null && (
          <p className="rounded-md border border-scout-danger/40 bg-scout-danger/10 px-3 py-2 text-sm">
            {pageError}
          </p>
        )}

        {share.showShareLink && share.shareLink !== null && (
          <ExploreShareRow shareLink={share.shareLink} copied={share.copied} />
        )}

        <div ref={bottomRef} />

        {/* Pinned to the bottom of the viewport: scrolling up to re-read an
            earlier answer used to take the ask box off screen entirely. */}
        <div className="sticky bottom-0 max-w-3xl bg-background pt-2 pb-4">
          <ExploreComposer
            active={turn.pendingTurn !== null}
            restoredDraft={restoredDraft}
            onAsk={ask}
            onStop={turn.stop}
          />
          <ExploreQuota quota={quota} />
        </div>
      </div>

      <RenameConversationDialog
        conversation={renaming}
        pending={renameMutation.isPending}
        onClose={() => {
          setRenaming(null);
        }}
        onRename={(conversation, nextTitle) => {
          void handleRename(conversation, nextTitle);
        }}
      />

      <ConfirmDeleteDialog
        conversation={deleting}
        pending={deleteMutation.isPending}
        onClose={() => {
          setDeleting(null);
        }}
        onConfirm={(conversation) => {
          void handleDelete(conversation);
        }}
      />
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
    .reduce<
      (typeof props.quota)[number] | null
    >((tightest, snapshot) => (tightest === null || snapshot.remaining < tightest.remaining ? snapshot : tightest), null);
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
  const status = useQuery(trpc.explore.status.queryOptions());
  const enabled = status.data?.enabled === true;
  const conversations = useQuery({
    ...trpc.explore.list.queryOptions(),
    enabled,
  });
  const transcript = useQuery({
    ...trpc.explore.get.queryOptions({ conversationId: conversationId ?? "" }),
    enabled: enabled && conversationId !== null,
  });

  return {
    status,
    enabled,
    quota: status.data?.quota ?? [],
    conversations,
    transcript,
    messages: transcript.data?.messages ?? [],
    title: transcript.data?.conversation.title ?? "Explore",
    shared: transcript.data?.conversation.shareToken ?? null,
  };
}

const EXAMPLES = [
  "Which champions have the highest win rate?",
  "How does KDA differ by position?",
  "What is the most played queue this month?",
];
