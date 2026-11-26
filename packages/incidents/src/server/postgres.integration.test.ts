import path from "node:path";
import {
  createEmptyTestDatabase,
  ensureSharedPostgres,
  envWithPostgresBin,
  runCommandAsync,
  type OwnedTestDatabaseHandle,
} from "@shepherdjerred/test-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  IncidentErrorDataSchema,
  IncidentDetailSchema,
  TakeCommandResultSchema,
} from "#shared/contract.ts";
import { emit, begin } from "#domain/model.ts";
import type { PrismaClient } from "#generated/prisma/client.ts";
import {
  createIncidentsDatabase,
  createPrismaIncidentsRepository,
} from "#infrastructure/prisma-repository.ts";
import {
  RevisionConflictError,
  type IncidentsRepository,
} from "#infrastructure/repository.ts";
import {
  AGENT,
  agent,
  createHarness,
  jsonOf,
  OPS_TOKEN,
  requestDispatchLease,
} from "#testing/hub.ts";
import {
  PRIORITY_SCENARIO_EXPECTED,
  runPriorityScenario,
  runWatermarkRace,
  runWatermarkScenario,
  WATERMARK_RACE_EXPECTED,
  WATERMARK_SCENARIO_EXPECTED,
} from "#testing/signal-scenarios.ts";
import { minutes, T0 } from "#testing/records.ts";

const ConflictBodySchema = z.object({
  error: z.object({ data: IncidentErrorDataSchema }),
});

const packageRoot = path.resolve(import.meta.dir, "../..");

let dbHandle: OwnedTestDatabaseHandle | undefined;
let prisma: PrismaClient | undefined;
const repositories: IncidentsRepository[] = [];

function db(): PrismaClient {
  if (prisma === undefined) throw new Error("database not ready");
  return prisma;
}

function repository(): IncidentsRepository {
  if (dbHandle === undefined) throw new Error("database not ready");
  const created = createPrismaIncidentsRepository(
    createIncidentsDatabase(dbHandle.url),
  );
  repositories.push(created);
  return created;
}

beforeAll(async () => {
  const shared = ensureSharedPostgres();
  dbHandle = await createEmptyTestDatabase({
    prefix: "tracker",
    kind: "test",
    adminUrl: shared.superUrl,
  });
  const migrate = await runCommandAsync(["bun", "run", "migrate:deploy"], {
    cwd: packageRoot,
    env: envWithPostgresBin({ INCIDENTS_DATABASE_URL: dbHandle.url }),
  });
  if (migrate.exitCode !== 0)
    throw new Error(
      `incidents prisma migrate deploy failed: ${migrate.stderr || migrate.stdout}`,
    );
  prisma = createIncidentsDatabase(dbHandle.url);
});

afterAll(async () => {
  await Promise.all(repositories.map((created) => created.close()));
  await prisma?.$disconnect();
  await dbHandle?.drop();
});

const DECLARE = {
  actor: AGENT,
  title: "Delivery dispatch is stuck",
  severity: "sev1",
  systems: ["delivery"],
  exitCondition: "Queued deployments dispatch again.",
};

async function clean(): Promise<void> {
  await db()
    .$executeRaw`TRUNCATE incidents, actors, signal_watermarks RESTART IDENTITY CASCADE`;
}

describe("PostgreSQL incidents repository", () => {
  it("round-trips a full incident and numbers incidents from the sequence", async () => {
    await clean();
    const h = createHarness({ repository: repository() });
    const first = await h.call(
      "declare",
      {
        ...DECLARE,
        components: ["delivery-dispatch"],
        suspect: { prNumber: 5142, branch: "temporal-schedule-split" },
        links: [
          {
            kind: "pr",
            ref: "5142",
            url: "https://github.com/shepherdjerred/monorepo/pull/5142",
          },
        ],
      },
      IncidentDetailSchema,
    );
    await h.call(
      "join",
      { actor: agent("blocked"), ref: "INC-1", note: "Blocked deploying" },
      IncidentDetailSchema,
    );
    await h.call(
      "addLink",
      {
        actor: AGENT,
        ref: "INC-1",
        link: { kind: "forum-thread", ref: "FM-222" },
      },
      IncidentDetailSchema,
    );
    const second = await h.call(
      "declare",
      { ...DECLARE, systems: ["tracker"], title: "Tracker slow" },
      IncidentDetailSchema,
    );
    expect([first.identifier, second.identifier]).toEqual(["INC-1", "INC-2"]);

    const detail = await h.query(
      "byRef",
      { ref: first.id },
      IncidentDetailSchema,
    );
    expect(detail).toMatchObject({
      revision: 2,
      components: ["delivery-dispatch"],
      suspect: { prNumber: 5142, branch: "temporal-schedule-split" },
      affectedCount: 1,
      affected: [{ actor: { key: "claude-code:blocked" } }],
    });
    expect(detail.links.map((link) => link.ref)).toEqual(["5142", "FM-222"]);
    expect(detail.timeline.map((event) => [event.seq, event.type])).toEqual([
      [1, "declared"],
      [2, "joined"],
      [3, "link-added"],
    ]);
    const actor = await db().actor.findUnique({ where: { key: AGENT.key } });
    expect(actor).toMatchObject({ seenCount: 3, metadata: AGENT.metadata });
  });
});

