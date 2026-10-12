import { useState } from "react";
import { Link } from "react-router";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { Button } from "@scout-for-lol/design-system/components/button";
import { FeedbackForm } from "#src/components/feedback-form.tsx";
import {
  SupportConversation,
  SUPPORT_STATUS_TEXT,
} from "#src/components/support-conversation.tsx";
import { SUPPORT_URL } from "#src/lib/support.ts";
import { useTRPC } from "#src/lib/query/trpc.ts";

export function Feedback() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [submitted, setSubmitted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const history = useInfiniteQuery(
    trpc.feedback.conversation.infiniteQueryOptions(
      {},
      {
        getNextPageParam: (page) => page.nextCursor ?? undefined,
        refetchInterval: 30_000,
      },
    ),
  );
  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: trpc.feedback.conversation.pathKey(),
    });
  };
  const remove = useMutation(
    trpc.feedback.deleteConversation.mutationOptions({
      retry: false,
      onSuccess: () => {
        setConfirmDelete(false);
        refresh();
      },
    }),
  );
  const retry = useMutation(
    trpc.feedback.retryScreenshot.mutationOptions({
      retry: false,
      onSuccess: refresh,
      onError: (error) => {
        setRetryError(error.message);
      },
    }),
  );
  const markRead = useMutation(
    trpc.feedback.markRead.mutationOptions({ onSuccess: refresh }),
  );
  const pages = history.data?.pages ?? [];
  const conversation = pages[0]?.conversation;
  const messages = [...pages].reverse().flatMap((page) => page.messages);
  const last = messages.at(-1);
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Help and feedback</h1>
        <Button variant="outline" size="sm" onClick={refresh}>
          Refresh
        </Button>
      </header>
      <p className="text-scout-subtle">
        Ask for help, report a bug, or suggest something. This is a private
        conversation with Scout&apos;s human support team, not an AI chat.
        Replies are always available here, even if Discord DMs are blocked.
      </p>
      {conversation !== undefined && conversation !== null && (
        <p className="text-sm">
          Status: {SUPPORT_STATUS_TEXT[conversation.status]}
          {conversation.muted ? " · Muted" : ""}
        </p>
      )}
      {history.isPending && <p role="status">Loading conversation…</p>}
      {history.error !== null && (
        <p role="alert" className="text-scout-danger">
          {history.error.message}
        </p>
      )}
      {history.hasNextPage && (
        <Button
          variant="outline"
          disabled={history.isFetchingNextPage}
          onClick={() => {
            void history.fetchNextPage();
          }}
        >
          Load earlier messages
        </Button>
      )}
      <SupportConversation
        messages={messages}
        onRetryScreenshot={(id) => {
          setRetryError(null);
          retry.mutate({ id });
        }}
      />
      {last !== undefined && (
        <Button
          variant="ghost"
          size="sm"
          disabled={markRead.isPending}
          onClick={() => {
            markRead.mutate({ messageId: last.id });
          }}
        >
          Mark replies read
        </Button>
      )}
      {retryError !== null && (
        <p role="alert" className="text-scout-danger">
          {retryError}
        </p>
      )}
      {submitted && (
        <p role="status">
          Thanks — your message is saved for the Scout team. Any reply will
          appear above.
        </p>
      )}
      {conversation?.muted !== true && (
        <FeedbackForm
          page="/app/feedback"
          onSubmitted={() => {
            setSubmitted(true);
            refresh();
          }}
          onCancel={() => {
            setSubmitted(false);
          }}
        />
      )}
      <p className="text-sm text-scout-subtle">
        You can also DM Scout directly. The{" "}
        <a
          href={SUPPORT_URL}
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          support server
        </a>{" "}
        is a community space; its messages do not enter this private
        conversation. We don&apos;t guarantee an immediate response.
      </p>
      {conversation !== undefined && conversation !== null && (
        <div className="space-y-3 border-t border-border pt-4">
          <p className="text-xs text-scout-subtle">
            Messages and screenshots stay until manually deleted. Unsubmitted
            uploads are removed after 24 hours. Deleted content can remain in
            existing backups until those backups expire.
          </p>
          {confirmDelete ? (
            <div className="space-y-2">
              <p>
                Delete this conversation and its screenshots? This cannot be
                undone.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="destructive"
                  disabled={remove.isPending}
                  onClick={() => {
                    remove.mutate({ confirmation: "DELETE" });
                  }}
                >
                  Confirm delete
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setConfirmDelete(false);
                  }}
                >
                  Keep conversation
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="ghost"
              onClick={() => {
                setConfirmDelete(true);
              }}
            >
              Delete conversation
            </Button>
          )}
          {remove.error !== null && <p role="alert">{remove.error.message}</p>}
        </div>
      )}
      <Button asChild variant="ghost">
        <Link to="/">Back to Scout</Link>
      </Button>
    </div>
  );
}
