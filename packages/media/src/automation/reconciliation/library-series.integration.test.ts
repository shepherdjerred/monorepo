import { afterEach, beforeAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { createManagedSeriesFixture } from "#testing/series-workflow/fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import {
  expandCatalogCoverage,
  LIBRARY_SERIES_CURSOR,
} from "./library-series.ts";
import { readLibrarySeriesManagement } from "#infrastructure/acquisition-identity/library-management.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { PrismaMediaCommands } from "#infrastructure/commands.ts";
import { createCoverageActivities } from "./coverage.ts";

const h = automationTestHarness();
const directories: string[] = [];
let original: Uint8Array;
let upgrade: Uint8Array;
beforeAll(async () => {
  original = await movieVideoFixture(1280);
  upgrade = await movieVideoFixture(1920, undefined, { bitrateKbps: 160_000 });
});
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture(monitored: boolean, includeSpecials = false) {
  const f = await createManagedSeriesFixture(
    h.database(),
    (directory) => directories.push(directory),
    {
      original,
      upgrade,
      ...(monitored ? { monitorSeries: { includeSpecials } } : {}),
    },
  );
  const operation = await f.db.operation.create({
    data: {
      kind: "expand_catalog_requests",
      targetId: f.series.id,
      payload: {},
    },
  });
  const input = {
    operationId: operation.id,
    mediaId: f.series.id,
    cursor: `${LIBRARY_SERIES_CURSOR}start`,
  };
  const episode = await f.db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Later catalog episode",
      parentId: f.series.id,
      seasonNumber: 2,
      episodeNumber: 3,
      runtimeMinutes: 1,
      originalLanguage: "en",
      airDate: new Date("2020-02-03"),
    },
  });
  return { ...f, input, episode };
}

test("an explicit actual series approval projects a later episode without a personal request and retains exact policy authority", async () => {
  const f = await fixture(true);
  expect(await expandCatalogCoverage(f.context, f.input)).toEqual({
    processed: 3,
    nextCursor: null,
  });
  const target = await f.db.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: f.episode.id, edition: "default" } },
  });
  expect(target).toMatchObject({
    desiredPresence: true,
    monitoring: true,
    generation: 1,
    automationEpoch: 0,
    profileId: f.profile.id,
    editionRootId: f.series.id,
  });
  const invocation = {
    freshness: f.context.plexBindingExecution(),
    access: await f.context.plexAccess("show"),
    budget: new PublicationAuthorityReadBudget(),
  };
  const authority = await f.db.$transaction(async (tx) => {
    await lockAcquisitionMedia(tx, [f.episode.id]);
    expect(await lockRuntimeAuthority(tx, 0)).toBe(true);
    return readLibrarySeriesManagement(
      tx,
      { mediaIds: [f.episode.id], epoch: 0, access: invocation.access },
      invocation,
    );
  });
  expect(authority?.proof).toMatchObject({
    schemaVersion: 2,
    policyScope: "series",
    includeSpecials: false,
    seriesId: f.series.id,
    receiptId: f.receiptId,
    rootGenerationAtCapture: 1,
    targets: [{ mediaId: f.episode.id, generation: 1 }],
  });
  expect(
    await f.db.mediaRequest.count({
      where: { mediaId: { in: [f.series.id, ...f.ids, f.episode.id] } },
    }),
  ).toBe(0);
  const before = await f.db.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: f.episode.id, edition: "default" } },
  });
  await expandCatalogCoverage(f.context, f.input);
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.episode.id, edition: "default" } },
    }),
  ).toEqual(before);
  expect(
    await f.db.operation.count({
      where: { targetId: f.episode.id, kind: "reconcile_media" },
    }),
  ).toBe(1);
});

