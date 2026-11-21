import { describe, expect, test } from "vitest";
import { flagDeployments } from "./deployments.ts";
import { evaluateBoolean, evaluateString } from "./evaluate.ts";
import {
  projectDeploymentById,
  projectDeploymentFlags,
} from "./project-deployment.ts";

describe("projectDeploymentFlags", () => {
  test("every real deployment fits the evaluator", () => {
    for (const deployment of flagDeployments) {
      const flags = projectDeploymentFlags(deployment);
      expect(flags.length).toBeGreaterThan(0);
      expect(new Set(flags.map((flag) => flag.key)).size).toBe(flags.length);
    }
  });

  test("Scout beta Dares matches its guild segment and otherwise stays off", () => {
    const flags = projectDeploymentById("scout/beta");
    const dares = flags.find((flag) => flag.key === "dares_enabled");
    if (dares?.type !== "boolean") throw new Error("dares_enabled missing");
    const constraint = dares.rollouts[0]?.constraints[0];
    if (constraint === undefined) throw new Error("dares segment missing");
    expect(
      evaluateBoolean(flags, "dares_enabled", {
        [constraint.property]: constraint.value,
      }),
    ).toEqual({ kind: "value", value: true });
    expect(evaluateBoolean(flags, "dares_enabled", {})).toEqual({
      kind: "value",
      value: false,
    });
  });

  test("Scout prod Dares has no segment, and the explore model is the variant string", () => {
    const flags = projectDeploymentById("scout/prod");
    expect(
      evaluateBoolean(flags, "dares_enabled", { server: "anyone" }),
    ).toEqual({ kind: "value", value: false });
    expect(evaluateString(flags, "scout-explore-model")).toEqual({
      kind: "value",
      value: "gpt-6-luna",
    });
  });
});
