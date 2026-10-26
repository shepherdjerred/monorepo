import { describe, expect, test } from "vitest";
import {
  acceptanceSigningArguments,
  assertExactNativeResults,
  assertExactStandaloneResults,
  expectedStandaloneTitles,
  isFullStandaloneSelection,
  selectStandaloneTests,
  standaloneSelector,
  standaloneTests,
  verifyStandaloneNotes,
} from "./acceptance-test-plan.ts";

describe.each([
  {
    suite: "BoardTaskTests",
    method: "testLoadMoreMakesCardBeyondTheInitialHundredReachable",
    wrongSuite: "MobileParityTests",
    wrongMethod: "testWrongCase",
  },
  {
    suite: "MobileParityTests",
    method: "testTodayUpcomingAndGlobalMetadataSearch",
    wrongSuite: "StandaloneTaskTests",
    wrongMethod: "testWrongMethod",
  },
] as const)(
  "dedicated $suite selected-test proof",
  ({ suite, method, wrongSuite, wrongMethod }) => {
    const summary = {
      result: "Passed",
      totalTestCount: 1,
      passedTests: 1,
      failedTests: 0,
      skippedTests: 0,
      expectedFailures: 0,
    };
    const entry = {
      nodeType: "Test Case",
      result: "Passed",
      nodeIdentifier: `${suite}/${method}()`,
      nodeIdentifierURL: `test://com.apple.xcode/TasksForObsidian/TasksForObsidianUITests/${suite}/${method}`,
    };
    const identity = {
      target: "TasksForObsidianUITests",
      suite,
    } as const;

    test("accepts exactly the selected passing iOS parity method", () => {
      expect(() =>
        assertExactNativeResults(
          summary,
          { testNodes: [entry] },
          [method],
          identity,
        ),
      ).not.toThrow();
    });

    test.each([
      {
        ...entry,
        nodeIdentifierURL: entry.nodeIdentifierURL.replace(
          "TasksForObsidianUITests",
          "TaskNotesAcceptanceUITests",
        ),
      },
      { ...entry, nodeIdentifier: `${wrongSuite}/${method}()` },
      {
        ...entry,
        nodeIdentifierURL: entry.nodeIdentifierURL.replace(
          suite,
          "OccurrenceTaskTests",
        ),
      },
      { ...entry, nodeIdentifier: `${suite}/${wrongMethod}()` },
      { ...entry, result: "Skipped" },
    ])(
      "rejects a wrong target, suite, method or nonpassing node",
      (invalid) => {
        expect(() =>
          assertExactNativeResults(
            summary,
            { testNodes: [invalid] },
            [method],
            identity,
          ),
        ).toThrow();
      },
    );

    test("rejects missing or duplicated parity cases even after exit zero", () => {
      for (const testNodes of [[], [entry, entry]]) {
        expect(() =>
          assertExactNativeResults(summary, { testNodes }, [method], identity),
        ).toThrow();
      }
    });
  },
);

describe("standalone native test selection", () => {
  test("defaults to every required workflow and retains explicit narrowed selection", () => {
    expect(selectStandaloneTests([])).toEqual(standaloneTests);
    const selected = selectStandaloneTests([
      "--only-testing=testQuickAddRetainsHiddenDraftAndAddsAnother",
    ]);
    expect(selected).toEqual(["testQuickAddRetainsHiddenDraftAndAddsAnother"]);
    expect(selected.map(standaloneSelector)).toEqual([
      "TaskNotesAcceptanceUITests/StandaloneVaultUITests/testQuickAddRetainsHiddenDraftAndAddsAnother",
    ]);
    expect(expectedStandaloneTitles(selected, "run")).toEqual([
      "Quick Mac run retained",
    ]);
    expect(isFullStandaloneSelection(selected)).toBe(false);
    expect(isFullStandaloneSelection([])).toBe(false);
    expect(isFullStandaloneSelection([...standaloneTests].reverse())).toBe(
      true,
    );
  });

  test("rejects unknown, legacy, live, and repeated selectors before launching", () => {
    for (const args of [
      ["--only-testing=Missing"],
      ["--only-testing=TaskNotesUITests/QuickAddPanelUITests"],
      ["--only-testing=LiveSyncVaultUITests"],
      [
        "--only-testing=testNativeVaultCaptureEditAndRelaunch",
        "--only-testing=testNativeVaultCaptureEditAndRelaunch",
      ],
    ])
      expect(() => selectStandaloneTests(args)).toThrow();
  });
});

