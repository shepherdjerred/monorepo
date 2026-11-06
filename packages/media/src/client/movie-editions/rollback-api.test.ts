import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { queryClient, sessionBoundary } from "#client/api.ts";
import {
  owner,
  member,
  sessionFixture,
} from "#client/session.test-support.tsx";
import { MovieRollbackViewV1Schema } from "#shared/movie-editions/rollback/view.ts";
import {
  movieRollbackSubmissionV1,
  readMovieRollbackV1,
  writeMovieRollbackV1,
  type RollbackReviewV1,
} from "./rollback-api.ts";

afterEach(() => {
  sessionBoundary.publish(
    null,
    sessionBoundary.getSnapshot().generation,
    "logout",
  );
  queryClient.clear();
  vi.unstubAllGlobals();
});

function rollbackReview(state: "request" | "retry"): RollbackReviewV1 {
  const mediaId = crypto.randomUUID();
  const scope = {
    rootMediaId: mediaId,
    mediaId,
    edition: "directors_cut" as const,
  };
  const asset = {
    id: crypto.randomUUID(),
    version: 2,
    checksum: "a".repeat(64),
  };
  const successor = {
    ...asset,
    id: crypto.randomUUID(),
    checksum: "b".repeat(64),
  };
  const binding = {
    scope: { mediaId, edition: scope.edition },
    evidenceId: crypto.randomUUID(),
    associationHash: "c".repeat(64),
    revision: 3,
  };
  const common = {
    schemaVersion: 1,
    scope,
    sourceAttemptId: crypto.randomUUID(),
  };
  const expected = {
    mediaVersion: 8,
    targetVersion: 11,
    generation: 4,
    recoveryEpoch: 2,
  };
  const cleanup = {
    id: crypto.randomUUID(),
    version: 1,
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  const review = MovieRollbackViewV1Schema.parse({
    scope,
    title: "Reviewed Film",
    editionLabel: "Director's Cut",
    originalDeadline: cleanup.expiresAt,
    predecessor: {
      id: asset.id,
      version: asset.version,
      quality: "WEB-1080p",
      codec: "h264",
      audioLanguages: ["en"],
      sizeBytes: "1000",
    },
    successor: {
      id: successor.id,
      version: successor.version,
      quality: "WEB-2160p",
      codec: "h265",
      audioLanguages: ["en"],
      sizeBytes: "2000",
    },
    reason: null,
    state,
    command:
      state === "request"
        ? {
            ...common,
            expected: {
              ...expected,
              predecessor: asset,
              successor: { ...successor, publicationHash: "d".repeat(64) },
              binding,
              cleanup,
            },
          }
        : {
            ...common,
            resume: {
              operationId: crypto.randomUUID(),
              intentHash: "d".repeat(64),
            },
            expected: {
              ...expected,
              predecessor: { ...asset, snapshotHash: "e".repeat(64) },
              successor: { ...successor, snapshotHash: "f".repeat(64) },
              pointer: {
                scope: binding.scope,
                revision: binding.revision,
                evidence: {
                  id: binding.evidenceId,
                  associationHash: binding.associationHash,
                },
              },
              physicalHash: null,
              previousHandoff: null,
              originalCleanup: cleanup,
            },
          },
  });
  if (review.state !== "request" && review.state !== "retry")
    throw new Error("Eligible public rollback fixture required");
  return review;
}
function confirmation() {
  const form = new FormData();
  form.set("reason", "  This exact upgrade has the wrong dialogue track.  ");
  form.set("restore", "on");
  form.set("retain", "on");
  form.set("resume", "on");
  return form;
}
function accepted(input: ReturnType<typeof movieRollbackSubmissionV1>) {
  const common = {
    schemaVersion: 1,
    operationId: crypto.randomUUID(),
    scope: input.body.scope,
    sourceAttemptId: input.body.sourceAttemptId,
    status: "queued",
  };
  return "resume" in input.body
    ? common
    : { ...common, expiresAt: "2099-01-01T00:00:00.000Z" };
}
function signIn() {
  const fixture = sessionFixture();
  sessionBoundary.publish(
    owner,
    sessionBoundary.getSnapshot().generation,
    "login",
  );
  return fixture;
}

it.each(["restore", "retain"])(
  "requires the actual owner's %s acknowledgement before constructing a new rollback command",
  (missing) => {
    const form = confirmation();
    form.delete(missing);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(() =>
      movieRollbackSubmissionV1(owner.id, rollbackReview("request"), form),
    ).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it("keeps the exact public predecessor/successor CAS and distinguishes an admitted retry from new removal permission", () => {
  const review = rollbackReview("request");
  const request = movieRollbackSubmissionV1(owner.id, review, confirmation());
  expect(request.body).toMatchObject({
    expected: review.command.expected,
    confirmRestorePredecessor: true,
    confirmRetainRejectedSuccessor: true,
    reason: "This exact upgrade has the wrong dialogue track.",
  });
  expect(request.path).toBe(
    `/media/${review.scope.mediaId}/movie-editions/directors_cut/rollback`,
  );
  const retryReview = rollbackReview("retry");
  const form = confirmation();
  form.delete("resume");
  expect(() =>
    movieRollbackSubmissionV1(owner.id, retryReview, form),
  ).toThrow();
  form.set("resume", "on");
  const retry = movieRollbackSubmissionV1(owner.id, retryReview, form);
  expect(retry.path).toBe(
    `/media/${retryReview.scope.mediaId}/movie-editions/directors_cut/rollback/retry`,
  );
  expect(retry.body).toMatchObject({
    ...retryReview.command,
    confirmResumeAdmittedRollback: true,
  });
  expect(retry.body).not.toHaveProperty("confirmRestorePredecessor");
  review.command.expected.targetVersion++;
  expect(request.body.expected.targetVersion).toBe(11);
});

it.each(["request", "retry"] as const)(
  "retries a lost %s response with the original actor, URL, body and key after a genuine background read changes CAS",
  async (state) => {
    const fixture = signIn();
    const review = rollbackReview(state);
    const original = movieRollbackSubmissionV1(
      owner.id,
      review,
      confirmation(),
    );
    const sent: { url: string; key: string | null; body: unknown }[] = [];
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      if (init.method === undefined)
        return Promise.resolve(Response.json(review));
      sent.push({
        url,
        key: new Headers(init.headers).get("Idempotency-Key"),
        body: JSON.parse(z.string().parse(init.body)),
      });
      return sent.length === 1
        ? Promise.reject(new TypeError("Response lost after commit"))
        : Promise.resolve(Response.json(accepted(original)));
    });
    await expect(writeMovieRollbackV1(original)).rejects.toThrow(
      "Response lost after commit",
    );
    expect(fixture.stored.size).toBe(1);
    review.command.expected.targetVersion++;
    const current = await readMovieRollbackV1(review.scope);
    if (current.state !== "request" && current.state !== "retry")
      throw new Error("Current public CAS required");
    expect(
      movieRollbackSubmissionV1(owner.id, current, confirmation()).body.expected
        .targetVersion,
    ).toBe(12);
    await writeMovieRollbackV1(original);
    expect(original.actorId).toBe(owner.id);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[0]?.url).toBe(`/api/v4${original.path}`);
    expect(sent[0]?.body).toMatchObject({ expected: { targetVersion: 11 } });
    expect(fixture.stored.size).toBe(0);
  },
);

