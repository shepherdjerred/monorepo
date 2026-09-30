import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import { BUN_CACHE, BUN_CACHE_CONTROL } from "#src/pipeline/cache.ts";
import {
  WORKFLOW_TIMEOUT_MINUTES,
  emitWorkflow,
  wrapCommands,
} from "#src/pipeline/emit.ts";
import { TEST_IDENTITY, testPipelineSteps } from "./identity.ts";

/** What Woodpecker's envsubst does to text that holds only escaped `$`. */
function substitute(yaml: string): string {
  return yaml.replaceAll("$$", () => "$");
}

const EmittedCommands = z.object({
  steps: z.tuple([z.object({ commands: z.array(z.string()) })]),
});

describe("variable substitution", () => {
  const steps = testPipelineSteps();

  /**
   * An odd run is a `$` envsubst would read as the start of a substitution:
   * a braced one is rewritten or rejects the whole pipeline.
   */
  test("leaves no unescaped `$` in any workflow", () => {
    for (const step of steps) {
      const runs = emitWorkflow(step, TEST_IDENTITY).match(/\$+/gu) ?? [];
      for (const run of runs) {
        expect(run.length % 2, `${step.key} has an unescaped $`).toBe(0);
      }
    }
  });

  test("hands every step back its exact commands", () => {
    for (const step of steps) {
      const parsed = EmittedCommands.parse(
        parse(substitute(emitWorkflow(step, TEST_IDENTITY))),
      );
      expect(parsed.steps[0].commands, step.key).toEqual(wrapCommands(step));
    }
  });

  /** Keep the envsubst guard even when no production lane uses an array. */
  test("keeps bash array expansions intact", () => {
    const sites = steps.find((step) => step.key === "sites");
    expect(sites).toBeDefined();
    if (sites === undefined) return;
    const probe = {
      ...sites,
      commands: [
        "filters=(one two)",
        'printf "%s" "${filters[@]}" "${#filters[@]}"',
      ],
    };
    const command = EmittedCommands.parse(
      parse(substitute(emitWorkflow(probe, TEST_IDENTITY))),
    ).steps[0].commands[0];
    expect(command).toContain('"${filters[@]}"');
    expect(command).toContain("${#filters[@]}");
  });
});

describe("Bun cache install mode", () => {
  test("sets a valid install mode on every workflow and locks shared cache use", () => {
    for (const step of testPipelineSteps()) {
      const parsed = z
        .object({
          steps: z.tuple([
            z.object({ environment: z.record(z.string(), z.string()) }),
          ]),
        })
        .parse(parse(substitute(emitWorkflow(step, TEST_IDENTITY))));
      const environment = parsed.steps[0].environment;
      const cacheClaims = new Set(
        (step.volumes ?? []).map((volume) => volume.claim),
      );
      const shared =
        cacheClaims.has(BUN_CACHE.claim) &&
        cacheClaims.has(BUN_CACHE_CONTROL.claim);

      if (step.key === "codex-review-gate") {
        expect(shared).toBe(false);
      }

      expect(environment["BUN_INSTALL_LOCK_MODE"], step.key).toBe(
        shared ? "shared" : "local",
      );
      expect(environment["BUN_CACHE_LOCK_FILE"], step.key).toBe(
        shared ? `${BUN_CACHE_CONTROL.path}/.gc.lock` : undefined,
      );
    }
  });
});

/** Clone, image pull, and pod start all count against the workflow timeout. */
const WORKFLOW_OVERHEAD_MINUTES = 15;

describe("workflow timeout", () => {
  /**
   * Woodpecker kills the whole workflow at the repository timeout, so a step
   * budgeted past it would be cut off mid-run rather than by its own bound.
   */
  test("fits every step's worst case inside it", () => {
    for (const step of testPipelineSteps()) {
      const attempts = Math.max(step.retries ?? 1, 1);
      expect(
        step.timeoutMinutes * attempts + WORKFLOW_OVERHEAD_MINUTES,
        step.key,
      ).toBeLessThanOrEqual(WORKFLOW_TIMEOUT_MINUTES);
    }
  });
});

const EmittedPodOptions = z.object({
  backend_options: z.object({
    kubernetes: z
      .object({
        resources: z.object({
          requests: z.record(z.string(), z.string()),
          limits: z.record(z.string(), z.string()),
        }),
        serviceAccountName: z.string(),
        labels: z.record(z.string(), z.string()),
      })
      .loose(),
  }),
});

const EmittedServices = z.object({
  steps: z.tuple([EmittedPodOptions.loose()]),
  services: z.array(EmittedPodOptions.loose()).optional(),
});

describe("pod shape", () => {
  /**
   * Services are separate pods. Without their own requests Kueue and the
   * scheduler cannot see them, and without the step-key label neither can
   * the telemetry or network policy that select CI pods.
   */
  test("gives every step and service pod requests, limits, and CI labels", () => {
    let services = 0;
    for (const step of testPipelineSteps()) {
      if (step.backend === "local") continue;
      const emitted = EmittedServices.parse(
        parse(substitute(emitWorkflow(step, TEST_IDENTITY))),
      );
      const pods = [emitted.steps[0], ...(emitted.services ?? [])];
      services += emitted.services?.length ?? 0;
      for (const pod of pods) {
        const options = pod.backend_options.kubernetes;
        for (const resource of ["cpu", "memory", "ephemeral-storage"]) {
          expect(options.resources.requests[resource], step.key).toBeDefined();
          expect(options.resources.limits[resource], step.key).toBeDefined();
        }
        expect(options.labels["ci.sjer.red/step-key"]).toBe(step.key);
        expect(options.serviceAccountName).toBe("woodpecker-job");
      }
    }
    expect(services).toBeGreaterThan(0);
  });
});

describe("service entrypoints", () => {
  test("starts Tempo directly without a shell wrapper", () => {
    const step = testPipelineSteps().find(
      (candidate) => candidate.key === "docker-e2e",
    );
    expect(step).toBeDefined();
    if (step === undefined) return;
    const emitted = z
      .object({
        services: z.array(
          z.object({
            name: z.string(),
            entrypoint: z.array(z.string()).optional(),
            commands: z.array(z.string()).optional(),
          }),
        ),
      })
      .parse(parse(substitute(emitWorkflow(step, TEST_IDENTITY))));
    const tempo = emitted.services.find((service) => service.name === "tempo");
    expect(tempo?.entrypoint).toEqual([
      "/tempo",
      "-config.file=/woodpecker/src/github.com/shepherdjerred/monorepo/packages/llm-observability/test/tempo.yaml",
    ]);
    expect(tempo?.commands).toBeUndefined();
  });
});

describe("review gate providers", () => {
  test("the gate step enables every confirmed-reviewing provider", () => {
    const step = testPipelineSteps().find(
      (candidate) => candidate.key === "codex-review-gate",
    );
    expect(step).toBeDefined();
    if (step === undefined) return;
    // The key stays stable for the required-check ruleset; the env selects
    // the multi-provider OR gate (one clean review passes, a P0 vetoes).
    expect(step.environment?.["REVIEW_PROVIDERS"]).toBe("codex,coderabbit");
    const emitted = z
      .object({
        steps: z.tuple([
          z.object({ environment: z.record(z.string(), z.string()) }),
        ]),
      })
      .parse(parse(substitute(emitWorkflow(step, TEST_IDENTITY))));
    expect(emitted.steps[0].environment["REVIEW_PROVIDERS"]).toBe(
      "codex,coderabbit",
    );
  });
});
