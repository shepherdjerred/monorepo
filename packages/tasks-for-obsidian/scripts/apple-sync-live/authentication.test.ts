import { expect, test } from "vitest";
import { assertAuthenticationFixtureOutput } from "./authentication";

const cases = [
  "diagnosticsDistinguishPreflightAndPostRejectionWithoutContents",
  "verificationChallengeIsVisibleAndCredentialEditInvalidatesIt",
  "cancelledSignInDrainsAndResumesWithoutPublishingItsLateResponse",
  "oldProfileCredentialsCannotResumeUnderAnotherActiveAccount",
];
test("authentication evidence requires actual positive Swift Testing execution and selected cases", () => {
  const selected = cases.join("\n");
  expect(
    assertAuthenticationFixtureOutput(
      `${selected}\nTest run with 20 tests passed after 1 second.`,
    ),
  ).toBe(20);
  expect(() =>
    assertAuthenticationFixtureOutput(
      `${selected}\nExecuted 0 tests, with 0 failures. passed`,
    ),
  ).toThrow("did not execute");
  expect(() =>
    assertAuthenticationFixtureOutput(
      `${selected}\nTest run with 0 tests passed.`,
    ),
  ).toThrow("did not execute");
  expect(() =>
    assertAuthenticationFixtureOutput("Test run with 20 tests passed."),
  ).toThrow("did not execute");
});
