import {
  RedditOutreachStopReasonSchema,
  type RedditOutreachOverview,
  type RedditOutreachRun,
} from "@shepherdjerred/ops-model/promotion/reddit-outreach.ts";
import { promotionConfig } from "#config/promotion.ts";
import { redditOutreachConfig } from "#config/reddit-outreach.ts";
import type { PromotionStore } from "#activities/promotion/store.ts";
import {
  readRedditReplyRecord,
  readRedditReplyReservations,
  type RedditReplyRecord,
} from "#activities/promotion/reddit-outreach/ledger.ts";
import { readRedditPromotionAccount } from "#activities/promotion/reddit-outreach/ownership.ts";
import {
  readRedditSweep,
  readRedditSweepDay,
  type SweepSummary,
} from "#activities/promotion/reddit-outreach/sweep-audit.ts";
import { promotionSpendDay } from "./budget.ts";
import {
  readRedditOutreachSchedule,
  REDDIT_OUTREACH_RUN_LIMIT,
} from "./status-reddit-schedule.ts";

type ReplyObservations = {
  verifiedReceipts: string[];
  unresolvedReplies: number;
};

export async function readRedditOutreachOverview(
  store: PromotionStore,
  now: number,
  readSchedule = readRedditOutreachSchedule,
): Promise<RedditOutreachOverview> {
  const day = promotionSpendDay(new Date(now));
  // Shift the calendar date in UTC after determining the Pacific date. An
  // elapsed 24 hours can still belong to the same day across the fall DST change.
  const yesterday = previousCalendarDate(day);
  const [
    todayAudits,
    previousAudits,
    account,
    outreach,
    promotion,
    ...reservations
  ] = await Promise.all([
    readRedditSweepDay(store, day),
    readRedditSweepDay(store, yesterday),
    readRedditPromotionAccount(store),
    redditOutreachConfig(),
    promotionConfig(),
    ...[day, yesterday, previousCalendarDate(yesterday)].map((date) =>
      readRedditReplyReservations(store, date),
    ),
  ] as const);
  const audits = new Map(
    [...todayAudits, ...previousAudits]
      .filter((audit) => !audit.preview)
      .map((audit) => [audit.occurrenceId, audit]),
  );
  const { replyRecords, unauditedReplyRuns } = await readReservationClaims(
    store,
    reservations.flat(),
    audits,
  );
  const native = await readSchedule(
    yesterday,
    new Set(audits.keys()),
    unauditedReplyRuns,
  );
  // An individual audit write can succeed before indexing that Pacific day.
  const recovered = await Promise.all(
    native.executions.map(async (execution) => ({
      execution,
      audit: await readRedditSweep(store, execution.id),
    })),
  );
  for (const { audit } of recovered) {
    if (audit !== undefined && !audit.preview) {
      audits.set(audit.occurrenceId, audit);
    }
  }

  const verifiedAudits = verifiedAuditReceipts(audits);
  await readReplyRecords(store, replyRecords, verifiedAudits.keys());
  const replies = projectReplyObservations(verifiedAudits, replyRecords);
  const recorded = [...audits.values()].map((audit) =>
    projectAudit(audit, replies.get(audit.occurrenceId)),
  );
  const missing = recovered.flatMap(({ execution, audit }) => {
    if (audit !== undefined) return [];
    const observed = replies.get(execution.id);
    return [
      {
        row: {
          id: execution.id,
          at: execution.at,
          status: execution.status,
          elapsedMs: execution.elapsedMs,
          stopReason: null,
          inspected: null,
          assessed: null,
          cached: null,
          metrics: null,
          verifiedReceipts: observed?.verifiedReceipts ?? [],
          unresolvedReplies: observed?.unresolvedReplies ?? 0,
          failureCategory: execution.status === "failed" ? "workflow" : null,
        } satisfies RedditOutreachRun,
        completedAt: execution.completedAt,
      },
    ];
  });
  const runs = [...recorded, ...missing.map(({ row }) => row)]
    .filter(({ at }) => {
      const completedDay = promotionSpendDay(new Date(at));
      return completedDay >= yesterday && completedDay <= day;
    })
    .sort(
      (a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id),
    );
  const completedToday = [
    ...recorded.filter(({ at }) => promotionSpendDay(new Date(at)) === day),
    ...missing.flatMap(({ row, completedAt }) =>
      completedAt !== null && promotionSpendDay(new Date(completedAt)) === day
        ? [row]
        : [],
    ),
  ];
  const settingsAvailable = outreach.available && promotion.available;
  const publishingEnabled =
    outreach.enabled &&
    outreach.maxRepliesPerDay > 0 &&
    outreach.maxRepliesPerSweep > 0;
  return {
    status: "available",
    schedule: {
      ...native.schedule,
      lastRunAt: native.schedule.lastRunAt ?? runs[0]?.at ?? null,
    },
    publishing: settingsAvailable
      ? publishingEnabled
        ? "enabled"
        : "disabled"
      : "unavailable",
    account: {
      hold: account.hold,
      retryAt:
        account.retryAt !== null && Date.parse(account.retryAt) > now
          ? account.retryAt
          : null,
    },
    today: {
      day,
      inspected: completedToday.reduce(
        (total, run) => total + (run.inspected ?? 0),
        0,
      ),
      assessed: completedToday.reduce(
        (total, run) => total + (run.assessed ?? 0),
        0,
      ),
      cached: completedToday.reduce(
        (total, run) => total + (run.cached ?? 0),
        0,
      ),
      draftsPrepared: completedToday.some((run) => run.metrics === null)
        ? null
        : completedToday.reduce(
            (total, run) => total + (run.metrics?.draftsPrepared ?? 0),
            0,
          ),
      verifiedReplies: completedToday.reduce(
        (total, run) => total + run.verifiedReceipts.length,
        0,
      ),
      unresolvedReplies: completedToday.reduce(
        (total, run) => total + run.unresolvedReplies,
        0,
      ),
      remainingSlots: outreach.available
        ? Math.max(
            0,
            outreach.maxRepliesPerDay - (reservations[0]?.length ?? 0),
          )
        : null,
    },
    runs: runs.slice(0, REDDIT_OUTREACH_RUN_LIMIT),
  };
}

