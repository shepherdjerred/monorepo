import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requireStableSources, verifyVault } from "./ios-native-e2e.ts";
import { exportIosJourneyAttachments } from "./native-acceptance/attachments.ts";
import {
  configureIosJourneyTests,
  runSelectedIosJourneyTest,
} from "./native-acceptance/selected-tests.ts";

it("source provenance rejects changed, added or removed build inputs", () => {
  expect(() =>
    requireStableSources({ "a.swift": "sha-a" }, { "a.swift": "sha-a" }),
  ).not.toThrow();
  expect(() =>
    requireStableSources({ "a.swift": "sha-a" }, { "a.swift": "sha-b" }),
  ).toThrow();
  expect(() =>
    requireStableSources(
      { "a.swift": "sha-a" },
      { "a.swift": "sha-a", "b.swift": "sha-b" },
    ),
  ).toThrow();
  expect(() => requireStableSources({ "a.swift": "sha-a" }, {})).toThrow();
});

const fixture = path.resolve(
  import.meta.dir,
  "../../tasknotes-fixtures/e2e/local-vault",
);
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function outputVault(
  title = "E2E edited task",
  status = "done",
): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "facet-e2e-assertions-"));
  directories.push(directory);
  await cp(fixture, directory, { recursive: true });
  await Bun.write(
    path.join(directory, "Created.md"),
    `---\ntitle: ${title}\nstatus: ${status}\ntags: [task]\ncompletedDate: "2026-10-10T12:00:00Z"\n---\n`,
  );
  return directory;
}

async function resultPaths(): Promise<{ result: string; output: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), "facet-result-export-"));
  directories.push(directory);
  return {
    result: path.join(directory, "Result with spaces.xcresult"),
    output: path.join(directory, "Screenshots with spaces"),
  };
}

describe("shared native XCTest attachment export", () => {
  it("does not invoke an exporter when no result bundle was produced", async () => {
    const { result, output } = await resultPaths();
    const calls: string[][] = [];
    await exportIosJourneyAttachments(result, output, async (argv) => {
      calls.push(argv);
      return "";
    });
    expect(calls).toEqual([]);
  });

  it("passes exact result/output paths to the bounded command without shell splitting", async () => {
    const { result, output } = await resultPaths();
    await mkdir(result);
    await Bun.write(path.join(result, "Info.plist"), "synthetic bundle marker");
    const calls: string[][] = [];
    await exportIosJourneyAttachments(result, output, async (argv) => {
      calls.push(argv);
      return "";
    });
    expect(calls).toEqual([
      [
        "xcrun",
        "xcresulttool",
        "export",
        "attachments",
        "--path",
        result,
        "--output-path",
        output,
      ],
    ]);
  });

  it("propagates export failure so the journey cannot claim complete evidence", async () => {
    const { result, output } = await resultPaths();
    await mkdir(result);
    await Bun.write(path.join(result, "Info.plist"), "synthetic bundle marker");
    const failure = new Error("xcresult export failed");
    await expect(
      exportIosJourneyAttachments(result, output, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });
});

describe("shared native selected-test configuration", () => {
  it("replaces existing day, inserts missing zone and preserves the original evidence policy", async () => {
    const calls: { argv: string[]; capture: boolean | undefined }[] = [];
    const testRun = "Run with spaces.xctestrun";
    const environmentPath = "TasksForObsidianUITests.EnvironmentVariables";
    await configureIosJourneyTests(
      testRun,
      {
        FACET_PARITY_DAY: "2026-10-25",
        FACET_PARITY_TIME_ZONE: "America/Los_Angeles",
      },
      async (argv, capture) => {
        calls.push({ argv, capture });
        return JSON.stringify({
          TasksForObsidianUITests: {
            EnvironmentVariables: {
              FACET_PARITY_DAY: "old",
              FACET_E2E_SIMULATOR: "owned-device",
            },
          },
        });
      },
    );
    expect(calls).toEqual([
      {
        argv: ["plutil", "-convert", "json", "-o", "-", testRun],
        capture: true,
      },
      {
        argv: [
          "plutil",
          "-replace",
          `${environmentPath}.FACET_PARITY_DAY`,
          "-string",
          "2026-10-25",
          testRun,
        ],
        capture: undefined,
      },
      {
        argv: [
          "plutil",
          "-insert",
          `${environmentPath}.FACET_PARITY_TIME_ZONE`,
          "-string",
          "America/Los_Angeles",
          testRun,
        ],
        capture: undefined,
      },
      {
        argv: [
          "plutil",
          "-replace",
          "TasksForObsidianUITests.SystemAttachmentLifetime",
          "-string",
          "keepNever",
          testRun,
        ],
        capture: undefined,
      },
    ]);
  });

  it.each([{}, { TasksForObsidianUITests: { EnvironmentVariables: [] } }])(
    "rejects malformed native environment before any plist mutation",
    async (configuration) => {
      const calls: string[][] = [];
      await expect(
        configureIosJourneyTests(
          "run.xctestrun",
          { FACET_BOARD_DAY: "2026-10-25" },
          async (argv) => {
            calls.push(argv);
            return JSON.stringify(configuration);
          },
        ),
      ).rejects.toThrow();
      expect(calls).toEqual([
        ["plutil", "-convert", "json", "-o", "-", "run.xctestrun"],
      ]);
    },
  );

  it.each([
    "BoardTaskTests",
    "MobileParityTests",
    "OccurrenceTaskTests",
  ] as const)(
    "preserves exact selected command, device, result and120s bound for %s",
    async (suite) => {
      const calls: string[][] = [];
      await runSelectedIosJourneyTest(
        {
          testRun: "Run with spaces.xctestrun",
          device: "owned-device",
          result: "Result with spaces.xcresult",
          suite,
          test: "testSelected",
        },
        async (argv) => {
          calls.push(argv);
          return "";
        },
      );
      expect(calls).toEqual([
        [
          "xcodebuild",
          "test-without-building",
          "-xctestrun",
          "Run with spaces.xctestrun",
          "-destination",
          "platform=iOS Simulator,id=owned-device",
          "-parallel-testing-enabled",
          "NO",
          "-resultBundlePath",
          "Result with spaces.xcresult",
          "-collect-test-diagnostics",
          "never",
          "-test-timeouts-enabled",
          "YES",
          "-maximum-test-execution-time-allowance",
          "120",
          `-only-testing:TasksForObsidianUITests/${suite}/testSelected`,
        ],
      ]);
    },
  );
});

describe("native E2E filesystem acceptance", () => {
  it("accepts a persisted edit/completion while preserving the original files", async () => {
    await expect(verifyVault(await outputVault())).resolves.toBeUndefined();
  });

  it.each([
    ["E2E captured task", "done"],
    ["E2E edited task", "open"],
  ])(
    "rejects a GUI journey that did not persist %s / %s",
    async (title, status) => {
      await expect(
        verifyVault(await outputVault(title, status)),
      ).rejects.toThrow();
    },
  );

  it("rejects collateral changes to a preexisting note", async () => {
    const vault = await outputVault();
    await Bun.write(path.join(vault, "Reference.md"), "Rewritten reference\n");
    await expect(verifyVault(vault)).rejects.toThrow(
      "Fixture changed: Reference.md",
    );
  });

  it("rejects a duplicate capture or a persisted discarded draft", async () => {
    const vault = await outputVault();
    await Bun.write(path.join(vault, "Unexpected.md"), "Unexpected task\n");
    await expect(verifyVault(vault)).rejects.toThrow("Expected two task notes");
  });
});
