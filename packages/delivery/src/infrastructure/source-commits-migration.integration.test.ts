import { afterEach, describe, expect, test } from "vitest";
import { createTestDatabase } from "#testing/postgres.ts";
import { registerTestService } from "#testing/services.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import { TITLE_LIMIT } from "#infrastructure/hub/source-commit.ts";

const BEFORE = "20261022000000_model_v2";
const MIGRATION = "20261119000000_source_commits";
/** The reason `qualify` records when the exact pipeline was read and had not passed. */
const CI_FAILED = "CI pipeline did not pass exact main push verification";

type Cluster = Awaited<ReturnType<typeof createTestDatabase>>;
const clusters: Cluster[] = [];
afterEach(async () => {
  for (const cluster of clusters.splice(0)) await cluster.close();
});

const sha = (digit: string) => digit.repeat(40);

async function before() {
  const cluster = await createTestDatabase({ through: BEFORE });
  clusters.push(cluster);
  expect(cluster.applied.at(-1)).toBe(BEFORE);
  for (const id of ["arcade", "scout-for-lol"])
    await registerTestService(cluster.database, id);
  return cluster;
}

let builds = 0;
async function ciBuild(
  cluster: Cluster,
  options: {
    sourceRevision: string;
    pipelineNumber: number;
    status: "pending" | "verified" | "failed";
    qualificationReason?: string;
    serviceId?: string;
  },
) {
  builds += 1;
  const id = `build-${String(builds)}`;
  await cluster.database.build.create({
    data: {
      id,
      requestId: `ci/1/${String(options.pipelineNumber)}/${id}`,
      serviceId: options.serviceId ?? "arcade",
      sourceRevision: options.sourceRevision,
      sourceKind: "ci",
      ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(options.pipelineNumber)}`,
      verifiedAt: new Date("2026-11-01T00:00:00Z"),
      status: options.status,
      qualificationReason: options.qualificationReason ?? null,
      repositoryId: 1,
      pipelineNumber: options.pipelineNumber,
    },
  });
}

/** A cached CI run as the hub's Woodpecker reader stores it: no commit sha. */
async function cachedRun(
  cluster: Cluster,
  pipelineNumber: number,
  run: {
    message?: string;
    author?: string | null;
    event?: string;
    branch?: string;
  },
) {
  await cluster.database.integrationSnapshot.create({
    data: {
      source: "woodpecker",
      key: `1/${String(pipelineNumber)}`,
      final: true,
      fetchedAt: new Date("2026-11-02T00:00:00Z"),
      payload: {
        number: pipelineNumber,
        status: "succeeded",
        event: "push",
        branch: "main",
        message: "feat: a cached run",
        author: "shepherdjerred",
        ...run,
      },
    },
  });
}

async function migrated(cluster: Cluster) {
  await cluster.migrate(MIGRATION);
  const rows = await cluster.database.sourceCommit.findMany({
    orderBy: { sourceRevision: "asc" },
  });
  return new Map(rows.map((row) => [row.sourceRevision, row]));
}

describe("source commit backfill", () => {
  test("a qualified build's cached pipeline gives its commit a title and author", async () => {
    const cluster = await before();
    await ciBuild(cluster, {
      sourceRevision: sha("a"),
      pipelineNumber: 1,
      status: "verified",
    });
    // Two services built the same commit in one pipeline: still one commit.
    await ciBuild(cluster, {
      sourceRevision: sha("a"),
      pipelineNumber: 1,
      status: "verified",
      serviceId: "scout-for-lol",
    });
    await cachedRun(cluster, 1, {
      message: "  feat(arcade): ship it (#1)  \n\nWhy\n\nBecause.",
      author: " shepherdjerred ",
    });
    await ciBuild(cluster, {
      sourceRevision: sha("b"),
      pipelineNumber: 2,
      status: "failed",
      qualificationReason: CI_FAILED,
    });
    await cachedRun(cluster, 2, { message: "fix(arcade): broke CI" });

    const rows = await migrated(cluster);
    expect([...rows.keys()]).toEqual([sha("a"), sha("b")]);
    expect(rows.get(sha("a"))).toMatchObject({
      title: "feat(arcade): ship it (#1)",
      author: "shepherdjerred",
      pipelineNumber: 1,
    });
    expect(rows.get(sha("b"))).toMatchObject({
      title: "fix(arcade): broke CI",
      author: "shepherdjerred",
      pipelineNumber: 2,
    });
  });

  test("a commit is left without a row unless its pipeline's identity was proven and cached", async () => {
    const cluster = await before();
    // The build named a pipeline that turned out to be another commit's.
    await ciBuild(cluster, {
      sourceRevision: sha("a"),
      pipelineNumber: 1,
      status: "failed",
      qualificationReason:
        "Pipeline does not verify this exact main push revision",
    });
    await cachedRun(cluster, 1, { message: "another commit's title" });
    // Not checked yet.
    await ciBuild(cluster, {
      sourceRevision: sha("b"),
      pipelineNumber: 2,
      status: "pending",
    });
    await cachedRun(cluster, 2, {});
    // Qualified, but nobody opened its CI panel.
    await ciBuild(cluster, {
      sourceRevision: sha("c"),
      pipelineNumber: 3,
      status: "verified",
    });
    // A cached run that is not a main push, or lacks the fields, describes nothing usable.
    await ciBuild(cluster, {
      sourceRevision: sha("d"),
      pipelineNumber: 4,
      status: "verified",
    });
    await cachedRun(cluster, 4, { event: "manual" });
    await ciBuild(cluster, {
      sourceRevision: sha("e"),
      pipelineNumber: 5,
      status: "verified",
    });
    await cachedRun(cluster, 5, { author: null });
    // A GitHub snapshot is keyed by sha and is not Woodpecker's answer.
    await cluster.database.integrationSnapshot.create({
      data: {
        source: "github",
        key: sha("c"),
        final: true,
        fetchedAt: new Date("2026-11-02T00:00:00Z"),
        payload: { sha: sha("c"), headline: "from GitHub" },
      },
    });

    const rows = await migrated(cluster);
    expect([...rows.keys()]).toEqual([]);
  });

  test("a rerun commit takes its first pipeline, and empty values are recorded as absent", async () => {
    const cluster = await before();
    await ciBuild(cluster, {
      sourceRevision: sha("a"),
      pipelineNumber: 7,
      status: "verified",
    });
    await cachedRun(cluster, 7, { message: "the rerun", author: "rerunner" });
    await ciBuild(cluster, {
      sourceRevision: sha("a"),
      pipelineNumber: 6,
      status: "verified",
      serviceId: "scout-for-lol",
    });
    await cachedRun(cluster, 6, { message: "the push", author: "pusher" });
    await ciBuild(cluster, {
      sourceRevision: sha("b"),
      pipelineNumber: 8,
      status: "verified",
    });
    await cachedRun(cluster, 8, {
      message: `${"é".repeat(TITLE_LIMIT + 50)}\nsecond line`,
      author: "",
    });
    await ciBuild(cluster, {
      sourceRevision: sha("c"),
      pipelineNumber: 9,
      status: "verified",
    });
    await cachedRun(cluster, 9, { message: "\n\nonly a body" });

    const rows = await migrated(cluster);
    expect(rows.get(sha("a"))).toMatchObject({
      title: "the push",
      author: "pusher",
      pipelineNumber: 6,
    });
    expect(rows.get(sha("b"))).toMatchObject({
      title: "é".repeat(TITLE_LIMIT),
      author: null,
    });
    expect(rows.get(sha("c"))).toMatchObject({
      title: null,
      author: "shepherdjerred",
    });

    // Capture after the migration leaves a backfilled commit as it is.
    await new Delivery(cluster.database).recordSourceCommit({
      sourceRevision: sha("a"),
      message: "a later qualification",
      author: "someone-else",
      pipelineNumber: 10,
    });
    expect(
      await cluster.database.sourceCommit.findUnique({
        where: { sourceRevision: sha("a") },
      }),
    ).toEqual(rows.get(sha("a")));
  });
});
