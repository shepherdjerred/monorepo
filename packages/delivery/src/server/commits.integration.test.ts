import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestDatabase } from "#testing/postgres.ts";
import { registerTestService } from "#testing/services.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import { readChangeFeed } from "#testing/http-app.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import { createQualifier } from "#infrastructure/qualification.ts";
import { createChangeListener } from "#infrastructure/change-feed/listener.ts";
import { ChangeEventSchema } from "#shared/hub/change-contract.ts";
import { PAGE_SIZE } from "#infrastructure/hub/cursor.ts";
import { TITLE_LIMIT } from "#infrastructure/hub/source-commit.ts";
import {
  CommitListSchema,
  CommitStatusSchema,
} from "#shared/hub/hub-contract.ts";
import { createApp } from "./app.ts";

const TOKEN = "executor-test-credential-32-characters";
const BASE = Date.parse("2026-11-01T00:00:00.000Z");
const MINUTE = 60_000;
/** Two full pages and a short third. */
const COMMITS = PAGE_SIZE * 2 + 5;
/**
 * Three commits first seen in the same millisecond. Newest first, the second
 * page begins inside them, so its cursor must break the tie by sha.
 */
const TIED_AT = COMMITS - PAGE_SIZE - 1;
const TIED = new Set([TIED_AT, TIED_AT + 1, TIED_AT + 2]);

const sha = (position: number) => position.toString(16).padStart(40, "0");
const firstSeen = (position: number) =>
  new Date(BASE + (TIED.has(position) ? TIED_AT : position) * MINUTE);

/** What Woodpecker answers for each pipeline the qualifier asks about. */
const pipelines = new Map<number, Record<string, unknown>>();

let cluster: Awaited<ReturnType<typeof createTestDatabase>>;
let delivery: Delivery;
let feed: ReturnType<typeof createChangeListener>;
let app: ReturnType<typeof createApp>;
let builds = 0;

