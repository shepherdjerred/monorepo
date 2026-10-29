import { afterEach, beforeAll, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { movieVideoFixture } from "#testing/movie-video.ts";
import {
  createMovieRetentionFixture,
  createAdoptedMovieRetentionFixture,
} from "#testing/movie-workflow/retention-fixture.ts";
import {
  MovieEditionKeySchema,
  movieEditionDisplayLabel,
} from "#shared/movie-editions/registry.ts";
import { MovieRetentionWarningV4Schema } from "#shared/movie-editions/retention-v4.ts";
import {
  warningHistory,
  assertWarningHistory,
} from "#automation/retention/fixtures/elapsed.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { evaluateMovieRetentionV4 } from "./evaluate.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { createNotificationActivities } from "#automation/notifications.ts";
import { observeRequesterWatch } from "#automation/watch.ts";
import {
  currentCuts,
  cutCanonical,
} from "#infrastructure/editions/cut-context.ts";

const closers: (() => Promise<void>)[] = [];
let bytes: Uint8Array;
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

test.each(MovieEditionKeySchema.options)(
  "%s retention uses its actual watched publication and accepted warning without rewriting their history",
  async (edition) => {
    const f = await createMovieRetentionFixture(edition, bytes);
    closers.push(f.close);
    const publication = await f.db.operation.findUniqueOrThrow({
      where: { id: f.publicationOperationId },
    });
    const binding = await f.db.plexBindingCurrent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.scope.mediaId, edition } },
    });
    const warning = await f.warning();
    expect(warning).toMatchObject({ status: "warning" });
    if (warning.decisionId === null)
      throw new Error("Actual warning producer omitted its decision");
    const delivery = await f.deliverWarning();
    expect(
      MovieRetentionWarningV4Schema.parse(delivery.event.payload),
    ).toMatchObject({
      scope: f.scope,
      decisionId: warning.decisionId,
      generation: f.input.generation,
    });
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]?.text).toContain(movieEditionDisplayLabel(edition));
    const link = f.sent[0]?.text.split("\n").at(-1);
    if (link === undefined)
      throw new Error("Actual warning omitted its detail link");
    const page = await fetch(link);
    expect(page.status).toBe(200);
    const history = await warningHistory(f.db, warning.decisionId);
    const publishedAt = f.asset.plexPublishedAt;
    if (publishedAt === null)
      throw new Error("Actual publication timestamp missing");
    for (const event of history.events)
      expect(event.createdAt.getTime()).toBeGreaterThanOrEqual(
        publishedAt.getTime(),
      );
    for (const accepted of history.deliveries) {
      if (accepted.acceptedAt === null)
        throw new Error("Actual warning acceptance missing");
      expect(accepted.acceptedAt.getTime()).toBeGreaterThanOrEqual(
        publishedAt.getTime(),
      );
      expect(accepted.acceptedAt.getTime()).toBeLessThanOrEqual(Date.now());
    }
    expect(await f.evaluate()).toMatchObject({
      status: "quarantine",
      decisionId: warning.decisionId,
    });
    await assertWarningHistory(f.db, warning.decisionId, history);
    expect(
      await f.db.plexBindingCurrent.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: f.scope.mediaId, edition } },
      }),
    ).toEqual(binding);
    expect(
      await f.db.operation.findUniqueOrThrow({
        where: { id: f.publicationOperationId },
      }),
    ).toEqual(publication);
    expect(
      createHash("sha256")
        .update(
          await readFile(workerFilePath(f.source.files.context, f.asset.path)),
        )
        .digest("hex"),
    ).toBe(createHash("sha256").update(bytes).digest("hex"));
  },
  60_000,
);

test("a fresh actual warning retains all seven days of grace", async () => {
  const f = await createMovieRetentionFixture("final_cut", bytes, false);
  closers.push(f.close);
  const warning = await f.warning();
  expect(warning.status).toBe("warning");
  const delivery = await f.deliverWarning();
  const result = await f.evaluate();
  expect(result).toMatchObject({
    status: "grace",
    decisionId: warning.decisionId,
  });
  const accepted = await f.db.notificationDelivery.findUniqueOrThrow({
    where: { id: delivery.id },
  });
  if (accepted.acceptedAt === null || result.wakeAt === null)
    throw new Error("Actual accepted warning lost its grace deadline");
  expect(Date.parse(result.wakeAt) - accepted.acceptedAt.getTime()).toBe(
    7 * 86_400_000,
  );
}, 60_000);