function previousCalendarDate(day: string) {
  const midnight = new Date(`${day}T00:00:00Z`);
  midnight.setUTCDate(midnight.getUTCDate() - 1);
  return midnight.toISOString().slice(0, 10);
}

function projectAudit(
  audit: SweepSummary,
  replies: ReplyObservations | undefined,
): RedditOutreachRun {
  const stopReason = RedditOutreachStopReasonSchema.safeParse(audit.stopReason);
  return {
    id: audit.occurrenceId,
    at: audit.completedAt,
    elapsedMs: audit.elapsedMs ?? null,
    status: "recorded",
    stopReason: stopReason.success
      ? stopReason.data
      : audit.stopReason === undefined
        ? null
        : "other",
    deferUntil: audit.deferUntil ?? null,
    inspected: audit.inspected,
    assessed: audit.assessed,
    cached: audit.cached,
    metrics: audit.metrics ?? null,
    ...(audit.coverage === undefined ? {} : { coverage: audit.coverage }),
    verifiedReceipts: replies?.verifiedReceipts ?? [],
    unresolvedReplies: replies?.unresolvedReplies ?? 0,
    failureCategory: audit.failureCategory ?? null,
  };
}

async function readReservationClaims(
  store: PromotionStore,
  reservations: string[],
  audits: ReadonlyMap<string, SweepSummary>,
) {
  const replyRecords = new Map<string, RedditReplyRecord | undefined>();
  await readReplyRecords(store, replyRecords, reservations);
  const unauditedReplyRuns = new Set<string>();
  for (const [postId, record] of replyRecords) {
    const reply =
      record === undefined ? undefined : projectReplyRecord(postId, record);
    if (reply !== undefined && !audits.has(reply.id))
      unauditedReplyRuns.add(reply.id);
  }
  return { replyRecords, unauditedReplyRuns };
}

async function readReplyRecords(
  store: PromotionStore,
  records: Map<string, RedditReplyRecord | undefined>,
  postIds: Iterable<string>,
) {
  const unread = [...new Set(postIds)].filter((postId) => !records.has(postId));
  const observations = await Promise.all(
    unread.map(
      async (postId) =>
        [postId, await readRedditReplyRecord(store, postId)] as const,
    ),
  );
  for (const [postId, record] of observations) records.set(postId, record);
}

function projectReplyObservations(
  verified: ReadonlyMap<string, { id: string; receipt: string }>,
  records: ReadonlyMap<string, RedditReplyRecord | undefined>,
) {
  const replies = new Map<string, ReplyObservations>();
  for (const [postId, record] of records) {
    const result =
      record === undefined
        ? verified.get(postId)
        : projectReplyRecord(postId, record);
    if (result === undefined) continue;
    const { id, receipt } = result;
    const observed = replies.get(id) ?? {
      verifiedReceipts: [],
      unresolvedReplies: 0,
    };
    if (receipt === null) observed.unresolvedReplies++;
    else observed.verifiedReceipts.push(receipt);
    replies.set(id, observed);
  }
  return replies;
}

function verifiedAuditReceipts(audits: ReadonlyMap<string, SweepSummary>) {
  const observed = new Map<string, { id: string; receipt: string }>();
  const ordered = [...audits.values()].sort(
    (left, right) =>
      Date.parse(left.completedAt) - Date.parse(right.completedAt),
  );
  for (const audit of ordered) {
    for (const reply of audit.replies) {
      if (reply.status !== "verified" || observed.has(reply.postId)) continue;
      const receipt = canonicalCommentReceipt(
        reply.receiptUrl ?? null,
        reply.postId,
      );
      if (receipt !== null)
        observed.set(reply.postId, { id: audit.occurrenceId, receipt });
    }
  }
  return observed;
}

function projectReplyRecord(postId: string, record: RedditReplyRecord) {
  const suffix = `/reply/${postId}`;
  if (
    record.postId !== postId ||
    !record.occurrenceId.endsWith(suffix) ||
    record.status === "blocked"
  ) {
    return;
  }
  return {
    id: record.occurrenceId.slice(0, -suffix.length),
    receipt:
      record.status === "verified"
        ? canonicalCommentReceipt(record.receiptUrl, postId)
        : null,
  };
}

function canonicalCommentReceipt(address: string | null, postId: string) {
  if (address === null) return null;
  const url = URL.parse(address);
  if (
    url?.protocol !== "https:" ||
    !["www.reddit.com", "old.reddit.com", "reddit.com"].includes(
      url.hostname,
    ) ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  )
    return null;
  const match =
    /^\/r\/(\w+)\/comments\/([a-z0-9]+)\/[^/]+\/([a-z0-9]+)\/?$/.exec(
      url.pathname,
    );
  const [, subreddit, parentId, commentId] = match ?? [];
  return subreddit === undefined ||
    commentId === undefined ||
    parentId !== postId
    ? null
    : `https://www.reddit.com/r/${subreddit}/comments/${postId}/comment/${commentId}/`;
}
