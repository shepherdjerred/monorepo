import { describe, expect, test } from "vitest";
import { MovieTargetProgressV4Schema } from "#shared/movie-editions/lifecycle/public-v4.ts";
import {
  movieDiscoveryOutcome,
  movieDiscoveryWhere,
} from "./discovery-status.ts";

test("uses only the dispatched coordinator for the exact current edition, generation and epoch", () => {
  const rootMediaId = crypto.randomUUID();
  const mediaId = crypto.randomUUID();
  expect(
    movieDiscoveryWhere({
      scope: { rootMediaId, mediaId, edition: "extended_cut" },
      generation: 11,
      epoch: 12,
    }),
  ).toEqual({
    kind: "reconcile_movie_edition_v4",
    targetId: mediaId,
    outbox: { is: { dispatchedAt: { not: null } } },
    AND: [
      { payload: { path: ["schemaVersion"], equals: 4 } },
      { payload: { path: ["scope", "rootMediaId"], equals: rootMediaId } },
      { payload: { path: ["scope", "mediaId"], equals: mediaId } },
      { payload: { path: ["scope", "edition"], equals: "extended_cut" } },
      { payload: { path: ["generation"], equals: 11 } },
      { payload: { path: ["recoveryEpoch"], equals: 12 } },
    ],
  });
});

describe("movie discovery status", () => {
  test("distinguishes scanner work, deliberate retry, and an already selected release", () => {
    const pending = { status: "queued", payload: {}, result: null } as const;
    expect(movieDiscoveryOutcome(pending, false)).toBe("searching");
    expect(movieDiscoveryOutcome(pending, true)).toBeUndefined();
    expect(
      movieDiscoveryOutcome(
        {
          ...pending,
          payload: { releaseId: crypto.randomUUID() },
        },
        false,
      ),
    ).toBeUndefined();
    expect(
      movieDiscoveryOutcome(
        {
          ...pending,
          payload: { movieRetryV2: {} },
        },
        true,
      ),
    ).toBe("retrying");
  });

  test("uses recorded outcomes and preserves the existing response when none applies", () => {
    expect(
      movieDiscoveryOutcome(
        {
          status: "completed",
          payload: {},
          result: { reason: "no_acceptable_release" },
        },
        false,
      ),
    ).toBe("waiting_for_release");
    expect(
      movieDiscoveryOutcome(
        {
          status: "reconciling",
          payload: {},
          result: { reason: "plex_exclusion_proof_required" },
        },
        false,
      ),
    ).toBe("plex_exclusion_proof_required");
    expect(
      movieDiscoveryOutcome(
        {
          status: "completed",
          payload: {},
          result: { reason: "movie_operation_cancelled" },
        },
        false,
      ),
    ).toBeUndefined();
    const previous = { attempts: [], torrents: [], historyTruncated: false };
    expect(MovieTargetProgressV4Schema.parse(previous)).toEqual(previous);
  });
});
