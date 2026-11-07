import { afterEach, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import { queueOperation } from "#automation/store.ts";
import { createRetentionActivities } from "#automation/retention.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { evaluateMovieRetentionV4 } from "#automation/movie-editions/retention/evaluate.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createMovieHistoryFixture } from "#testing/movie-workflow/history/history-review-fixture.ts";
import { createMovieHistoryHttpFixture } from "#testing/movie-workflow/history/history-http-fixture.ts";
import { enableMovieFixtureEmail } from "#testing/movie-workflow/personal-email.ts";
import { movieWorkflowWire } from "#testing/movie-workflow/wire.ts";
import { MovieHistoryDetailV3Schema } from "#shared/movie-editions/history-review-v3.ts";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});
const checksum = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

test("an old default command captured before genuine scoped release becomes obsolete without reopening its hold", async () => {
  const bytes = await movieVideoFixture();
  const f = await createMovieHistoryFixture("default", bytes);
  closers.push(f.close);
  const target = await f.db.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: f.scope.mediaId, edition: "default" },
    },
  });
  const operationId = await f.db.$transaction((tx) =>
    queueOperation(tx, {
      key: `historical-default-boundary:${crypto.randomUUID()}`,
      kind: "retain_media",
      targetId: f.scope.mediaId,
      payload: { mediaId: f.scope.mediaId, generation: target.generation },
    }),
  );
  const review = await f.prepare();
  const subject = review.detail.scope.users.find(
    (person) => person.id === f.owner.id,
  );
  if (subject === undefined)
    throw new Error("Actual applicable library owner missing");
  await f.service.respond(f.owner, crypto.randomUUID(), review.detail.id, {
    schemaVersion: 3,
    scope: f.scope,
    scopeHash: review.detail.scopeHash,
    subjectUserId: f.owner.id,
    definition: review.detail.scope.definition,
    registryVersion: 1,
    declaration: { intent: "no_longer_request" },
    claimAcknowledgements: subject.claimAcknowledgements,
    acknowledgeMissingHistory: true,
  });
  await f.declareRemaining(review.detail.id);
  const ready = MovieHistoryDetailV3Schema.parse(
    await f.service.detail(f.owner, review.detail.id),
  );
  const released = await f.service.release(
    f.owner,
    crypto.randomUUID(),
    ready.id,
    {
      schemaVersion: 3,
      scope: f.scope,
      expectedVersion: ready.version,
      scopeHash: ready.scopeHash,
      responseHash: ready.responseHash,
      confirmHouseholdBaseline: true,
      confirmExistingPins: true,
      acknowledgeMissingHistory: true,
    },
  );
  const hold = await f.db.recoveryHold.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: f.scope.mediaId, edition: "default" },
    },
  });
  const receipt = await f.db.recoveryReleaseReceipt.findUniqueOrThrow({
    where: { id: z.uuid().parse(released.recoveryReceiptId) },
  });
  const old = await f.db.operation.findUniqueOrThrow({
    where: { id: operationId },
  });
  const budget = new PublicationAuthorityReadBudget();
  const execution = testPlexBindingExecution();
  const network = createRetentionActivities({
    ...f.original.context,
    movieManagement: { budget, execution },
  });
  expect(
    await network.evaluateMediaRetention({
      operationId,
      mediaId: f.scope.mediaId,
      generation: target.generation,
    }),
  ).toEqual({
    status: "obsolete",
    reason: "intent_obsolete",
    decisionId: null,
    wakeAt: null,
  });
  expect(
    await f.db.recoveryHold.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: f.scope.mediaId, edition: "default" },
      },
    }),
  ).toEqual(hold);
  expect(
    await f.db.recoveryReleaseReceipt.findUniqueOrThrow({
      where: { id: receipt.id },
    }),
  ).toEqual(receipt);
  expect(
    await f.db.operation.findUniqueOrThrow({ where: { id: operationId } }),
  ).toEqual(old);
  expect(checksum(await readFile(f.original.target))).toBe(checksum(bytes));
  expect(
    await f.db.applicationEvent.count({
      where: {
        mediaId: f.scope.mediaId,
        kind: "recovery_legacy_claim_protected",
      },
    }),
  ).toBe(0);
}, 60_000);

test("old default Files quarantine rejects an actual scoped warning before creating a manifest or changing the released hold", async () => {
  const bytes = await movieVideoFixture();
  const f = await createMovieHistoryHttpFixture("default", bytes);
  closers.push(f.close);
  const part = f.original.item().Media?.[0]?.Part[0];
  if (part === undefined) throw new Error("Actual adopted Part missing");
  const wire = movieWorkflowWire(f.db, {
    mediaId: f.scope.mediaId,
    edition: "default",
    downloads: f.original.files.roots.movies.downloads,
    bytes,
    ratingKey: f.original.item().ratingKey,
    partId: part.id,
    playback: { viewCount: 3, lastViewedAt: 1_234_567, viewOffset: 456_000 },
  });
  const email = await enableMovieFixtureEmail(
    { ...f.original.context, plex: wire.plex, userPlex: wire.userPlex },
    f.member,
  );
  closers.unshift(email.close);
  const execution = testPlexBindingExecution();
  const budget = new PublicationAuthorityReadBudget();
  const warning = await evaluateMovieRetentionV4(
    {
      ...email.context,
      now: () => new Date(Date.now() + 8 * 86_400_000),
      movieManagement: { execution, budget },
    },
    f.input,
    execution,
  );
  expect(warning.status).toBe("warning");
  const decisionId = z.uuid().parse(warning.decisionId);
  const before = await f.db.retentionDecision.findUniqueOrThrow({
    where: { id: decisionId },
  });
  expect(before.manifest).toBeNull();
  const hold = await f.db.recoveryHold.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: f.scope.mediaId, edition: "default" },
    },
  });
  const receipt = await f.db.recoveryReleaseReceipt.findUniqueOrThrow({
    where: { reviewId: f.detail.id },
  });
  const physical = testPublicationExecution();
  const spent = new PublicationAuthorityReadBudget();
  spent.consume(99);
  const refused = await createMediaFileActivities({
    ...f.original.files,
    publicationExecution: () => physical,
    movieManagement: { execution: physical, budget: spent },
  }).quarantineMediaFiles({ operationId: f.input.operationId, decisionId });
  expect(refused).toEqual({
    status: "protected",
    reason: "archive_transition_reconciliation_required",
  });
  expect(() => spent.consume(0)).toThrow();
  expect(
    await f.db.retentionDecision.findUniqueOrThrow({
      where: { id: decisionId },
    }),
  ).toEqual(before);
  const physicalBudget = new PublicationAuthorityReadBudget();
  expect(
    await createMediaFileActivities({
      ...f.original.files,
      publicationExecution: () => physical,
      movieManagement: { execution: physical, budget: physicalBudget },
    }).quarantineMediaFiles({ operationId: f.input.operationId, decisionId }),
  ).toEqual({
    status: "protected",
    reason: "movie_scope_requires_v4_retention",
  });
  expect(
    await f.db.retentionDecision.findUniqueOrThrow({
      where: { id: decisionId },
    }),
  ).toEqual(before);
  expect(
    await f.db.recoveryHold.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: f.scope.mediaId, edition: "default" },
      },
    }),
  ).toEqual(hold);
  expect(
    await f.db.recoveryReleaseReceipt.findUniqueOrThrow({
      where: { id: receipt.id },
    }),
  ).toEqual(receipt);
  expect(checksum(await readFile(f.original.target))).toBe(checksum(bytes));
  expect(wire.additions()).toBe(0);
}, 60_000);
