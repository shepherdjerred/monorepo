import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { routeSteps, type RoutingContext } from "#src/pipeline/routing.ts";
import { completionStep, noWorkStep } from "#src/pipeline/completion.ts";
import { prGateSteps } from "#src/pipeline/lanes/pr-gates.ts";
import { buildPipelineSteps } from "#src/pipeline/steps.ts";
import { emitWorkflow } from "#src/pipeline/emit.ts";
import { GATE_TIER } from "#src/pipeline/tiers.ts";
import { TEST_IDENTITY, TEST_IMAGES } from "./identity.ts";

const image = `docker.io/shepherdjerred/woodpecker-config-extension@sha256:${"c".repeat(64)}`;
const context: RoutingContext = {
  event: "pull_request",
  branch: "main",
  defaultBranch: "main",
  draft: false,
};
const steps = buildPipelineSteps({
  images: TEST_IMAGES,
  changedBase: "",
});
const verify = steps.find((step) => step.key === "verify");
if (verify === undefined) throw new Error("missing gate fixtures");
const complete = completionStep([verify], image, "/app");

describe("agent pool routing", () => {
  test("prGateSteps no longer emits codex-review-gate", () => {
    expect(
      prGateSteps(TEST_IMAGES).find((step) => step.key === "codex-review-gate"),
    ).toBeUndefined();
    expect(
      steps.find((step) => step.key === "codex-review-gate"),
    ).toBeUndefined();
  });

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

  test.each([{ maintenance: true }, { extended: true }])(
    "keeps default-branch background work %j in the PR pool at draft priority",
    (background) => {
      for (const event of ["manual", "push"]) {
        expect(
          routeSteps([verify], { ...context, event, ...background }, image)[0]
            ?.agentLabels,
        ).toEqual({
          "ci-pool": "pr",
          "kueue.x-k8s.io/priority-class": "ci-draft",
        });
      }
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

  test("reserves a checkout-free slot for completion", () => {
    const routed = routeSteps([complete], context, image);
    expect(routed.map((step) => step.agentLabels?.["ci-pool"])).toEqual([
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

  test("keeps non-trusted completion and unrelated no-ops out of gate slots", () => {
    const fallback = completionStep([verify], TEST_IMAGES.base, "/workspace");
    const routed = routeSteps(
      [fallback, noWorkStep(TEST_IMAGES.base), noWorkStep(image)],
      context,
      image,
    );
    expect(routed.map((step) => step.agentLabels?.["ci-pool"])).toEqual([
      "pr",
      "pr",
      "pr",
    ]);
  });

  test("rejects checkout or services in a reserved gate", () => {
    expect(() =>
      routeSteps([{ ...complete, skipClone: false }], context, image),
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
