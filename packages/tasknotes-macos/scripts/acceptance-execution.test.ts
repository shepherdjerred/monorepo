import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  acceptanceStages,
  executeAcceptanceStages,
  readAcceptanceResultReports,
  type AcceptanceCommand,
  type AcceptanceStage,
} from "./acceptance-execution.ts";
import {
  launchSmokeSelector,
  standaloneTests,
} from "./acceptance-test-plan.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function plan(smokeOnly = false) {
  const root = await mkdtemp(path.join(tmpdir(), "facet-serial-contract-"));
  roots.push(root);
  return acceptanceStages(standaloneTests, root, smokeOnly);
}

async function receipt(stage: AcceptanceStage | undefined) {
  assert.ok(stage);
  const value: unknown = JSON.parse(await readFile(stage.receipt, "utf8"));
  return value;
}

function fakeCommand(
  stages: readonly AcceptanceStage[],
  launches: string[],
  fault?: {
    index: number;
    kind: "command" | "invalid" | "missing-report" | "wrong-case";
  },
): AcceptanceCommand {
  return async (argv) => {
    const stage = stages.find((entry) => argv.includes(entry.resultBundle));
    if (!stage) throw new Error("Command must target a planned private result");
    const index = stages.indexOf(stage);
    if (argv[0] === "xcodebuild") {
      const selectors = argv.filter((arg) => arg.startsWith("-only-testing:"));
      expect(selectors).toEqual([`-only-testing:${stage.selector}`]);
      launches.push(stage.selector);
      if (fault?.index === index && fault.kind === "command")
        throw new Error("Native count failed");
      return "";
    }
    const failed = fault?.index === index && fault.kind === "invalid";
    if (argv[4] === "summary") {
      return JSON.stringify({
        result: failed ? "Failed" : "Passed",
        totalTestCount: 1,
        passedTests: failed ? 0 : 1,
        failedTests: failed ? 1 : 0,
        skippedTests: 0,
        expectedFailures: 0,
      });
    }
    expect(argv[4]).toBe("tests");
    if (fault?.index === index && fault.kind === "missing-report")
      throw new Error("Tree missing");
    const selector =
      fault?.index === index && fault.kind === "wrong-case"
        ? "TaskNotesAcceptanceUITests/StandaloneVaultUITests/testWrongCase"
        : stage.selector;
    const method = selector.split("/").at(-1);
    return JSON.stringify({
      testNodes: [
        {
          nodeType: "Test Case",
          result: "Passed",
          nodeIdentifier: `StandaloneVaultUITests/${method}()`,
          nodeIdentifierURL: `test://com.apple.xcode/TaskNotes/${selector}`,
        },
      ],
    });
  };
}

