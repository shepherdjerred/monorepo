import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import {
  isPrLightWorkflow,
  routeSteps,
  type RoutingContext,
} from "#src/pipeline/routing.ts";
import { completionStep, noWorkStep } from "#src/pipeline/completion.ts";
import { draftPreflightStep } from "#src/pipeline/draft.ts";
import { prGateSteps } from "#src/pipeline/lanes/pr-gates.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { buildPipelineSteps } from "#src/pipeline/steps.ts";
import { emitWorkflow } from "#src/pipeline/emit.ts";
import {
  GATE_TIER,
  LIGHT_TIER,
  MEDIUM_TIER,
  SCANNER_TIER,
  SERVICE_TIER,
} from "#src/pipeline/tiers.ts";
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

  test.each([{ canary: true }, { extended: true }])(
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

  /**
   * The `pr` agent's first-in-first-out queue held the golden workspace
   * refresh for hours behind the PR backlog. Maintenance has its own agent,
   * and is admitted ahead of waiting ready PR pods at main's priority.
   */
  test("routes Temporal maintenance to its own pool at main priority", () => {
    for (const event of ["manual", "push"]) {
      for (const draft of [false, true]) {
        expect(
          routeSteps(
            [verify],
            { ...context, event, draft, maintenance: true },
            image,
          )[0]?.agentLabels,
        ).toEqual({
          "ci-pool": "maintenance",
          "kueue.x-k8s.io/priority-class": "ci-main",
        });
      }
    }
  });

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
    // Light-tier and service-free, so the light pool rather than a gate.
    expect(routed.map((step) => step.agentLabels?.["ci-pool"])).toEqual([
      "pr-light",
      "pr-light",
      "pr-light",
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

const pools = (routed: readonly CiStep[]) =>
  Object.fromEntries(
    routed.map((step) => [step.key, step.agentLabels?.["ci-pool"]]),
  );

/**
 * In `pr`, a one-minute scanner waited for a slot behind every verify that
 * held one while Kueue gated it. Light, scanner and contained checks with no
 * services take their own pool; everything heavier stays in `pr`.
 */
describe("pr-light agent pool routing", () => {
  const prSteps = [...steps, draftPreflightStep(TEST_IMAGES)].filter(
    (step) => step.defaultBranchOnly !== true,
  );

  test("takes the light, scanner and contained PR checks of the real graph", () => {
    expect(pools(routeSteps(prSteps, context, image))).toEqual({
      verify: "pr",
      trivy: "pr-light",
      semgrep: "pr-light",
      "alert-dashboard-sqlite": "pr",
      "resume-build": "pr",
      "trmnl-validate": "pr-light",
      "tofu-validate": "pr",
      "playwright-e2e": "pr",
      "docker-e2e": "pr",
      "paper-smoke-pr": "pr",
      "pr-dryrun": "pr",
      "draft-preflight": "pr-light",
    });
  });

  test("keeps the light pool's Kueue priority by PR state", () => {
    const [trivy] = routeSteps(
      prSteps.filter((step) => step.key === "trivy"),
      { ...context, draft: true },
      image,
    );
    expect(trivy?.agentLabels).toEqual({
      "ci-pool": "pr-light",
      "kueue.x-k8s.io/priority-class": "ci-draft",
    });
  });

  test("leaves services, heavier containers and raised requests in pr", () => {
    const trivy = prSteps.find((step) => step.key === "trivy");
    if (trivy === undefined) throw new Error("missing trivy fixture");
    const service = { name: "db", image, resources: SERVICE_TIER };
    const routed = routeSteps(
      [
        { ...trivy, key: "with-service", services: [service] },
        {
          ...trivy,
          key: "with-medium-container",
          orderedSteps: [{ ...trivy, key: "build", resources: MEDIUM_TIER }],
        },
        {
          ...trivy,
          key: "with-raised-request",
          resources: { ...SCANNER_TIER, memoryRequest: "4Gi" },
        },
        {
          ...trivy,
          key: "light-ordered",
          orderedSteps: [{ ...trivy, key: "next", resources: LIGHT_TIER }],
        },
      ],
      context,
      image,
    );
    expect(pools(routed)).toEqual({
      "with-service": "pr",
      "with-medium-container": "pr",
      "with-raised-request": "pr",
      "light-ordered": "pr-light",
    });
  });

  test("leaves main pushes and background work out of it", () => {
    const light = prSteps.filter((step) => isPrLightWorkflow(step));
    expect(light.map((step) => step.key)).toEqual([
      "trivy",
      "semgrep",
      "trmnl-validate",
      "draft-preflight",
    ]);
    const route = (overrides: Partial<RoutingContext>) =>
      new Set(
        routeSteps(light, { ...context, ...overrides }, image).map(
          (step) => step.agentLabels?.["ci-pool"],
        ),
      );
    expect(route({ event: "push" })).toEqual(new Set(["main"]));
    expect(route({ event: "manual", maintenance: true })).toEqual(
      new Set(["maintenance"]),
    );
    expect(route({ event: "manual", canary: true })).toEqual(new Set(["pr"]));
    expect(route({ event: "manual", extended: true })).toEqual(new Set(["pr"]));
  });
});
