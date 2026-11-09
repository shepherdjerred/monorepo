import { expect, test } from "vitest";
import {
  CI_EXTENDED_VERIFY_PREFIX,
  extendedVerifyFailureMessage,
  extendedVerifyMessage,
  extendedVerifySucceeded,
  isTerminalPipelineStatus,
  supersededReceipt,
  type ExtendedVerifyReceipt,
} from "./ci-extended-verify.ts";

const receipt = (
  extra: Partial<ExtendedVerifyReceipt> = {},
): ExtendedVerifyReceipt => ({
  number: 4321,
  url: "https://woodpecker.sjer.red/repos/1/pipeline/4321",
  commit: "a".repeat(40),
  status: "success",
  workflows: [{ name: "verify-extended", state: "success" }],
  ...extra,
});

test("the nightly message never carries the maintenance prefix", () => {
  expect(extendedVerifyMessage("request-1")).toBe(
    `${CI_EXTENDED_VERIFY_PREFIX}request-1`,
  );
  expect(extendedVerifyMessage("request-1")).not.toContain("ci-maintenance/");
});

test.each(["created", "pending", "running", "blocked"])(
  "%s keeps polling",
  (status) => {
    expect(isTerminalPipelineStatus(status)).toBe(false);
  },
);
test.each([
  "success",
  "failure",
  "error",
  "killed",
  "canceled",
  "declined",
  "skipped",
])("%s is terminal", (status) => {
  expect(isTerminalPipelineStatus(status)).toBe(true);
});

test("only a receipt without the verification workflow is superseded", () => {
  expect(
    supersededReceipt(
      receipt({
        workflows: [{ name: "extended-superseded", state: "success" }],
      }),
    ),
  ).toBe(true);
  expect(supersededReceipt(receipt())).toBe(false);
  expect(
    supersededReceipt(
      receipt({
        workflows: [
          { name: "extended-superseded", state: "success" },
          { name: "verify-extended", state: "success" },
        ],
      }),
    ),
  ).toBe(false);
  expect(supersededReceipt(receipt({ workflows: [] }))).toBe(false);
});

test("a green receipt ran verify-extended to success; a skipped lane is not green", () => {
  expect(extendedVerifySucceeded(receipt())).toBe(true);
  expect(
    extendedVerifySucceeded(
      receipt({ workflows: [{ name: "verify-extended", state: "skipped" }] }),
    ),
  ).toBe(false);
  expect(extendedVerifySucceeded(receipt({ workflows: [] }))).toBe(false);
  expect(extendedVerifySucceeded(receipt({ status: "failure" }))).toBe(false);
  expect(
    extendedVerifySucceeded(
      receipt({
        workflows: [
          { name: "verify-extended", state: "success" },
          { name: "other", state: "failure" },
        ],
      }),
    ),
  ).toBe(false);
});

test("the failure message names the pipeline, its URL and the red workflows", () => {
  const message = extendedVerifyFailureMessage(
    receipt({
      status: "failure",
      workflows: [
        { name: "verify-extended", state: "failure" },
        { name: "extended-superseded", state: "success" },
      ],
    }),
  );
  expect(message).toContain("pipeline 4321");
  expect(message).toContain("ended failure");
  expect(message).toContain("verify-extended=failure");
  expect(message).not.toContain("extended-superseded=");
  expect(message).toContain(
    "https://woodpecker.sjer.red/repos/1/pipeline/4321",
  );
  expect(message).toContain("a".repeat(12));
  expect(
    extendedVerifyFailureMessage(receipt({ status: "success", workflows: [] })),
  ).toContain("no verify-extended workflow ran");
});
