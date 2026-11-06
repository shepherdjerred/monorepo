import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, queryClient, sessionBoundary } from "#client/api.ts";
import { sessionFixture } from "#client/session.test-support.tsx";
import {
  readMovieHistoryContextV3,
  readMovieHistoryIndexV3,
  unresolvedMovieHistoryWriteV3,
  writeMovieHistoryV3,
  type MovieHistoryWriteV3,
} from "./api.ts";
import { movieHistoryResponseV3 } from "./declaration.ts";
import { movieHistoryPersonalFixtureV3 } from "./test-support.ts";

afterEach(() => {
  sessionBoundary.publish(
    null,
    sessionBoundary.getSnapshot().generation,
    "logout",
  );
  queryClient.clear();
  vi.unstubAllGlobals();
});

it("retries an unknown write with its original actor/path/body/key after background choice changes", async () => {
  const { user, review } = movieHistoryPersonalFixtureV3();
  const fixture = sessionFixture();
  sessionBoundary.publish(
    user,
    sessionBoundary.getSnapshot().generation,
    "login",
  );
  const path = `/movie-history/reviews/${review.id}/responses`;
  const sent: { path: string; key: string | null; body: unknown }[] = [];
  vi.stubGlobal("fetch", (url: string, input: RequestInit) => {
    sent.push({
      path: url,
      key: new Headers(input.headers).get("Idempotency-Key"),
      body: JSON.parse(z.string().parse(input.body)),
    });
    return sent.length === 1
      ? Promise.reject(new TypeError("Response lost after commit"))
      : Promise.resolve(
          Response.json({
            recoveryReviewId: review.id,
            status: "completed",
            version: 4,
          }),
        );
  });
  const original: MovieHistoryWriteV3 = {
    actorId: user.id,
    path,
    body: movieHistoryResponseV3(review, "request", ""),
  };
  await expect(writeMovieHistoryV3(original)).rejects.toThrow(
    "Response lost after commit",
  );
  expect(fixture.stored.size).toBe(1);
  const request = review.requests[0];
  if (request === undefined) throw new Error("Captured request required");
  request.version++;
  review.version++;
  const retry = unresolvedMovieHistoryWriteV3({
    error: new Error("Unknown response"),
    variables: original,
  });
  expect(retry).toBe(original);
  if (retry === null)
    throw new Error("Unknown result must retain its original input");
  await writeMovieHistoryV3(retry);
  expect(sent).toHaveLength(2);
  expect(sent[1]).toEqual(sent[0]);
  expect(sent[1]?.path).toBe(`/api/v3${path}`);
  expect(sent[1]?.body).toMatchObject({
    declaration: { currentChoice: { requestVersion: 7 } },
  });
  expect(fixture.stored.size).toBe(0);
  expect(
    unresolvedMovieHistoryWriteV3({
      error: new ApiError("movie_history_changed", "Review again", 409),
      variables: original,
    }),
  ).toBeNull();
});

it("rejects another cut's prepare context and pending list rather than displaying borrowed consent", async () => {
  const { review } = movieHistoryPersonalFixtureV3();
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      Response.json({
        schemaVersion: 3,
        scope: { ...review.scope, edition: "theatrical_cut" },
        expected: {
          mediaVersion: 2,
          targetVersion: 3,
          holdVersion: 1,
          definition: review.definition,
        },
      }),
    ),
  );
  await expect(readMovieHistoryContextV3(review.scope)).rejects.toThrow(
    "another edition",
  );
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      Response.json({
        reviews: [
          {
            id: review.id,
            version: review.version,
            scope: { ...review.scope, edition: "theatrical_cut" },
            definition: review.definition,
            title: review.title,
            expiresAt: review.expiresAt,
            responded: false,
          },
        ],
      }),
    ),
  );
  await expect(readMovieHistoryIndexV3(review.scope)).rejects.toThrow(
    "another edition",
  );
});
