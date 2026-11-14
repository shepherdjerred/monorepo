import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import type { MediaUser } from "#shared/contract.ts";
import {
  RequestInterestListSchema,
  RequestInterestResultSchema,
  type RequestInterestCommand,
} from "#shared/household/interests.ts";
import { queryClient, readApi, writeApi } from "#client/api.ts";
import {
  dateLabel,
  ErrorNotice,
  Loading,
  MediaLink,
  Status,
} from "#client/components.tsx";

type Interest = z.infer<typeof RequestInterestListSchema>["items"][number];

export function RequestInterests({ user }: { user: MediaUser }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const interests = useQuery({
    queryKey: ["request-interests", user.id, cursor],
    queryFn: () =>
      readApi(
        `/request-interests${cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`}`,
        RequestInterestListSchema,
      ),
  });
  const nextCursor = interests.data?.nextCursor ?? null;
  return (
    <section className="panel">
      <h2>What you’re keeping</h2>
      <p className="muted">
        Temporary titles stay while someone is interested. Catching up on an
        ongoing show keeps you following it. Finished or Drop ends your
        subscription; it does not change anyone else’s request.
      </p>
      {interests.isPending && <Loading />}
      {interests.error !== null && <ErrorNotice error={interests.error} />}
      {interests.data?.items.length === 0 && <p>No interests on this page.</p>}
      {interests.data?.items.map((interest) => (
        <InterestRow key={interest.requestId} user={user} interest={interest} />
      ))}
      <div className="action-row">
        {cursor !== null && (
          <button
            className="button subtle"
            onClick={() => {
              setCursor(null);
            }}
          >
            First page
          </button>
        )}
        {nextCursor !== null && (
          <button
            className="button subtle"
            onClick={() => {
              setCursor(nextCursor);
            }}
          >
            More interests
          </button>
        )}
      </div>
    </section>
  );
}

function InterestRow({
  user,
  interest,
}: {
  user: MediaUser;
  interest: Interest;
}) {
  const change = useMutation({
    mutationFn: (action: RequestInterestCommand["action"]) =>
      writeApi({
        actorId: user.id,
        path: `/request-interests/${encodeURIComponent(interest.requestId)}/commands`,
        body: {
          schemaVersion: 1,
          requestId: interest.requestId,
          expectedVersion: interest.version,
          expectedInterestRevision: interest.interestRevision,
          action,
          ...(action === "notice_viewed" && interest.noticeEventId !== null
            ? { noticeEventId: interest.noticeEventId }
            : {}),
        } satisfies RequestInterestCommand,
        schema: RequestInterestResultSchema,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["request-interests"] }),
        queryClient.invalidateQueries({ queryKey: ["requests"] }),
        queryClient.invalidateQueries({ queryKey: ["removals"] }),
        queryClient.invalidateQueries({ queryKey: ["library"] }),
      ]);
    },
  });
  const own = interest.userId === user.id;
  const following = interest.interestState === "following";
  return (
    <article className="request-row" id={`interest-${interest.requestId}`}>
      <div className="item-main">
        <h3>
          <MediaLink id={interest.mediaId} title={interest.title} />
        </h3>
        <p>
          {interest.keepingPolicy === "keep"
            ? "Keep indefinitely"
            : "Temporary"}
          {interest.releaseReason === null
            ? ""
            : ` · ${interest.releaseReason.replaceAll("_", " ")}`}
        </p>
        {interest.noticeDeliveryState === "attention" && (
          <p className="notice">
            This reminder needs attention:{" "}
            {interest.noticeReason?.replaceAll("_", " ")}. Your interest stays
            protected until a private notice is confirmed.
          </p>
        )}
        {interest.noticeEventId !== null && following && (
          <div className="notice">
            <p>
              Still watching? Choose Keep watching to stay interested.
              {interest.replyBy === null
                ? " The reply period begins after a private notice is accepted or you acknowledge this reminder."
                : ` Reply by ${dateLabel(interest.replyBy)}.`}
            </p>
            {own && interest.replyBy === null && (
              <button
                className="button subtle"
                disabled={change.isPending}
                onClick={() => {
                  change.mutate("notice_viewed");
                }}
              >
                I have seen this reminder
              </button>
            )}
          </div>
        )}
        <div className="action-row">
          {own && (
            <button
              className="button subtle"
              disabled={change.isPending}
              onClick={() => {
                change.mutate("continue");
              }}
            >
              Keep watching
            </button>
          )}
          {own && following && interest.keepingPolicy === "temporary" && (
            <>
              <button
                className="button subtle"
                disabled={change.isPending}
                onClick={() => {
                  change.mutate("finished");
                }}
              >
                Finished
              </button>
              <button
                className="button subtle"
                disabled={change.isPending}
                onClick={() => {
                  change.mutate("drop");
                }}
              >
                Drop
              </button>
            </>
          )}
          {user.role === "owner" && (
            <button
              className="button subtle"
              disabled={change.isPending}
              onClick={() => {
                change.mutate(
                  interest.keepingPolicy === "keep" ? "temporary" : "keep",
                );
              }}
            >
              {interest.keepingPolicy === "keep"
                ? "Make temporary"
                : "Keep indefinitely"}
            </button>
          )}
        </div>
        {change.error !== null && <ErrorNotice error={change.error} />}
      </div>
      <Status value={interest.interestState} />
    </article>
  );
}
