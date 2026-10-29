import { afterEach, beforeAll, expect, test } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { createRestoredMovieFixture } from "#testing/movie-workflow/restore-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  MovieEditionKeySchema,
  movieEditionDisplayLabel,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";
import { MovieRestorationNoticeV4Schema } from "#shared/movie-editions/notifications-v4.ts";
import { MovieRestorePlexReceiptEnvelopeV1Schema } from "#shared/movie-editions/restore-plex-v1.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { createNotificationActivities } from "#automation/notifications.ts";
import { warningHistory } from "#automation/retention/fixtures/elapsed.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { currentMovieSubtitleWorkV4 } from "#automation/movie-editions/subtitles/authority.ts";
import { MovieSubtitleOperationV4Schema } from "#shared/movie-editions/subtitles-v4.ts";
import { publishRestoredMovieToPlexV4 } from "./restore-plex.ts";
import { finalizeMovieRestorationV4 } from "./restore-finalization.ts";

const closers: (() => Promise<void>)[] = [];
let bytes: Uint8Array;
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});
type Fixture = Awaited<ReturnType<typeof createRestoredMovieFixture>>;

function invocation(f: Fixture) {
  const execution = testPlexBindingExecution();
  const budget = new PublicationAuthorityReadBudget();
  return {
    execution,
    budget,
    context: {
      ...f.context,
      plexBindingExecution: () => execution,
      movieManagement: { execution, budget },
    },
  };
}

async function ready(
  edition: MovieEditionKey,
  options: { subtitleLanguages?: string[] } = {},
) {
  const f = await createRestoredMovieFixture(edition, bytes, options);
  closers.push(f.close);
  const call = invocation(f);
  expect(
    await publishRestoredMovieToPlexV4(call.context, f.input, call.execution),
  ).toEqual({ status: "available", reason: null });
  expect(() => call.budget.consume(0)).not.toThrow();
  return f;
}

async function finalize(f: Fixture) {
  const call = invocation(f);
  await finalizeMovieRestorationV4(call.context, f.input, call.execution);
  expect(() => call.budget.consume(0)).not.toThrow();
}

async function notices(f: Fixture) {
  return f.db.applicationEvent.findMany({
    where: {
      mediaId: f.scope.mediaId,
      kind: "media_available",
      payload: { path: ["kind"], equals: "movie_restoration" },
    },
    include: { notifications: { orderBy: { id: "asc" } } },
    orderBy: { id: "asc" },
  });
}

async function finalizedEvents(f: Fixture) {
  return f.db.applicationEvent.findMany({
    where: { mediaId: f.scope.mediaId, kind: "movie_restoration_finalized_v4" },
    orderBy: { id: "asc" },
  });
}

async function immutableState(f: Fixture) {
  const asset = await f.db.libraryAsset.findUniqueOrThrow({
    where: { id: f.asset.id },
    include: { subtitles: { orderBy: { id: "asc" } } },
  });
  const installed = asset.subtitles.filter(
    (subtitle) =>
      subtitle.state === "installed" && subtitle.storageKind === "sidecar",
  );
  expect(installed.map((subtitle) => subtitle.language).sort()).toEqual([
    "en",
    "zh-Hans",
  ]);
  const names = await readdir(
    path.join(f.source.files.roots.movies.control, "journal"),
  );
  const journals = names
    .filter(
      (name) =>
        name.startsWith(`${f.retentionInput.operationId}-quarantine-`) ||
        name.startsWith(`${f.input.operationId}-restore-`),
    )
    .sort();
  expect(journals).toHaveLength(6);
  return {
    asset,
    files: await Promise.all(
      [
        asset.path,
        ...installed.map((subtitle) => {
          if (subtitle.path === null)
            throw new Error("Actual restored caption omitted its path");
          return subtitle.path;
        }),
      ].map((file) => readFile(workerFilePath(f.source.files.context, file))),
    ),
    journals: await Promise.all(
      journals.map((name) =>
        readFile(
          path.join(f.source.files.roots.movies.control, "journal", name),
          "utf8",
        ),
      ),
    ),
    restore: await f.db.operation.findUniqueOrThrow({
      where: { id: f.input.operationId },
    }),
    quarantine: await f.db.operation.findUniqueOrThrow({
      where: { id: f.retentionInput.operationId },
    }),
    publication: await f.db.operation.findUniqueOrThrow({
      where: { id: f.publicationOperationId },
    }),
    history: await warningHistory(f.db, f.decisionId),
    captions: await f.db.operation.findMany({
      where: { kind: "acquire_movie_subtitles_v4", targetId: f.asset.id },
      orderBy: { id: "asc" },
    }),
    attempts: await f.db.acquisitionAttempt.findMany({
      where: { mediaIds: { has: f.scope.mediaId } },
      orderBy: { id: "asc" },
    }),
    torrents: await f.db.torrent.findMany({ orderBy: { id: "asc" } }),
    seeding: await f.db.operation.findMany({
      where: { kind: "maintain_torrent" },
      orderBy: { id: "asc" },
    }),
  };
}

