import { expect, test } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import { benchmarkRequest, benchmarkSteps } from "#src/pipeline/benchmark.ts";
import { groupSmallChecks } from "#src/pipeline/group-small-checks.ts";
import { performanceSteps } from "#src/pipeline/performance.ts";
import { cacheSourceSteps } from "#src/pipeline/source-cache.ts";
import { DISABLED_PERFORMANCE } from "#src/performance-config.ts";
import { emitWorkflow } from "#src/pipeline/emit.ts";
import { RAM_SCRATCH, ramScratchProfile } from "#src/pipeline/ram-scratch.ts";
import { BROWSER_TIER, TURBO_VERIFY_TIER } from "#src/pipeline/tiers.ts";
import { PipelineSchema } from "#src/schemas.ts";
import fixture from "./fixtures/woodpecker-v3.18.1-config-request.json" with { type: "json" };
import { TEST_IMAGES, TEST_IDENTITY, testPipelineSteps } from "./identity.ts";

const enabled = {
  incremental: true,
  prepared: true,
  formatting: true,
  gradle: true,
  grouping: true,
  copyfile: true,
  scratch: true,
};
const helper = `docker.io/shepherdjerred/woodpecker-config-extension@sha256:${"a".repeat(64)}`;
const backend = (environment?: Readonly<Record<string, string>>) =>
  environment?.["CI_BUN_INSTALL_BACKEND"];