test("episode-only adoption cannot approve a future episode or leave an invented target behind", async () => {
  const f = await fixture(false);
  await f.db.mediaIntent.upsert({
    where: { mediaId_edition: { mediaId: f.series.id, edition: "default" } },
    create: {
      mediaId: f.series.id,
      editionRootId: f.series.id,
      generation: 1,
      automationEpoch: 0,
      desiredPresence: true,
      monitoring: true,
      profileId: f.profile.id,
    },
    update: {
      generation: 1,
      automationEpoch: 0,
      desiredPresence: true,
      monitoring: true,
      profileId: f.profile.id,
    },
  });
  expect(await expandCatalogCoverage(f.context, f.input)).toEqual({
    processed: 0,
    nextCursor: null,
  });
  expect(
    await f.db.mediaIntent.findUnique({
      where: { mediaId_edition: { mediaId: f.episode.id, edition: "default" } },
    }),
  ).toBeNull();
  expect(
    await f.db.operation.count({ where: { targetId: f.episode.id } }),
  ).toBe(0);
});

test("a long approved series projects at most 25 episodes per page and resumes without changing committed generations", async () => {
  const f = await fixture(true);
  await f.db.mediaItem.createMany({
    data: Array.from({ length: 48 }, (_, index) => ({
      kind: "episode" as const,
      title: `Later episode ${String(index + 4)}`,
      parentId: f.series.id,
      seasonNumber: 2,
      episodeNumber: index + 4,
    })),
  });
  const first = await expandCatalogCoverage(f.context, f.input);
  expect(first.processed).toBe(25);
  expect(first.nextCursor).not.toBeNull();
  const before = await f.db.mediaIntent.findMany({
    where: { editionRootId: f.series.id },
    orderBy: { mediaId: "asc" },
  });
  expect(await expandCatalogCoverage(f.context, f.input)).toEqual(first);
  expect(
    await f.db.mediaIntent.findMany({
      where: { editionRootId: f.series.id },
      orderBy: { mediaId: "asc" },
    }),
  ).toEqual(before);
  const second = await expandCatalogCoverage(f.context, {
    ...f.input,
    cursor: first.nextCursor,
  });
  expect(second.processed).toBe(25);
  expect(
    await expandCatalogCoverage(f.context, {
      ...f.input,
      cursor: second.nextCursor,
    }),
  ).toEqual({ processed: 1, nextCursor: null });
  expect(
    await f.db.mediaIntent.count({
      where: {
        editionRootId: f.series.id,
        generation: 1,
        desiredPresence: true,
        monitoring: true,
      },
    }),
  ).toBe(f.ids.length + 1 + 48 + 1);
  expect(
    await f.db.mediaRequest.count({
      where: {
        media: { OR: [{ id: f.series.id }, { parentId: f.series.id }] },
      },
    }),
  ).toBe(0);
});

test.each([false, true])(
  "specials require the explicit series choice (included=%s)",
  async (includeSpecials) => {
    const f = await fixture(true, includeSpecials);
    await f.db.mediaItem.update({
      where: { id: f.episode.id },
      data: { seasonNumber: 0 },
    });
    await expandCatalogCoverage(f.context, f.input);
    const target = await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.episode.id, edition: "default" } },
    });
    expect(target.monitoring).toBe(includeSpecials);
    expect(target.desiredPresence).toBe(includeSpecials);
  },
);

test.each(["owner", "monitoring", "epoch"] as const)(
  "revoked %s authority cannot project later episodes",
  async (change) => {
    const f = await fixture(true);
    if (change === "owner")
      await f.db.mediaUser.update({
        where: { id: f.network.actor.id },
        data: { restricted: true },
      });
    else
      await f.db.mediaIntent.update({
        where: {
          mediaId_edition: { mediaId: f.series.id, edition: "default" },
        },
        data:
          change === "monitoring"
            ? { monitoring: false, generation: { increment: 1 } }
            : { automationEpoch: -1 },
      });
    expect(await expandCatalogCoverage(f.context, f.input)).toEqual({
      processed: 0,
      nextCursor: null,
    });
    expect(
      await f.db.mediaIntent.findUnique({
        where: {
          mediaId_edition: { mediaId: f.episode.id, edition: "default" },
        },
      }),
    ).toBeNull();
  },
);

