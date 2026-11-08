import { describe, expect, test } from "vitest";
import {
  assertExactNativeJourney,
  assertDistinctNativeEvidenceLabels,
  initialConfigurationJourneys,
} from "./native-evidence";

test("initial configuration retains separate iOS and macOS result bundles", () => {
  expect(initialConfigurationJourneys.map(({ client }) => client)).toEqual([
    "ios",
    "macos",
  ]);
  expect(() =>
    assertDistinctNativeEvidenceLabels(initialConfigurationJourneys),
  ).not.toThrow();
  expect(() =>
    assertDistinctNativeEvidenceLabels([
      { label: "initial-configuration" },
      { label: "initial-configuration" },
    ]),
  ).toThrow("distinct evidence directories");
});

const target = "TaskNotesAcceptanceUITests";
const selector =
  "LiveSyncLifecycleUITests/testReauthorizedReplicaRetainsTaskAndColdRelaunch";
const summary = {
  result: "Passed",
  totalTestCount: 1,
  passedTests: 1,
  failedTests: 0,
  skippedTests: 0,
  expectedFailures: 0,
};
function report(identifier = selector, bundle = target, result = "Passed") {
  return {
    testNodes: [
      {
        nodeType: "Test Plan",
        children: [
          {
            nodeType: "UI test bundle",
            children: [
              {
                nodeType: "Test Case",
                result,
                nodeIdentifier: `${identifier}()`,
                nodeIdentifierURL: `test://com.apple.xcode/TaskNotes/${bundle}/${identifier}`,
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("exact selected native journey evidence", () => {
  test("accepts one positively identified passing selected case", () => {
    expect(() =>
      assertExactNativeJourney(summary, report(), target, selector),
    ).not.toThrow();
  });
  test.each([
    { totalTestCount: 0, passedTests: 0 },
    { skippedTests: 1 },
    { failedTests: 1 },
    { expectedFailures: 1 },
    { totalTestCount: 2, passedTests: 2 },
  ])("rejects missing, skipped, failed or extra executions: %o", (change) => {
    expect(() =>
      assertExactNativeJourney(
        { ...summary, ...change },
        report(),
        target,
        selector,
      ),
    ).toThrow();
  });
  test("rejects another test or target even if the summary reports success", () => {
    expect(() =>
      assertExactNativeJourney(
        summary,
        report("OtherTests/testOther"),
        target,
        selector,
      ),
    ).toThrow();
    expect(() =>
      assertExactNativeJourney(
        summary,
        report(selector, "OtherUITests"),
        target,
        selector,
      ),
    ).toThrow();
    expect(() =>
      assertExactNativeJourney(
        summary,
        report(selector, target, "Skipped"),
        target,
        selector,
      ),
    ).toThrow();
  });
  test("rejects absent cases and an extra case hidden by an inconsistent summary", () => {
    expect(() =>
      assertExactNativeJourney(summary, { testNodes: [] }, target, selector),
    ).toThrow();
    const two = report();
    two.testNodes.push(...report("OtherTests/testOther").testNodes);
    expect(() =>
      assertExactNativeJourney(summary, two, target, selector),
    ).toThrow();
  });
});