const gib = (value: string) => Number(value.replace(/Gi$/u, ""));
test("RAM scratch benchmarks stay exclusive to owner manual verify canaries", () => {
  const pipeline = PipelineSchema.parse({
    ...fixture.pipeline,
    event: "manual",
    branch: "ci-canary/ram-scratch",
    ref: "refs/heads/ci-canary/ram-scratch",
    variables: {
      CI_BENCHMARK_PROFILE: "verify",
      CI_BENCHMARK_SOURCE: fixture.pipeline.commit,
      CI_BENCHMARK_VARIANT: "candidate",
      CI_BENCHMARK_CACHE: "cold",
      CI_BENCHMARK_FEATURE: "scratch",
    },
  });
  const request = benchmarkRequest(pipeline, "main", true);
  if (request === undefined) throw new Error("Missing request");
  expect(() => benchmarkRequest(pipeline, "main", false)).toThrow();
  expect(() =>
    benchmarkRequest({ ...pipeline, event: "pull_request" }, "main", true),
  ).toThrow();
  expect(() =>
    benchmarkRequest(
      { ...pipeline, branch: "main", ref: "refs/heads/main" },
      "main",
      true,
    ),
  ).toThrow();
  expect(() =>
    benchmarkRequest(
      {
        ...pipeline,
        variables: { ...pipeline.variables, CI_BENCHMARK_PROFILE: "browser" },
      },
      "main",
      true,
    ),
  ).toThrow();
  expect(() =>
    benchmarkSteps(TEST_IMAGES, request, DISABLED_PERFORMANCE, helper),
  ).toThrow();
  const candidate = benchmarkSteps(TEST_IMAGES, request, enabled, helper)[0];
  const baseline = benchmarkSteps(
    TEST_IMAGES,
    { ...request, variant: "baseline" },
    enabled,
    helper,
  )[0];
  if (candidate === undefined || baseline === undefined)
    throw new Error("Missing verify");
  expect(candidate.resources).toEqual(RAM_SCRATCH.resources);
  expect(baseline.resources).toEqual(TURBO_VERIFY_TIER);
  expect(baseline.ramScratch).toBeUndefined();
  const emitted = z
    .object({
      clone: z.array(
        z.object({
          backend_options: z.object({
            kubernetes: z.object({ labels: z.record(z.string(), z.string()) }),
          }),
        }),
      ),
      steps: z.array(
        z.object({
          name: z.string(),
          backend_options: z.object({
            kubernetes: z.object({
              labels: z.record(z.string(), z.string()),
              resources: z.object({
                requests: z.record(z.string(), z.string()),
                limits: z.record(z.string(), z.string()),
              }),
            }),
          }),
        }),
      ),
    })
    .parse(
      parse(
        emitWorkflow(candidate, {
          ...TEST_IDENTITY,
          branch: pipeline.branch,
          event: "manual",
        }),
      ),
    );
  for (const clone of emitted.clone)
    expect(
      clone.backend_options.kubernetes.labels[RAM_SCRATCH.label],
    ).toBeUndefined();
  expect(emitted.steps).toHaveLength(1);
  expect(
    emitted.steps[0]?.backend_options.kubernetes.labels[RAM_SCRATCH.label],
  ).toBe(RAM_SCRATCH.profile);
  expect(
    emitted.steps[0]?.backend_options.kubernetes.resources.requests["memory"],
  ).toBe("30Gi");
  expect(
    emitted.steps[0]?.backend_options.kubernetes.resources.limits["memory"],
  ).toBe("36Gi");
  const scratch = RAM_SCRATCH.volumes.reduce(
    (sum, volume) => sum + gib(volume.size),
    0,
  );
  expect(
    gib(candidate.resources.memoryRequest) -
      gib(TURBO_VERIFY_TIER.memoryRequest),
  ).toBe(scratch);
  expect(
    gib(candidate.resources.memoryLimit) - gib(TURBO_VERIFY_TIER.memoryLimit),
  ).toBe(scratch);
});
test("ordinary verify and browser execution pods carry their own scratch profile only when enabled", () => {
  const steps = testPipelineSteps();
  const scratched = performanceSteps(steps, enabled, true, false);
  expect(
    scratched
      .filter((step) => step.ramScratch === true)
      .map((step) => step.key),
  ).toEqual(["verify", "playwright-e2e"]);
  for (const step of scratched.filter((candidate) => candidate.ramScratch)) {
    const profile = ramScratchProfile(step.key);
    if (profile === undefined) throw new Error("Missing scratch profile");
    expect(step.resources).toEqual(profile.resources);
    const tier = step.key === "verify" ? TURBO_VERIFY_TIER : BROWSER_TIER;
    // The profile reserves exactly its tmpfs allowance above the lane's tier.
    const tmpfs = profile.volumes.reduce(
      (sum, volume) => sum + gib(volume.size),
      0,
    );
    expect(gib(profile.resources.memoryRequest) - gib(tier.memoryRequest)).toBe(
      tmpfs,
    );
    expect(gib(profile.resources.memoryLimit) - gib(tier.memoryLimit)).toBe(
      tmpfs,
    );
    expect(profile.resources.cpuRequest).toBe(tier.cpuRequest);
    const labels = z
      .object({
        steps: z.array(
          z.object({
            backend_options: z.object({
              kubernetes: z.object({
                labels: z.record(z.string(), z.string()),
              }),
            }),
          }),
        ),
        clone: z
          .array(
            z.object({
              backend_options: z.object({
                kubernetes: z.object({
                  labels: z.record(z.string(), z.string()),
                }),
              }),
            }),
          )
          .optional(),
      })
      .parse(
        parse(emitWorkflow(step, { ...TEST_IDENTITY, event: "pull_request" })),
      );
    expect(
      labels.steps[0]?.backend_options.kubernetes.labels[profile.label],
    ).toBe(profile.profile);
    for (const clone of labels.clone ?? [])
      expect(
        clone.backend_options.kubernetes.labels[profile.label],
      ).toBeUndefined();
  }
  expect(
    performanceSteps(steps, { ...enabled, scratch: false }, true, false).some(
      (step) => step.ramScratch === true,
    ),
  ).toBe(false);
  expect(
    performanceSteps(steps, enabled, true, true).some(
      (step) => step.ramScratch === true,
    ),
  ).toBe(false);
});
test("ordinary lanes and their ordered containers install with Bun copyfile only when enabled", () => {
  const steps = groupSmallChecks(testPipelineSteps(), true);
  const copied = performanceSteps(
    steps,
    { ...DISABLED_PERFORMANCE, copyfile: true },
    true,
    false,
  );
  for (const key of ["verify", "playwright-e2e"])
    expect(backend(copied.find((step) => step.key === key)?.environment)).toBe(
      "copyfile",
    );
  const ordered = copied.flatMap((step) => step.orderedSteps ?? []);
  expect(ordered.length).toBeGreaterThan(0);
  expect(
    ordered.every((command) => backend(command.environment) === "copyfile"),
  ).toBe(true);
  const plain = performanceSteps(steps, DISABLED_PERFORMANCE, true, false);
  expect(
    [...plain, ...plain.flatMap((step) => step.orderedSteps ?? [])].some(
      (step) => backend(step.environment) !== undefined,
    ),
  ).toBe(false);
});
test("performance options never grant caches to credentialless work", () => {
  const steps = testPipelineSteps();
  expect(performanceSteps(steps, enabled, false, true)).toEqual(steps);
  const cached = cacheSourceSteps(steps, {
    enabled: true,
    credentialless: false,
    main: false,
    image: helper,
  });
  const verify = performanceSteps(cached, enabled, false, false).find(
    (step) => step.key === "verify",
  );
  expect(verify?.environment?.["CI_FORMAT_CACHE_ROOT"]).toMatch(/\/pr$/u);
  expect(verify?.sourceCache?.prepared?.profile).toBe("verify");
  expect(verify?.sourceCache?.gradle?.image).toBe(TEST_IMAGES.base);
  expect(
    verify?.volumes?.some(
      (volume) => volume.claim === "woodpecker-workspace-seeds",
    ),
  ).toBe(false);
});
test("benchmark requests cannot trigger releases, platform operations, or a moving source", () => {
  const pipeline = PipelineSchema.parse({
    ...fixture.pipeline,
    event: "manual",
    branch: "main",
    ref: "refs/heads/main",
    variables: {
      CI_BENCHMARK_PROFILE: "browser",
      CI_BENCHMARK_SOURCE: fixture.pipeline.commit,
      CI_BENCHMARK_VARIANT: "candidate",
      CI_BENCHMARK_CACHE: "cold",
      CI_BENCHMARK_FEATURE: "prepared",
    },
  });
  const request = benchmarkRequest(pipeline, "main", true);
  if (request === undefined) throw new Error("Missing request");
  expect(() => benchmarkRequest(pipeline, "main", false)).toThrow();
  expect(() =>
    benchmarkRequest({ ...pipeline, commit: "b".repeat(40) }, "main", true),
  ).toThrow();
  expect(() =>
    benchmarkRequest(
      {
        ...pipeline,
        variables: { ...pipeline.variables, CI_MAINTENANCE_KIND: "ci-images" },
      },
      "main",
      true,
    ),
  ).toThrow();
  expect(() =>
    benchmarkSteps(TEST_IMAGES, request, DISABLED_PERFORMANCE, helper),
  ).toThrow();
  const steps = benchmarkSteps(TEST_IMAGES, request, enabled, helper);
  expect(steps.map((step) => step.key)).toEqual(["playwright-e2e"]);
  expect(steps[0]?.sourceCache?.cold).toBe(true);
  expect(steps[0]?.commands.join("\n")).toContain(
    'export TURBO_CACHE="local:r"',
  );
  expect(steps[0]?.commands.join("\n")).not.toContain("ci-artifact.ts put");
});
test("grouped checks retain separate secrets and both run after an independent check fails", () => {
  const grouped = groupSmallChecks(testPipelineSteps(), true);
  const group = grouped.find((step) => step.key === "small-pr-checks");
  if (group === undefined) throw new Error("Missing grouped checks");
  expect(group.secrets?.map((grant) => grant.env)).toEqual([
    "GITHUB_DOWNLOAD_TOKEN",
  ]);
  expect(group.orderedSteps?.map((step) => step.key)).toEqual([
    "alert-dashboard-sqlite",
    "pr-dryrun",
  ]);
  const emitted = z
    .object({
      steps: z.array(
        z.object({
          name: z.string(),
          when: z.unknown().optional(),
          commands: z.array(z.string()).optional(),
        }),
      ),
    })
    .parse(parse(emitWorkflow(group, TEST_IDENTITY)));
  for (const name of ["pr-dryrun", "alert-dashboard-sqlite"])
    expect(emitted.steps.find((step) => step.name === name)?.when).toEqual([
      { status: ["success", "failure"] },
    ]);
  expect(
    group.orderedSteps
      ?.find((step) => step.key === "alert-dashboard-sqlite")
      ?.secrets?.map((grant) => grant.env),
  ).toEqual(["GITHUB_DOWNLOAD_TOKEN"]);
  expect(
    groupSmallChecks(
      testPipelineSteps().filter((step) => step.key !== "pr-dryrun"),
      true,
    ).some((step) => step.key === "small-pr-checks"),
  ).toBe(false);
});
