import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { MacSessionPreflightError } from "./mac-session.ts";
import {
  acceptanceStateWritePrefix,
  materializeMacArtifact,
  readMacArtifact,
  validateMacCapabilities,
} from "./mac-artifact.ts";
import { readMacEvidence } from "./mac-evidence.ts";
import {
  buildMacAcceptance,
  configureMacAcceptanceTestRun,
  createMacAcceptanceState,
  macAcceptanceTestRun,
  recordMacAcceptanceOutcome,
  runMacAcceptanceCase,
  retainMacAcceptanceEvidence,
} from "./mac-journey.ts";

const directories: string[] = [];
const proofRunID = "12345678-1234-1234-1234-123456789abc";
const proofSHA = "a".repeat(64);
test("effective runner capabilities confine writes without dropping the SDK sandbox", () => {
  const homeWrite =
    "com.apple.security.temporary-exception.files.home-relative-path.read-write";
  const signed = {
    "com.apple.security.app-sandbox": true,
    "com.apple.security.get-task-allow": true,
    "com.apple.security.temporary-exception.files.absolute-path.read-only": [
      "/",
      "/",
    ],
    "com.apple.security.temporary-exception.sbpl": [
      "(allow hid-control)",
      "(allow signal)",
    ],
    [homeWrite]: [acceptanceStateWritePrefix],
  };
  expect(() => validateMacCapabilities(signed, "runner")).not.toThrow();
  expect(() =>
    validateMacCapabilities(
      {
        ...signed,
        [homeWrite]: [acceptanceStateWritePrefix, acceptanceStateWritePrefix],
      },
      "runner",
    ),
  ).not.toThrow();
  const bad = [
    { ...signed, "com.apple.security.app-sandbox": false },
    { ...signed, [homeWrite]: [] },
    { ...signed, [homeWrite]: ["/Library/Containers/"] },
    { ...signed, [homeWrite]: [acceptanceStateWritePrefix + "../"] },
    {
      ...signed,
      "com.apple.security.temporary-exception.files.absolute-path.read-write": [
        "/",
      ],
    },
    {
      ...signed,
      "com.apple.security.temporary-exception.sbpl": ["(allow file-write*)"],
    },
    {
      ...signed,
      "com.apple.security.temporary-exception.sbpl": ["(allow hid-control)"],
    },
    { ...signed, "com.apple.security.files.user-selected.read-write": true },
  ];
  for (const capabilities of bad)
    expect(() => validateMacCapabilities(capabilities, "runner")).toThrow();
  const { [homeWrite]: removed, ...missing } = signed;
  expect(removed).toEqual([acceptanceStateWritePrefix]);
  expect(() => validateMacCapabilities(missing, "runner")).toThrow();
  expect(() =>
    validateMacCapabilities(
      {
        "com.apple.security.app-sandbox": true,
        "com.apple.security.files.user-selected.read-write": true,
      },
      "app",
    ),
  ).not.toThrow();
  expect(() => validateMacCapabilities(signed, "app")).toThrow();
  expect(() =>
    validateMacCapabilities(
      {
        "com.apple.security.app-sandbox": true,
        "com.apple.security.temporary-exception.sbpl": ["(allow file-write*)"],
      },
      "app",
    ),
  ).toThrow();
});
test("VM result manifest rejects traversal, collisions, foreign identity and byte overflow", () => {
  const file = { path: "state/vault/task.md", bytes: 4, sha256: proofSHA };
  const manifest = { schemaVersion: 1, runID: proofRunID, files: [file] };
  expect(readMacEvidence(manifest, proofRunID)).toEqual([file]);
  for (const files of [
    [{ ...file, path: "../foreign" }],
    [file, file],
    [{ ...file, bytes: 65 * 1024 * 1024 }],
    [file, { ...file, path: "state/vault" }],
  ])
    expect(() => readMacEvidence({ ...manifest, files }, proofRunID)).toThrow();
  expect(() => readMacEvidence(manifest, crypto.randomUUID())).toThrow();
});
test("artifact input graph rejects escaping/dangling links before destination writes", async () => {
  const root = await directory(),
    destination = path.join(root, "fresh");
  const artifact = {
    schemaVersion: 1 as const,
    runID: proofRunID,
    packageRoot: root,
    sourceHead: "a".repeat(40),
    xcodeVersion: "Xcode owned",
    sources: { "owned.swift": proofSHA },
    files: {
      "Debug/FacetAcceptance.app/Contents/binary": {
        sha256: proofSHA,
        mode: 0o755,
      },
    },
    links: { "Debug/FacetAcceptance.app/Contents/link": "missing" },
  };
  expect(() => readMacArtifact(artifact)).toThrow("Dangling");
  await expect(
    materializeMacArtifact(artifact, root, destination),
  ).rejects.toThrow();
  expect(
    await Bun.file(
      path.join(destination, "Debug/FacetAcceptance.app/Contents/binary"),
    ).exists(),
  ).toBe(false);
  expect(() =>
    readMacArtifact({
      ...artifact,
      links: { "Debug/FacetAcceptance.app/Contents/link": "../escape" },
    }),
  ).toThrow();
});
async function directory(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "facet-mac-journey-control-"));
  directories.push(root);
  return root;
}
afterEach(async () => {
  for (const root of directories.splice(0)) await rm(root, { recursive: true });
});

