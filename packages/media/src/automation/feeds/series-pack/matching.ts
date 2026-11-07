import type { MediaAutomationContext } from "#automation/context.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import {
  MatchFeedSourceV1Schema,
  type MatchFeedSourceV1,
} from "#shared/feeds/contract.ts";
import { parseSeriesSeasonSetV1 } from "#domain/acquisition-identity/series-season-set.ts";
import { readFeedSourceV1 } from "#automation/feeds/source.ts";
import {
  advanceSeriesPackFeedV1,
  seriesPackFeedCommandV1,
  cursorPosition,
} from "./command.ts";
import { matchSeriesPackFeedTargetV1 } from "./target.ts";

/** One whole potential cohort and two operational targets per Activity; no per-target allowance. */
export async function matchSeriesPackFeedSourceV1(
  context: MediaAutomationContext,
  raw: MatchFeedSourceV1,
) {
  const input = MatchFeedSourceV1Schema.parse(raw);
  const invocation = context.libraryManagement;
  if (invocation === undefined)
    throw new Error(
      "Series pack feed matching needs its original configured invocation",
    );
  invocation.freshness.assertActive();
  const initial = await seriesPackFeedCommandV1(context.db, input, invocation);
  invocation.budget.consume(1);
  const source = await readFeedSourceV1(
    context.db,
    context.cipher,
    input.sourceId,
  );
  if (initial.progress.completed)
    return { status: "processed" as const, processed: 0, nextCursor: null };
  const cursor = initial.progress.cursor;
  if (
    input.cursor !== null &&
    (cursor === null || cursorPosition(input.cursor) > cursorPosition(cursor))
  )
    throw new Error("Series pack feed caller skipped uncommitted targets");
  const syntax = parseSeriesSeasonSetV1(source.title);
  if (syntax.status !== "resolved")
    throw new Error(
      "Series pack feed command does not reference one explicit valid source range",
    );
  const runtime = await runtimeAuthority(context.db);
  const provider = await context.db.mediaProvider.findUniqueOrThrow({
    where: { id: source.providerId },
  });
  invocation.freshness.assertActive();
  if (
    !runtime.active ||
    !provider.enabled ||
    !(await context.gates.acquisition())
  )
    return { status: "paused" as const, processed: 0, nextCursor: cursor };
  const targets = await context.db.mediaIntent.findMany({
    where: {
      edition: "default",
      desiredPresence: true,
      monitoring: true,
      intentionallyRemovedAt: null,
      automationEpoch: runtime.epoch,
      media: {
        kind: "episode",
        seasonNumber: { in: syntax.range.seasons },
        OR: [{ airDate: null }, { airDate: { lte: new Date() } }],
      },
      ...(cursor === null
        ? {}
        : {
            OR: [
              { mediaId: { gt: cursor.mediaId } },
              { mediaId: cursor.mediaId, edition: { gt: cursor.edition } },
            ],
          }),
    },
    orderBy: [{ mediaId: "asc" }, { edition: "asc" }],
    take: 2,
    include: { media: { include: { parent: { include: { parent: true } } } } },
  });
  const target = targets[0];
  if (target === undefined) {
    await advanceSeriesPackFeedV1(
      context.db,
      {
        operationId: input.operationId,
        sourceId: input.sourceId,
        prior: initial.raw,
        next: { ...initial.progress, completed: true },
      },
      invocation,
    );
    return { status: "processed" as const, processed: 0, nextCursor: null };
  }
  const next = { mediaId: target.mediaId, edition: target.edition };
  const matched = await matchSeriesPackFeedTargetV1(context, {
    command: input,
    target,
    source,
    completed: targets.length < 2,
  });
  if (matched.status === "paused")
    return { status: "paused" as const, processed: 0, nextCursor: cursor };
  if (matched.status === "committed")
    return {
      status: "processed" as const,
      processed: 1,
      nextCursor: matched.progress.completed ? null : matched.progress.cursor,
    };
  // A known oversized whole cohort advances exactly one candidate. No more
  // provenance queries occur after budget exhaustion; the prior checkpoint is a CAS.
  const progress = await advanceSeriesPackFeedV1(
    context.db,
    {
      operationId: input.operationId,
      sourceId: input.sourceId,
      prior: initial.raw,
      next: {
        ...initial.progress,
        cursor: next,
        completed: targets.length < 2,
        protection: matched.protection,
      },
    },
    invocation,
  );
  return {
    status: "processed" as const,
    processed: 1,
    nextCursor: progress.completed ? null : progress.cursor,
  };
}
