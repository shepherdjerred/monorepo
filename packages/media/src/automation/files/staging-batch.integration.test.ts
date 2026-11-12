import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import {
  personalSeasonFixture,
  changePersonalSeasonAuthority,
} from "./fixtures/personal-season.ts";
import { FilePlanSchema } from "./types.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { exists } from "#filesystem/operations-io.ts";
import { prepareInspectionPlan } from "./inspection.ts";
import { z } from "zod";

const h = automationTestHarness();
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture(count = 10) {
  const f = await personalSeasonFixture(h.database(), h.context(), count);
  directories.push(f.files.directory);
  let filePlanHash: string | undefined;
  const call = async (batchIndex: number | null) => {
    if (batchIndex !== null && filePlanHash === undefined)
      throw new Error("Planning commitment required");
    const stagingBatch =
      batchIndex === null
        ? { schemaVersion: 1 as const, batchIndex: null }
        : {
            schemaVersion: 1 as const,
            batchIndex,
            filePlanHash: filePlanHash ?? "",
          };
    const result = await f.physical.inspectAndStageMedia({
      ...f.originalInput,
      stagingBatch,
    });
    if (result.status === "staging") {
      if (filePlanHash !== undefined)
        expect(result.filePlanHash).toBe(filePlanHash);
      filePlanHash = result.filePlanHash;
    }
    return result;
  };
  const plan = async () => {
    const attempt = await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.birth.id },
    });
    return FilePlanSchema.parse(attempt.filePlan);
  };
  const journals = async () => {
    const entries = await plan();
    return await Promise.all(
      entries.map(async (entry) => {
        const filename = path.join(
          f.files.roots.control,
          `journal/${entry.operationId}.json`,
        );
        return (await exists(filename))
          ? JSON.parse(await readFile(filename, "utf8"))
          : null;
      }),
    );
  };
  const assetCount = () =>
    f.db.libraryAsset.count({ where: { torrentId: f.birth.torrentId } });
  const transitionCount = () =>
    f.db.mediaPublicationTransition.count({ where: { attemptId: f.birth.id } });
  const changeCoordinator = async () => {
    const operation = await f.db.operation.create({
      data: {
        kind: "reconcile_media",
        targetId: f.files.media.id,
        payload: {},
        idempotencyKey: crypto.randomUUID(),
      },
    });
    await f.db.acquisitionAttempt.update({
      where: { id: f.birth.id },
      data: { coordinatorOperationId: operation.id },
    });
  };
  const changeFutureDescriptor = async () => {
    const changedPlan = await plan(),
      last = changedPlan.at(-1);
    if (last === undefined)
      throw new Error("Original future descriptor missing");
    last.operationId = crypto.randomUUID();
    await f.db.acquisitionAttempt.update({
      where: { id: f.birth.id },
      data: { filePlan: changedPlan },
    });
  };
  return {
    ...f,
    call,
    plan,
    journals,
    assetCount,
    transitionCount,
    changeCoordinator,
    changeFutureDescriptor,
  };
}