/** A CI build row as publication leaves it: pending, tied to its pipeline. */
async function ciBuild(options: {
  sourceRevision: string;
  createdAt: Date;
  serviceId?: string;
  pipelineNumber?: number;
}) {
  builds += 1;
  const pipelineNumber = options.pipelineNumber ?? builds;
  const id = `build-${String(builds)}`;
  await cluster.database.build.create({
    data: {
      id,
      requestId: `ci/1/${String(pipelineNumber)}/${id}`,
      serviceId: options.serviceId ?? "arcade",
      sourceRevision: options.sourceRevision,
      sourceKind: "ci",
      ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(pipelineNumber)}`,
      verifiedAt: options.createdAt,
      status: "pending",
      repositoryId: 1,
      pipelineNumber,
      createdAt: options.createdAt,
    },
  });
  return { id, pipelineNumber };
}

async function read(path: string) {
  return app.request(path, {
    headers: { "tailscale-user-login": testOperator.id },
  });
}

async function list(cursor?: string) {
  const response = await read(
    `/api/v1/commits${cursor === undefined ? "" : `?cursor=${encodeURIComponent(cursor)}`}`,
  );
  expect(response.status).toBe(200);
  return CommitListSchema.parse(await response.json());
}

async function commit(revision: string) {
  const response = await read(`/api/v1/commits/${revision}`);
  expect(response.status).toBe(200);
  return CommitStatusSchema.parse(await response.json());
}

/** Every page from the newest, following each cursor to the end. */
async function everyPage() {
  const pages = [await list()];
  for (
    let cursor = pages[0]?.nextCursor ?? null;
    cursor !== null;
    cursor = pages.at(-1)?.nextCursor ?? null
  )
    pages.push(await list(cursor));
  return pages;
}

/** Newest first seen first; a tie falls back to the sha, descending. */
function expectedOrder(positions: number[]) {
  return positions
    .toSorted(
      (left, right) =>
        firstSeen(right).getTime() - firstSeen(left).getTime() ||
        sha(right).localeCompare(sha(left)),
    )
    .map((position) => sha(position));
}

async function qualify(buildId: string) {
  const response = await app.request(`/api/v1/builds/${buildId}/qualify`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  expect(response.status).toBe(200);
  return response;
}

/** The arcade build of the commit at `position`. */
async function buildOf(position: number) {
  const build = await cluster.database.build.findFirstOrThrow({
    where: { sourceRevision: sha(position), serviceId: "arcade" },
  });
  return build.id;
}

/** The qualification a report came from: the arcade build of the commit at `position`. */
async function qualificationOf(position: number, requestId: string) {
  return { buildId: await buildOf(position), actor: testExecutor, requestId };
}

/** Every change published for the first record of a commit's title and author. */
function sourceRecorded(revision: string) {
  return cluster.database.audit.findMany({
    where: {
      action: "build.source_recorded",
      metadata: { path: ["sourceRevision"], equals: revision },
    },
    select: {
      actor: true,
      action: true,
      entityId: true,
      requestId: true,
      metadata: true,
    },
  });
}

beforeAll(async () => {
  cluster = await createTestDatabase();
  delivery = new Delivery(cluster.database);
  feed = createChangeListener(cluster.url);
  await feed.start();
  app = createApp({
    delivery,
    changeFeed: feed,
    ciOrigin: "https://woodpecker.sjer.red",
    ciRepositoryId: 1,
    peerAddress: () => "127.0.0.1",
    qualifyBuild: createQualifier({
      origin: "https://woodpecker.sjer.red",
      repositoryId: 1,
      token: "test-only-credential",
      recordSourceCommit: (report) => delivery.recordSourceCommit(report),
      fetch: (input) => {
        if (!(input instanceof URL))
          throw new TypeError("Qualifier must request an exact pipeline URL");
        const pipeline = pipelines.get(
          Number(input.pathname.split("/").at(-1)),
        );
        return Promise.resolve(
          pipeline === undefined
            ? new Response("no such pipeline", { status: 404 })
            : Response.json(pipeline),
        );
      },
    }),
    config: {
      publicOrigin: "http://delivery.test",
      machineCredentials: [{ token: TOKEN, principal: testExecutor }],
      writesEnabled: () => Promise.resolve(true),
      enabledEnvironments: () => Promise.resolve([]),
      operatorLogins: () => Promise.resolve([testOperator.id]),
      trustedProxyAddresses: () => Promise.resolve(["127.0.0.1"]),
    },
  });
  for (let position = 0; position < COMMITS; position += 1)
    await ciBuild({
      sourceRevision: sha(position),
      createdAt: firstSeen(position),
    });
  // A second service's build of an old commit registers after every other
  // commit: the commit must keep the place its first build gave it.
  await ciBuild({
    sourceRevision: sha(3),
    serviceId: "scout-for-lol",
    createdAt: new Date(BASE + 10_000 * MINUTE),
  });
  // Neither an acquisition nor a build of a service outside the catalog is a
  // monorepo commit the hub can describe.
  await cluster.database.build.create({
    data: {
      id: "acquired",
      requestId: "acquire/minecraft",
      serviceId: "minecraft",
      sourceRevision: "f".repeat(40),
      sourceKind: "upstream",
      verifiedAt: new Date(BASE),
      status: "verified",
      createdAt: new Date(BASE + 20_000 * MINUTE),
    },
  });
  await registerTestService(cluster.database, "outside-the-catalog");
  await ciBuild({
    sourceRevision: "e".repeat(40),
    serviceId: "outside-the-catalog",
    createdAt: new Date(BASE + 30_000 * MINUTE),
  });
}, 120_000);

afterAll(async () => {
  await feed.stop();
  await cluster.close();
});

describe("commit list paging", () => {
  test("pages run newest first seen first, sha breaking ties, without gaps or repeats", async () => {
    const pages = await everyPage();
    expect(pages.map((page) => page.items.length)).toEqual([
      PAGE_SIZE,
      PAGE_SIZE,
      5,
    ]);
    const listed = pages.flatMap((page) => page.items.map((item) => item.sha));
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed).toEqual(
      expectedOrder(Array.from({ length: COMMITS }, (_, position) => position)),
    );
    expect(pages.at(-1)?.nextCursor).toBeNull();
    // The first page ends, and the second begins, inside the tie.
    expect(pages[0]?.items.at(-1)?.seenAt).toBe(pages[1]?.items[0]?.seenAt);
  });

  test("a commit is placed and dated by its first build, not its newest", async () => {
    const pages = await everyPage();
    const old = pages.at(-1)?.items.find((item) => item.sha === sha(3));
    expect(old?.seenAt).toBe(firstSeen(3).toISOString());
    const detail = await commit(sha(3));
    expect(detail.seenAt).toBe(firstSeen(3).toISOString());
  });

  test("a cursor keeps its page while newer commits and builds arrive", async () => {
    const first = await list();
    if (first.nextCursor === null) throw new Error("A second page is required");
    const second = await list(first.nextCursor);
    const added = "d".repeat(40);
    await ciBuild({
      sourceRevision: added,
      createdAt: new Date(BASE + 5000 * MINUTE),
    });
    // A late build of a commit on the second page.
    const late = second.items[0];
    if (late === undefined) throw new Error("The second page has commits");
    await ciBuild({
      sourceRevision: late.sha,
      serviceId: "scout-for-lol",
      createdAt: new Date(BASE + 6000 * MINUTE),
    });
    try {
      const again = await list(first.nextCursor);
      expect(again.items.map((item) => item.sha)).toEqual(
        second.items.map((item) => item.sha),
      );
      const newest = await list();
      expect(newest.items[0]?.sha).toBe(added);
    } finally {
      await cluster.database.build.deleteMany({
        where: {
          OR: [
            { sourceRevision: added },
            { sourceRevision: late.sha, serviceId: "scout-for-lol" },
          ],
        },
      });
    }
  });

  test("an invalid cursor is a typed 400", async () => {
    for (const cursor of ["not-a-cursor", "", "e30"]) {
      const response = await read(
        `/api/v1/commits?cursor=${encodeURIComponent(cursor)}`,
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "INVALID" },
      });
    }
  });
});

describe("commit titles and authors", () => {
  test("a recorded commit shows its title and author in the list and on its page", async () => {
    const newest = sha(COMMITS - 1);
    await delivery.recordSourceCommit({
      sourceRevision: newest,
      message:
        "  feat(delivery): show commit titles (#4723)  \n\nWhy\n\nBare shas.",
      author: " shepherdjerred ",
      pipelineNumber: COMMITS,
      ...(await qualificationOf(COMMITS - 1, "request-newest")),
    });
    const expected = {
      sha: newest,
      title: "feat(delivery): show commit titles (#4723)",
      author: "shepherdjerred",
    };
    const page = await list();
    expect(page.items[0]).toMatchObject(expected);
    expect(await commit(newest)).toMatchObject(expected);
  });

  test("a commit nothing was recorded for has neither, seen or not", async () => {
    const page = await list();
    expect(page.items[1]).toMatchObject({
      sha: sha(COMMITS - 2),
      title: null,
      author: null,
    });
    expect(await commit(sha(COMMITS - 2))).toMatchObject({
      title: null,
      author: null,
    });
    expect(await commit("9".repeat(40))).toMatchObject({
      verdict: "unknown",
      title: null,
      author: null,
    });
  });

  test("a commit with no record offers the stored Woodpecker pipeline's message and author as a stand-in", async () => {
    const revision = sha(40);
    const stored = await cluster.database.build.findFirstOrThrow({
      where: { sourceRevision: revision },
    });
    const number = stored.pipelineNumber ?? 0;
    const key = `1/${String(number)}`;
    await cluster.database.integrationSnapshot.create({
      data: {
        source: "woodpecker",
        key,
        final: true,
        fetchedAt: new Date(),
        payload: {
          number,
          status: "failed",
          event: "push",
          branch: "main",
          author: " pipeline-author ",
          message: "fix(scout): stored by Woodpecker\n\nBody.",
          createdAt: new Date().toISOString(),
          startedAt: null,
          finishedAt: null,
          url: `https://woodpecker.sjer.red/repos/1/pipeline/${String(number)}`,
          workflows: [],
        },
      },
    });
    try {
      // Delivery's own record stays empty: the stand-in is labelled apart.
      const status = await commit(revision);
      expect(status).toMatchObject({ title: null, author: null });
      expect(status.pipeline).toEqual({
        number,
        title: "fix(scout): stored by Woodpecker",
        author: "pipeline-author",
      });
      // With its own record, the commit needs no stand-in.
      await delivery.recordSourceCommit({
        sourceRevision: revision,
        message: "feat(scout): recorded",
        author: "recorded-author",
        pipelineNumber: number,
        ...(await qualificationOf(40, "request-standin")),
      });
      const recorded = await commit(revision);
      expect(recorded).toMatchObject({
        title: "feat(scout): recorded",
        author: "recorded-author",
      });
      expect(recorded.pipeline).toBeUndefined();
    } finally {
      await cluster.database.integrationSnapshot.delete({
        where: { source_key: { source: "woodpecker", key } },
      });
    }
  });

  test("the first record wins and repeats change nothing", async () => {
    const revision = sha(20);
    const first = await qualificationOf(20, "request-first");
    await Promise.all(
      Array.from({ length: 20 }, () =>
        delivery.recordSourceCommit({
          sourceRevision: revision,
          message: "fix(arcade): the push itself",
          author: "shepherdjerred",
          pipelineNumber: 21,
          ...first,
        }),
      ),
    );
    const recorded = await cluster.database.sourceCommit.findUniqueOrThrow({
      where: { sourceRevision: revision },
    });
    await delivery.recordSourceCommit({
      sourceRevision: revision,
      message: "a rerun cannot rewrite the title",
      author: "someone-else",
      pipelineNumber: 99,
      ...(await qualificationOf(20, "request-rerun")),
    });
    expect(
      await cluster.database.sourceCommit.findMany({
        where: { sourceRevision: revision },
      }),
    ).toEqual([recorded]);
    expect(recorded).toMatchObject({
      title: "fix(arcade): the push itself",
      author: "shepherdjerred",
      pipelineNumber: 21,
    });
    // Twenty racing reports and a rerun published one change between them.
    expect(await sourceRecorded(revision)).toEqual([
      {
        actor: testExecutor.id,
        action: "build.source_recorded",
        entityId: first.buildId,
        requestId: "request-first",
        metadata: { sourceRevision: revision, pipelineNumber: 21 },
      },
    ]);
  });

  test("the first record is audited to its build, principal and request; a later build's report is not", async () => {
    // The commit two services built: each build reports it when qualified.
    const revision = sha(3);
    const arcade = await qualificationOf(3, "request-arcade");
    const scout = await cluster.database.build.findFirstOrThrow({
      where: { sourceRevision: revision, serviceId: "scout-for-lol" },
    });
    expect(await sourceRecorded(revision)).toEqual([]);
    const report = {
      sourceRevision: revision,
      message: "feat: one commit, two services",
      author: "shepherdjerred",
      pipelineNumber: 4,
    };
    await delivery.recordSourceCommit({ ...report, ...arcade });
    const published = [
      {
        actor: testExecutor.id,
        action: "build.source_recorded",
        entityId: arcade.buildId,
        requestId: "request-arcade",
        metadata: { sourceRevision: revision, pipelineNumber: 4 },
      },
    ];
    expect(await sourceRecorded(revision)).toEqual(published);
    await delivery.recordSourceCommit({
      ...report,
      buildId: scout.id,
      actor: testExecutor,
      requestId: "request-scout",
    });
    expect(await sourceRecorded(revision)).toEqual(published);
    expect(
      await cluster.database.audit.count({ where: { entityId: scout.id } }),
    ).toBe(0);
  });

  test("a title is one bounded line; an empty message or author is recorded as absent", async () => {
    await delivery.recordSourceCommit({
      sourceRevision: sha(21),
      message: `${"é".repeat(TITLE_LIMIT + 50)}\nsecond line`,
      author: "",
      pipelineNumber: 22,
      ...(await qualificationOf(21, "request-bounded")),
    });
    await delivery.recordSourceCommit({
      sourceRevision: sha(22),
      message: "\n\nonly a body",
      author: "shepherdjerred",
      pipelineNumber: 23,
      ...(await qualificationOf(22, "request-untitled")),
    });
    expect(await commit(sha(21))).toMatchObject({
      title: "é".repeat(TITLE_LIMIT),
      author: null,
    });
    expect(await commit(sha(22))).toMatchObject({
      title: null,
      author: "shepherdjerred",
    });
  });
});

