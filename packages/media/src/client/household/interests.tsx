import { useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import type { MediaUser } from "#shared/contract.ts";
import {
  RequestInterestListSchema,
  RequestInterestResultSchema,
  type RequestInterestCommand,
} from "#shared/household/interests.ts";
import { queryClient, readApi, writeApi } from "#client/api.ts";
import { dateLabel, ErrorNotice } from "#client/components.tsx";
import { INTEREST_ACTION_NAMES } from "#shared/household/names.ts";
import { RequestInterestProgress } from "./progress.tsx";

type Interest = z.infer<typeof RequestInterestListSchema>["items"][number];
type InterestAction = RequestInterestCommand["action"];

/**
 * One page of the reader's request interests, with each row's artwork. The
 * rows are a strict contract, so artwork arrives only because it is asked
 * for here.
 */
export function readInterests(cursor: string | null) {
  const params = new URLSearchParams({ include: "artwork" });
  if (cursor !== null) params.set("cursor", cursor);
  return readApi(
    `/request-interests?${params.toString()}`,
    RequestInterestListSchema,
  );
}

/**
 * Sends one of the commands a person has over their interest in something
 * they asked for, then refreshes every list that shows it. `onDone` hears
 * which command went through, before the lists have refreshed.
 */
export function useInterestChange(
  user: MediaUser,
  interest: Interest,
  onDone?: (action: InterestAction) => void,
) {
  return useMutation({
    mutationFn: (action: InterestAction) =>
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
    onSuccess: async (_result, action) => {
      onDone?.(action);
      await Promise.all(
        [
          "request-interests",
          "request-interest-progress",
          "requests",
          "removals",
          "library",
        ].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
      );
    },
  });
}

type InterestChange = ReturnType<typeof useInterestChange>;

function InterestButton({
  change,
  action,
}: {
  change: InterestChange;
  action: InterestAction;
}) {
  return (
    <button
      className={action === "continue" ? "button primary" : "button subtle"}
      type="button"
      disabled={change.isPending}
      onClick={() => {
        change.mutate(action);
      }}
    >
      {INTEREST_ACTION_NAMES[action]}
    </button>
  );
}

/**
 * The answers a person can give about something they asked for: keep
 * watching it, which is the main one, and, for something kept only while
 * they follow it, that they have finished it or want to stop following.
 * Nobody answers for someone else, so another person's interest has none.
 */
export function InterestAnswers({
  user,
  interest,
  change,
}: {
  user: MediaUser;
  interest: Interest;
  change: InterestChange;
}) {
  if (interest.userId !== user.id) return null;
  return (
    <>
      <InterestButton change={change} action="continue" />
      {interest.interestState === "following" &&
        interest.keepingPolicy === "temporary" && (
          <>
            <InterestButton change={change} action="finished" />
            <InterestButton change={change} action="drop" />
          </>
        )}
    </>
  );
}

/**
 * What a person can do about their interest in something they asked for:
 * answer a "still watching?" check, keep watching, say they are done, and,
 * for the owner, change how long it is kept.
 */
export function InterestControls({
  user,
  interest,
}: {
  user: MediaUser;
  interest: Interest;
}) {
  const change = useInterestChange(user, interest);
  const own = interest.userId === user.id;
  const following = interest.interestState === "following";
  return (
    <>
      {interest.noticeDeliveryState === "attention" && (
        <p className="notice">
          Media could not deliver this reminder to you. Your interest stays
          protected until a reminder reaches you.
        </p>
      )}
      {interest.noticeEventId !== null && following && (
        <div className="notice">
          <p>
            Still watching? Choose {INTEREST_ACTION_NAMES.continue} to stay
            interested.
            {interest.replyBy === null
              ? " The time to answer starts once a reminder has reached you, or when you say you have seen this one."
              : ` Answer by ${dateLabel(interest.replyBy)}.`}
          </p>
          {own && interest.replyBy === null && (
            <InterestButton change={change} action="notice_viewed" />
          )}
        </div>
      )}
      <RequestInterestProgress
        actorId={user.id}
        requestId={interest.requestId}
        title={interest.title}
      />
      <div className="action-row">
        <InterestAnswers user={user} interest={interest} change={change} />
        {user.role === "owner" && (
          <InterestButton
            change={change}
            action={interest.keepingPolicy === "keep" ? "temporary" : "keep"}
          />
        )}
      </div>
      {change.error !== null && <ErrorNotice error={change.error} />}
    </>
  );
}