test("one ordinary ten-file owner acquisition stages 4/4/2 across original invocation clocks and publishes the unchanged plan once", async () => {
  const f = await fixture();
  let wall = Date.now();
  const firstObserved = wall;
  vi.spyOn(Date, "now").mockImplementation(() => wall);
  const checkpoint = f.files.context.checkpoint;
  f.files.context.checkpoint = async (phase) => {
    await checkpoint(phase);
    if (phase === "staging-prepared") wall += 8000;
  };
  expect(await f.call(null)).toMatchObject({
    status: "staging",
    nextBatchIndex: 0,
  });
  const plan = await f.plan(),
    originalHash = identityHash(plan);
  expect(plan).toHaveLength(10);
  expect(f.probe).toHaveBeenCalledTimes(10);
  expect(await f.journals()).toEqual(Array.from({ length: 10 }, () => null));
  for (const [batch, total] of [
    [0, 4],
    [1, 8],
    [2, 10],
  ] as const) {
    expect(await f.call(batch)).toEqual(
      batch === 2
        ? { status: "staged" }
        : {
            status: "staging",
            nextBatchIndex: batch + 1,
            filePlanHash: originalHash,
          },
    );
    const journals = await f.journals();
    expect(
      journals.filter((journal) => journal?.phase === "staged"),
    ).toHaveLength(total);
    expect(journals.filter((journal) => journal !== null)).toHaveLength(total);
    expect(await f.assetCount()).toBe(0);
    expect(await f.transitionCount()).toBe(0);
    expect(identityHash(await f.plan())).toBe(originalHash);
  }
  expect(wall - firstObserved).toBe(80_000);
  expect(f.probe).toHaveBeenCalledTimes(10);
  expect(await f.physical.promoteMediaFiles(f.originalInput)).toEqual({
    status: "published",
  });
  const final = await f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: f.birth.id },
  });
  expect(final.identityEvidence).toEqual(f.birth.identityEvidence);
  expect(final.torrentId).toBe(f.birth.torrentId);
  expect(identityHash(final.filePlan)).toBe(originalHash);
  expect(
    await f.db.libraryAsset.count({
      where: { torrentId: f.birth.torrentId, owned: true },
    }),
  ).toBe(10);
  expect(
    await f.db.assetCoverage.count({
      where: { current: true, mediaId: { in: f.birth.mediaIds } },
    }),
  ).toBe(10);
  expect(
    await f.db.acquisitionAttempt.count({
      where: { mediaIds: { hasSome: f.birth.mediaIds } },
    }),
  ).toBe(1);
  expect(f.adds()).toBe(1);
});

test("seventeen actual personal leaves retain every operational profile check while staging only four under the original provenance allowance", async () => {
  const f = await fixture(17);
  expect(await f.call(null)).toMatchObject({
    status: "staging",
    nextBatchIndex: 0,
  });
  expect(await f.call(0)).toMatchObject({
    status: "staging",
    nextBatchIndex: 1,
  });
  const plan = await f.plan(),
    journals = await f.journals();
  expect(plan).toHaveLength(17);
  expect(
    journals.filter((journal) => journal?.phase === "staged"),
  ).toHaveLength(4);
  expect(journals.slice(4)).toEqual(Array.from({ length: 13 }, () => null));
  for (const entry of plan.slice(4)) {
    expect(
      await exists(
        path.join(
          f.files.roots.control,
          `staging/${entry.operationId}.partial`,
        ),
      ),
    ).toBe(false);
    expect(
      await exists(
        path.join(f.files.roots.control, `staging/${entry.operationId}`),
      ),
    ).toBe(false);
  }
  expect(f.probe).toHaveBeenCalledTimes(17);
  expect(await f.assetCount()).toBe(0);
  expect(await f.transitionCount()).toBe(0);
});

test("a retained literal plan extension keeps its original commitment while validated semantics stage and publish unchanged", async () => {
  const f = await fixture();
  await prepareInspectionPlan(f.files.context, f.birth.id);
  const original = await f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: f.birth.id },
  });
  const literal = z
      .array(z.record(z.string(), z.json()))
      .parse(original.filePlan),
    first = literal[0];
  if (first === undefined)
    throw new Error("Original retained descriptor missing");
  first["retainedInspectionExtension"] = { schemaVersion: 1 };
  await f.db.acquisitionAttempt.update({
    where: { id: f.birth.id },
    data: { filePlan: literal },
  });
  const literalHash = identityHash(literal);
  expect(identityHash(FilePlanSchema.parse(literal))).not.toBe(literalHash);
  expect(await f.call(null)).toEqual({
    status: "staging",
    nextBatchIndex: 0,
    filePlanHash: literalHash,
  });
  for (const batch of [0, 1, 2]) await f.call(batch);
  expect(await f.physical.promoteMediaFiles(f.originalInput)).toEqual({
    status: "published",
  });
  const final = await f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: f.birth.id },
  });
  expect(final.filePlan).toEqual(literal);
  expect(final.identityEvidence).toEqual(f.birth.identityEvidence);
  expect(final.torrentId).toBe(f.birth.torrentId);
  expect(await f.assetCount()).toBe(10);
  expect(f.probe).toHaveBeenCalledTimes(10);
});

