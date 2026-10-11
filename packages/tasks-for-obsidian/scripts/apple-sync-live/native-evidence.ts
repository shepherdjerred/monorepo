import { z } from "zod";

export const initialConfigurationJourneys = [
  { client: "ios", label: "initial-configuration-ios" },
  { client: "macos", label: "initial-configuration-macos" },
] as const;

export function assertDistinctNativeEvidenceLabels(
  journeys: readonly { label: string }[],
): void {
  if (new Set(journeys.map(({ label }) => label)).size !== journeys.length)
    throw new Error(
      "Native journeys must retain distinct evidence directories",
    );
}

const SummarySchema = z.object({
  result: z.string(),
  totalTestCount: z.number().int().nonnegative(),
  passedTests: z.number().int().nonnegative(),
  failedTests: z.number().int().nonnegative(),
  skippedTests: z.number().int().nonnegative(),
  expectedFailures: z.number().int().nonnegative(),
});
const NodeSchema = z.object({
  nodeType: z.string(),
  nodeIdentifier: z.string().optional(),
  nodeIdentifierURL: z.string().optional(),
  result: z.string().optional(),
  children: z.array(z.unknown()).optional(),
});

function testCases(value: unknown): z.infer<typeof NodeSchema>[] {
  const node = NodeSchema.parse(value);
  const descendants = (node.children ?? []).flatMap((child) =>
    testCases(child),
  );
  return node.nodeType === "Test Case" ? [node, ...descendants] : descendants;
}

/** Exit zero alone also describes a misspelled selector which ran no tests. */
export function assertExactNativeJourney(
  summaryValue: unknown,
  testsValue: unknown,
  target: string,
  selector: string,
): void {
  if (
    !/^[A-Za-z]\w*$/u.test(target) ||
    !/^[A-Za-z]\w*\/test\w+$/u.test(selector)
  )
    throw new Error("Invalid native journey selector");
  const summary = SummarySchema.parse(summaryValue);
  if (
    summary.result !== "Passed" ||
    summary.totalTestCount !== 1 ||
    summary.passedTests !== 1 ||
    summary.failedTests !== 0 ||
    summary.skippedTests !== 0 ||
    summary.expectedFailures !== 0
  )
    throw new Error(
      "Native journey did not execute exactly one passing test without skips",
    );
  const report = z
    .object({ testNodes: z.array(z.unknown()) })
    .parse(testsValue);
  const cases = report.testNodes.flatMap((node) => testCases(node));
  const [test, ...remaining] = cases;
  if (
    test === undefined ||
    remaining.length > 0 ||
    test.result !== "Passed" ||
    test.nodeIdentifier !== `${selector}()` ||
    test.nodeIdentifierURL?.endsWith(`/${target}/${selector}`) !== true
  )
    throw new Error(
      "Native journey result does not match its exact selected test",
    );
}