describe("persisted native workflow proof", () => {
  const note = "---\ntitle: Native Mac run edited\nstatus: open\n---\n";
  test.each(["open", '"open"', "'open'"])(
    "accepts the YAML string status %s from a persisted note",
    (status) => {
      const persisted = `---\ntitle: "Native Mac run edited"\nstatus: ${status}\n---\nBody remains Markdown.\n`;
      expect(() =>
        verifyStandaloneNotes([persisted], ["Native Mac run edited"]),
      ).not.toThrow();
      expect(() =>
        verifyStandaloneNotes(
          [persisted.replaceAll("\n", "\r\n")],
          ["Native Mac run edited"],
        ),
      ).not.toThrow();
    },
  );

  test.each([
    "---\ntitle: Native Mac run edited\nstatus: done\n---\nstatus: open\n",
    "---\ntitle: Wrong title\nstatus: open\n---\ntitle: Native Mac run edited\n",
    "---\ntitle: Native Mac run edited\n---\nstatus: open\n",
    "---\nstatus: open\n---\ntitle: Native Mac run edited\n",
    "---\ntitle: Native Mac run edited\nstatus: [open\n---\n",
    "---\ntitle: Native Mac run edited\nstatus: open\n",
    "title: Native Mac run edited\nstatus: open\n",
    "---\n[Native Mac run edited, open]\n---\n",
    "---\nnull\n---\n",
    "---\ntitle: [Native Mac run edited]\nstatus: open\n---\n",
    "---\ntitle: Native Mac run edited\nstatus: [open]\n---\n",
    "---\ntitle: Native Mac run edited\nstatus: true\n---\n",
  ])(
    "rejects invalid frontmatter even when the body resembles a task",
    (persisted) => {
      expect(() =>
        verifyStandaloneNotes([persisted], ["Native Mac run edited"]),
      ).toThrow();
    },
  );

  test("requires exactly one final open task per selected test", () => {
    expect(() =>
      verifyStandaloneNotes([note], ["Native Mac run edited"]),
    ).not.toThrow();
    expect(() =>
      verifyStandaloneNotes([], ["Native Mac run edited"]),
    ).toThrow();
    expect(() =>
      verifyStandaloneNotes([note, note], ["Native Mac run edited"]),
    ).toThrow();
    expect(() =>
      verifyStandaloneNotes(
        [note.replace("open", "done")],
        ["Native Mac run edited"],
      ),
    ).toThrow();
    expect(() => verifyStandaloneNotes([note], ["Wrong title"])).toThrow();
  });
  test("zero-task smoke accepts only the untouched seed note set", () => {
    expect(() => verifyStandaloneNotes([], [])).not.toThrow();
    expect(() => verifyStandaloneNotes([note], [])).toThrow();
  });
});

describe("runner-only signing bootstrap", () => {
  test("allows default ad-hoc or exactly one operator identity setting", () => {
    expect(acceptanceSigningArguments(undefined)).toEqual([]);
    const identity = "A".repeat(40);
    expect(acceptanceSigningArguments(identity)).toEqual([
      `TASKNOTES_UITEST_IDENTITY=${identity}`,
    ]);
    for (const identity of [
      "",
      "-",
      "Developer ID",
      "A".repeat(39),
      "G".repeat(40),
    ]) {
      expect(() => acceptanceSigningArguments(identity)).toThrow();
    }
  });
});