test("retained release provenance uses the caller's remaining allowance without counting JSON text as new parents", async () => {
  const f = await createMovieRetentionFixture("extended_cut", bytes);
  closers.push(f.close);
  const canonical = await cutCanonical(f.db, [f.scope.mediaId]);
  const completeBudget = new PublicationAuthorityReadBudget();
  completeBudget.consume(98);
  const facts = await currentCuts(f.db, canonical, {
    mediaIds: [],
    predecessorAssetIds: [f.asset.id],
    budget: completeBudget,
  });
  expect(facts.length).toBeGreaterThanOrEqual(2);
  expect(() => completeBudget.consume(0)).not.toThrow();
  expect(() => completeBudget.consume(1)).toThrow("100 total queried records");
  const budget = new PublicationAuthorityReadBudget();
  budget.consume(99);
  await expect(
    currentCuts(f.db, canonical, {
      mediaIds: [],
      predecessorAssetIds: [f.asset.id],
      budget,
    }),
  ).rejects.toThrow("100 total queried records");
  expect(() => budget.consume(0)).toThrow("100 total queried records");
  expect(
    await f.db.retentionDecision.count({ where: { mediaId: f.scope.mediaId } }),
  ).toBe(0);
}, 60_000);

test("an actual adopted cut retains its unresolved request-history hold without creating personal consent or acquisitions", async () => {
  const f = await createAdoptedMovieRetentionFixture("directors_cut", bytes);
  closers.push(f.close);
  const selected = { mediaId: f.scope.mediaId, edition: f.scope.edition };
  const holds = await f.db.recoveryHold.findMany({
    where: { ...selected, releasedAt: null },
    orderBy: { edition: "asc" },
  });
  expect(holds).toHaveLength(1);
  const asset = await f.db.libraryAsset.findUniqueOrThrow({
    where: { id: f.asset.id },
  });
  const binding = await f.db.plexBindingCurrent.findUniqueOrThrow({
    where: { mediaId_edition: selected },
  });
  expect(await f.evaluate()).toEqual({
    status: "protected",
    reason: "recovery_hold",
    decisionId: null,
    wakeAt: null,
  });
  expect(
    await f.db.recoveryHold.findMany({
      where: { ...selected, releasedAt: null },
      orderBy: { edition: "asc" },
    }),
  ).toEqual(holds);
  expect(
    await f.db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toEqual(asset);
  expect(
    await f.db.plexBindingCurrent.findUniqueOrThrow({
      where: { mediaId_edition: selected },
    }),
  ).toEqual(binding);
  expect(
    await f.db.mediaRequest.count({ where: { mediaId: f.scope.mediaId } }),
  ).toBe(0);
  expect(
    await f.db.acquisitionAttempt.count({
      where: { mediaIds: { has: f.scope.mediaId } },
    }),
  ).toBe(0);
  expect(await f.db.retentionDecision.count({ where: selected })).toBe(0);
  expect(f.wire.additions()).toBe(0);
}, 60_000);

test("another cut's actual pending request and Keep do not block or receive this warning", async () => {
  const f = await createMovieRetentionFixture("directors_cut", bytes);
  closers.push(f.close);
  const other = await requestTestMovieV4(
    f.db,
    f.source.user,
    f.scope.mediaId,
    "extended_cut",
  );
  const hold = await f.db.retentionHold.create({
    data: {
      userId: f.source.user.id,
      mediaId: f.scope.mediaId,
      edition: "extended_cut",
      isPin: true,
    },
  });
  const warning = await f.warning();
  expect(warning.status).toBe("warning");
  await f.deliverWarning();
  expect(await f.evaluate()).toMatchObject({ status: "quarantine" });
  expect(
    await f.db.retentionDecision.count({
      where: { mediaId: f.scope.mediaId, edition: "extended_cut" },
    }),
  ).toBe(0);
  expect(
    await f.db.retentionHold.findUniqueOrThrow({ where: { id: hold.id } }),
  ).toEqual(hold);
  expect(
    await f.db.mediaRequest.findUniqueOrThrow({
      where: {
        userId_mediaId_edition: {
          userId: f.source.user.id,
          mediaId: f.scope.mediaId,
          edition: other.input.scope.edition,
        },
      },
    }),
  ).toMatchObject({ active: true });
}, 60_000);

test.each(["unwatched", "pin", "session"] as const)(
  "%s protects the selected movie before warning",
  async (change) => {
    const f = await createMovieRetentionFixture("uncut_version", bytes);
    closers.push(f.close);
    if (change === "unwatched") f.source.wire.setWatched(false);
    if (change === "pin")
      await f.db.retentionHold.create({
        data: {
          userId: f.source.user.id,
          mediaId: f.scope.mediaId,
          edition: f.scope.edition,
          isPin: true,
        },
      });
    if (change === "session")
      f.source.wire.control.sessions.push({
        ratingKey: f.source.wire.ratingKey,
        type: "movie",
        title: "Synthetic active movie",
      });
    expect(await f.warning()).toMatchObject({ status: "protected" });
    expect(
      await f.db.retentionDecision.count({
        where: { mediaId: f.scope.mediaId },
      }),
    ).toBe(0);
    expect(f.sent).toHaveLength(0);
  },
  60_000,
);

test("the original caller-owned exhausted allowance cannot be replaced during retention", async () => {
  const f = await createMovieRetentionFixture("extended_cut", bytes);
  closers.push(f.close);
  const execution = testPlexBindingExecution();
  const budget = new PublicationAuthorityReadBudget();
  budget.consume(99);
  expect(
    await evaluateMovieRetentionV4(
      { ...f.context, movieManagement: { execution, budget } },
      f.input,
      execution,
    ),
  ).toEqual({
    status: "protected",
    reason: "archive_transition_reconciliation_required",
    decisionId: null,
    wakeAt: null,
  });
  expect(() => budget.consume(0)).toThrow("100 total queried records");
  expect(
    await f.db.retentionDecision.count({ where: { mediaId: f.scope.mediaId } }),
  ).toBe(0);
}, 60_000);

test("SDK expiry during the requester metadata read cannot renew retention authority", async () => {
  const f = await createMovieRetentionFixture("theatrical_cut", bytes);
  closers.push(f.close);
  const original = testPlexBindingExecution();
  let expired = false;
  const expiry = new Error("Original retention SDK expired during metadata");
  f.source.wire.control.beforeMetadata = () => {
    expired = true;
    return Promise.resolve();
  };
  const execution = {
    ...original,
    assertActive: () => {
      original.assertActive();
      if (expired) throw expiry;
    },
  };
  await expect(
    evaluateMovieRetentionV4(f.context, f.input, execution),
  ).rejects.toBe(expiry);
  expect(
    await f.db.retentionDecision.count({ where: { mediaId: f.scope.mediaId } }),
  ).toBe(0);
  expect(f.sent).toHaveLength(0);
}, 60_000);

test.each(["pin", "unwatch", "section", "section_removed"] as const)(
  "a real %s after the warning claim prevents its stale send",
  async (change) => {
    const f = await createMovieRetentionFixture("directors_cut", bytes);
    closers.push(f.close);
    expect(await f.warning()).toMatchObject({ status: "warning" });
    const delivery = await f.db.notificationDelivery.findFirstOrThrow({
      where: {
        userId: f.source.user.id,
        channel: "email",
        event: { mediaId: f.scope.mediaId, kind: "retention_warning" },
      },
    });
    const command = await f.db.operation.findFirstOrThrow({
      where: { kind: "deliver_notification", targetId: delivery.id },
    });
    const result = await createNotificationActivities({
      ...f.context,
      permittedSections: () => f.context.permittedSections(),
      checkpoint: async () => {
        if (change === "pin")
          await f.db.retentionHold.create({
            data: {
              userId: f.source.user.id,
              mediaId: f.scope.mediaId,
              edition: f.scope.edition,
              isPin: true,
            },
          });
        else if (change === "unwatch") {
          f.source.wire.setWatched(false);
          expect(
            await observeRequesterWatch(f.context, f.scope.mediaId, {
              edition: f.scope.edition,
            }),
          ).toEqual({ complete: true, reason: null });
        } else
          f.context.permittedSections = () =>
            Promise.resolve({
              movie: change === "section_removed" ? "" : "2",
              series: "2",
            });
      },
    }).deliverMediaNotification({
      operationId: command.id,
      notificationId: delivery.id,
    });
    expect(result.status).toBe("failed");
    expect(f.sent).toHaveLength(0);
    expect(
      await f.db.notificationDelivery.findUniqueOrThrow({
        where: { id: delivery.id },
      }),
    ).toMatchObject({ state: "failed" });
  },
  60_000,
);