test("a lost reply repeats only its original four staged journals while later whole-plan publication rejects tampered prior bytes", async () => {
  const f = await fixture();
  await f.call(null);
  expect(await f.call(0)).toMatchObject({
    status: "staging",
    nextBatchIndex: 1,
  });
  const plan = await f.plan(),
    first = plan[0];
  if (first === undefined) throw new Error("First actual descriptor missing");
  const staged = path.join(
    f.files.roots.control,
    `staging/${first.operationId}`,
  );
  const before = await lstat(staged, { bigint: true });
  expect(await f.call(0)).toMatchObject({
    status: "staging",
    nextBatchIndex: 1,
  });
  const after = await lstat(staged, { bigint: true }),
    journals = await f.journals();
  expect(after.ino).toBe(before.ino);
  expect(journals.filter((journal) => journal !== null)).toHaveLength(4);
  await writeFile(staged, "different private bytes");
  expect(await f.call(1)).toMatchObject({
    status: "staging",
    nextBatchIndex: 2,
  });
  expect(await f.call(2)).toEqual({ status: "staged" });
  expect(await f.physical.promoteMediaFiles(f.originalInput)).toEqual({
    status: "blocked",
    reason: "publication_effect_without_intent",
  });
  expect(await f.assetCount()).toBe(0);
  for (const entry of plan)
    await expect(
      access(path.join(f.files.roots.library, entry.libraryPath)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  expect(f.probe).toHaveBeenCalledTimes(10);
});

test.each([
  "coordinator",
  "profile",
  "reservation",
  "request",
  "runtime",
] as const)(
  "a later %s change protects every untouched staging slot",
  async (change) => {
    const f = await fixture();
    await f.call(null);
    await f.call(0);
    const before = await f.journals();
    switch (change) {
      case "coordinator": {
        await f.changeCoordinator();
        break;
      }
      case "profile":
      case "reservation":
      case "request":
      case "runtime":
        await changePersonalSeasonAuthority(f, change);
        break;
    }
    expect(await f.call(1)).toMatchObject({
      status: "blocked",
      reason:
        change === "coordinator"
          ? "acquisition_obsolete"
          : change === "profile"
            ? "profile_obsolete"
            : change === "reservation"
              ? "reservation_obsolete"
              : change === "request"
                ? "request_obsolete"
                : "runtime_protected",
    });
    expect(await f.journals()).toEqual(before);
    expect(await f.assetCount()).toBe(0);
    expect(await f.transitionCount()).toBe(0);
  },
);

test("the opt-in planning call cannot extend its original deadline or start a video copy", async () => {
  const f = await fixture(),
    originalProbe = f.files.context.inspect;
  if (originalProbe === undefined) throw new Error("Original probe missing");
  const at = Date.now();
  const clock = vi.spyOn(Date, "now");
  f.files.context.inspect = async (filename) => {
    const result = await originalProbe(filename);
    clock.mockReturnValue(at + 60_001);
    return result;
  };
  expect(await f.call(null)).toEqual({
    status: "blocked",
    reason: "publication_authority_expired",
  });
  const attempt = await f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: f.birth.id },
  });
  expect(attempt.filePlan).toBeNull();
  expect(await exists(path.join(f.files.roots.control, "staging"))).toBe(false);
});