describe("positive native selected-test proof", () => {
  const summary = {
    result: "Passed",
    totalTestCount: 4,
    passedTests: 4,
    failedTests: 0,
    skippedTests: 0,
    expectedFailures: 0,
  };
  function node(
    test: string,
    result = "Passed",
    target = "TaskNotesAcceptanceUITests",
  ) {
    return {
      nodeType: "Test Case",
      result,
      nodeIdentifier: `StandaloneVaultUITests/${test}()`,
      nodeIdentifierURL: `test://com.apple.xcode/TaskNotes/${target}/StandaloneVaultUITests/${test}`,
    };
  }
  function report(cases = standaloneTests.map((test) => node(test))) {
    return {
      testNodes: [
        {
          nodeType: "Test Plan",
          children: [{ nodeType: "UI test bundle", children: cases }],
        },
      ],
    };
  }

  test("requires all four positively identified passing cases", () => {
    expect(() =>
      assertExactStandaloneResults(summary, report(), standaloneTests),
    ).not.toThrow();
  });
  test("a narrowed run proves only its recorded selected method", () => {
    const selected = selectStandaloneTests([
      "--only-testing=testNativeVaultCaptureEditAndRelaunch",
    ]);
    const one = { ...summary, totalTestCount: 1, passedTests: 1 };
    expect(() =>
      assertExactStandaloneResults(
        one,
        report(selected.map((test) => node(test))),
        selected,
      ),
    ).not.toThrow();
    expect(() =>
      assertExactStandaloneResults(
        one,
        report(selected.map((test) => node(test))),
        standaloneTests,
      ),
    ).toThrow();
  });
  test.each([
    { totalTestCount: 0, passedTests: 0 },
    { skippedTests: 1 },
    { failedTests: 1 },
    { expectedFailures: 1 },
    { result: "Failed" },
    { totalTestCount: 5, passedTests: 5 },
  ])("rejects incomplete or nonpassing summary: %o", (change) => {
    expect(() =>
      assertExactStandaloneResults(
        { ...summary, ...change },
        report(),
        standaloneTests,
      ),
    ).toThrow();
  });
  test("rejects missing, extra and duplicate cases even when summary claims success", () => {
    const cases = standaloneTests.map((test) => node(test));
    expect(() =>
      assertExactStandaloneResults(
        summary,
        report(cases.slice(1)),
        standaloneTests,
      ),
    ).toThrow();
    expect(() =>
      assertExactStandaloneResults(
        summary,
        report([...cases, node("testUnexpected")]),
        standaloneTests,
      ),
    ).toThrow();
    expect(() =>
      assertExactStandaloneResults(
        summary,
        report([...cases.slice(1), node(standaloneTests[1] ?? "")]),
        standaloneTests,
      ),
    ).toThrow();
  });
  test.each(["Skipped", "Failed", "Expected Failure", "Not Run"])(
    "rejects case result %s hidden by summary",
    (result) => {
      const cases = standaloneTests.map((test) => node(test));
      cases[0] = node("testNativeVaultCaptureEditAndRelaunch", result);
      expect(() =>
        assertExactStandaloneResults(summary, report(cases), standaloneTests),
      ).toThrow();
    },
  );
  test("rejects the wrong runner identity and malformed result documents", () => {
    const cases = standaloneTests.map((test) =>
      node(test, "Passed", "TaskNotesUITests"),
    );
    expect(() =>
      assertExactStandaloneResults(summary, report(cases), standaloneTests),
    ).toThrow();
    for (const malformed of [
      null,
      {},
      { testNodes: [] },
      { testNodes: [{ nodeType: "Test Plan", children: null }] },
    ]) {
      expect(() =>
        assertExactStandaloneResults(summary, malformed, standaloneTests),
      ).toThrow();
    }
    expect(() =>
      assertExactStandaloneResults(null, report(), standaloneTests),
    ).toThrow();
  });
});
