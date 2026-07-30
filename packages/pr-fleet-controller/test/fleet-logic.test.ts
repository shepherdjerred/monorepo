import { describe, expect, test } from "bun:test";
import {
  classify,
  computeStackIds,
  mapBounded,
} from "@shepherdjerred/pr-fleet-controller/src/fleet-logic.ts";
import { evidence, identity } from "./fixtures.ts";

describe("readiness classification", () => {
  test("requires every current-head readiness signal", () => {
    const pr = identity(1);
    expect(classify(pr, evidence(pr), false)).toBe("green");
    expect(
      classify(pr, evidence(pr, { hostedReviewComplete: false }), false),
    ).toBe("pending");
    expect(classify(pr, evidence(pr, { conflict: true }), false)).toBe(
      "conflict",
    );
  });

  test("blocks unknown current automated findings but ignores soft failures", () => {
    const pr = identity(2);
    expect(
      classify(
        pr,
        evidence(pr, {
          reviewFindings: [
            {
              id: "finding",
              author: "codex",
              body: "This may break callers",
              severity: "unknown",
              resolved: false,
              outdated: false,
            },
          ],
        }),
        false,
      ),
    ).toBe("actionable-red");
    expect(
      classify(
        pr,
        evidence(pr, {
          checks: [
            {
              name: "knip",
              state: "FAILURE",
              bucket: "fail",
              link: null,
              softFail: true,
            },
          ],
        }),
        false,
      ),
    ).toBe("green");
  });

  test("pauses an unmodifiable fork with actionable failures", () => {
    const pr = identity(3, {
      crossRepository: true,
      maintainerCanModify: false,
    });
    const red = evidence(pr, {
      checks: [
        {
          name: "verify",
          state: "FAILURE",
          bucket: "fail",
          link: null,
          softFail: false,
        },
      ],
    });
    expect(classify(pr, red, false)).toBe("paused");
  });
});

test("stack identity follows open PR base and head relationships", () => {
  const root = identity(10, { headRefName: "feature/root" });
  const child = identity(11, {
    headRefName: "feature/child",
    baseRefName: "feature/root",
  });
  const independent = identity(12);
  const stacks = computeStackIds([root, child, independent]);
  expect(stacks.get(10)).toBe("pr-10");
  expect(stacks.get(11)).toBe("pr-10");
  expect(stacks.get(12)).toBe("pr-12");
});

test("bounded mapping never exceeds its concurrency contract", async () => {
  let active = 0;
  let maximum = 0;
  const results = await mapBounded([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await Bun.sleep(5);
    active -= 1;
    return value * 2;
  });
  expect(maximum).toBe(2);
  expect(results).toEqual([2, 4, 6, 8, 10]);
});