describe("fail-fast native process orchestration", () => {
  test("same-bundle report reads never overlap across smoke and all workflows", async () => {
    const stages = await plan();
    const launches: string[] = [];
    const delegate = fakeCommand(stages, launches);
    const activeBundles = new Set<string>();
    const reads: string[] = [];
    const command: AcceptanceCommand = async (argv, capture) => {
      if (argv[0] === "xcodebuild") return delegate(argv, capture);
      const bundle = argv.at(-1);
      assert.ok(bundle);
      if (activeBundles.has(bundle))
        throw new Error("Concurrent same-bundle database materialization");
      activeBundles.add(bundle);
      try {
        await Promise.resolve();
        reads.push(`${path.basename(bundle)}:${argv[4]}`);
        return await delegate(argv, capture);
      } finally {
        activeBundles.delete(bundle);
      }
    };
    await executeAcceptanceStages(stages, "owned.xctestrun", command);
    expect(reads).toEqual(
      stages.flatMap((stage) =>
        ["summary", "tests"].map(
          (kind) => `${path.basename(stage.resultBundle)}:${kind}`,
        ),
      ),
    );
    expect(launches).toEqual(stages.map((stage) => stage.selector));
    for (const stage of stages)
      expect(await receipt(stage)).toMatchObject({ status: "passed" });
  });

  test.each(["summary", "tests"] as const)(
    "failed %s read retains the other report without retrying either command",
    async (failedKind) => {
      const stages = await plan(true);
      const stage = stages[0];
      assert.ok(stage);
      const destinations = {
        summary: `${stage.receipt}.summary.json`,
        tests: `${stage.receipt}.tests.json`,
      };
      const reads: string[] = [];
      let active = false;
      const command: AcceptanceCommand = async (argv, capture) => {
        expect(capture).toBe(true);
        expect(argv.at(-1)).toBe(stage.resultBundle);
        const kind = argv[4];
        assert.ok(kind === "summary" || kind === "tests");
        if (active) throw new Error("Overlapping same-bundle report command");
        active = true;
        try {
          await Promise.resolve();
          reads.push(kind);
          if (kind === failedKind) throw new Error("Report unavailable");
          return JSON.stringify({ retained: kind });
        } finally {
          active = false;
        }
      };
      await expect(
        readAcceptanceResultReports(stage.resultBundle, destinations, command),
      ).rejects.toThrow("Native result reports could not be read");
      expect(reads).toEqual(["summary", "tests"]);
      const retainedKind = failedKind === "summary" ? "tests" : "summary";
      expect(await Bun.file(destinations[retainedKind]).json()).toEqual({
        retained: retainedKind,
      });
      expect(await Bun.file(destinations[failedKind]).exists()).toBe(false);
    },
  );

  test("smoke-only cannot invoke workflows and records a distinct passing smoke", async () => {
    const stages = await plan(true);
    const launches: string[] = [];
    await executeAcceptanceStages(
      stages,
      "owned.xctestrun",
      fakeCommand(stages, launches),
    );
    expect(launches).toEqual([launchSmokeSelector]);
    expect(stages).toHaveLength(1);
    expect(await receipt(stages[0])).toMatchObject({
      kind: "launch-smoke",
      status: "passed",
    });
  });

  test("smoke process failure retains raw results and launches zero workflows", async () => {
    const stages = await plan();
    const launches: string[] = [];
    await expect(
      executeAcceptanceStages(
        stages,
        "owned.xctestrun",
        fakeCommand(stages, launches, { index: 0, kind: "command" }),
      ),
    ).rejects.toThrow();
    expect(launches).toEqual([launchSmokeSelector]);
    expect(await receipt(stages[0])).toMatchObject({ status: "failed" });
    expect(await Bun.file(`${stages[0]?.receipt}.summary.json`).exists()).toBe(
      true,
    );
    expect(await Bun.file(`${stages[0]?.receipt}.tests.json`).exists()).toBe(
      true,
    );
    for (const stage of stages.slice(1))
      expect(await Bun.file(stage.receipt).exists()).toBe(false);
  });

  test.each(["command", "invalid", "missing-report", "wrong-case"] as const)(
    "%s at workflow two prevents workflow three and retains earlier exact receipts",
    async (kind) => {
      const stages = await plan();
      const launches: string[] = [];
      await expect(
        executeAcceptanceStages(
          stages,
          "owned.xctestrun",
          fakeCommand(stages, launches, { index: 2, kind }),
        ),
      ).rejects.toThrow();
      expect(launches).toEqual(
        stages.slice(0, 3).map((stage) => stage.selector),
      );
      for (const stage of stages.slice(0, 2))
        expect(await receipt(stage)).toMatchObject({ status: "passed" });
      expect(await receipt(stages[2])).toMatchObject({ status: "failed" });
      expect(
        await Bun.file(`${stages[2]?.receipt}.summary.json`).exists(),
      ).toBe(true);
      for (const stage of stages.slice(3))
        expect(await Bun.file(stage.receipt).exists()).toBe(false);
    },
  );

  test("runs smoke and exactly the original four singleton workflows once", async () => {
    const stages = await plan();
    const launches: string[] = [];
    await executeAcceptanceStages(
      stages,
      "owned.xctestrun",
      fakeCommand(stages, launches),
    );
    expect(
      stages
        .filter((stage) => stage.kind === "workflow")
        .map((stage) => stage.test),
    ).toEqual(standaloneTests);
    expect(launches).toEqual(stages.map((stage) => stage.selector));
    for (const stage of stages)
      expect(await receipt(stage)).toMatchObject({ status: "passed" });
  });
});