describe("PostgreSQL compare-and-set", () => {
  it("commits exactly one of many compare-and-set writes against one revision", async () => {
    await clean();
    const repo = repository();
    const h = createHarness({ repository: repo });
    const declared = await h.call("declare", DECLARE, IncidentDetailSchema);
    const previous = await repo.findIncident({ id: declared.id });
    if (previous === null) throw new Error("missing incident");
    const writes = Array.from({ length: 10 }, (_, index) =>
      repo.commit(
        previous,
        emit(
          begin(previous),
          { now: minutes(1), actor: null, newId: () => crypto.randomUUID() },
          {
            type: "update",
            body: `writer ${String(index)}`,
          },
        ),
      ),
    );
    const settled = await Promise.allSettled(writes);
    expect(
      settled.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = settled.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    expect(rejected).toHaveLength(9);
    expect(
      rejected.every((reason) => reason instanceof RevisionConflictError),
    ).toBe(true);
    expect(
      await db().incidentEvent.count({
        where: { incidentId: declared.id, type: "update" },
      }),
    ).toBe(1);
    const after = await repo.findIncident({ id: declared.id });
    expect(after?.revision).toBe(1);
  });

  it("gives command to exactly one of many concurrent takers", async () => {
    await clean();
    const h = createHarness({ repository: repository() });
    await h.call("declare", DECLARE, IncidentDetailSchema);
    h.clock.now = minutes(11);
    const results = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        h.call(
          "take",
          { actor: agent(`taker-${String(index)}`), ref: "INC-1" },
          TakeCommandResultSchema,
        ),
      ),
    );
    const winners = results.filter((result) => result.outcome === "owned");
    expect(winners).toHaveLength(1);
    expect(results.filter((result) => result.outcome === "taken")).toHaveLength(
      15,
    );
    const row = await db().incident.findUniqueOrThrow({ where: { number: 1 } });
    expect(row).toMatchObject({
      commandState: "owned",
      revision: 1,
      everClaimed: true,
    });
    expect(
      await db().incidentEvent.count({
        where: { incidentId: row.id, type: "claimed" },
      }),
    ).toBe(1);
  });

  it("lets exactly one concurrent declaration hold a system", async () => {
    await clean();
    const h = createHarness({ repository: repository() });
    const attempts = await Promise.all(
      Array.from({ length: 8 }, async (_, index) => {
        const response = await h.app.request("/api/incidents/trpc/declare", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...DECLARE,
            actor: agent(`declarer-${String(index)}`),
          }),
        });
        return { status: response.status, body: await response.json() };
      }),
    );
    expect(attempts.filter((attempt) => attempt.status === 200)).toHaveLength(
      1,
    );
    const conflicts = attempts.filter((attempt) => attempt.status === 409);
    expect(conflicts).toHaveLength(7);
    for (const conflict of conflicts)
      expect(
        ConflictBodySchema.parse(conflict.body).error.data.incident,
      ).toMatchObject({ code: "duplicate-incident", systems: ["delivery"] });
    expect(await db().incident.count()).toBe(1);
    expect(
      await db().openIncidentSystem.findMany({ select: { system: true } }),
    ).toEqual([{ system: "delivery" }]);
  });
});

