import { z } from "zod";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";

export const KeepingPolicySchema = z.enum(["keep", "temporary"]);
export const InterestStateSchema = z.enum([
  "following",
  "finished",
  "dropped",
  "expired",
]);
export const InterestCheckNoticeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  requestId: z.uuid(),
  userId: z.uuid(),
  interestRevision: z.int().nonnegative(),
  mediaId: z.uuid(),
  edition: MovieEditionKeySchema,
});
export const RequestInterestCommandSchema = z.strictObject({
  schemaVersion: z.literal(1),
  requestId: z.uuid(),
  expectedVersion: z.int().nonnegative(),
  expectedInterestRevision: z.int().nonnegative(),
  action: z.enum([
    "continue",
    "finished",
    "drop",
    "keep",
    "temporary",
    "notice_viewed",
  ]),
  noticeEventId: z.uuid().optional(),
});
export const RequestInterestViewSchema = z.strictObject({
  requestId: z.uuid(),
  mediaId: z.uuid(),
  edition: z.string(),
  userId: z.uuid(),
  title: z.string(),
  keepingPolicy: KeepingPolicySchema,
  interestState: InterestStateSchema,
  version: z.int().nonnegative(),
  interestRevision: z.int().nonnegative(),
  renewedAt: z.iso.datetime(),
  releasedAt: z.iso.datetime().nullable(),
  releaseReason: z.string().nullable(),
  noticeEventId: z.uuid().nullable(),
  replyBy: z.iso.datetime().nullable(),
  noticeDeliveryState: z.enum(["pending", "accepted", "attention"]).nullable(),
  noticeReason: z.string().nullable(),
});
export const RequestInterestListSchema = z.strictObject({
  items: z.array(RequestInterestViewSchema),
  nextCursor: z.uuid().nullable(),
});
export const RequestInterestResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  requestId: z.uuid(),
  version: z.int().nonnegative(),
  interestRevision: z.int().nonnegative(),
  state: InterestStateSchema,
  keepingPolicy: KeepingPolicySchema,
});
export type RequestInterestCommand = z.infer<
  typeof RequestInterestCommandSchema
>;
export const LibraryKeepingCommandSchema = z.strictObject({
  schemaVersion: z.literal(1),
  mediaId: z.uuid(),
  edition: MovieEditionKeySchema,
  expectedMediaVersion: z.int().nonnegative(),
  expectedTargetVersion: z.int().nonnegative(),
  keepingPolicy: KeepingPolicySchema,
});
export const LibraryKeepingResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  mediaId: z.uuid(),
  edition: z.string(),
  mediaVersion: z.int().nonnegative(),
  targetVersion: z.int().nonnegative(),
  keepingPolicy: KeepingPolicySchema,
});
export type LibraryKeepingCommand = z.infer<typeof LibraryKeepingCommandSchema>;
