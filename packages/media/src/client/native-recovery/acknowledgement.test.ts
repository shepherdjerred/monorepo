import { expect, test } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  nativeReviewIdentity,
  nativeReviewAcknowledged,
} from "./acknowledgement.ts";

test("same-route proof refresh invalidates acknowledgement before any new approval", () => {
  const client = new QueryClient();
  const review = {
    id: "review",
    version: 1,
    planHash: "a".repeat(64),
    scope: { request: { recoveryEpoch: 2, runtimeVersion: 3 } },
  };
  const key = ["native-recovery-detail", review.id];
  client.setQueryData(key, review);
  const acknowledged = nativeReviewIdentity(review);
  expect(nativeReviewAcknowledged(acknowledged, client.getQueryData(key))).toBe(
    true,
  );
  const changed = [
    { ...review, id: "other-review" },
    { ...review, version: 2 },
    { ...review, planHash: "b".repeat(64) },
    { ...review, scope: { request: { recoveryEpoch: 3, runtimeVersion: 3 } } },
    { ...review, scope: { request: { recoveryEpoch: 2, runtimeVersion: 4 } } },
  ];
  for (const next of changed) {
    client.setQueryData(key, next);
    expect(
      nativeReviewAcknowledged(acknowledged, client.getQueryData(key)),
    ).toBe(false);
    expect(
      nativeReviewAcknowledged(
        nativeReviewIdentity(next),
        client.getQueryData(key),
      ),
    ).toBe(true);
  }
  expect(nativeReviewAcknowledged(null, review)).toBe(false);
  expect(
    nativeReviewAcknowledged(acknowledged, { ...review, planHash: null }),
  ).toBe(false);
  client.clear();
});