describe("PostgreSQL lifecycle and signals", () => {
  it("persists lazy lease expiry on the next write and releases systems on resolve", async () => {
    await clean();
    const h = createHarness({ repository: repository() });
    await h.call("declare", DECLARE, IncidentDetailSchema);
    h.clock.now = minutes(11);
    const lease = await requestDispatchLease(h);
    const stored = await db().incident.findUniqueOrThrow({
      where: { number: 1 },
    });
    expect(stored.dispatchTokenHash).not.toBe(lease.dispatchToken);
    expect(stored.dispatchTokenHash).toHaveLength(64);

    h.clock.now = minutes(30);
    const taken = await h.call(
      "take",
      { actor: agent("fixer"), ref: "INC-1" },
      TakeCommandResultSchema,
    );
    expect(taken.outcome).toBe("owned");
    const resolved = await h.call(
      "resolve",
      {
        actor: agent("fixer"),
        ref: "INC-1",
        expectedRevision: taken.incident.revision,
        note: "Deployment 42 settled; queue drained.",
      },
      IncidentDetailSchema,
    );
    expect(resolved.timeline.map((event) => event.type)).toEqual([
      "declared",
      "dispatched",
      "dispatch-expired",
      "claimed",
      "resolved",
    ]);
    expect(await db().openIncidentSystem.count()).toBe(0);
  });

  it("auto-opens and auto-resolves from signals", async () => {
    await clean();
    const h = createHarness({ repository: repository() });
    const red = {
      source: "main-ci",
      key: "main-ci:main",
      firing: true,
      system: "main-ci",
      severity: "sev2",
      title: "main is red",
      exitCondition: "main is green",
      observedAt: T0.toISOString(),
    };
    const post = (signals: unknown[]) =>
      h.app.request("/api/incidents/internal/signals", {
        method: "POST",
        headers: {
          authorization: `Bearer ${OPS_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ signals }),
      });
    expect(await jsonOf(post([red, red]))).toEqual({
      results: [
        { key: "main-ci:main", outcome: "opened", identifier: "INC-1" },
        { key: "main-ci:main", outcome: "ignored", identifier: "INC-1" },
      ],
    });
    h.clock.now = minutes(5);
    const green = await post([
      { ...red, firing: false, observedAt: minutes(5).toISOString() },
    ]);
    expect(await green.json()).toEqual({
      results: [
        { key: "main-ci:main", outcome: "auto-resolved", identifier: "INC-1" },
      ],
    });
    const signalRow = await db().incidentSignal.findFirstOrThrow({
      where: { key: "main-ci:main" },
    });
    expect(signalRow).toMatchObject({
      firing: false,
      firstFiredAt: T0,
      lastChangedAt: minutes(5),
    });
    expect(await db().openIncidentSystem.count()).toBe(0);
  });

  it("reports readiness", async () => {
    const repo = repository();
    await expect(repo.ping()).resolves.toBe(true);
  });
});

describe("PostgreSQL signal watermarks and open priority", () => {
  it("matches the in-memory ordering of retried, delayed, repeated, and tied reports", async () => {
    await clean();
    const h = createHarness({ repository: repository() });
    expect(await runWatermarkScenario(h)).toEqual(WATERMARK_SCENARIO_EXPECTED);
    const rows = await db().signalWatermark.findMany({
      orderBy: { key: "asc" },
      select: { source: true, key: true, firing: true, revision: true },
    });
    expect(rows).toEqual([
      { source: "alertmanager", key: "fp-argocd", firing: true, revision: 0 },
      {
        source: "alertmanager",
        key: "fp-delivery",
        firing: false,
        revision: 0,
      },
      { source: "alertmanager", key: "fp-tracker", firing: true, revision: 1 },
      { source: "main-ci", key: "main-ci:main", firing: false, revision: 1 },
    ]);
  });

  it("keeps one incident and the newest watermark under concurrent reports", async () => {
    await clean();
    const h = createHarness({ repository: repository() });
    expect(await runWatermarkRace(h)).toEqual(WATERMARK_RACE_EXPECTED);
  });

  it("commits exactly one of many watermark compare-and-sets against one revision", async () => {
    await clean();
    const repo = repository();
    const first = {
      source: "main-ci" as const,
      key: "main-ci:main",
      firing: true,
    };
    await repo.commitSignal({
      watermark: {
        previous: null,
        next: { ...first, lastObservedAt: minutes(0) },
      },
      incident: null,
    });
    const previous = await repo.findSignalWatermark("main-ci", "main-ci:main");
    const settled = await Promise.allSettled(
      Array.from({ length: 10 }, (_, index) =>
        repo.commitSignal({
          watermark: {
            previous,
            next: { ...first, lastObservedAt: minutes(index + 1) },
          },
          incident: null,
        }),
      ),
    );
    expect(
      settled.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      settled.every(
        (result) =>
          result.status === "fulfilled" ||
          result.reason instanceof RevisionConflictError,
      ),
    ).toBe(true);
    const after = await repo.findSignalWatermark("main-ci", "main-ci:main");
    expect(after?.revision).toBe(1);
    const duplicateInsert = repo.commitSignal({
      watermark: {
        previous: null,
        next: { ...first, lastObservedAt: minutes(30) },
      },
      incident: null,
    });
    await expect(duplicateInsert).rejects.toBeInstanceOf(RevisionConflictError);
  });

  it("writes no watermark when the signal's incident write loses its compare-and-set", async () => {
    await clean();
    const repo = repository();
    const h = createHarness({ repository: repo });
    const declared = await h.call("declare", DECLARE, IncidentDetailSchema);
    const stale = await repo.findIncident({ id: declared.id });
    if (stale === null) throw new Error("missing incident");
    await h.call(
      "join",
      { actor: agent("blocked"), ref: "INC-1" },
      IncidentDetailSchema,
    );
    const write = repo.commitSignal({
      watermark: {
        previous: null,
        next: {
          source: "alertmanager",
          key: "fp-x",
          firing: true,
          lastObservedAt: minutes(1),
        },
      },
      incident: {
        previous: stale,
        transition: emit(
          begin(stale),
          { now: minutes(1), actor: null, newId: () => crypto.randomUUID() },
          { type: "signal-firing", body: "late" },
        ),
      },
    });
    await expect(write).rejects.toBeInstanceOf(RevisionConflictError);
    expect(await db().signalWatermark.count()).toBe(0);
  });

  it("orders open incidents by severity before the limit", async () => {
    await clean();
    const h = createHarness({ repository: repository() });
    expect(await runPriorityScenario(h)).toEqual(PRIORITY_SCENARIO_EXPECTED);
  });
});
