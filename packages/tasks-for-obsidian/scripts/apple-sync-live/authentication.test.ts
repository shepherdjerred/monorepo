import { expect, test } from "vitest";
import { assertAuthenticationFixtureOutput } from "./authentication";

const cases = [
  "diagnosticsDistinguishPreflightAndPostRejectionWithoutContents",
  "verificationChallengeIsVisibleAndCredentialEditInvalidatesIt",
  "cancelledSignInDrainsAndResumesWithoutPublishingItsLateResponse",
  "oldProfileCredentialsCannotResumeUnderAnotherActiveAccount",
] as const;

function run(names: readonly string[], count: number) {
  return [
    "◇ Test run started.",
    "↳ Testing Library Version: 2074",
    ...names.map((name) => `◇ Test ${name}() started.`),
    ...names.map((name) => `✔ Test ${name}() passed after 0.027 seconds.`),
    `✔ Test run with ${String(count)} tests in 2 suites passed after 0.027 seconds.`,
  ].join("\n");
}

const actualTargets = [
  run(cases.slice(1, 3), 15),
  run([cases[0], cases[3]], 10),
].join("\n");

test("authentication evidence sums both SwiftPM executables rather than only the first summary", () => {
  expect(assertAuthenticationFixtureOutput(actualTargets)).toBe(25);
  expect(
    assertAuthenticationFixtureOutput(actualTargets.replaceAll("\n", "\r\n")),
  ).toBe(25);
});

test("Swift Testing summaries count tests rather than parameterized test cases or XCTest wrappers", () => {
  expect(
    assertAuthenticationFixtureOutput(
      `${actualTargets}\n✔ Test parameterized(outcome:) with 4 test cases passed after 0.027 seconds.\nExecuted 0 tests, with 0 failures (0 unexpected) in 0.000 seconds`,
    ),
  ).toBe(25);
});

test("every started target must have one positive complete summary", () => {
  for (const invalid of [
    `${run(cases, 15)}\n◇ Test run started.`,
    `${run(cases, 15)}\n✔ Test run with 10 tests in 2 suites passed after 0.027 seconds.`,
    `${run(cases, 15)}\n✔ Test run with 15 tests in 2 suites passed after 0.027 seconds.\n◇ Test run started.`,
    `◇ Test run started.\n${run(cases, 15)}`,
    run(cases, 0),
    `${run(cases, 15)}\n${run([], 0)}`,
    run(cases, Number.MAX_SAFE_INTEGER + 1),
    `${run(cases, Number.MAX_SAFE_INTEGER)}\n${run([], 1)}`,
    run(cases, 15).replace("passed after 0.027 seconds.", "started."),
    run(cases, 15).replace(
      "✔ Test run with 15 tests in 2 suites passed after 0.027 seconds.",
      "✔ Test run with 15 tests in 2 suites\nAn unrelated operation passed after 0.027 seconds.",
    ),
  ]) {
    expect(() => assertAuthenticationFixtureOutput(invalid)).toThrow();
  }
});

test("failed, skipped and ignored results cannot be hidden beside a passing target", () => {
  for (const outcome of ["failed", "skipped", "ignored"]) {
    expect(() =>
      assertAuthenticationFixtureOutput(
        `${run(cases, 15)}\n${run([], 10).replace("passed after", `${outcome} after`)}`,
      ),
    ).toThrow("did not execute");
    expect(() =>
      assertAuthenticationFixtureOutput(
        `${actualTargets}\n↷ Test otherCase() ${outcome} after 0.027 seconds.`,
      ),
    ).toThrow("did not execute");
  }
  expect(() =>
    assertAuthenticationFixtureOutput(
      actualTargets.replace(
        "✔ Test run with 10 tests in 2 suites passed after 0.027 seconds.",
        "✔ Test run with 10 tests in 2 suites passed after 0.027 seconds with 1 test skipped.",
      ),
    ),
  ).toThrow("did not execute");
});

test("required cases must actually pass, not merely appear in start or diagnostic output", () => {
  for (const name of cases) {
    expect(() =>
      assertAuthenticationFixtureOutput(
        actualTargets.replace(
          `✔ Test ${name}() passed after 0.027 seconds.`,
          `Diagnostic mentions ${name}`,
        ),
      ),
    ).toThrow("did not execute");
  }
  for (const invalid of [
    `${cases.join("\n")}\nExecuted 0 tests, with 0 failures. passed`,
    "✔ Test run with 20 tests passed after 1 second.",
    run([], 20),
  ]) {
    expect(() => assertAuthenticationFixtureOutput(invalid)).toThrow(
      "did not execute",
    );
  }
});
