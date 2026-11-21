import { afterAll, beforeAll, expect, test } from "vitest";
import { MediaError } from "#application/errors.ts";
import type { Database } from "#infrastructure/database.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { createTestDefaultTarget } from "#testing/editions.ts";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { queryFixtureDatabase } from "#testing/query-client.ts";
import { commandFixture } from "./command-test-support.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  await cluster.close();
});

type Fixture = Awaited<ReturnType<typeof commandFixture>>;

/** A series with a default target. Section 2 is one of the actor's libraries;
 * section 9 is not. */
async function show(db: Database, title: string, section: "2" | "9") {
  const item = await db.mediaItem.create({
    data: { kind: "series", title, externalIds: { plexSectionId: section } },
  });
  await createTestDefaultTarget(db, item.id);
  return item.id;
}

/** An episode with a default target, in a series of that section. */
async function episodeIn(db: Database, title: string, section: "2" | "9") {
  const series = await db.mediaItem.create({
    data: {
      kind: "series",
      title: `Series of ${title}`,
      externalIds: { plexSectionId: section },
    },
  });
  const episode = await db.mediaItem.create({
    data: { kind: "episode", title, parentId: series.id },
  });
  const target = await createTestDefaultTarget(db, episode.id);
  return { series: series.id, episode: episode.id, target };
}

/** An episode nobody follows, with a removal that can still be stopped. */
async function leavingEpisode(db: Database, title: string, section: "2" | "9") {
  const { episode, target } = await episodeIn(db, title, section);
  await db.retentionDecision.create({
    data: {
      mediaId: episode,
      generation: target.generation,
      state: "grace_period",
      evidence: { recoveryEpoch: 0 },
      graceUntil: new Date(Date.now() + 3 * 86_400_000),
    },
  });
  return episode;
}

/** One title for every way an actor can stand towards a default target. */
async function library(db: Database, f: Fixture) {
  const other = await commandFixture(db);
  const requested = await show(db, "Requested", "2");
  await db.mediaRequest.create({
    data: { mediaId: requested, userId: f.actor.id },
  });
  const hidden = await show(db, "Hidden", "9");
  await db.mediaRequest.create({
    data: { mediaId: hidden, userId: other.actor.id },
  });
  const hiddenRequested = await show(db, "Hidden, requested", "9");
  await db.mediaRequest.create({
    data: { mediaId: hiddenRequested, userId: f.actor.id },
  });
  const hiddenCancelled = await show(db, "Hidden, cancelled", "9");
  await db.mediaRequest.create({
    data: { mediaId: hiddenCancelled, userId: f.actor.id, active: false },
  });
  const visible = await episodeIn(db, "Visible episode", "2");
  const inherited = await episodeIn(db, "Hidden, covered episode", "9");
  await createTestDefaultTarget(db, inherited.series);
  const root = await db.mediaRequest.create({
    data: { mediaId: inherited.series, userId: f.actor.id },
  });
  const covered = await db.mediaRequest.create({
    data: { mediaId: inherited.episode, userId: f.actor.id, direct: false },
  });
  await db.requestCoverage.create({
    data: {
      rootRequestId: root.id,
      requestId: covered.id,
      mediaId: inherited.episode,
      sourceVersion: root.version,
    },
  });
  // Leaving soon is the household's: seeing the title is enough to hold it.
  const leaving = await leavingEpisode(db, "Leaving episode", "2");
  const hiddenLeaving = await leavingEpisode(db, "Hidden, leaving", "9");
  return {
    untargeted: f.media.id,
    requested,
    hidden,
    hiddenRequested,
    hiddenCancelled,
    episode: visible.episode,
    inherited: inherited.episode,
    leaving,
    hiddenLeaving,
    unknown: crypto.randomUUID(),
  };
}

/** A single read in the batch's vocabulary. */
async function single(f: Fixture, mediaId: string) {
  try {
    return {
      status: "ok",
      view: await f.service.getDefaultCommandContext(f.actor, mediaId),
    };
  } catch (error) {
    if (!(error instanceof MediaError)) throw error;
    return { status: "unavailable", mediaId, code: error.code };
  }
}

