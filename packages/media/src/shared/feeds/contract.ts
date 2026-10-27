import { z } from "zod";

export const NativeFeedProviderSchema = z.enum([
  "knaben",
  "privatehd",
  "avistaz",
  "animez",
]);
const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
const Page = z
  .int()
  .positive()
  .max(Math.floor(Number.MAX_SAFE_INTEGER / 100));
const Cycle = z.string().min(1).max(200);

export const FeedSourceV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  providerId: NativeFeedProviderSchema,
  providerReleaseId: z.string().min(1),
  identityHash: Hash,
  sourceHash: Hash,
  encryptedSource: z.string().min(1),
});
export const FeedCheckpointV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  providerId: NativeFeedProviderSchema,
  cycleId: Cycle,
  page: Page,
  priorHead: z.array(Hash).max(100),
  head: z.array(Hash).max(100),
  completed: z.boolean(),
});
export const FeedCursorV1Schema = FeedCheckpointV1Schema.pick({
  providerId: true,
  cycleId: true,
  page: true,
});
export const FeedPageReceiptV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  providerId: z.enum([
    "knaben",
    "privatehd",
    "avistaz",
    "animez",
    "thepiratebay",
    "magnetdownload",
  ]),
  cycleId: Cycle,
  page: Page,
  scanned: z.int().min(0).max(100),
  sourceIds: z.array(z.uuid()).max(100),
  nextCursor: z.string().nullable(),
});
export const MatchFeedSourceV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  operationId: z.uuid(),
  sourceId: z.uuid(),
  cursor: z.strictObject({ mediaId: z.uuid(), edition: z.string() }).nullable(),
});
export const FeedMatchProgressV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  sourceId: z.uuid(),
  cursor: MatchFeedSourceV1Schema.shape.cursor,
  completed: z.boolean(),
});
export type FeedCheckpointV1 = z.infer<typeof FeedCheckpointV1Schema>;
export type FeedPageReceiptV1 = z.infer<typeof FeedPageReceiptV1Schema>;
export type MatchFeedSourceV1 = z.infer<typeof MatchFeedSourceV1Schema>;

const prefix = "feed-v1:";
export function encodeFeedCursorV1(input: z.infer<typeof FeedCursorV1Schema>) {
  return `${prefix}${encodeURIComponent(JSON.stringify(FeedCursorV1Schema.parse(input)))}`;
}
export function readFeedCursorV1(raw: string | null) {
  return raw?.startsWith(prefix) === true
    ? FeedCursorV1Schema.parse(
        JSON.parse(decodeURIComponent(raw.slice(prefix.length))),
      )
    : null;
}