it("rejects another edition's readable review and accepted response instead of borrowing its authority", async () => {
  const fixture = signIn();
  const review = rollbackReview("request");
  const otherScope = { ...review.scope, edition: "theatrical_cut" as const };
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      Response.json({
        ...review,
        scope: otherScope,
        command: { ...review.command, scope: otherScope },
      }),
    ),
  );
  await expect(readMovieRollbackV1(review.scope)).rejects.toThrow(
    "another movie edition",
  );
  const input = movieRollbackSubmissionV1(owner.id, review, confirmation());
  vi.stubGlobal("fetch", () =>
    Promise.resolve(Response.json({ ...accepted(input), scope: otherScope })),
  );
  await expect(writeMovieRollbackV1(input)).rejects.toThrow(
    "another reviewed edition",
  );
  expect(fixture.stored.size).toBe(1);
});

it.each(["logout", "switch_actor"] as const)(
  "a %s cannot resubmit the prior owner's unresolved rollback",
  async (termination) => {
    signIn();
    const input = movieRollbackSubmissionV1(
      owner.id,
      rollbackReview("request"),
      confirmation(),
    );
    const fetcher = vi.fn(() =>
      Promise.reject(new TypeError("Unknown response")),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(writeMovieRollbackV1(input)).rejects.toThrow(
      "Unknown response",
    );
    sessionBoundary.publish(
      termination === "logout" ? null : member,
      sessionBoundary.getSnapshot().generation,
      termination === "logout" ? "logout" : "login",
    );
    await expect(writeMovieRollbackV1(input)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