test.each([
  {
    role: "member" as const,
    shape: {
      untargeted: { access: "detail", actions: [] },
      requested: { access: "detail", actions: ["keep", "cancel_request"] },
      hidden: "forbidden",
      hiddenRequested: {
        access: "protection_only",
        actions: ["keep", "cancel_request"],
      },
      hiddenCancelled: { access: "protection_only", actions: [] },
      episode: { access: "detail", actions: [] },
      inherited: {
        access: "protection_only",
        actions: ["keep", "cancel_request"],
      },
      leaving: { access: "detail", actions: ["keep"] },
      hiddenLeaving: "forbidden",
      unknown: "media_not_found",
    },
  },
  {
    role: "owner" as const,
    shape: {
      untargeted: { access: "detail", actions: ["keep", "pin"] },
      requested: {
        access: "detail",
        actions: ["keep", "pin", "unpin", "cancel_request"],
      },
      hidden: {
        access: "protection_only",
        actions: ["keep", "pin", "unpin", "cancel_request"],
      },
      hiddenRequested: {
        access: "protection_only",
        actions: ["keep", "pin", "unpin", "cancel_request"],
      },
      hiddenCancelled: {
        access: "protection_only",
        actions: ["keep", "pin", "unpin", "cancel_request"],
      },
      episode: {
        access: "detail",
        actions: ["keep", "pin", "unpin", "cancel_request"],
      },
      inherited: {
        access: "protection_only",
        actions: ["keep", "pin", "unpin", "cancel_request"],
      },
      leaving: {
        access: "detail",
        actions: ["keep", "pin", "unpin", "cancel_request"],
      },
      hiddenLeaving: {
        access: "protection_only",
        actions: ["keep", "pin", "unpin", "cancel_request"],
      },
      unknown: "media_not_found",
    },
  },
])(
  "a $role's batch holds exactly what a single read of each title returns",
  async ({ role, shape }) => {
    const db = cluster.database;
    const f = await commandFixture(db, role);
    const titles = await library(db, f);
    const names = Object.keys(shape);
    const ids = Object.values(titles);
    expect(Object.keys(titles)).toEqual(names);

    const batch = await f.service.getDefaultCommandContexts(f.actor, ids);

    expect(batch.schemaVersion).toBe(2);
    const singles = [];
    for (const id of ids) singles.push(await single(f, id));
    expect(batch.items).toEqual(singles);
    // The fixture reaches every branch, so the equality above is not vacuous.
    expect(
      Object.fromEntries(
        batch.items.map((item, index) => [
          names[index],
          item.status === "ok"
            ? {
                access: item.view.access,
                actions: item.view.allowedProtectiveActions,
              }
            : item.code,
        ]),
      ),
    ).toEqual(shape);
  },
);

test("items follow request order and a repeated id is answered once", async () => {
  const db = cluster.database;
  const f = await commandFixture(db);
  const { unknown, hidden, untargeted, requested } = await library(db, f);
  const batch = await f.service.getDefaultCommandContexts(f.actor, [
    unknown,
    hidden,
    untargeted,
    unknown,
    untargeted,
    requested,
    hidden,
  ]);
  expect(
    batch.items.map((item) =>
      item.status === "ok" ? item.view.scope.mediaId : item.mediaId,
    ),
  ).toEqual([unknown, hidden, untargeted, requested]);
});

test("the single read keeps its typed failures", async () => {
  const db = cluster.database;
  const f = await commandFixture(db);
  const { unknown, hidden } = await library(db, f);
  await expect(
    f.service.getDefaultCommandContext(f.actor, unknown),
  ).rejects.toMatchObject({
    code: "media_not_found",
    status: 404,
    message: "Media item does not exist",
  });
  await expect(
    f.service.getDefaultCommandContext(f.actor, hidden),
  ).rejects.toMatchObject({
    code: "forbidden",
    status: 403,
    message: "No authorized command context for this target",
  });
});

test("a batch issues the same queries for one title as for a page of them", async () => {
  const db = cluster.database;
  const f = await commandFixture(db);
  const titles = Object.values(await library(db, f));
  for (let index = titles.length; index < 50; index++)
    titles.push(await show(db, `Filler ${String(index)}`, "2"));
  expect(titles).toHaveLength(50);
  const operations: string[] = [];
  const counted = new PrismaMediaApplication(
    queryFixtureDatabase(db, {
      query: {
        $allOperations({ model = "raw", operation, args, query }) {
          operations.push(`${model}.${operation}`);
          return query(args);
        },
      },
    }),
    {
      keepDays: 30,
      serverMachineId: "command-server",
      visibilitySections: { movie: "1", series: "2" },
    },
  );
  const [first = ""] = titles;

  await counted.getDefaultCommandContext(f.actor, first);
  const one = operations.splice(0);
  await counted.getDefaultCommandContexts(f.actor, [first]);
  const batchOfOne = operations.splice(0);
  const page = await counted.getDefaultCommandContexts(f.actor, titles);
  const batchOfFifty = operations.splice(0);

  expect(page.items).toHaveLength(50);
  // Two row locks and the actor, then titles, own requests, effective
  // requests, open removals and targets: eight statements however many titles
  // are read.
  expect(one).toHaveLength(8);
  expect(batchOfOne).toEqual(one);
  expect(batchOfFifty).toEqual(one);
});
