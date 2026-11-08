import { afterEach, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { createMovieHistoryHttpFixture } from "#testing/movie-workflow/history/history-http-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { movieHistoryHttpResponse } from "#testing/movie-workflow/history/history-http-transport.ts";
import {
  MovieHistoryCommandResultV3Schema,
  MovieHistoryClaimAccountingV3Schema,
} from "#shared/movie-editions/history-review-v3.ts";
import { MovieHistoryPendingV3Schema } from "#shared/movie-editions/history-review-views-v3.ts";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

test("real authenticated HTTP discovers and records each person's named-cut declaration before queuing scoped retention", async () => {
  const bytes = await movieVideoFixture();
  const f = await createMovieHistoryHttpFixture("directors_cut", bytes);
  closers.push(f.close);
  const unauthenticated = await fetch(
    `${f.http.origin}/api/v3/movie-history/reviews`,
  );
  expect(unauthenticated.status).toBe(401);
  const forbidden = await f.memberBrowser.request(
    `/api/v3/movie-history/context?mediaId=${f.scope.mediaId}&edition=${f.scope.edition}`,
  );
  expect(forbidden.status).toBe(403);
  expect(f.visible.scope).toEqual(f.scope);
  expect(f.visible.subject.id).toBe(f.member.id);
  expect(f.visible.requests.map((row) => row.id)).toEqual([f.request.id]);
  expect(f.visible.choices.map((row) => row.id)).toEqual([f.choice.id]);
  expect(Object.keys(f.visible)).not.toContain("users");
  expect(Object.keys(f.visible)).not.toContain("legacyClaims");
  const sibling = await movieHistoryHttpResponse(
    await f.memberBrowser.request(
      `/api/v3/movie-history/reviews?mediaId=${f.scope.mediaId}&edition=default`,
    ),
    MovieHistoryPendingV3Schema,
  );
  expect(sibling.reviews).toEqual([]);
  const responses = await f.db.recoveryResponse.findMany({
    where: { reviewId: f.detail.id },
    orderBy: { userId: "asc" },
  });
  expect(responses).toHaveLength(f.detail.scope.users.length);
  for (const response of responses)
    expect(response.actorId).toBe(response.userId);
  expect(
    await f.db.movieEditionChoice.findUniqueOrThrow({
      where: { id: f.choice.id },
    }),
  ).toEqual(f.choice);
  expect(
    await f.db.mediaRequest.findUniqueOrThrow({ where: { id: f.request.id } }),
  ).toEqual(f.request);
  const receipt = await f.db.recoveryReleaseReceipt.findUniqueOrThrow({
    where: { reviewId: f.detail.id },
  });
  expect(
    MovieHistoryClaimAccountingV3Schema.parse(receipt.claimAccounting).scope,
  ).toEqual(f.scope);
  const operation = await f.db.operation.findUniqueOrThrow({
    where: { id: z.uuid().parse(f.released.operationId) },
    include: { outbox: true },
  });
  expect(operation.kind).toBe("retain_movie_edition_v4");
  expect(operation.idempotencyKey).toBe(`movie-history-release:${f.detail.id}`);
  expect(operation.outbox?.kind).toBe("retain_movie_edition_v4");
  expect(f.input.scope).toEqual(f.scope);
  expect(
    await movieHistoryHttpResponse(
      await f.ownerBrowser.request(
        `/api/v3/movie-history/reviews/${f.detail.id}/release`,
        { key: f.key, body: f.releaseInput },
      ),
      MovieHistoryCommandResultV3Schema,
    ),
  ).toEqual(f.released);
  expect(
    await f.db.recoveryReleaseReceipt.count({
      where: { reviewId: f.detail.id },
    }),
  ).toBe(1);
  expect(
    await f.db.libraryAsset.findUniqueOrThrow({
      where: { id: f.baseline.asset.id },
    }),
  ).toEqual(f.baseline.asset);
  expect(
    await f.db.mediaHandoffReceipt.findUniqueOrThrow({
      where: { id: f.baseline.handoff.id },
    }),
  ).toEqual(f.baseline.handoff);
  expect(
    await f.db.plexBindingCurrent.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: f.scope.mediaId, edition: f.scope.edition },
      },
    }),
  ).toEqual(f.baseline.binding);
  expect(
    createHash("sha256")
      .update(await readFile(f.original.target))
      .digest("hex"),
  ).toBe(createHash("sha256").update(bytes).digest("hex"));
  expect(await f.db.acquisitionAttempt.count()).toBe(0);
  expect(f.http.errors).toEqual([]);
}, 60_000);
