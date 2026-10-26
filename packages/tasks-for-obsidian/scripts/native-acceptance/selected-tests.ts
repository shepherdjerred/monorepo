import { z } from "zod";

type NativeCommand = (argv: string[], capture?: boolean) => Promise<string>;

/** Preserve the normal xctestrun environment and custom-only evidence policy. */
export async function configureIosJourneyTests(
  testRun: string,
  values: Readonly<Record<string, string>>,
  command: NativeCommand,
): Promise<void> {
  const configuration = z
    .object({
      TasksForObsidianUITests: z.object({
        EnvironmentVariables: z.record(z.string(), z.string()),
      }),
    })
    .parse(
      JSON.parse(
        await command(["plutil", "-convert", "json", "-o", "-", testRun], true),
      ),
    );
  const environment =
    configuration.TasksForObsidianUITests.EnvironmentVariables;
  for (const [key, value] of Object.entries(values)) {
    await command([
      "plutil",
      environment[key] === undefined ? "-insert" : "-replace",
      `TasksForObsidianUITests.EnvironmentVariables.${key}`,
      "-string",
      value,
      testRun,
    ]);
  }
  await command([
    "plutil",
    "-replace",
    "TasksForObsidianUITests.SystemAttachmentLifetime",
    "-string",
    "keepNever",
    testRun,
  ]);
}

/** The caller's existing bounded command owns the unchanged 180-second deadline. */
export async function runSelectedIosJourneyTest(
  selection: {
    testRun: string;
    device: string;
    result: string;
    suite:
      | "BoardTaskTests"
      | "MobileParityTests"
      | "OccurrenceTaskTests"
      | "DependencyEditorUITests";
    test: string;
  },
  command: NativeCommand,
): Promise<void> {
  await command([
    "xcodebuild",
    "test-without-building",
    "-xctestrun",
    selection.testRun,
    "-destination",
    `platform=iOS Simulator,id=${selection.device}`,
    "-parallel-testing-enabled",
    "NO",
    "-resultBundlePath",
    selection.result,
    "-collect-test-diagnostics",
    "never",
    "-test-timeouts-enabled",
    "YES",
    "-maximum-test-execution-time-allowance",
    "120",
    `-only-testing:TasksForObsidianUITests/${selection.suite}/${selection.test}`,
  ]);
}
