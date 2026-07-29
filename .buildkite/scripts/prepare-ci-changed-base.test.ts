import { expect, test } from "bun:test";
import {
  fixedCorpusForcesLane,
  fixedCorpusLaneMetadata,
  fixedCorpusMode,
  laneMetadata,
  selectBase,
} from "./migration-core.ts";

test("selects the newest green commit other than the head", () => {
  expect(selectBase([{ commit: "head" }, { commit: "base" }], "head")).toBe(
    "base",
  );
});

test("rejects malformed API data", () => {
  expect(() => selectBase({}, "head")).toThrow("array");
  expect(() => selectBase([{}, { commit: "" }], "head")).toThrow(
    "no earlier green commit",
  );
});

test("precomputes non-Bun lane decisions with fail-open metadata defaults", () => {
  expect(laneMetadata("resume", false, "base")).toEqual({
    "ci-lane-run-resume": "false",
    "ci-lane-decision-resume": "skipped — unchanged since base",
  });
  expect(laneMetadata("playwright", true, "base")).toEqual({
    "ci-lane-run-playwright": "true",
    "ci-lane-decision-playwright": "ran — matching changes since base",
  });
});

test("forces only fixed-corpus lanes on main", () => {
  const environment = {
    CI_IO_FIXED_CORPUS: "true",
    BUILDKITE_BRANCH: "main",
  };
  expect(fixedCorpusMode(environment)).toBe(true);
  expect(fixedCorpusForcesLane("playwright", environment)).toBe(true);
  expect(fixedCorpusForcesLane("resume", environment)).toBe(true);
  expect(fixedCorpusForcesLane("sites", environment)).toBe(false);
  expect(fixedCorpusLaneMetadata("playwright")).toEqual({
    "ci-lane-run-playwright": "true",
    "ci-lane-decision-playwright": "ran — fixed CI I/O corpus requested",
  });
});

test("keeps normal selectors unchanged without fixed-corpus mode", () => {
  expect(fixedCorpusMode({ BUILDKITE_BRANCH: "main" })).toBe(false);
  expect(
    fixedCorpusForcesLane("playwright", { BUILDKITE_BRANCH: "main" }),
  ).toBe(false);
});

test("rejects invalid and non-main fixed-corpus requests", () => {
  expect(() =>
    fixedCorpusMode({
      CI_IO_FIXED_CORPUS: "TRUE",
      BUILDKITE_BRANCH: "main",
    }),
  ).toThrow('must be exactly "true"');
  expect(() =>
    fixedCorpusMode({
      CI_IO_FIXED_CORPUS: "true",
      BUILDKITE_BRANCH: "feature/example",
    }),
  ).toThrow("main-only");
  expect(() => fixedCorpusMode({ CI_IO_FIXED_CORPUS: "true" })).toThrow(
    "BUILDKITE_BRANCH was unset",
  );
});