async function notificationInput(f: Fixture, notificationId: string) {
  const command = await f.db.operation.findFirstOrThrow({
    where: { kind: "deliver_notification", targetId: notificationId },
  });
  return { operationId: command.id, notificationId };
}

test.each(MovieEditionKeySchema.options)(
  "%s finalizes its actual restored publication and delivers one edition-scoped personal email",
  async (edition) => {
    const f = await ready(edition);
    const before = await immutableState(f);
    const sentBefore = f.sent.length;
    expect(await notices(f)).toEqual([]);
    await finalize(f);
    expect(f.sent).toHaveLength(sentBefore);
    const events = await notices(f);
    expect(events).toHaveLength(1);
    const event = events[0];
    if (event === undefined)
      throw new Error("Actual finalizer omitted its restoration notice");
    expect(event.notifications).toHaveLength(1);
    const delivery = event.notifications[0];
    if (delivery === undefined)
      throw new Error(
        "Actual restoration notice omitted its personal delivery",
      );
    const source = MovieRestorePlexReceiptEnvelopeV1Schema.parse(
      z
        .object({ movieRestorePlexReceiptV1: z.unknown() })
        .parse(before.restore.result).movieRestorePlexReceiptV1,
    );
    expect(MovieRestorationNoticeV4Schema.parse(event.payload)).toMatchObject({
      schemaVersion: 4,
      kind: "movie_restoration",
      eventKind: "media_available",
      source: f.input,
      publicationHash: identityHash(source.receipt),
      generation: f.input.generation,
      asset: {
        id: f.asset.id,
        version: before.asset.version,
        checksum: before.asset.checksum,
      },
    });
    expect(delivery).toMatchObject({
      userId: f.source.user.id,
      channel: "email",
      state: "pending",
    });
    expect(await finalizedEvents(f)).toHaveLength(1);
    const input = await notificationInput(f, delivery.id);
    expect(
      await createNotificationActivities(f.context).deliverMediaNotification(
        input,
      ),
    ).toEqual({ status: "accepted", reason: null });
    expect(f.sent).toHaveLength(sentBefore + 1);
    const email = f.sent.at(-1);
    expect(email).toMatchObject({
      channel: "email",
      recipient: `${f.source.user.id}@retention.fixture`,
    });
    expect(email?.subject).toContain(movieEditionDisplayLabel(edition));
    expect(email?.text).toContain(
      `${movieEditionDisplayLabel(edition)}) is available in Plex`,
    );
    const link = email?.text.split("\n").at(-1);
    if (link === undefined)
      throw new Error("Actual restoration email omitted its detail link");
    expect(new URL(link).pathname).toBe(`/media/${f.scope.mediaId}`);
    const page = await fetch(link);
    expect(page.status).toBe(200);
    const accepted = await f.db.notificationDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
      include: { deliveryAttempts: true },
    });
    expect(accepted).toMatchObject({
      state: "accepted",
      attempts: 1,
      deliveryAttempts: [{ state: "accepted" }],
    });
    const acknowledgement = invocation(f);
    let configurationReads = 0;
    const changed = {
      ...acknowledgement.context,
      permittedSections: () => {
        configurationReads++;
        return Promise.resolve({ movie: "2", series: "2" });
      },
      gates: {
        ...acknowledgement.context.gates,
        acquisition: () => Promise.resolve(false),
      },
    };
    await finalizeMovieRestorationV4(
      changed,
      f.input,
      acknowledgement.execution,
    );
    expect(configurationReads).toBe(0);
    expect(
      await createNotificationActivities(changed).deliverMediaNotification(
        input,
      ),
    ).toEqual({ status: "accepted", reason: null });
    expect(configurationReads).toBe(0);
    expect(f.sent).toHaveLength(sentBefore + 1);
    const acknowledged = await notices(f);
    expect(
      acknowledged.map((row) => ({
        id: row.id,
        deliveryIds: row.notifications.map((notice) => notice.id),
      })),
    ).toEqual([{ id: event.id, deliveryIds: [delivery.id] }]);
    expect(await finalizedEvents(f)).toHaveLength(1);
    expect(await immutableState(f)).toEqual(before);
  },
  60_000,
);

