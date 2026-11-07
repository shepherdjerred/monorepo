import { afterEach, expect, test, vi } from "vitest";
import type {
  AcquisitionAttempt,
  MovieEditionChoice,
  Operation,
} from "#generated/prisma/client.ts";
import { createDatabase } from "#infrastructure/database.ts";
import { assertSponsorAuthority } from "#infrastructure/acquisition-identity/sponsor.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  movieAttemptQueriedInTransactionV4,
  readMovieAttemptSponsor,
} from "./attempt-sponsor.ts";

const scope = {
  mediaId: "8aa6f467-61d9-4ff4-a272-a4278d39626a",
  rootMediaId: "8aa6f467-61d9-4ff4-a272-a4278d39626a",
  edition: "directors_cut",
} as const;
const actorId = "fc5e31e3-e92e-4f47-80a7-caf5346e554b";
const requestId = "7163864f-fea4-44f5-b53e-c13867233065";
const choiceId = "19970aa6-d5bf-4f39-963a-1407ee5cd3db";
const attemptId = "d3ff577c-33bb-48c2-9990-03a2b2371be3";
const operationId = "3bde187a-304e-4bc3-9f17-46d5f32ea8e1";
const attempt: AcquisitionAttempt = {
  id: attemptId,
  edition: scope.edition,
  releaseId: "586c3425-3e47-44f9-b3a4-93caf4862488",
  sponsorRequestId: requestId,
  mediaIds: [scope.mediaId],
  generations: { [scope.mediaId]: 0 },
  state: "imported",
  torrentId: null,
  operationId,
  coordinatorOperationId: operationId,
  failure: null,
  filePlan: null,
  identityEvidence: null,
  movieEditionChoiceId: choiceId,
  movieEditionChoiceRevision: 1,
  movieEditionAuthority: {
    schemaVersion: 1,
    choiceId,
    choiceRevision: 1,
    sponsorRequestId: requestId,
    requestVersionAtCapture: 0,
    ...scope,
    definitionVersion: 0,
    definitionDigest: "a".repeat(64),
    targetGenerationAtCapture: 0,
    actorId,
    subjectUserId: actorId,
  },
  recoveryEpoch: 0,
  createdAt: new Date("2020-01-02T00:00:00Z"),
  updatedAt: new Date("2020-01-02T00:00:00Z"),
};
const choice: MovieEditionChoice = {
  id: choiceId,
  requestId,
  choiceRevision: 1,
  actorId,
  subjectUserId: actorId,
  rootMediaId: scope.rootMediaId,
  edition: scope.edition,
  definitionVersion: 0,
  registryVersion: 1,
  requestVersionAtChoice: 0,
  authority: {
    schemaVersion: 1,
    mode: "self",
    actorVersion: 0,
    subjectVersion: 0,
    mappingVersion: 0,
    serverMachineId: "synthetic-server",
    homeUserId: null,
    serverAccountId: null,
  },
  createdAt: new Date("2020-01-01T00:00:00Z"),
};
const command: Operation = {
  id: operationId,
  idempotencyKey: "synthetic-original-operation",
  userId: actorId,
  kind: "reconcile_movie_edition_v4",
  targetId: scope.mediaId,
  payload: {},
  status: "queued",
  result: null,
  createdAt: new Date("2020-01-01T00:00:00Z"),
  updatedAt: new Date("2020-01-01T00:00:00Z"),
};
const databases: ReturnType<typeof createDatabase>[] = [];
function database() {
  // Generated Prisma delegates are mocked below. This client never opens a
  // connection and no unit fixture confers persisted effect authority.
  const db = createDatabase("postgresql://media@127.0.0.1:1/postgres");
  databases.push(db);
  return db;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) await db.$disconnect();
});

test("queried attempts require the exact transaction object and attempt ID", () => {
  const tx = {};
  const queried = { tx, attempt };
  expect(movieAttemptQueriedInTransactionV4(tx, attempt.id, queried)).toBe(
    attempt,
  );
  expect(movieAttemptQueriedInTransactionV4(tx, attempt.id)).toBeUndefined();
  expect(() =>
    movieAttemptQueriedInTransactionV4({}, attempt.id, queried),
  ).toThrow("transaction or identity");
  expect(() =>
    movieAttemptQueriedInTransactionV4(tx, "another-attempt", queried),
  ).toThrow("transaction or identity");
});

