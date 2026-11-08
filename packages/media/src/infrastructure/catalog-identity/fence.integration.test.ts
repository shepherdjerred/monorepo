import { expect, test } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import { isRetryableTransaction } from "#infrastructure/locks.ts";
import { TmdbCatalogApplication } from "#infrastructure/catalog.ts";
import { createCatalogActivities } from "#automation/reconciliation/catalog.ts";
import { numberingCatalog } from "./numbering-snapshot.ts";
import {
  numberingFixture,
  commitNumberingInput,
} from "./numbering-test-fixture.ts";

const harness = automationTestHarness();

test.each(["manual", "catalog-page"] as const)(
  "%s waits for the complete sorted leaf set before taking a selected later leaf",
  async (kind) => {
    const f = await numberingFixture(harness.database());
    const ids = f.episodes.map((row) => row.id).sort();
    const earlier = z.uuid().parse(ids[0]);
    const selected = z.uuid().parse(ids[1]);
    const write =
      kind === "manual"
        ? () =>
            f.manual.save(f.actor, crypto.randomUUID(), selected, {
              expectedVersion: 0,
              absoluteNumber: 7,
              evidence: "Explicit current owner numbering",
            })
        : await catalogPageWriter(f);
    let writer: ReturnType<typeof observeRejection> | undefined;
    try {
      await f.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "MediaItem" WHERE id = ${earlier} FOR UPDATE`;
        writer = observeRejection(write());
        await expect
          .poll(
            async () => {
              const rows = z
                .array(z.object({ waiting: z.boolean() }))
                .parse(
                  await f.db
                    .$queryRaw`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%MediaItem%' AND pid <> pg_backend_pid()) AS waiting`,
                );
              return rows[0]?.waiting;
            },
            { timeout: 2000, interval: 10 },
          )
          .toBe(true);
        // A sorted multi-leaf effect can finish its lock set without waiting for
        // numbering, which must still be blocked on the earlier leaf we hold.
        await tx.$queryRaw`SELECT id FROM "MediaItem" WHERE id = ${selected} FOR UPDATE NOWAIT`;
      });
    } finally {
      if (writer !== undefined)
        expect(await writer).toEqual({ rejected: false, retryable: false });
    }
    expect(
      await f.db.mediaItem.findUniqueOrThrow({ where: { id: f.series.id } }),
    ).toMatchObject({ version: 1 });
    expect(
      await f.db.mediaItem.findUniqueOrThrow({ where: { id: selected } }),
    ).toMatchObject(
      kind === "manual"
        ? { version: 1, externalIds: { absoluteNumber: 7 } }
        : { version: 1, title: "Refreshed episode" },
    );
  },
);

async function catalogPageWriter(
  f: Awaited<ReturnType<typeof numberingFixture>>,
) {
  const season = await f.db.mediaItem.create({
    data: {
      kind: "season",
      title: "Page season",
      tmdbId: f.series.tmdbId,
      parentId: f.series.id,
      seasonNumber: 1,
    },
  });
  await f.db.mediaItem.updateMany({
    where: { id: { in: f.episodes.map((row) => row.id) } },
    data: { parentId: season.id, seasonNumber: 1 },
  });
  const episodes = [...f.episodes]
    .sort((left, right) => right.id.localeCompare(left.id))
    .map((row) => ({
      id: row.tmdbId,
      name: "Refreshed episode",
      season_number: 1,
      episode_number: row.episodeNumber,
      air_date: null,
      runtime: 24,
    }));
  const operation = await f.db.operation.create({
    data: {
      kind: "refresh_catalog",
      targetId: f.series.id,
      payload: {},
      result: {
        catalog: {
          seasons: [
            {
              id: season.tmdbId,
              season_number: 1,
              name: "Page season",
              episode_count: 2,
            },
          ],
          season: 0,
          offset: 0,
          episodes,
          completed: false,
        },
      },
    },
  });
  return () =>
    createCatalogActivities(harness.context()).refreshMediaCatalog({
      operationId: operation.id,
      mediaId: f.series.id,
      cursor: null,
    });
}

test.each(["manual", "group", "catalog"] as const)(
  "%s writer makes an already established serializable sibling snapshot fail before authority can be used",
  async (writer) => {
    const f = await numberingFixture(harness.database());
    const preview = await f.service.previewGroup(
      f.actor,
      f.series.id,
      f.interpretation,
    );
    const snapshotRead = Promise.withResolvers<undefined>();
    const continueReader = Promise.withResolvers<undefined>();
    let reachedEffect = false;
    const reader = observeRejection(
      f.db.$transaction(
        async (tx) => {
          const snapshot = await numberingCatalog(tx, f.series.id);
          expect(snapshot.episodes).toHaveLength(2);
          expect(
            snapshot.episodes.every((row) => row.absoluteNumber === null),
          ).toBe(true);
          snapshotRead.resolve();
          await continueReader.promise;
          await lockAcquisitionMedia(tx, [z.uuid().parse(f.episodes[0]?.id)]);
          reachedEffect = true;
        },
        { isolationLevel: "Serializable" },
      ),
    );
    await snapshotRead.promise;
    try {
      if (writer === "manual")
        await f.manual.save(
          f.actor,
          crypto.randomUUID(),
          z.uuid().parse(f.episodes[1]?.id),
          {
            expectedVersion: 0,
            absoluteNumber: 1,
            evidence: "Owner reviewed sibling numbering",
          },
        );
      if (writer === "group")
        await f.service.commitGroup(
          f.actor,
          crypto.randomUUID(),
          f.series.id,
          commitNumberingInput(preview),
        );
      if (writer === "catalog") {
        const tmdbId = z.int().positive().parse(f.series.tmdbId);
        const context = harness.context((url) => {
          if (url.pathname.endsWith("alternative_titles"))
            return Promise.resolve(Response.json({ id: tmdbId, results: [] }));
          if (url.pathname.endsWith("external_ids"))
            return Promise.resolve(
              Response.json({ id: tmdbId, imdb_id: null, tvdb_id: null }),
            );
          return Promise.resolve(
            Response.json({
              id: tmdbId,
              name: "Changed title",
              original_name: "Canonical title",
              original_language: "en",
              overview: "",
              poster_path: null,
              first_air_date: "2020-01-01",
              seasons: [],
            }),
          );
        });
        await new TmdbCatalogApplication(f.db, context.tmdb).adopt(
          "series",
          tmdbId,
        );
      }
    } finally {
      continueReader.resolve();
    }
    expect(await reader).toEqual({ rejected: true, retryable: true });
    expect(reachedEffect).toBe(false);
    expect(
      await f.db.mediaItem.findUniqueOrThrow({ where: { id: f.series.id } }),
    ).toMatchObject({ version: 1 });
  },
);

async function observeRejection(work: Promise<unknown>) {
  try {
    await work;
    return { rejected: false, retryable: false };
  } catch (error) {
    return { rejected: true, retryable: isRetryableTransaction(error) };
  }
}
