import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { routeSteps, type RoutingContext } from "#src/pipeline/routing.ts";
import { completionStep, noWorkStep } from "#src/pipeline/completion.ts";
import { buildPipelineSteps } from "#src/pipeline/steps.ts";
import { emitWorkflow } from "#src/pipeline/emit.ts";
import { GATE_TIER } from "#src/pipeline/tiers.ts";
import { TEST_IDENTITY, TEST_IMAGES } from "./identity.ts";

const image = `ghcr.io/shepherdjerred/woodpecker-config-extension@sha256:${"c".repeat(64)}`;
const context: RoutingContext = {
  event: "pull_request",
  branch: "main",
  defaultBranch: "main",
  draft: false,
};
const steps = buildPipelineSteps({
  images: TEST_IMAGES,
  trustedGateImage: image,
  changedBase: "",
});
const verify = steps.find((step) => step.key === "verify");
const review = steps.find((step) => step.key === "codex-review-gate");
if (verify === undefined || review === undefined)
  throw new Error("missing gate fixtures");
const complete = completionStep([verify, review], image, "/app");

describe("agent pool routing", () => {
  test("keeps a PR targeting main in the PR pool", () => {
    expect(routeSteps([verify], context, image)[0]?.agentLabels).toEqual({
      "ci-pool": "pr",
      "kueue.x-k8s.io/priority-class": "ci-ready",
    });
  });

  test.each(["push", "manual"])(
    "routes a default-branch %s to main",
    (event) => {
      expect(
        routeSteps([verify], { ...context, event }, image)[0]?.agentLabels,
      ).toEqual({
        "ci-pool": "main",
        "kueue.x-k8s.io/priority-class": "ci-main",
      });
      expect(
        routeSteps([verify], { ...context, event, branch: "feature" }, image)[0]
          ?.agentLabels?.["ci-pool"],
      ).toBe("pr");
    },
  );

  test("uses draft priority without changing the verification graph", () => {
    const routed = routeSteps(steps, { ...context, draft: true }, image);
    expect(routed.map((step) => step.key)).toEqual(
      steps.map((step) => step.key),
    );
    expect(
      routed.every(
        (step) =>
          step.agentLabels?.["kueue.x-k8s.io/priority-class"] === "ci-draft",
      ),
    ).toBe(true);
  });

  test("reserves separate checkout-free slots for review and completion", () => {
    const routed = routeSteps([review, complete], context, image);
    expect(routed.map((step) => step.agentLabels?.["ci-pool"])).toEqual([
      "review",
      "completion",
    ]);
    for (const step of routed) {
      expect(step.resources).toEqual(GATE_TIER);
      expect(parse(emitWorkflow(step, TEST_IDENTITY))).toMatchObject({
        skip_clone: true,
        workspace: { base: "/woodpecker", path: "." },
        labels: {
          backend: "kubernetes",
          "kueue.x-k8s.io/priority-class": "ci-ready",
        },
      });
    }
  });

  test("keeps source-based review and unrelated no-ops out of gate slots", () => {
    const fallback = buildPipelineSteps({
      images: TEST_IMAGES,
      changedBase: "",
    }).find((step) => step.key === "codex-review-gate");
    if (fallback === undefined) throw new Error("missing fallback review");
    const routed = routeSteps(
      [fallback, noWorkStep(TEST_IMAGES.base)],
      context,
      image,
    );
    expect(routed.map((step) => step.agentLabels?.["ci-pool"])).toEqual([
      "pr",
      "pr",
    ]);
  });

  test("rejects checkout or services in a reserved gate", () => {
    expect(() =>
      routeSteps([{ ...review, skipClone: false }], context, image),
    ).toThrow("no checkout or services");
    expect(() =>
      routeSteps(
        [
          {
            ...complete,
            services: [{ name: "service", image, resources: GATE_TIER }],
          },
        ],
        context,
        image,
      ),
    ).toThrow("no checkout or services");
  });

  test("preserves native agent routing", () => {
    const native = {
      ...verify,
      backend: "local" as const,
      agentLabels: { hostname: "jobs" },
    };
    expect(routeSteps([native], context, image)[0]).toBe(native);
  });
});
