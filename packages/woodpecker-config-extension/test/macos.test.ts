import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { macosSteps } from "#src/pipeline/lanes/macos.ts";
import { emitWorkflow } from "#src/pipeline/emit.ts";
import { TEST_IDENTITY, testPipelineSteps } from "./identity.ts";

describe("macOS native lanes", () => {
  const steps = macosSteps();

  test("cover the three native surfaces", () => {
    expect(steps.map((s) => s.key)).toEqual([
      "quotabar-macos",
      "hkctl-native",
      "tasknotes-native",
    ]);
  });

  /**
   * These run directly on the host as the logged-in user. A pod spec would be
   * meaningless, and Kubernetes secret grants would silently deliver nothing.
   */
  test("emit no pod spec and no secret grants", () => {
    for (const step of steps) {
      expect(step.backend).toBe("local");
      expect(step.secrets).toBeUndefined();
      const parsed: unknown = parse(emitWorkflow(step, TEST_IDENTITY));
      expect(parsed).not.toHaveProperty("steps.0.backend_options");
    }
  });

  test("target the Mac agent by label", () => {
    for (const step of steps) {
      const parsed: unknown = parse(emitWorkflow(step, TEST_IDENTITY));
      expect(parsed).toMatchObject({
        labels: { platform: "darwin/arm64", backend: "local" },
      });
    }
  });

  /**
   * The other half of that guard, and the one that was missing.
   *
   * Woodpecker runs a workflow on any agent satisfying every label the
   * workflow requests, so a Linux workflow requesting nothing was eligible for
   * the Mac — where the local backend would have run its commands directly on
   * the host instead of in the container the step declares.
   */
  test("every container step demands a container backend", () => {
    const containerSteps = testPipelineSteps().filter(
      (step) => step.backend !== "local",
    );
    expect(containerSteps.length).toBeGreaterThan(0);

    for (const step of containerSteps) {
      const parsed: unknown = parse(emitWorkflow(step, TEST_IDENTITY));
      expect(
        parsed,
        `${step.key} must not be schedulable on the Mac`,
      ).toMatchObject({ labels: { backend: "kubernetes" } });
    }
  });

  /** One Mac means one native job at a time, across every build. */
  test("share a single global serialization group", () => {
    for (const step of steps) {
      expect(step.concurrency).toEqual({ limit: 1, group: "macos-native" });
    }
  });

  /** A Swift host must not be occupied by a branch that does not typecheck. */
  test("gate on the Linux verify", () => {
    for (const step of steps) {
      expect(step.dependsOn).toEqual(["verify"]);
    }
  });

  test("validate the host toolchain before doing any work", () => {
    for (const step of steps) {
      expect(step.commands[0]).toContain("macos-native-env.sh");
    }
  });
});