test.each([120, 180] as const)(
  "isolated native invocation retains its %s second cap after a fresh preflight",
  async (maximumSeconds) => {
    const evidence = await directory();
    const commands: string[][] = [];
    await runMacAcceptanceCase(
      {
        evidence,
        testRun: "owned.xctestrun",
        result: "owned.xcresult",
        selector: "Owned/Suite/exactCase",
        maximumSeconds,
      },
      async (argv) => {
        commands.push(argv);
        return argv[0] === "xcrun"
          ? JSON.stringify({ onConsole: true, locked: false })
          : "";
      },
    );
    expect(commands[0]?.slice(0, 3)).toEqual(["xcrun", "swift", "-e"]);
    expect(commands[1]).toEqual([
      "xcodebuild",
      "test-without-building",
      "-xctestrun",
      "owned.xctestrun",
      "-destination",
      "platform=macOS",
      "-parallel-testing-enabled",
      "NO",
      "-resultBundlePath",
      "owned.xcresult",
      "-collect-test-diagnostics",
      "never",
      "-test-timeouts-enabled",
      "YES",
      "-maximum-test-execution-time-allowance",
      String(maximumSeconds),
      "-only-testing:Owned/Suite/exactCase",
    ]);
  },
);

test("final outcome persists failure before rethrowing every retained cause", async () => {
  const evidence = await directory();
  const receipt = {
    schemaVersion: 1,
    runID: "owned-run",
    selector: "exact-case",
  };
  const failures = [new Error("UI failed"), new Error("retention failed")];
  await expect(
    recordMacAcceptanceOutcome(
      receipt,
      failures,
      evidence,
      "owned proof failed",
    ),
  ).rejects.toMatchObject({
    message: "owned proof failed",
    errors: failures,
  });
  expect(await Bun.file(path.join(evidence, "run.json")).json()).toEqual({
    ...receipt,
    status: "failed",
  });
  await recordMacAcceptanceOutcome(receipt, [], evidence, "unused");
  expect(await Bun.file(path.join(evidence, "run.json")).json()).toEqual({
    ...receipt,
    status: "passed",
  });
});

test("a preflight block remains distinct from a started native test failure", async () => {
  const evidence = await directory();
  await expect(
    recordMacAcceptanceOutcome(
      { schemaVersion: 1, runID: "owned-run" },
      [new MacSessionPreflightError(new Error("off console"))],
      evidence,
      "blocked",
    ),
  ).rejects.toThrow("blocked");
  expect(await Bun.file(path.join(evidence, "run.json")).json()).toMatchObject({
    status: "blocked",
  });
});

test("shared build preserves product, signing, destination and bounded runner arguments", async () => {
  const commands: string[][] = [];
  await buildMacAcceptance(
    "/owned/derived",
    async (argv) => {
      commands.push(argv);
      return "";
    },
    "0123456789ABCDEF0123456789ABCDEF01234567",
  );
  expect(commands).toEqual([
    ["bun", "run", "mac:preflight"],
    ["xcodegen", "generate"],
    [
      "xcodebuild",
      "build-for-testing",
      "-project",
      "TaskNotes.xcodeproj",
      "-scheme",
      "TaskNotesAcceptance",
      "-configuration",
      "Debug",
      "-derivedDataPath",
      "/owned/derived",
      "-destination",
      "platform=macOS",
      "-parallel-testing-enabled",
      "NO",
      "-jobs",
      "2",
      "TASKNOTES_UITEST_IDENTITY=0123456789ABCDEF0123456789ABCDEF01234567",
    ],
  ]);
});

test("failed preflight cannot generate or build", async () => {
  const commands: string[][] = [];
  await expect(
    buildMacAcceptance(
      "/owned/derived",
      async (argv) => {
        commands.push(argv);
        throw new Error("matching artifact unavailable");
      },
      undefined,
    ),
  ).rejects.toThrow("matching artifact unavailable");
  expect(commands).toEqual([["bun", "run", "mac:preflight"]]);
});

