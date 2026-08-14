import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ExploreMessage } from "@scout-for-lol/data";
import { Button } from "#src/components/ui/button.tsx";
import { Textarea } from "#src/components/ui/textarea.tsx";
import { ExploreTranscript } from "#src/components/explore-transcript.tsx";
import { streamExploreTurn } from "#src/lib/explore-stream.ts";
import { useTRPC } from "#src/lib/trpc.ts";

/**
 * Explore: ask questions of every match Scout has ingested.
 *
 * Turns stream over SSE while conversation management goes through tRPC, so
 * the transcript is authoritative on the server and this page only mirrors
 * it. After a turn finishes the conversation is refetched rather than patched
 * locally — the server already owns ordering and ids, and duplicating that
 * here is how a transcript drifts from what a share link would show.
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
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const status = useQuery(trpc.explore.status.queryOptions());
  const conversations = useQuery({
    ...trpc.explore.list.queryOptions(),
    enabled: status.data?.enabled === true,
  });
  const transcript = useQuery({
    ...trpc.explore.get.queryOptions({ conversationId: conversationId ?? "" }),
    enabled: status.data?.enabled === true && conversationId !== null,
  });

  const shareMutation = useMutation(trpc.explore.share.mutationOptions());
  const deleteMutation = useMutation(trpc.explore.delete.mutationOptions());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript.data, pendingAnswer]);

  // Abandon an in-flight turn if the page unmounts.
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const ask = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (activity !== null || trimmed.length === 0) {
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      setQuestion("");
      setPendingQuestion(trimmed);
      setPendingAnswer(null);
      setActivity("Thinking…");

      let answered: string | null = null;
      try {
        await streamExploreTurn({
          input: { conversationId, question: trimmed },
          signal: controller.signal,
          onEvent: (event) => {
            switch (event.type) {
              case "started": {
                setConversationId(event.conversationId);
                break;
              }
              case "tool_call": {
                setActivity(event.message);
                break;
              }
              case "answer_delta": {
                answered = (answered ?? "") + event.text;
                setPendingAnswer(answered);
                break;
              }
              case "final": {
                setActivity(null);
                break;
              }
              case "error": {
                setError(event.message);
                break;
              }
              case "preview":
              case "tool_result":
              case "done": {
                break;
              }
            }
          },
        });
      } catch (streamError) {
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
        await queryClient.invalidateQueries({
          queryKey: trpc.explore.list.queryKey(),
        });
        await queryClient.invalidateQueries({
          queryKey: trpc.explore.get.queryKey(),
        });
      }
    },
    [
      activity,
      conversationId,
      queryClient,
      trpc.explore.get,
      trpc.explore.list,
    ],
  );

  if (status.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (status.data?.enabled !== true) {
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

  const messages: ExploreMessage[] = transcript.data?.messages ?? [];
  const shareToken = transcript.data?.conversation.shareToken ?? null;

  return (
    <div className="flex gap-6">
      <aside className="hidden w-56 shrink-0 space-y-2 md:block">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => {
            setConversationId(null);
          }}
        >
          New conversation
        </Button>
        <ul className="space-y-1">
          {(conversations.data ?? []).map((conversation) => (
            <li key={conversation.id} className="flex items-center gap-1">
              <button
                type="button"
                className={`flex-1 truncate rounded-md px-2 py-1 text-left text-sm hover:bg-muted ${
                  conversation.id === conversationId ? "bg-muted" : ""
                }`}
                onClick={() => {
                  setConversationId(conversation.id);
                }}
              >
                {conversation.title}
              </button>
              <button
                type="button"
                aria-label={`Delete ${conversation.title}`}
                className="px-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  void (async () => {
                    await deleteMutation.mutateAsync({
                      conversationId: conversation.id,
                    });
                    if (conversation.id === conversationId) {
                      setConversationId(null);
                    }
                    await queryClient.invalidateQueries({
                      queryKey: trpc.explore.list.queryKey(),
                    });
                  })();
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-tight">Explore</h2>
          {conversationId !== null && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void (async () => {
                  const result = await shareMutation.mutateAsync({
                    conversationId,
                  });
                  await navigator.clipboard.writeText(
                    `${globalThis.location.origin}/app/explore/s/${result.shareToken}`,
                  );
                  await queryClient.invalidateQueries({
                    queryKey: trpc.explore.get.queryKey(),
                  });
                })();
              }}
            >
              {shareToken === null ? "Share" : "Copy link"}
            </Button>
          )}
        </div>

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
                    void ask(example);
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
          onFollowUp={(followUp) => {
            void ask(followUp);
          }}
        />

        {error !== null && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
            {error}
          </p>
        )}

        <div ref={bottomRef} />

        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void ask(question);
          }}
        >
          <Textarea
            value={question}
            onChange={(event) => {
              setQuestion(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void ask(question);
              }
            }}
            placeholder="Ask a question about match data…"
            rows={2}
            disabled={activity !== null}
          />
          <Button type="submit" disabled={activity !== null}>
            Ask
          </Button>
        </form>
      </div>
    </div>
  );
}

const EXAMPLES = [
  "Which champions have the highest win rate?",
  "How does KDA differ by position?",
  "What is the most played queue this month?",
];
