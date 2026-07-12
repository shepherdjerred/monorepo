import { afterEach, describe, expect, it } from "bun:test";
import {
  applyBuildAgePriority,
  BUILD_AGE_SCALE,
} from "../lib/build-age-priority.ts";
import type { BuildkitePipeline } from "../lib/types.ts";

function pipeline(): BuildkitePipeline {
  return {
    agents: { queue: "default" },
    steps: [
      { label: "lint", key: "lint", command: "lint" }, // no priority (defaults to 0)
      { label: "deploy", key: "deploy", command: "deploy", priority: 1 },
      { wait: "~" },
      {
        group: "images",
        key: "images",
        steps: [
          { label: "build", key: "build", command: "build" },
          { label: "push", key: "push", command: "push", priority: 1 },
        ],
      },
    ],
  };
}

function priorityOf(p: BuildkitePipeline, key: string): number | undefined {
  for (const step of p.steps) {
    if ("command" in step && step.key === key) return step.priority;
    if ("group" in step) {
      for (const child of step.steps) {
        if (child.key === key) return child.priority;
      }
    }
  }
  throw new Error(`step ${key} not found`);
}

const ORIGINAL_BUILD_NUMBER = Bun.env["BUILDKITE_BUILD_NUMBER"];
afterEach(() => {
  if (ORIGINAL_BUILD_NUMBER === undefined) {
    delete Bun.env["BUILDKITE_BUILD_NUMBER"];
  } else {
    Bun.env["BUILDKITE_BUILD_NUMBER"] = ORIGINAL_BUILD_NUMBER;
  }
});

describe("applyBuildAgePriority", () => {
  it("subtracts buildNumber * scale while preserving per-step priority", () => {
    const p = applyBuildAgePriority(pipeline(), 100);
    const offset = 100 * BUILD_AGE_SCALE;
    expect(priorityOf(p, "lint")).toBe(0 - offset);
    expect(priorityOf(p, "deploy")).toBe(1 - offset);
    expect(priorityOf(p, "build")).toBe(0 - offset); // group child
    expect(priorityOf(p, "push")).toBe(1 - offset); // group child
  });

  it("ranks an older build above a newer build (smaller number = higher priority)", () => {
    const older = applyBuildAgePriority(pipeline(), 100);
    const newer = applyBuildAgePriority(pipeline(), 101);
    expect(priorityOf(older, "lint")).toBeGreaterThan(
      priorityOf(newer, "lint")!,
    );
  });

  it("keeps an older build's normal step above a newer build's deploy step", () => {
    const older = applyBuildAgePriority(pipeline(), 100);
    const newer = applyBuildAgePriority(pipeline(), 101);
    // cross-build ordering must dominate the intra-build deploy bump
    expect(priorityOf(older, "lint")).toBeGreaterThan(
      priorityOf(newer, "deploy")!,
    );
  });

  it("keeps deploy steps ahead of normal steps within the same build", () => {
    const p = applyBuildAgePriority(pipeline(), 100);
    expect(priorityOf(p, "deploy")).toBeGreaterThan(priorityOf(p, "lint")!);
    expect(priorityOf(p, "push")).toBeGreaterThan(priorityOf(p, "build")!);
  });

  it("leaves wait steps untouched", () => {
    const p = applyBuildAgePriority(pipeline(), 100);
    const wait = p.steps.find((s) => "wait" in s);
    expect(wait).toEqual({ wait: "~" });
  });

  it("is a no-op when no build number is available (local generation)", () => {
    const p = applyBuildAgePriority(pipeline(), null);
    expect(priorityOf(p, "lint")).toBeUndefined();
    expect(priorityOf(p, "deploy")).toBe(1);
  });

  it("reads BUILDKITE_BUILD_NUMBER from the environment by default", () => {
    Bun.env["BUILDKITE_BUILD_NUMBER"] = "7";
    const p = applyBuildAgePriority(pipeline());
    expect(priorityOf(p, "lint")).toBe(-7 * BUILD_AGE_SCALE);
  });

  it("treats a missing/invalid build number as no-op", () => {
    delete Bun.env["BUILDKITE_BUILD_NUMBER"];
    expect(priorityOf(applyBuildAgePriority(pipeline()), "deploy")).toBe(1);
    Bun.env["BUILDKITE_BUILD_NUMBER"] = "not-a-number";
    expect(priorityOf(applyBuildAgePriority(pipeline()), "deploy")).toBe(1);
  });
});