test.each(["cancel", "generation", "section"] as const)(
  "a real %s after the restoration email claim prevents its stale send",
  async (change) => {
    const f = await ready("directors_cut");
    await finalize(f);
    const before = await immutableState(f);
    const sentBefore = f.sent.length;
    const events = await notices(f);
    const event = events[0];
    const delivery = event?.notifications[0];
    if (delivery === undefined)
      throw new Error("Actual restoration notice missing");
    let claimed = false;
    const result = await createNotificationActivities({
      ...f.context,
      permittedSections: () => f.context.permittedSections(),
      checkpoint: async () => {
        claimed = true;
        if (change === "generation")
          await requestTestMovieV4(
            f.db,
            f.source.user,
            f.scope.mediaId,
            f.scope.edition,
          );
        if (change === "section")
          f.context.permittedSections = () =>
            Promise.resolve({ movie: "2", series: "2" });
        if (change === "cancel") {
          const request = await f.db.mediaRequest.findUniqueOrThrow({
            where: {
              userId_mediaId_edition: {
                userId: f.source.user.id,
                mediaId: f.scope.mediaId,
                edition: f.scope.edition,
              },
            },
          });
          const target = await f.db.mediaIntent.findUniqueOrThrow({
            where: {
              mediaId_edition: {
                mediaId: f.scope.mediaId,
                edition: f.scope.edition,
              },
            },
          });
          await f.restoreRequest.commands.cancelMovieEditionRequest(
            f.source.user,
            crypto.randomUUID(),
            {
              schemaVersion: 3,
              action: "cancel_request",
              scope: f.scope,
              subjectUserId: f.source.user.id,
              requestId: request.id,
              expected: {
                targetVersion: target.version,
                requestVersion: request.version,
                choiceRevision: request.movieEditionChoiceRevision,
              },
            },
          );
        }
      },
    }).deliverMediaNotification(await notificationInput(f, delivery.id));
    expect(claimed).toBe(true);
    expect(result).toEqual({
      status: "failed",
      reason: "authority_changed_before_send",
    });
    expect(f.sent).toHaveLength(sentBefore);
    expect(
      await f.db.notificationDelivery.findUniqueOrThrow({
        where: { id: delivery.id },
        include: { deliveryAttempts: true },
      }),
    ).toMatchObject({
      state: "failed",
      providerReceipt: null,
      acceptedAt: null,
      deliveryAttempts: [{ state: "rejected", providerReceipt: null }],
    });
    expect(await immutableState(f)).toEqual(before);
  },
  60_000,
);

test("restoration finalization preserves the exhausted original allowance without queuing captions or personal notices", async () => {
  const f = await ready("extended_cut");
  const before = await immutableState(f);
  const sentBefore = f.sent.length;
  const call = invocation(f);
  call.budget.consume(99);
  await expect(
    finalizeMovieRestorationV4(call.context, f.input, call.execution),
  ).rejects.toMatchObject({
    code: "archive_transition_reconciliation_required",
  });
  expect(() => call.budget.consume(0)).toThrow("100 total queried records");
  expect(await notices(f)).toEqual([]);
  expect(await finalizedEvents(f)).toEqual([]);
  expect(f.sent).toHaveLength(sentBefore);
  expect(await immutableState(f)).toEqual(before);
}, 60_000);

test("an actual requester-selected missing language queues only its restored-version caption work", async () => {
  const f = await ready("directors_cut", {
    subtitleLanguages: ["en", "zh-Hans", "fr"],
  });
  const request = await f.db.mediaRequest.findUniqueOrThrow({
    where: {
      userId_mediaId_edition: {
        userId: f.source.user.id,
        mediaId: f.scope.mediaId,
        edition: f.scope.edition,
      },
    },
  });
  expect(request.subtitleLanguages).toEqual(["en", "zh-Hans", "fr"]);
  const before = await immutableState(f);
  await finalize(f);
  const after = await immutableState(f);
  const queued = after.captions.filter(
    (command) =>
      !before.captions.some((original) => original.id === command.id),
  );
  expect(queued).toHaveLength(1);
  const command = queued[0];
  if (command === undefined)
    throw new Error("Actual finalizer omitted missing-language caption work");
  const payload = MovieSubtitleOperationV4Schema.parse(
    z.object(MovieSubtitleOperationV4Schema.shape).parse(command.payload),
  );
  expect(payload).toMatchObject({
    schemaVersion: 4,
    operationId: command.id,
    scope: f.scope,
    assetId: f.asset.id,
    language: "fr",
  });
  const budget = new PublicationAuthorityReadBudget();
  const work = await currentMovieSubtitleWorkV4(
    f.db,
    {
      scope: f.scope,
      assetId: f.asset.id,
      epoch: after.asset.ownershipEpoch,
      access: { serverMachineId: "fixture-server", movieSectionId: "1" },
    },
    budget,
  );
  expect(payload.targetAuthority).toBe(work.authority);
  expect(work.asset.version).toBe(f.asset.version + 2);
  expect(after.captions.filter((row) => row.id !== command.id)).toEqual(
    before.captions,
  );
  const { captions: _beforeCaptions, ...originalParents } = before;
  const { captions: _afterCaptions, ...currentParents } = after;
  expect(currentParents).toEqual(originalParents);
  expect(await notices(f)).toHaveLength(1);
  await finalize(f);
  expect(await immutableState(f)).toEqual(after);
}, 60_000);
