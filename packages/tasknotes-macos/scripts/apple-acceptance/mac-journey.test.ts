import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  buildMacAcceptance,
  configureMacAcceptanceTestRun,
  createMacAcceptanceState,
  macAcceptanceTestRun,
  recordMacAcceptanceOutcome,
  retainMacAcceptanceEvidence,
} from "./mac-journey.ts";

const directories: string[] = [];
async function directory(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "facet-mac-journey-control-"));
  directories.push(root);
  return root;
}
afterEach(async () => {
  for (const root of directories.splice(0)) await rm(root, { recursive: true });
});

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
