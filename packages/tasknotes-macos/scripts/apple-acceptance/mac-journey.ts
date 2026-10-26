import assert from "node:assert/strict";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { acceptanceSigningArguments } from "../acceptance-test-plan.ts";

export type MacJourneyCommand = (
  argv: string[],
  capture?: boolean,
  cwd?: string,
) => Promise<string>;

/** Both isolated journeys build the same signed product; callers retain their deadlines. */
export async function buildMacAcceptance(
  derived: string,
  command: MacJourneyCommand,
  signingIdentity: string | undefined,
): Promise<void> {
  await command(["bun", "run", "mac:preflight"]);
  await command(["xcodegen", "generate"]);
  await command([
    "xcodebuild",
    "build-for-testing",
    "-project",
    "TaskNotes.xcodeproj",
    "-scheme",
    "TaskNotesAcceptance",
    "-configuration",
    "Debug",
    "-derivedDataPath",
    derived,
    "-destination",
    "platform=macOS",
    "-parallel-testing-enabled",
    "NO",
    "-jobs",
    "2",
    ...acceptanceSigningArguments(signingIdentity),
  ]);
}

export async function createMacAcceptanceState(
  state: string,
  descriptor: string,
  runID: string,
): Promise<void> {
  await mkdir(path.dirname(state), { recursive: true, mode: 0o700 });
  await mkdir(state, { recursive: false, mode: 0o700 });
  await Bun.write(
    descriptor,
    JSON.stringify({ schemaVersion: 1, runID, stateDirectory: state }),
  );
}

export async function macAcceptanceTestRun(derived: string): Promise<string> {
  const testRuns = await Array.fromAsync(
    new Bun.Glob("*.xctestrun").scan({
      cwd: path.join(derived, "Build/Products"),
      absolute: true,
    }),
  );
  assert.equal(testRuns.length, 1);
  const testRun = testRuns[0];
  assert.ok(testRun);
  return testRun;
}

export async function configureMacAcceptanceTestRun(
  testRun: string,
  environment: Record<string, string>,
  command: MacJourneyCommand,
): Promise<void> {
  for (const [key, value] of Object.entries(environment)) {
    await command([
      "plutil",
      "-replace",
      `TaskNotesAcceptanceUITests.EnvironmentVariables.${key}`,
      "-string",
      value,
      testRun,
    ]);
  }
  for (const [key, value] of [
    ["SystemAttachmentLifetime", "keepNever"],
    ["UserAttachmentLifetime", "keepAlways"],
  ] as const) {
    await command([
      "plutil",
      "-replace",
      `TaskNotesAcceptanceUITests.${key}`,
      "-string",
      value,
      testRun,
    ]);
  }
}

/** Attempt both evidence paths even when one fails, retaining every failure. */
export async function retainMacAcceptanceEvidence(
  state: string,
  result: string,
  evidence: string,
  command: MacJourneyCommand,
): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (const retain of [
    () =>
      cp(state, path.join(evidence, "state"), {
        recursive: true,
        errorOnExist: true,
        force: false,
      }),
    async () => {
      if (await Bun.file(path.join(result, "Info.plist")).exists())
        await command([
          "xcrun",
          "xcresulttool",
          "export",
          "attachments",
          "--path",
          result,
          "--output-path",
          path.join(evidence, "screenshots"),
        ]);
    },
  ]) {
    try {
      await retain();
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

export async function recordMacAcceptanceOutcome(
  receipt: Record<string, unknown>,
  failures: unknown[],
  evidence: string,
  failureMessage: string,
): Promise<void> {
  await Bun.write(
    path.join(evidence, "run.json"),
    JSON.stringify(
      { ...receipt, status: failures.length === 0 ? "passed" : "failed" },
      null,
      2,
    ),
  );
  if (failures.length > 0) throw new AggregateError(failures, failureMessage);
}
