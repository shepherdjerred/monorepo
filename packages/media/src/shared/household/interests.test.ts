import { expect, test } from "vitest";
import {
  RequestInterestIncludeSchema,
  RequestInterestListSchema,
  RequestInterestViewSchema,
} from "#shared/household/interests.ts";

const row = {
  requestId: "00000000-0000-4000-8000-000000000001",
  mediaId: "00000000-0000-4000-8000-000000000002",
  edition: "default",
  userId: "00000000-0000-4000-8000-000000000003",
  title: "Followed show",
  keepingPolicy: "temporary",
  interestState: "following",
  version: 0,
  interestRevision: 0,
  renewedAt: "2026-11-01T00:00:00.000Z",
  releasedAt: null,
  releaseReason: null,
  noticeEventId: null,
  replyBy: null,
  noticeDeliveryState: null,
  noticeReason: null,
};
const artwork = { posterPath: "/poster.jpg", backdropPath: null };
// The contract a browser tab on the earlier client still holds: the same
// strict object, without the key.
const EarlierViewSchema = RequestInterestViewSchema.omit({ artwork: true });

test("an optional key on the strict row is accepted when present and absent when not sent", () => {
  const without = RequestInterestViewSchema.parse(row);
  expect(Object.hasOwn(without, "artwork")).toBe(false);
  expect(without).toEqual(row);
  expect(JSON.stringify(without)).not.toContain("artwork");
  expect(RequestInterestViewSchema.parse({ ...row, artwork })).toEqual({
    ...row,
    artwork,
  });
  expect(
    RequestInterestListSchema.parse({ items: [row], nextCursor: null }),
  ).toEqual({ items: [row], nextCursor: null });
});

test("the row stays strict: an unknown key and a malformed artwork are rejected", () => {
  expect(
    RequestInterestViewSchema.safeParse({ ...row, poster: "/poster.jpg" })
      .success,
  ).toBe(false);
  expect(
    RequestInterestViewSchema.safeParse({
      ...row,
      artwork: { posterPath: "/poster.jpg" },
    }).success,
  ).toBe(false);
});

test("an earlier client parses the default response and would reject an unrequested artwork key", () => {
  expect(EarlierViewSchema.parse(RequestInterestViewSchema.parse(row))).toEqual(
    row,
  );
  const rejected = EarlierViewSchema.safeParse({ ...row, artwork });
  expect(rejected.success).toBe(false);
  expect(rejected.error?.issues).toMatchObject([
    { code: "unrecognized_keys", keys: ["artwork"] },
  ]);
});

test("only a known addition can be requested", () => {
  expect(RequestInterestIncludeSchema.parse("artwork")).toBe("artwork");
  expect(RequestInterestIncludeSchema.safeParse("progress").success).toBe(
    false,
  );
});