test("catalog projection preserves an existing episode's explicit removal and does not reset the caller's budget", async () => {
  const f = await fixture(true);
  await expandCatalogCoverage(f.context, f.input);
  const where = {
    mediaId_edition: { mediaId: f.episode.id, edition: "default" },
  };
  await f.db.mediaIntent.update({
    where,
    data: {
      monitoring: false,
      desiredPresence: false,
      intentionallyRemovedAt: new Date(),
      generation: { increment: 1 },
    },
  });
  const removed = await f.db.mediaIntent.findUniqueOrThrow({ where });
  await expandCatalogCoverage(f.context, f.input);
  expect(await f.db.mediaIntent.findUniqueOrThrow({ where })).toEqual(removed);
  const budget = new PublicationAuthorityReadBudget();
  budget.consume(99);
  await expect(
    expandCatalogCoverage(
      {
        ...f.context,
        movieManagement: {
          budget,
          execution: f.context.plexBindingExecution(),
        },
      },
      f.input,
    ),
  ).rejects.toThrow("100 total queried records");
  expect(await f.db.mediaIntent.findUniqueOrThrow({ where })).toEqual(removed);
  expect(z.uuid().parse(removed.mediaId)).toBe(f.episode.id);
});

test.each(["before", "personal_first", "household_first"] as const)(
  "a member cancellation %s household projection cannot revoke approved series monitoring",
  async (phase) => {
    const f = await fixture(true);
    const account = crypto.randomUUID();
    const member = await f.db.mediaUser.create({
      data: {
        plexAccountId: account,
        displayName: "Series requester",
        role: "member",
        plexIdentity: {
          create: {
            kind: "account",
            serverMachineId: "fixture-server",
            serverAccountId: account,
            permittedSectionIds: ["2"],
            permittedMediaKinds: ["series"],
            verifiedAt: new Date(),
          },
        },
      },
    });
    if (phase === "household_first")
      await expandCatalogCoverage(f.context, f.input);
    const commands = new PrismaMediaCommands(f.db, {
      keepDays: 30,
      serverMachineId: "fixture-server",
    });
    const requested = await commands.createRequest(
      member,
      crypto.randomUUID(),
      {
        mediaId: f.series.id,
        subtitleLanguages: [],
        includeSpecials: false,
        includeFutureEpisodes: true,
      },
    );
    const requestId = z.uuid().parse(requested.requestId);
    const coverage = createCoverageActivities({ db: f.db });
    if (phase === "personal_first") {
      await coverage.expandMediaRequest({
        operationId: z.uuid().parse(requested.operationId),
        requestId,
        requestVersion: 0,
        cursor: null,
      });
      await expandCatalogCoverage(f.context, f.input);
    }
    const cancelled = await commands.cancelRequest(
      member,
      crypto.randomUUID(),
      requestId,
      0,
    );
    await coverage.expandMediaRequest({
      operationId: z.uuid().parse(cancelled.operationId),
      requestId,
      requestVersion: 1,
      cursor: null,
    });
    await expandCatalogCoverage(f.context, f.input);
    const targets = await f.db.mediaIntent.findMany({
      where: {
        edition: "default",
        mediaId: { in: [f.series.id, ...f.ids, f.episode.id] },
      },
    });
    expect(targets).toHaveLength(f.ids.length + 2);
    expect(
      targets.every(
        (target) =>
          target.libraryMonitoring &&
          target.monitoring &&
          target.desiredPresence,
      ),
    ).toBe(true);
    expect(
      await f.db.mediaRequest.count({
        where: {
          mediaId: { in: [f.series.id, ...f.ids, f.episode.id] },
          active: true,
        },
      }),
    ).toBe(0);
  },
);