/** Woodpecker's answer for the pipeline of the commit at `position`. */
function answer(position: number, status: string, finished: number) {
  return {
    number: position + 1,
    commit: sha(position),
    message: `feat: commit ${String(position)}\n\nbody`,
    author: "shepherdjerred",
    branch: "main",
    event: "push",
    status,
    finished,
  };
}

describe("capture at qualification", () => {
  test("a commit whose CI is still running gets its title while its build stays pending", async () => {
    pipelines.set(31, answer(30, "running", 0));
    await qualify(await buildOf(30));
    expect(await commit(sha(30))).toMatchObject({
      verdict: "building",
      title: "feat: commit 30",
      author: "shepherdjerred",
    });
  });

  test("the first capture is the pending build's only audited change, in the qualify request's name", async () => {
    pipelines.set(34, answer(33, "running", 0));
    const buildId = await buildOf(33);
    const response = await qualify(buildId);
    const audited = () =>
      cluster.database.audit.findMany({
        where: { entityId: buildId },
        select: {
          actor: true,
          action: true,
          requestId: true,
          metadata: true,
        },
      });
    const captured = [
      {
        actor: testExecutor.id,
        action: "build.source_recorded",
        requestId: response.headers.get("x-request-id"),
        metadata: { sourceRevision: sha(33), pipelineNumber: 34 },
      },
    ];
    expect(await audited()).toEqual(captured);
    // The next poll of the still-running pipeline publishes nothing more.
    await qualify(buildId);
    expect(await audited()).toEqual(captured);
    expect(await commit(sha(33))).toMatchObject({ verdict: "building" });
  });

  test("an open page is told when a pending build's qualification first records its commit", async () => {
    pipelines.set(35, answer(34, "running", 0));
    const buildId = await buildOf(34);
    const text = await readChangeFeed(
      await read("/api/v1/events"),
      () => qualify(buildId),
      (seen) => seen.includes('"action":"build.source_recorded"'),
    );
    const changes = text
      .split("\n")
      .filter((line) => line.startsWith('data: {"id"'))
      .map((line) => {
        const raw: unknown = JSON.parse(line.slice("data: ".length));
        return ChangeEventSchema.parse(raw);
      })
      .filter((change) => change.entityId === buildId);
    expect(changes).toMatchObject([
      { domain: "build", action: "build.source_recorded", entityId: buildId },
    ]);
    expect(await commit(sha(34))).toMatchObject({
      verdict: "building",
      title: "feat: commit 34",
    });
  });

  test("a commit whose CI failed gets its title too", async () => {
    pipelines.set(32, answer(31, "failure", 123));
    await qualify(await buildOf(31));
    expect(await commit(sha(31))).toMatchObject({
      verdict: "build_failed",
      title: "feat: commit 31",
      author: "shepherdjerred",
    });
  });

  test("a pipeline of another commit fails the build and records nothing", async () => {
    pipelines.set(33, { ...answer(32, "success", 123), commit: sha(0) });
    await qualify(await buildOf(32));
    expect(await commit(sha(32))).toMatchObject({
      verdict: "build_failed",
      title: null,
      author: null,
    });
    expect(
      await cluster.database.sourceCommit.findUnique({
        where: { sourceRevision: sha(0) },
      }),
    ).toBeNull();
    expect(await sourceRecorded(sha(0))).toEqual([]);
    expect(await sourceRecorded(sha(32))).toEqual([]);
  });
});