test("ordinary batch hints cannot adopt an unacknowledged torn partial or ignore an invalid schema", async () => {
  const f = await fixture();
  await f.call(null);
  const plan = await f.plan(),
    first = plan[0];
  if (first === undefined) throw new Error("First actual descriptor missing");
  const partial = path.join(
    f.files.roots.control,
    `staging/${first.operationId}.partial`,
  );
  await mkdir(path.dirname(partial));
  await writeFile(partial, "torn");
  const before = await lstat(partial, { bigint: true });
  await expect(f.call(0)).rejects.toThrow(
    "Unproven import partial requires recovery",
  );
  const after = await lstat(partial, { bigint: true });
  expect(after.ino).toBe(before.ino);
  expect(await readFile(partial, "utf8")).toBe("torn");
  const invalidHint = {
    schemaVersion: 1 as const,
    batchIndex: 0,
    filePlanHash: identityHash(await f.plan()),
    unexpected: true,
  };
  await expect(
    f.physical.inspectAndStageMedia({
      ...f.originalInput,
      stagingBatch: invalidHint,
    }),
  ).rejects.toThrow();
  expect(await f.assetCount()).toBe(0);
});

test("a genuine prepared ACK with changed native ctime remains protected instead of being rewritten by a later batch", async () => {
  const f = await fixture();
  await f.call(null);
  const at = Date.now(),
    clock = vi.spyOn(Date, "now"),
    checkpoint = f.files.context.checkpoint;
  f.files.context.checkpoint = async (phase) => {
    await checkpoint(phase);
    if (phase === "staging-prepared") clock.mockReturnValue(at + 60_001);
  };
  expect(await f.call(0)).toEqual({
    status: "blocked",
    reason: "publication_authority_expired",
  });
  clock.mockRestore();
  f.files.context.checkpoint = checkpoint;
  const plan = await f.plan(),
    first = plan[0];
  if (first === undefined) throw new Error("First actual descriptor missing");
  const partial = path.join(
      f.files.roots.control,
      `staging/${first.operationId}.partial`,
    ),
    journal = path.join(
      f.files.roots.control,
      `journal/${first.operationId}.json`,
    );
  const before = await readFile(journal, "utf8");
  expect(JSON.parse(before)).toHaveProperty("preparedPartial");
  await chmod(partial, 0o640);
  await expect(f.call(0)).rejects.toThrow(
    "Prepared import partial identity changed",
  );
  expect(await readFile(journal, "utf8")).toBe(before);
  expect(await f.assetCount()).toBe(0);
});

test("a future descriptor cannot change the whole-plan commitment after an earlier batch", async () => {
  const f = await fixture();
  await f.call(null);
  await f.call(0);
  const before = await f.journals();
  await f.changeFutureDescriptor();
  expect(await f.call(1)).toEqual({
    status: "blocked",
    reason: "staging_plan_changed",
  });
  expect(await f.journals()).toEqual(before);
  expect(await f.assetCount()).toBe(0);
});

test.each(["coordinator", "future_descriptor"] as const)(
  "a %s change during preparation is rechecked before the private staging commit",
  async (change) => {
    const f = await fixture();
    await f.call(null);
    const originalPlan = await f.plan(),
      checkpoint = f.files.context.checkpoint;
    let changed = false;
    f.files.context.checkpoint = async (phase) => {
      await checkpoint(phase);
      if (phase !== "staging-prepared" || changed) return;
      changed = true;
      if (change === "coordinator") {
        await f.changeCoordinator();
      } else {
        await f.changeFutureDescriptor();
      }
    };
    expect(await f.call(0)).toEqual({
      status: "blocked",
      reason: "staging_plan_changed",
    });
    expect(changed).toBe(true);
    const journals = await f.journals();
    expect(
      journals.filter(
        (journal) =>
          journal?.phase === "prepared" &&
          journal.preparedPartial !== undefined,
      ),
    ).toHaveLength(4);
    for (const entry of originalPlan)
      await expect(
        access(
          path.join(f.files.roots.control, `staging/${entry.operationId}`),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await f.assetCount()).toBe(0);
    expect(await f.transitionCount()).toBe(0);
  },
);
