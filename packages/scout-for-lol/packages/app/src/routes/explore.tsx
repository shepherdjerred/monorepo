import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Square } from "lucide-react";
import type {
  ExploreConversation,
  ExploreStreamEvent,
} from "@scout-for-lol/data";
import { Button } from "#src/components/ui/button.tsx";
import { Textarea } from "#src/components/ui/textarea.tsx";
import { ExploreHeader } from "#src/components/explore-header.tsx";
import { ExploreSidebar } from "#src/components/explore-sidebar.tsx";
import { ExploreTranscript } from "#src/components/explore-transcript.tsx";
import { ConfirmDeleteDialog } from "#src/components/confirm-delete-dialog.tsx";
import { RenameConversationDialog } from "#src/components/rename-conversation-dialog.tsx";
import { streamExploreTurn } from "#src/lib/explore-stream.ts";
import {
  conversationToMarkdown,
  downloadMarkdown,
  exportFilename,
} from "#src/lib/explore-export.ts";
import { useTRPC } from "#src/lib/trpc.ts";

/**
 * Explore: ask questions of every match Scout has ingested.
 *
 * Turns stream over SSE while conversation management goes through tRPC, so
 * the transcript is authoritative on the server and this page only mirrors
 * it. After a turn finishes the conversation is refetched rather than patched
 * locally — the server owns ordering, ids, and which branch is current, and
 * duplicating that here is how a transcript drifts from what a share link
 * would show.
 */
