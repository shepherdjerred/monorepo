import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  assertExactNativeResults,
  standaloneTests,
} from "../acceptance-test-plan.ts";
import {
  childTitle,
  followingDay,
  occurrenceFixture,
  repairChildPath,
  repairParentPath,
  restoredTemplate,
  seedOccurrenceVault,
  templatePath,
  verifyOccurrenceVault,
} from "./fixture.ts";

const roots: string[] = [];
const day = "2026-10-24";
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true });
});

async function completedVault() {
  const root = await mkdtemp(path.join(tmpdir(), "facet-occurrence-proof-"));
  roots.push(root);
  const vault = path.join(root, "Native acceptance");
  await seedOccurrenceVault(vault, day);
  const fixture = occurrenceFixture(day);
  const child = (fixture[repairChildPath] ?? "").replace(
    "status: open",
    "status: done\ncompletedDate: 2026-10-24",
  );
  const parent = (fixture[repairParentPath] ?? "").replace(
    "scheduled: 2026-10-24",
    "scheduled: 2026-10-25\ncomplete_instances: [2026-10-24]",
  );
  await writeFile(path.join(vault, repairChildPath), child);
  await writeFile(path.join(vault, repairParentPath), parent);
  for (const offset of [0, 1, 2]) {
    await writeFile(
      path.join(vault, `Tasks/Rolling-${offset}.md`),
      `---\ntitle: rolling\nstatus: open\nrecurrence_parent: '[[/Tasks/Rolling.md]]'\noccurrence_date: ${followingDay(day, offset)}\n---\n`,
    );
  }
  return { vault, child, parent };
}

async function restore(vault: string) {
  await mkdir(path.join(vault, "Templates"));
  await writeFile(path.join(vault, templatePath), restoredTemplate);
}

test("ordinary daily missing-template fixture does not use expansion-limit rules", () => {
  const fixture = occurrenceFixture(day);
  expect(fixture[repairParentPath]).toContain(
    "recurrence: DTSTART:20261024;FREQ=DAILY\n",
  );
  expect(fixture[repairParentPath]).toContain(
    "occurrence_template: Templates/missing.md",
  );
  expect(fixture["tasknotes.yaml"]).toContain("failure_mode: error_abort");
  expect(fixture[repairChildPath]).toContain(childTitle);
  expect(standaloneTests).toHaveLength(4);
  expect(followingDay("2026-12-31")).toBe("2027-01-01");
  expect(() => followingDay("2026-02-30")).toThrow();
});

test("proof distinguishes successful primary, exact repair Undo and one repaired future", async () => {
  const { vault, child, parent } = await completedVault();
  await expect(
    verifyOccurrenceVault(vault, day, "completed"),
  ).resolves.toMatchObject({ completedChild: child, completedParent: parent });
  await restore(vault);
  await expect(
    verifyOccurrenceVault(vault, day, "undone", child, parent),
  ).resolves.toBeDefined();
  await writeFile(
    path.join(vault, "Tasks/Future.md"),
    `---\ntitle: future\nstatus: open\nrecurrence_parent: '[[/${repairParentPath}]]'\noccurrence_date: 2026-10-25\n---\nRestored occurrence template body.\n`,
  );
  await expect(
    verifyOccurrenceVault(vault, day, "repaired", child, parent),
  ).resolves.toBeDefined();
  await expect(
    verifyOccurrenceVault(vault, day, "undone", child, parent),
  ).rejects.toThrow();
});

test.each(["reference", "child", "parent", "duplicate", "extra", "template"])(
  "proof rejects %s corruption instead of blessing the UI",
  async (kind) => {
    const { vault, child, parent } = await completedVault();
    await restore(vault);
    if (kind === "reference")
      await writeFile(
        path.join(vault, "Reference.md"),
        "Rewritten reference\n",
      );
    if (kind === "child")
      await writeFile(
        path.join(vault, repairChildPath),
        child + "Foreign edit\n",
      );
    if (kind === "parent")
      await writeFile(
        path.join(vault, repairParentPath),
        parent + "Foreign edit\n",
      );
    if (kind === "duplicate")
      await writeFile(
        path.join(vault, "Tasks/Duplicate.md"),
        await Bun.file(path.join(vault, "Tasks/Rolling-0.md")).text(),
      );
    if (kind === "extra")
      await writeFile(
        path.join(vault, "Tasks/Extra.md"),
        "---\ntitle: unexpected\nstatus: open\n---\n",
      );
    if (kind === "template")
      await writeFile(path.join(vault, templatePath), "Unexpected template\n");
    await expect(
      verifyOccurrenceVault(vault, day, "undone", child, parent),
    ).rejects.toThrow();
  },
);

function result(
  testName: string,
  target = "TaskNotesAcceptanceUITests",
  suite = "OccurrenceVaultUITests",
) {
  return {
    summary: {
      result: "Passed",
      totalTestCount: 1,
      passedTests: 1,
      failedTests: 0,
      skippedTests: 0,
      expectedFailures: 0,
    },
    report: {
      testNodes: [
        {
          nodeType: "Test Case",
          nodeIdentifier: `${suite}/${testName}()`,
          result: "Passed",
          nodeIdentifierURL: `test://${target}/${suite}/${testName}`,
        },
      ],
    },
  };
}

test("recurrence result proof rejects skips, wrong identities, missing cases and duplicates", () => {
  const name = "testGenerationRepairUndoAndColdRelaunch";
  const identity = {
    target: "TaskNotesAcceptanceUITests",
    suite: "OccurrenceVaultUITests",
  } as const;
  const accepted = result(name);
  expect(() =>
    assertExactNativeResults(
      accepted.summary,
      accepted.report,
      [name],
      identity,
    ),
  ).not.toThrow();
  expect(() =>
    assertExactNativeResults(
      { ...accepted.summary, skippedTests: 1 },
      accepted.report,
      [name],
      identity,
    ),
  ).toThrow();
  expect(() =>
    assertExactNativeResults(
      accepted.summary,
      { testNodes: [] },
      [name],
      identity,
    ),
  ).toThrow();
  expect(() =>
    assertExactNativeResults(
      accepted.summary,
      {
        testNodes: [...accepted.report.testNodes, ...accepted.report.testNodes],
      },
      [name],
      identity,
    ),
  ).toThrow();
  const wrong = result(name, "OtherTarget");
  expect(() =>
    assertExactNativeResults(wrong.summary, wrong.report, [name], identity),
  ).toThrow();
  expect(() =>
    assertExactNativeResults(
      accepted.summary,
      accepted.report,
      [name, name],
      identity,
    ),
  ).toThrow();
});
