import assert from "node:assert/strict";

export type StandaloneTest =
  | "testNativeVaultCaptureEditAndRelaunch"
  | "testDirtyInspectorNavigationAndWindowClosePreserveChanges"
  | "testIndependentWindowQueriesAndSelections"
  | "testQuickAddRetainsHiddenDraftAndAddsAnother";

export const standaloneTests: readonly StandaloneTest[] = [
  "testNativeVaultCaptureEditAndRelaunch",
  "testDirtyInspectorNavigationAndWindowClosePreserveChanges",
  "testIndependentWindowQueriesAndSelections",
  "testQuickAddRetainsHiddenDraftAndAddsAnother",
];

export const launchSmokeTest = "testAcceptanceFirstLaunchHasOneWorkspace";
export const launchSmokeSelector = `TaskNotesAcceptanceUITests/StandaloneVaultUITests/${launchSmokeTest}`;

export function isFullStandaloneSelection(
  tests: readonly StandaloneTest[],
): boolean {
  return (
    tests.length === standaloneTests.length &&
    standaloneTests.every((test) => tests.includes(test))
  );
}

const titleParts: Record<StandaloneTest, readonly [string, string]> = {
  testNativeVaultCaptureEditAndRelaunch: ["Native Mac", " edited"],
  testDirtyInspectorNavigationAndWindowClosePreserveChanges: [
    "Draft Mac",
    " closed",
  ],
  testIndependentWindowQueriesAndSelections: ["Windows Mac", ""],
  testQuickAddRetainsHiddenDraftAndAddsAnother: ["Quick Mac", " retained"],
};

export function selectStandaloneTests(
  args: readonly string[],
): StandaloneTest[] {
  if (args.length === 0) return [...standaloneTests];
  const selected = args.map((arg) => {
    const test = standaloneTests.find(
      (name) => arg === `--only-testing=${name}`,
    );
    assert.ok(test, `Unknown standalone test selector: ${arg}`);
    return test;
  });
  assert.equal(
    new Set(selected).size,
    selected.length,
    "Duplicate test selector",
  );
  return selected;
}

export function standaloneSelector(test: StandaloneTest): string {
  return `TaskNotesAcceptanceUITests/StandaloneVaultUITests/${test}`;
}

export function expectedStandaloneTitles(
  tests: readonly StandaloneTest[],
  runID: string,
): string[] {
  return tests.map((test) => {
    const [prefix, suffix] = titleParts[test];
    return `${prefix} ${runID}${suffix}`;
  });
}

export function acceptanceSigningArguments(
  identity: string | undefined,
): string[] {
  if (identity === undefined) return [];
  assert.match(
    identity,
    /^[0-9A-Fa-f]{40}$/u,
    "TASKNOTES_UITEST_IDENTITY must be a 40-hex Apple Development identity SHA-1",
  );
  return [`TASKNOTES_UITEST_IDENTITY=${identity}`];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nativeTestCases(value: unknown): Record<string, unknown>[] {
  assert.ok(isRecord(value), "Native test node must be an object");
  assert.equal(
    typeof value["nodeType"],
    "string",
    "Native node type is required",
  );
  const children = value["children"];
  assert.ok(
    children === undefined || Array.isArray(children),
    "Native children must be an array",
  );
  const descendants =
    children === undefined ? [] : children.flatMap(nativeTestCases);
  return value["nodeType"] === "Test Case"
    ? [value, ...descendants]
    : descendants;
}

/** An exit-zero test process can still have skipped or run the wrong cases. */
export function assertExactStandaloneResults(
  summary: unknown,
  report: unknown,
  selected: readonly StandaloneTest[],
): void {
  assertExactNativeResults(summary, report, selected);
}

export function assertExactLaunchSmokeResults(
  summary: unknown,
  report: unknown,
): void {
  assertExactNativeResults(summary, report, [launchSmokeTest]);
}

function assertExactNativeResults(
  summary: unknown,
  report: unknown,
  selected: readonly string[],
): void {
  assert.ok(selected.length > 0, "At least one native case must execute");
  assert.equal(
    new Set(selected).size,
    selected.length,
    "Native selections must be unique",
  );
  assert.ok(isRecord(summary), "Native summary must be an object");
  assert.equal(summary["result"], "Passed", "Native suite must pass");
  for (const field of ["totalTestCount", "passedTests"]) {
    assert.equal(
      summary[field],
      selected.length,
      "Every selected native case must execute and pass",
    );
  }
  for (const field of ["failedTests", "skippedTests", "expectedFailures"]) {
    assert.equal(
      summary[field],
      0,
      "Native acceptance permits no failures, skips, or expected failures",
    );
  }
  assert.ok(
    isRecord(report) && Array.isArray(report["testNodes"]),
    "Native test tree is required",
  );
  const cases = report["testNodes"].flatMap(nativeTestCases);
  assert.equal(
    cases.length,
    selected.length,
    "Native test tree must contain the exact selected case count",
  );
  for (const test of selected) {
    const identifier = `StandaloneVaultUITests/${test}()`;
    const matches = cases.filter(
      (entry) => entry["nodeIdentifier"] === identifier,
    );
    assert.equal(
      matches.length,
      1,
      `Native result must identify exactly one ${identifier}`,
    );
    const entry = matches[0];
    assert.ok(entry);
    assert.equal(
      entry["result"],
      "Passed",
      "Each native test must positively pass",
    );
    const url = entry["nodeIdentifierURL"];
    assert.ok(
      typeof url === "string" &&
        url.endsWith(
          `/TaskNotesAcceptanceUITests/StandaloneVaultUITests/${test}`,
        ),
      "Native result must belong to the exact acceptance target and selected method",
    );
  }
}

/** Exact title/status validation on persisted Markdown, independent of the UI. */
export function verifyStandaloneNotes(
  notes: readonly string[],
  titles: readonly string[],
): void {
  assert.equal(
    notes.length,
    titles.length,
    "Only one capture per selected workflow may exist",
  );
  const tasks = notes.map((note) => {
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(
      note,
    )?.[1];
    assert.ok(frontmatter !== undefined, "Task must have YAML frontmatter");
    const task: unknown = Bun.YAML.parse(frontmatter);
    assert.ok(isRecord(task), "Task frontmatter must be a mapping");
    assert.equal(typeof task["title"], "string", "Task title must be a string");
    assert.equal(task["status"], "open", "Task must finish reopened");
    return task;
  });
  for (const title of titles) {
    const matches = tasks.filter((task) => task["title"] === title);
    assert.equal(
      matches.length,
      1,
      `Expected exactly one persisted task: ${title}`,
    );
  }
}
