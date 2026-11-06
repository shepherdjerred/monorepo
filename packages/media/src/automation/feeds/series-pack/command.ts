import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  FeedMatchProgressV1Schema,
  MatchFeedSourceV1Schema,
  type MatchFeedSourceV1,
} from "#shared/feeds/contract.ts";
import type { LibraryManagementInvocation } from "#infrastructure/acquisition-identity/library-policy.ts";

export const SeriesPackFeedProgressV1Schema = FeedMatchProgressV1Schema.extend({
  protection: z
    .strictObject({ mediaId: z.uuid(), reason: z.string().min(1).max(200) })
    .nullable(),
});
export type SeriesPackFeedProgressV1 = z.infer<
  typeof SeriesPackFeedProgressV1Schema
>;
export const cursorPosition = (
  cursor: NonNullable<MatchFeedSourceV1["cursor"]>,
) => `${cursor.mediaId}:${cursor.edition}`;

export async function seriesPackFeedCommandV1(
  tx: Prisma.TransactionClient,
  input: MatchFeedSourceV1,
  invocation: LibraryManagementInvocation,
) {
  invocation.freshness.assertActive();
  invocation.budget.consume(1);
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  const command = z
    .object({
      ...MatchFeedSourceV1Schema.shape,
      kind: z.literal("match_series_pack_feed_source_v1"),
    })
    .parse(operation.payload);
  if (
    operation.kind !== command.kind ||
    operation.id !== command.operationId ||
    operation.targetId !== command.sourceId ||
    command.sourceId !== input.sourceId ||
    command.cursor !== null
  )
    throw new Error("Series pack feed command lost its actual original source");
  const raw = z
    .object({
      seriesPackFeedMatchV1: SeriesPackFeedProgressV1Schema.optional(),
    })
    .parse(operation.result ?? {}).seriesPackFeedMatchV1;
  const progress = raw ?? {
    schemaVersion: 1 as const,
    sourceId: input.sourceId,
    cursor: null,
    completed: false,
    protection: null,
  };
  if (
    progress.sourceId !== input.sourceId ||
    (operation.status === "completed" && !progress.completed)
  )
    throw new Error("Series pack feed progress changed its actual source");
  invocation.freshness.assertActive();
  return { operation, progress, raw };
}

/** CAS uses the already verified command and exact prior checkpoint, including exhausted-budget protection. */
export async function advanceSeriesPackFeedV1(
  tx: Prisma.TransactionClient,
  input: {
    operationId: string;
    sourceId: string;
    prior: SeriesPackFeedProgressV1 | undefined;
    next: SeriesPackFeedProgressV1;
  },
  invocation: LibraryManagementInvocation,
) {
  invocation.freshness.assertActive();
  const next = SeriesPackFeedProgressV1Schema.parse(input.next);
  if (next.sourceId !== input.sourceId)
    throw new Error("Series pack feed checkpoint changed source");
  const prior = input.prior === undefined ? null : JSON.stringify(input.prior);
  const count =
    await tx.$executeRaw`UPDATE "Operation" SET result=COALESCE(result,'{}'::jsonb) || jsonb_build_object('seriesPackFeedMatchV1',${JSON.stringify(next)}::jsonb)
    WHERE id=${input.operationId} AND kind='match_series_pack_feed_source_v1' AND "targetId"=${input.sourceId}
    AND (result->'seriesPackFeedMatchV1') IS NOT DISTINCT FROM ${prior}::jsonb`;
  if (count !== 1)
    throw new Error("Series pack feed checkpoint changed concurrently");
  invocation.freshness.assertActive();
  return next;
}
