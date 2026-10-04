import { useRef, useState } from "react";
import { useSearchParams } from "react-router";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Button } from "@scout-for-lol/design-system/components/button";
import { Badge } from "@scout-for-lol/design-system/components/badge";
import { Textarea } from "@scout-for-lol/design-system/components/textarea";
import { Label } from "@scout-for-lol/design-system/components/label";
import {
  SupportConversation,
  SUPPORT_STATUS_TEXT,
} from "#src/components/support-conversation.tsx";
import { useTRPC } from "#src/lib/query/trpc.ts";
import { SupportInboxStats } from "#src/components/support-inbox-stats.tsx";

function ConversationDetail(props: {
  id: string;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const replyFormRef = useRef<HTMLFormElement>(null);
  const detail = useInfiniteQuery(
    trpc.operations.inbox.detail.infiniteQueryOptions(
      { id: props.id },
      {
        getNextPageParam: (page) => page.nextCursor ?? undefined,
        refetchInterval: 30_000,
      },
    ),
  );
  const changed = () => {
    void queryClient.invalidateQueries({
      queryKey: trpc.operations.inbox.detail.pathKey(),
    });
    props.onChanged();
  };
  const reply = useMutation(
    trpc.operations.inbox.reply.mutationOptions({
      retry: false,
      onSuccess: () => {
        replyFormRef.current?.reset();
        setBody("");
        requestId.current = crypto.randomUUID();
        changed();
      },
    }),
  );
  const update = useMutation(
    trpc.operations.inbox.update.mutationOptions({ onSuccess: changed }),
  );
  const read = useMutation(
    trpc.operations.inbox.markRead.mutationOptions({ onSuccess: changed }),
  );
  const remove = useMutation(
    trpc.operations.inbox.deleteConversation.mutationOptions({
      retry: false,
      onSuccess: () => {
        changed();
        props.onDeleted();
      },
    }),
  );
  const storageRetry = useMutation(
    trpc.operations.inbox.retryStorage.mutationOptions({
      retry: false,
      onSuccess: changed,
    }),
  );
  const pages = detail.data?.pages ?? [];
  const conversation = pages[0]?.conversation;
  const messages = [...pages].reverse().flatMap((page) => page.messages);
  const latest = messages.at(-1);
  if (detail.isPending) return <p role="status">Loading conversation…</p>;
  if (detail.error !== null) return <p role="alert">{detail.error.message}</p>;
  if (conversation === undefined) return null;
  return (
    <section className="space-y-5 rounded-lg border border-border p-5">
      <h2 className="text-xl font-semibold">
        {conversation.username === null
          ? conversation.discordId
          : `@${conversation.username}`}
      </h2>
      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor="support-status">Status</Label>
        <select
          id="support-status"
          className="rounded border border-border bg-scout-surface p-2"
          value={conversation.status}
          disabled={update.isPending}
          onChange={(event) => {
            const status = event.target.value;
            if (
              status === "OPEN" ||
              status === "WAITING_ON_USER" ||
              status === "RESOLVED"
            )
              update.mutate({ id: props.id, status });
          }}
        >
          <option value="OPEN">Open</option>
          <option value="WAITING_ON_USER">Waiting on user</option>
          <option value="RESOLVED">Resolved</option>
        </select>
        <Label htmlFor="support-category">Label</Label>
        <select
          id="support-category"
          className="rounded border border-border bg-scout-surface p-2"
          value={conversation.category ?? ""}
          disabled={update.isPending}
          onChange={(event) => {
            const category = event.target.value;
            if (
              category === "" ||
              category === "HELP" ||
              category === "BUG" ||
              category === "IDEA"
            )
              update.mutate({
                id: props.id,
                category: category === "" ? null : category,
              });
          }}
        >
          <option value="">Unlabelled</option>
          <option value="HELP">Help</option>
          <option value="BUG">Bug</option>
          <option value="IDEA">Idea</option>
        </select>
        {latest !== undefined && (
          <Button
            variant="outline"
            size="sm"
            disabled={read.isPending}
            onClick={() => {
              read.mutate({ id: props.id, messageId: latest.id });
            }}
          >
            Mark read
          </Button>
        )}
      </div>
      {detail.hasNextPage && (
        <Button
          variant="outline"
          disabled={detail.isFetchingNextPage}
          onClick={() => {
            void detail.fetchNextPage();
          }}
        >
          Load earlier messages
        </Button>
      )}
      <SupportConversation messages={messages} operator />
      {(pages[0]?.jobs ?? []).map((job) => (
        <div
          key={job.id}
          className="space-y-2 rounded border border-border p-3 text-sm"
        >
          <p>
            {job.kind} · {job.status}: {job.errorCode}. Replies remain available
            on the web. Uncertain Discord sends must not be automatically
            repeated.
          </p>
          {(job.kind === "ARCHIVE" || job.kind === "DELETE_OBJECT") &&
            job.status === "FAILED" && (
              <Button
                variant="outline"
                size="sm"
                disabled={storageRetry.isPending}
                onClick={() => {
                  storageRetry.mutate({ jobId: job.id });
                }}
              >
                Retry storage work
              </Button>
            )}
        </div>
      ))}
      <form
        ref={replyFormRef}
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          reply.mutate({
            conversationId: props.id,
            requestId: requestId.current,
            body,
          });
        }}
      >
        <Label htmlFor="support-reply">
          Reply as Scout&apos;s support team
        </Label>
        <Textarea
          id="support-reply"
          value={body}
          required
          rows={4}
          maxLength={2000}
          disabled={reply.isPending}
          onChange={(event) => {
            setBody(event.target.value);
            requestId.current = crypto.randomUUID();
          }}
        />
        <p className="text-xs text-scout-subtle">
          Saved to the web conversation first. Scout also attempts a Discord
          notification.
        </p>
        <Button
          type="submit"
          disabled={reply.isPending || body.trim().length === 0}
        >
          {reply.isPending ? "Saving…" : "Send reply"}
        </Button>
      </form>
      <div className="flex flex-wrap gap-3 border-t border-border pt-4">
        <Button
          variant="outline"
          disabled={update.isPending}
          onClick={() => {
            update.mutate({ id: props.id, muted: !conversation.muted });
          }}
        >
          {conversation.muted ? "Unmute conversation" : "Mute conversation"}
        </Button>
        {confirmDelete ? (
          <>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                remove.mutate({ id: props.id, confirmation: "DELETE" });
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
              Cancel deletion
            </Button>
          </>
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
      </div>
      {[reply.error, update.error, read.error, remove.error, storageRetry.error]
        .filter((error) => error !== null)
        .map((error) => (
          <p role="alert" className="text-scout-danger" key={error.message}>
            {error.message}
          </p>
        ))}
    </section>
  );
}

export function OperationsInbox() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [needsReplyOnly, setNeedsReplyOnly] = useState(false);
  const failures = useQuery(
    trpc.operations.inbox.storageFailures.queryOptions(undefined, {
      refetchInterval: 30_000,
    }),
  );
  const retryStorage = useMutation(
    trpc.operations.inbox.retryStorage.mutationOptions({
      retry: false,
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.operations.inbox.pathKey(),
        });
      },
    }),
  );
  const inbox = useInfiniteQuery(
    trpc.operations.inbox.list.infiniteQueryOptions(
      { unreadOnly, needsReplyOnly },
      {
        getNextPageParam: (page) => page.nextCursor,
        refetchInterval: 30_000,
      },
    ),
  );
  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: trpc.operations.inbox.pathKey(),
    });
  };
  const selected = params.get("conversation");
  const first = inbox.data?.pages[0];
  return (
    <section className="mx-auto max-w-6xl space-y-6 px-6 py-8 sm:px-8 sm:py-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Support inbox</h1>
          <p className="text-scout-subtle">
            {first?.unreadCount ?? 0} unread conversations ·{" "}
            {first?.needsReplyCount ?? 0} need a reply
          </p>
        </div>
        <Button variant="outline" onClick={refresh}>
          Refresh
        </Button>
      </header>
      <SupportInboxStats />
      {(failures.data?.length ?? 0) > 0 && (
        <section className="space-y-2 rounded-lg border border-border p-4 text-sm">
          <h2 className="font-semibold">Screenshot storage needs attention</h2>
          {failures.data?.map((job) => (
            <div
              key={job.id}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <span>
                {job.kind === "DELETE_OBJECT"
                  ? "Private file deletion"
                  : "Screenshot archival"}{" "}
                · {job.errorCode}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={retryStorage.isPending}
                onClick={() => {
                  retryStorage.mutate({ jobId: job.id });
                }}
              >
                Retry storage work
              </Button>
            </div>
          ))}
        </section>
      )}
      {[failures.error, retryStorage.error]
        .filter((error) => error !== null)
        .map((error) => (
          <p role="alert" key={error.message}>
            {error.message}
          </p>
        ))}
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(event) => {
              setUnreadOnly(event.target.checked);
            }}
          />
          Unread only
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={needsReplyOnly}
            onChange={(event) => {
              setNeedsReplyOnly(event.target.checked);
            }}
          />
          Needs reply only
        </label>
      </div>
      {inbox.isPending && <p role="status">Loading inbox…</p>}
      {inbox.error !== null && <p role="alert">{inbox.error.message}</p>}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)]">
        <div className="space-y-3">
          {inbox.data?.pages
            .flatMap((page) => page.conversations)
            .map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={`w-full space-y-2 rounded-lg border border-border p-4 text-left ${conversation.id === selected ? "bg-scout-raised" : "bg-scout-surface"}`}
                aria-pressed={conversation.id === selected}
                onClick={() => {
                  setParams({ conversation: conversation.id });
                }}
              >
                <span className="block font-semibold">
                  {conversation.username === null
                    ? conversation.discordId
                    : `@${conversation.username}`}
                </span>
                <span className="flex flex-wrap gap-2">
                  <Badge variant="secondary">
                    {SUPPORT_STATUS_TEXT[conversation.status]}
                  </Badge>
                  {conversation._count.messages > 0 && <Badge>Unread</Badge>}
                  {conversation.category !== null && (
                    <Badge variant="outline">{conversation.category}</Badge>
                  )}
                </span>
                <span className="block truncate text-sm text-scout-subtle">
                  {conversation.messages[0]?.body === ""
                    ? "Screenshot"
                    : (conversation.messages[0]?.body ?? "Screenshot")}
                </span>
                {conversation.jobs.length > 0 && (
                  <span className="block text-xs">
                    Delivery or storage needs attention
                  </span>
                )}
              </button>
            ))}
          {first?.conversations.length === 0 && (
            <p>No conversations match these filters.</p>
          )}
          {inbox.hasNextPage && (
            <Button
              variant="outline"
              disabled={inbox.isFetchingNextPage}
              onClick={() => {
                void inbox.fetchNextPage();
              }}
            >
              Load more conversations
            </Button>
          )}
        </div>
        {selected === null ? (
          <p className="text-scout-subtle">
            Select a conversation to read and reply.
          </p>
        ) : (
          <ConversationDetail
            key={selected}
            id={selected}
            onChanged={refresh}
            onDeleted={() => {
              setParams({});
            }}
          />
        )}
      </div>
    </section>
  );
}
