import { rm } from "node:fs/promises";
import { afterAll, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeFileFixture } from "#automation/native-recovery/test-fixture.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  ApprovedStorageRootsSchema,
  NativeStorageAuthoritySchema,
} from "#shared/canonical-storage.ts";
import { seedUnrelatedStorageHistory } from "./storage-provenance.test-support.ts";
import { MountEvidenceSchema } from "#shared/legacy-observer.ts";
import {
  assertNativeStorageRoots,
  resolveNativeStorageRoots,
} from "./storage-provenance.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof nativeFileFixture>>;
let roots: Awaited<ReturnType<typeof resolveNativeStorageRoots>>;
let inheritedRoots: typeof roots;
let legacyEvidence: z.infer<typeof MountEvidenceSchema>;
beforeAll(async () => {
  fixture = await nativeFileFixture(
    harness.database(),
    harness.context().cipher,
  );
  const storage = await harness
    .database()
    .mediaStorageAuthority.findUniqueOrThrow({
      where: { rootPath: "/data/tv" },
    });
  legacyEvidence = MountEvidenceSchema.parse(storage.evidence);
  const approval = await fixture.review();
  await fixture.observe();
  await fixture.activities.applyNativeRecoveryFiles({
    planId: fixture.planId,
    operationId: z.uuid().parse(approval.operationId),
  });
  inheritedRoots = await harness
    .database()
    .$transaction((tx) => resolveNativeStorageRoots(tx));
  const receipt = await harness
    .database()
    .nativeRecoveryReceipt.findUniqueOrThrow({
      where: { planId: fixture.planId },
    });
  // Explicit current receipt references prove the v3 ten-record graph:
  // receipt+plan and two four-record batches reusing that exact queried plan.
  // Discovery separately preserves the older refs actually consumed at install.
  roots = ApprovedStorageRootsSchema.parse(
    inheritedRoots.map((root) => ({
      ...root,
      receipt: { kind: "native", id: receipt.id, planHash: receipt.planHash },
    })),
  );
  const rows = await harness
    .database()
    .mediaStorageAuthority.findMany({ orderBy: { rootPath: "asc" } });
  expect(inheritedRoots).toEqual(
    NativeStorageAuthoritySchema.parse(rows[0]?.evidence).approvedRoots,
  );
  expect(
    inheritedRoots.every(
      (root) =>
        root.receipt.kind === "legacy" &&
        root.receipt.id === fixture.prior.receipt.id,
    ),
  ).toBe(true);
}, 60_000);
afterAll(async () => {
  if (fixture !== undefined)
    await rm(fixture.file.directory, { recursive: true, force: true });
});

test("real paired root provenance validates both roots once within the remaining ten records", async () => {
  const budget = new PublicationAuthorityReadBudget();
  budget.consume(90);
  expect(
    await harness
      .database()
      .$transaction((tx) => assertNativeStorageRoots(tx, roots, budget)),
  ).toEqual(roots);
  expect(() => budget.consume(1)).toThrow("100 total queried records");
  // A second complete check is a new read, never a reusable authority cache.
  await expect(
    harness
      .database()
      .$transaction((tx) => assertNativeStorageRoots(tx, roots, budget)),
  ).rejects.toThrow("100 total queried records");
});

test("native discovery preserves its exact inherited approval instead of selecting a newer receipt", async () => {
  const budget = new PublicationAuthorityReadBudget();
  budget.consume(98);
  expect(
    await harness
      .database()
      .$transaction((tx) => resolveNativeStorageRoots(tx, budget)),
  ).toEqual(inheritedRoots);
  expect(() => budget.consume(1)).toThrow("100 total queried records");
  const short = new PublicationAuthorityReadBudget();
  short.consume(100);
  await expect(
    harness
      .database()
      .$transaction((tx) => resolveNativeStorageRoots(tx, short)),
  ).rejects.toThrow("100 total queried records");
});

test.each([85, 90, 95])(
  "actual v3 root graph honors the original budget with %i prior records (95/100/105 total)",
  async (prior) => {
    const budget = new PublicationAuthorityReadBudget();
    budget.consume(prior);
    const result = harness
      .database()
      .$transaction((tx) => assertNativeStorageRoots(tx, roots, budget));
    if (prior === 95)
      await expect(result).rejects.toThrow("100 total queried records");
    else {
      expect(await result).toEqual(roots);
      expect(budget.take).toBe(101 - prior - 10);
    }
  },
);

test("mixed native and refreshed legacy rows retain exact approvals despite many unrelated historical receipts", async () => {
  const db = harness.database();
  await seedUnrelatedStorageHistory(db, fixture.prior.receipt.id);
  const before = await db.mediaStorageAuthority.findMany({
    orderBy: { rootPath: "asc" },
  });
  const rollback = new Error("rollback mixed storage fixture");
  await expect(
    db.$transaction(async (tx) => {
      const row = before.find((value) => value.rootPath === "/data/tv");
      if (row === undefined) throw new Error("TV root missing");
      // The fixture's literal first-installed legacy envelope is retained by its
      // original capture; never synthesize an approving receipt.
      const refreshed = {
        ...legacyEvidence,
        bindings: legacyEvidence.bindings.map((binding) => ({
          ...binding,
          canonical:
            binding.canonical.root === row.rootPath
              ? { ...binding.canonical, podUid: "refreshed-worker" }
              : binding.canonical,
        })),
      };
      await tx.mediaStorageAuthority.update({
        where: { rootPath: row.rootPath },
        data: {
          evidence: z.record(z.string(), z.json()).parse(refreshed),
          workerPodUid: "refreshed-worker",
        },
      });
      const budget = new PublicationAuthorityReadBudget();
      budget.consume(98);
      expect(await resolveNativeStorageRoots(tx, budget)).toEqual(
        inheritedRoots,
      );
      expect(budget.take).toBe(1);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
  expect(
    await db.mediaStorageAuthority.findMany({ orderBy: { rootPath: "asc" } }),
  ).toEqual(before);
});

test.each(["source", "pinned_ref", "tuple"] as const)(
  "discovery rejects changed %s without replacing the original authority",
  async (change) => {
    const db = harness.database();
    const before = await db.mediaStorageAuthority.findUniqueOrThrow({
      where: { rootPath: "/data/tv" },
    });
    const rollback = new Error("rollback rejected storage fixture");
    await expect(
      db.$transaction(async (tx) => {
        const native = NativeStorageAuthoritySchema.parse(before.evidence);
        const altered =
          change === "source"
            ? {
                ...legacyEvidence,
                bindings: legacyEvidence.bindings.map((binding) => ({
                  ...binding,
                  source: {
                    ...binding.source,
                    deploymentUid: "unapproved-controller",
                  },
                })),
              }
            : {
                ...native,
                approvedRoots: native.approvedRoots.map((root) =>
                  root.rootPath === before.rootPath
                    ? {
                        ...root,
                        ...(change === "tuple"
                          ? { pvcUid: "unapproved-volume" }
                          : {
                              receipt: {
                                ...root.receipt,
                                id: crypto.randomUUID(),
                              },
                            }),
                      }
                    : root,
                ),
              };
        await tx.mediaStorageAuthority.update({
          where: { rootPath: before.rootPath },
          data: { evidence: z.record(z.string(), z.json()).parse(altered) },
        });
        await expect(resolveNativeStorageRoots(tx)).rejects.toThrow();
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(
      await db.mediaStorageAuthority.findUniqueOrThrow({
        where: { rootPath: before.rootPath },
      }),
    ).toEqual(before);
  },
);