export function Explore() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [pendingAnswer, setPendingAnswer] = useState<string | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [renaming, setRenaming] = useState<ExploreConversation | null>(null);
  const [deleting, setDeleting] = useState<ExploreConversation | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const {
    status,
    enabled,
    conversations,
    transcript,
    messages,
    title,
    shared,
  } = useExploreConversation(conversationId);

  const shareMutation = useMutation(trpc.explore.share.mutationOptions());
  const deleteMutation = useMutation(trpc.explore.delete.mutationOptions());
  const renameMutation = useMutation(trpc.explore.rename.mutationOptions());
  const setLeafMutation = useMutation(trpc.explore.setLeaf.mutationOptions());

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: trpc.explore.list.queryKey(),
    });
    await queryClient.invalidateQueries({
      queryKey: trpc.explore.get.queryKey(),
    });
  }, [queryClient, trpc.explore.get, trpc.explore.list]);

  // Sharing is two steps that can each fail — mint the token, then hand the
  // link to the clipboard, which a browser may refuse over permissions or not
  // implement at all. The link is shown as soon as it exists, so a refused
  // clipboard write costs the copy and not the share; failing silently would
  // look exactly like a copy that worked.
  const share = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const result = await shareMutation.mutateAsync({ conversationId: id });
        const link = `${globalThis.location.origin}/app/explore/s/${result.shareToken}`;
        setShareLink(link);
        await refresh();
        await navigator.clipboard.writeText(link);
      } catch (shareError) {
        setError(
          shareError instanceof Error ? shareError.message : String(shareError),
        );
      }
    },
    [refresh, shareMutation],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript.data, pendingAnswer]);

  // Grow the composer with its content instead of scrolling a fixed box.
  useEffect(() => {
    const textarea = composerRef.current;
    if (textarea === null) {
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height = `${String(Math.min(textarea.scrollHeight, 200))}px`;
  }, [question]);

  // Abandon an in-flight turn if the page unmounts.
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const runTurn = useCallback(
    async (input: {
      question: string | null;
      parentMessageId: string | null;
      displayQuestion: string | null;
    }) => {
      if (activity !== null) {
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      setPendingQuestion(input.displayQuestion);
      setPendingAnswer(null);
      setActivity("Thinking…");

      let answered: string | null = null;
      try {
        await streamExploreTurn({
          input: {
            conversationId,
            question: input.question,
            parentMessageId: input.parentMessageId,
          },
          signal: controller.signal,
          onEvent: (event) => {
            answered = applyStreamEvent(event, answered, {
              setConversationId,
              setActivity,
              setPendingAnswer,
              setError,
            });
          },
        });
      } catch (streamError) {
        // A deliberate stop is not a failure — the server keeps whatever the
        // answer had reached, so there is nothing to apologise for.
        if (!controller.signal.aborted) {
          setError(
            streamError instanceof Error
              ? streamError.message
              : String(streamError),
          );
        }
      } finally {
        abortRef.current = null;
        setActivity(null);
        setPendingAnswer(null);
        setPendingQuestion(null);
        await refresh();
      }
    },
    [activity, conversationId, refresh],
  );

  const ask = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0) {
        return;
      }
      setQuestion("");
      void runTurn({
        question: trimmed,
        parentMessageId: null,
        displayQuestion: trimmed,
      });
    },
    [runTurn],
  );

  if (status.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (!enabled) {
    return (
      <div className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">Explore</h2>
        <p className="text-sm text-muted-foreground">
          Explore is in a limited rollout and is not available on your account
          yet.
        </p>
      </div>
    );
  }

  const headerActions =
    conversationId !== null && messages.length > 0
      ? {
          shared: shared !== null,
          onExport: () => {
            downloadMarkdown(
              exportFilename(title),
              conversationToMarkdown(title, messages),
            );
          },
          sharing: shareMutation.isPending,
          onShare: () => {
            void share(conversationId);
          },
        }
      : undefined;

  const sidebar = (
    <ExploreSidebar
      conversations={conversations.data ?? []}
      activeId={conversationId}
      onSelect={(id) => {
        setConversationId(id);
        setShareLink(null);
        setDrawerOpen(false);
      }}
      onNew={() => {
        setConversationId(null);
        setShareLink(null);
        setDrawerOpen(false);
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
          onFollowUp={ask}
          onEdit={(message, edited) => {
            // Attach the new question beside the old one, so both survive.
            void runTurn({
              question: edited,
              parentMessageId: message.parentId,
              displayQuestion: edited,
            });
          }}
          onRegenerate={(message) => {
            // A null question means "answer this one again"; the parent of an
            // answer is the question it belongs to.
            void runTurn({
              question: null,
              parentMessageId: message.parentId,
              displayQuestion: null,
            });
          }}
          onSelectVersion={(messageId) => {
            if (conversationId === null) {
              return;
            }
            void (async () => {
              await setLeafMutation.mutateAsync({ conversationId, messageId });
              await refresh();
            })();
          }}
        />

        {error !== null && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
            {error}
          </p>
        )}

        {shareLink !== null && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Share link
            <input
              readOnly
              value={shareLink}
              onFocus={(event) => {
                event.target.select();
              }}
              className="min-w-0 flex-1 rounded-md border bg-muted px-2 py-1 font-mono text-xs"
            />
          </label>
        )}

        <div ref={bottomRef} />

        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            ask(question);
          }}
        >
          <Textarea
            ref={composerRef}
            value={question}
            rows={1}
            className="max-h-[200px] min-h-[42px] resize-none"
            onChange={(event) => {
              setQuestion(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                ask(question);
              }
            }}
            placeholder="Ask a question about match data…"
            disabled={activity !== null}
          />
          {activity === null ? (
            <Button type="submit" disabled={question.trim().length === 0}>
              Ask
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                abortRef.current?.abort();
              }}
            >
              <Square className="size-3.5" />
              Stop
            </Button>
          )}
        </form>
      </div>

      <RenameConversationDialog
        conversation={renaming}
        onClose={() => {
          setRenaming(null);
        }}
        onRename={(conversation, nextTitle) => {
          void (async () => {
            await renameMutation.mutateAsync({
              conversationId: conversation.id,
              title: nextTitle,
            });
            setRenaming(null);
            await refresh();
          })();
        }}
      />

      <ConfirmDeleteDialog
        conversation={deleting}
        onClose={() => {
          setDeleting(null);
        }}
        onConfirm={(conversation) => {
          void (async () => {
            await deleteMutation.mutateAsync({
              conversationId: conversation.id,
            });
            if (conversation.id === conversationId) {
              setConversationId(null);
            }
            setDeleting(null);
            await refresh();
          })();
        }}
      />
    </div>
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
    conversations,
    transcript,
    messages: transcript.data?.messages ?? [],
    title: transcript.data?.conversation.title ?? "Explore",
    shared: transcript.data?.conversation.shareToken ?? null,
  };
}

/**
 * Fold one stream event into page state, returning the answer text so far.
 *
 * Lifted out of the component so its switch does not count against the
 * route's complexity budget, and so the event handling reads on its own.
 */
function applyStreamEvent(
  event: ExploreStreamEvent,
  answered: string | null,
  setters: {
    setConversationId: (id: string) => void;
    setActivity: (message: string) => void;
    setPendingAnswer: (text: string) => void;
    setError: (message: string) => void;
  },
): string | null {
  switch (event.type) {
    case "started": {
      setters.setConversationId(event.conversationId);
      return answered;
    }
    case "tool_call": {
      setters.setActivity(event.message);
      return answered;
    }
    case "answer_delta": {
      const next = (answered ?? "") + event.text;
      setters.setPendingAnswer(next);
      return next;
    }
    case "error": {
      setters.setError(event.message);
      return answered;
    }
    case "final":
    case "preview":
    case "tool_result":
    case "done": {
      return answered;
    }
  }
}

const EXAMPLES = [
  "Which champions have the highest win rate?",
  "How does KDA differ by position?",
  "What is the most played queue this month?",
];
