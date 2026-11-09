import { expect, test } from "vitest";
import { evaluateMainRun } from "#lib/ci/wait/main.ts";
import type { MainRunSnapshot } from "#lib/ci/main.ts";
import type { WoodpeckerPipeline } from "#lib/woodpecker/ci.ts";
import { CI_HEAD } from "./fixtures.ts";

function run(status: string, failed?: string): WoodpeckerPipeline {
  return {
    number: 11,
    event: "push",
    status,
    commit: CI_HEAD,
    branch: "main",
    ref: "refs/heads/main",
    workflows: [
      { name: "verify", state: failed === "verify" ? "failure" : status },
      { name: "images", state: status === "failure" ? "success" : status },
    ],
  };
}

function snapshot(
  pipeline: WoodpeckerPipeline | null,
  tipSha = CI_HEAD,
): MainRunSnapshot {
  return { sha: CI_HEAD, tipSha, run: pipeline, url: null };
}

test("a pinned main commit waits until its own run exists and finishes", () => {
  expect(evaluateMainRun(snapshot(null)).outcome).toBe("waiting");
  expect(evaluateMainRun(snapshot(run("running"))).outcome).toBe("waiting");
  expect(evaluateMainRun(snapshot(run("pending"))).outcome).toBe("waiting");
});

test("a pinned main commit passes or fails on its own run", () => {
  expect(evaluateMainRun(snapshot(run("success"))).outcome).toBe("ready");
  const failed = evaluateMainRun(snapshot(run("failure", "verify")));
  expect(failed.outcome).toBe("failure");
  expect(failed.reasons).toContain("verify failed");
});

test("a superseded tip still reports the pinned commit's verdict and says so", () => {
  const verdict = evaluateMainRun(snapshot(run("success"), "c".repeat(40)));
  expect(verdict.outcome).toBe("ready");
  expect(verdict.reasons.join(" ")).toContain("Main has advanced");
});