test("a new owned state is exact and an existing state is never reused", async () => {
  const root = await directory();
  const state = path.join(root, "state");
  const descriptor = path.join(state, "acceptance.json");
  await createMacAcceptanceState(state, descriptor, "owned-run");
  expect(await Bun.file(descriptor).json()).toEqual({
    schemaVersion: 1,
    runID: "owned-run",
    stateDirectory: state,
  });
  await expect(
    createMacAcceptanceState(state, descriptor, "another-run"),
  ).rejects.toThrow();
  expect((await Bun.file(descriptor).json()).runID).toBe("owned-run");
});

test("test discovery requires exactly one produced test run", async () => {
  const root = await directory();
  const products = path.join(root, "Build/Products");
  await mkdir(products, { recursive: true });
  await expect(macAcceptanceTestRun(root)).rejects.toThrow();
  const only = path.join(products, "Owned.xctestrun");
  await Bun.write(only, "owned");
  expect(await macAcceptanceTestRun(root)).toBe(only);
  await Bun.write(path.join(products, "Unexpected.xctestrun"), "other");
  await expect(macAcceptanceTestRun(root)).rejects.toThrow();
});

test("test setup keeps exact owner environment and custom-only screenshot lifetimes", async () => {
  const commands: string[][] = [];
  await configureMacAcceptanceTestRun(
    "/owned/test.xctestrun",
    {
      FACET_E2E_DESCRIPTOR: "/owned/acceptance.json",
      FACET_E2E_RUN_ID: "owned-run",
      FACET_OCCURRENCE_DAY: "2026-10-26",
    },
    async (argv) => {
      commands.push(argv);
      return "";
    },
  );
  expect(commands.map((argv) => argv.slice(2, 5))).toEqual([
    [
      "TaskNotesAcceptanceUITests.EnvironmentVariables.FACET_E2E_DESCRIPTOR",
      "-string",
      "/owned/acceptance.json",
    ],
    [
      "TaskNotesAcceptanceUITests.EnvironmentVariables.FACET_E2E_RUN_ID",
      "-string",
      "owned-run",
    ],
    [
      "TaskNotesAcceptanceUITests.EnvironmentVariables.FACET_OCCURRENCE_DAY",
      "-string",
      "2026-10-26",
    ],
    [
      "TaskNotesAcceptanceUITests.SystemAttachmentLifetime",
      "-string",
      "keepNever",
    ],
    [
      "TaskNotesAcceptanceUITests.UserAttachmentLifetime",
      "-string",
      "keepAlways",
    ],
  ]);
  expect(
    commands.every(
      (argv) =>
        argv[0] === "plutil" &&
        argv[1] === "-replace" &&
        argv.at(-1) === "/owned/test.xctestrun",
    ),
  ).toBe(true);
});

test("retention attempts attachment export after failed state copy and keeps both errors", async () => {
  const root = await directory();
  const result = path.join(root, "Result.xcresult");
  await Bun.write(path.join(result, "Info.plist"), "result");
  const commands: string[][] = [];
  const failures = await retainMacAcceptanceEvidence(
    path.join(root, "missing-state"),
    result,
    root,
    async (argv) => {
      commands.push(argv);
      throw new Error("export failed");
    },
  );
  expect(failures).toHaveLength(2);
  expect(String(failures[1])).toContain("export failed");
  expect(commands).toEqual([
    [
      "xcrun",
      "xcresulttool",
      "export",
      "attachments",
      "--path",
      result,
      "--output-path",
      path.join(root, "screenshots"),
    ],
  ]);
});

test("retention copies exact state without overwriting prior evidence and skips absent results", async () => {
  const root = await directory();
  const state = path.join(root, "owned-state");
  const evidence = path.join(root, "evidence");
  await mkdir(evidence);
  await Bun.write(path.join(state, "exact.txt"), "untouched\n");
  const command = async () => {
    throw new Error("No result exists to export");
  };
  expect(
    await retainMacAcceptanceEvidence(
      state,
      path.join(root, "absent.xcresult"),
      evidence,
      command,
    ),
  ).toEqual([]);
  expect(await Bun.file(path.join(evidence, "state/exact.txt")).text()).toBe(
    "untouched\n",
  );
  await Bun.write(path.join(state, "exact.txt"), "changed");
  expect(
    await retainMacAcceptanceEvidence(
      state,
      path.join(root, "absent.xcresult"),
      evidence,
      command,
    ),
  ).toHaveLength(1);
  expect(await Bun.file(path.join(evidence, "state/exact.txt")).text()).toBe(
    "untouched\n",
  );
});