test.each([false, true])(
  "recorded sponsor still validates its choice while queried AA reuse is %s",
  async (reuse) => {
    const db = database();
    const attemptRead = vi
      .spyOn(db.acquisitionAttempt, "findUniqueOrThrow")
      .mockResolvedValue(attempt);
    const choiceRead = vi
      .spyOn(db.movieEditionChoice, "findUniqueOrThrow")
      .mockResolvedValue(choice);
    const budget = new PublicationAuthorityReadBudget();
    expect(
      await readMovieAttemptSponsor(db, {
        attemptId,
        expectedScope: scope,
        expectedRequestId: requestId,
        budget,
        ...(reuse ? { queriedAttempt: { tx: db, attempt } } : {}),
      }),
    ).toEqual({
      userId: actorId,
      actorId,
      serverMachineId: "synthetic-server",
    });
    expect(attemptRead).toHaveBeenCalledTimes(reuse ? 0 : 1);
    expect(choiceRead).toHaveBeenCalledTimes(1);
    expect(budget.take).toBe(reuse ? 100 : 99);
  },
);

test("reusing an AA cannot substitute a different sponsor", async () => {
  const db = database();
  const attemptRead = vi.spyOn(db.acquisitionAttempt, "findUniqueOrThrow");
  const choiceRead = vi.spyOn(db.movieEditionChoice, "findUniqueOrThrow");
  await expect(
    readMovieAttemptSponsor(db, {
      attemptId,
      expectedRequestId: "a-different-sponsor",
      queriedAttempt: { tx: db, attempt },
    }),
  ).rejects.toThrow("another request");
  expect(attemptRead).not.toHaveBeenCalled();
  expect(choiceRead).not.toHaveBeenCalled();
});

test("queried birth rows cannot substitute another movie scope", async () => {
  const db = database();
  const choiceRead = vi.spyOn(db.movieEditionChoice, "findUniqueOrThrow");
  const mediaId = "e62ccbbf-0910-401c-8768-d859a38f3bc4";
  await expect(
    readMovieAttemptSponsor(db, {
      attemptId,
      expectedScope: { ...scope, rootMediaId: mediaId, mediaId },
      queriedAttempt: { tx: db, attempt, choice },
    }),
  ).rejects.toThrow("another edition scope");
  expect(choiceRead).not.toHaveBeenCalled();
});

test("the same transaction can reuse the already validated historical birth choice without changing attribution", async () => {
  const db = database();
  const attemptRead = vi.spyOn(db.acquisitionAttempt, "findUniqueOrThrow");
  const choiceRead = vi.spyOn(db.movieEditionChoice, "findUniqueOrThrow");
  const budget = new PublicationAuthorityReadBudget();
  expect(
    await readMovieAttemptSponsor(db, {
      attemptId,
      expectedScope: scope,
      expectedRequestId: requestId,
      budget,
      queriedAttempt: { tx: db, attempt, choice },
    }),
  ).toEqual({ userId: actorId, actorId, serverMachineId: "synthetic-server" });
  expect(attemptRead).not.toHaveBeenCalled();
  expect(choiceRead).not.toHaveBeenCalled();
  expect(budget.take).toBe(101);
});

test("historical choice reuse rejects an unrelated choice ID", async () => {
  const db = database();
  const choiceRead = vi.spyOn(db.movieEditionChoice, "findUniqueOrThrow");
  await expect(
    readMovieAttemptSponsor(db, {
      attemptId,
      queriedAttempt: {
        tx: db,
        attempt,
        choice: { ...choice, id: "a-different-choice" },
      },
    }),
  ).rejects.toThrow("birth choice changed its exact identity");
  expect(choiceRead).not.toHaveBeenCalled();
});

test.each(["absent", "same", "different"] as const)(
  "sponsor coordinator %s retains its exact actual query path",
  async (mode) => {
    const db = database();
    const id =
      mode === "different"
        ? "73c4ca68-a878-4781-8989-73005e92bfb9"
        : operationId;
    const operationRead = vi
      .spyOn(db.operation, "findUnique")
      .mockResolvedValue({ ...command, id });
    vi.spyOn(db, "$queryRaw").mockResolvedValue([]);
    const stop = new Error(
      "Stop before current sponsor authority; no positive permission fixture",
    );
    vi.spyOn(db.mediaRequest, "findFirst").mockRejectedValue(stop);
    const budget = new PublicationAuthorityReadBudget();
    await expect(
      assertSponsorAuthority(db, {
        authority: {
          userId: actorId,
          actorId,
          serverMachineId: "synthetic-server",
        },
        sponsorRequestId: requestId,
        operationId: id,
        mediaIds: [scope.mediaId],
        recordedAttemptId: attemptId,
        movieScope: scope,
        budget,
        ...(mode === "absent"
          ? {}
          : { queriedAttempt: { tx: db, attempt, command } }),
      }),
    ).rejects.toBe(stop);
    expect(operationRead).toHaveBeenCalledTimes(mode === "same" ? 0 : 1);
    if (mode !== "same")
      expect(operationRead).toHaveBeenCalledWith({ where: { id } });
    expect(budget.take).toBe(mode === "same" ? 101 : 100);
  },
);
