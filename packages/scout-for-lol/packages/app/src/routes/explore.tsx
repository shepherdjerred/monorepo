import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type { ExploreConversation, ExploreMessage } from "@scout-for-lol/data";
import { Button } from "#src/components/ui/button.tsx";
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
import { visiblePending } from "#src/lib/explore-turn-state.ts";
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

  const transcriptActions = useMemo<ExploreTranscriptActions>(
    () => ({
      onFollowUp: ask,
      onEdit: handleEdit,
      onRegenerate: handleRegenerate,
      onSelectVersion: (messageId) => {
        void handleSelectVersion(messageId);
      },
    }),
    [ask, handleEdit, handleRegenerate, handleSelectVersion],
  );

  const { pendingQuestion, pendingAnswer, activity } = visiblePending(
    turn.pendingTurn,
    conversationId,
    messages,
  );

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
      <div className="rounded-lg border border-destructive/40 bg-card p-8 text-center">
        <h2 className="text-base font-semibold text-destructive">
          Explore couldn&apos;t load
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
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
    <div className="flex gap-6">
      <aside className="hidden w-60 shrink-0 md:block">{sidebar}</aside>

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
            <p className="text-xs text-muted-foreground">
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

        <ExploreTranscript
          messages={messages}
          pendingQuestion={pendingQuestion}
          pendingAnswer={pendingAnswer}
          activity={activity}
          actions={transcriptActions}
        />

        {pageError !== null && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
            {pageError}
          </p>
        )}

        {share.showShareLink && share.shareLink !== null && (
          <ExploreShareRow shareLink={share.shareLink} copied={share.copied} />
        )}

        <div ref={bottomRef} />

        <ExploreComposer
          active={turn.pendingTurn !== null}
          restoredDraft={restoredDraft}
          onAsk={ask}
          onStop={turn.stop}
        />
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
