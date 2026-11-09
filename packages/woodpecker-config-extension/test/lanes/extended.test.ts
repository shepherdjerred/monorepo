import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import {
  EXTENDED_STEP_KEY,
  EXTENDED_SUPERSEDED_KEY,
  extendedRequest,
  extendedSourcePipeline,
  extendedSteps,
  extendedSupersededStep,
} from "#src/pipeline/extended.ts";
import { benchmarkRequest } from "#src/pipeline/benchmark.ts";
import { maintenanceRequest } from "#src/pipeline/maintenance.ts";
import {
  BUN_CACHE,
  BUN_CACHE_CONTROL,
  MISE_INSTALLS,
  TOOL_CACHE,
  UV_CACHE,
} from "#src/pipeline/cache.ts";
import { emitWorkflow } from "#src/pipeline/emit.ts";
import { performanceSteps } from "#src/pipeline/performance.ts";
import { RAM_SCRATCH_PROFILES } from "#src/pipeline/ram-scratch.ts";
import { routeSteps } from "#src/pipeline/routing.ts";
import { TURBO_VERIFY_TIER } from "#src/pipeline/tiers.ts";
import { DISABLED_PERFORMANCE } from "#src/performance-config.ts";
import { PipelineSchema } from "#src/schemas.ts";
import fixture from "#test-fixtures/woodpecker-v3.18.1-config-request.json" with { type: "json" };
import { TEST_IDENTITY, TEST_IMAGES, testPipelineSteps } from "#test-identity";

const REQUEST = "8f6d3a2e-4c1b-4e7a-9f0d-2b5c6d7e8f90";
const manual = PipelineSchema.parse({
  ...fixture.pipeline,
  event: "manual",
  branch: "main",
  ref: "refs/heads/main",
  variables: {
    CI_EXTENDED_REQUEST: REQUEST,
    CI_EXTENDED_SOURCE: fixture.pipeline.commit,
  },
});
const parsed = { request: REQUEST, source: fixture.pipeline.commit };

describe("extended verification request", () => {
  test("accepts exactly the owner's exclusive manual request on the default branch", () => {
    expect(extendedRequest(manual, "main", true)).toEqual(parsed);
    expect(
      extendedRequest({ ...manual, variables: {} }, "main", true),
    ).toBeUndefined();
    expect(() => extendedRequest(manual, "main", false)).toThrow("owner");
    expect(() => extendedRequest(manual, "trunk", true)).toThrow();
    for (const event of ["push", "pull_request", "pull_request_metadata"])
      expect(() => extendedRequest({ ...manual, event }, "main", true)).toThrow(
        "exclusive owner manual request",
      );
    expect(() =>
      extendedRequest(
        {
          ...manual,
          branch: "ci-canary/extended",
          ref: "refs/heads/ci-canary/extended",
        },
        "main",
        true,
      ),
    ).toThrow();
    expect(() =>
      extendedRequest({ ...manual, ref: "refs/pull/1/head" }, "main", true),
    ).toThrow();
  });

  test.each([
    { CI_MAINTENANCE_KIND: "release-notes" },
    { CI_MAINTENANCE_SOURCE: fixture.pipeline.commit },
    { CI_BENCHMARK_PROFILE: "verify" },
    { TOFU_PLATFORM_PLAN: "openai" },
    { CI_IO_FIXED_CORPUS: "x" },
  ])("refuses to share a pipeline with %j", (variables) => {
    expect(() =>
      extendedRequest(
        { ...manual, variables: { ...manual.variables, ...variables } },
        "main",
        true,
      ),
    ).toThrow("exclusive");
  });

  test.each([
    { CI_EXTENDED_SOURCE: undefined },
    { CI_EXTENDED_SOURCE: "main" },
    { CI_EXTENDED_SOURCE: "B".repeat(40) },
    { CI_EXTENDED_SOURCE: "b".repeat(39) },
    { CI_EXTENDED_REQUEST: "nightly" },
    { CI_EXTENDED_REQUEST: "" },
  ])("rejects a malformed request value %j", (change) => {
    const variables = Object.fromEntries(
      Object.entries({ ...manual.variables, ...change }).flatMap(
        ([key, value]) => (value === undefined ? [] : [[key, value] as const]),
      ),
    );
    expect(() =>
      extendedRequest({ ...manual, variables }, "main", true),
    ).toThrow();
  });

  test("the benchmark and maintenance routes refuse an extended request in turn", () => {
    expect(() =>
      benchmarkRequest(
        {
          ...manual,
          variables: { ...manual.variables, CI_BENCHMARK_PROFILE: "verify" },
        },
        "main",
        true,
      ),
    ).toThrow("exclusive");
    expect(() =>
      maintenanceRequest(
        {
          ...manual,
          variables: { ...manual.variables, CI_MAINTENANCE_KIND: "ci-images" },
        },
        "main",
      ),
    ).toThrow("exclusive");
  });

  test("pins the verified source and supersedes any other", () => {
    const verified = "b".repeat(40);
    const behind = {
      ...manual,
      variables: { ...manual.variables, CI_EXTENDED_SOURCE: verified },
    };
    expect(extendedSourcePipeline(behind, verified).commit).toBe(verified);
    expect(extendedSourcePipeline(behind, "c".repeat(40))).toBe(behind);
    expect(extendedSourcePipeline(behind, undefined)).toBe(behind);
    expect(extendedSourcePipeline(manual, verified)).toBe(manual);
    const receipt = extendedSupersededStep(TEST_IMAGES.base);
    expect(receipt.key).toBe(EXTENDED_SUPERSEDED_KEY);
    expect(receipt.skipClone).toBe(true);
    expect(receipt.secrets).toBeUndefined();
    expect(receipt.commands.join("\n")).not.toContain("exit 1");
  });
});

describe("extended verification step", () => {
  const steps = extendedSteps(TEST_IMAGES, parsed);
  const step = steps[0];
  if (step === undefined) throw new Error("Missing extended step");

  test("is one verify-shaped workflow running the extended tier with diagnostics", () => {
    expect(steps).toHaveLength(1);
    expect(step.key).toBe(EXTENDED_STEP_KEY);
    expect(step.image).toBe(TEST_IMAGES.base);
    expect(step.dependsOn).toEqual([]);
    expect(step.timeoutMinutes).toBe(90);
    expect(step.resources).toEqual(TURBO_VERIFY_TIER);
    expect(step.concurrency).toEqual({ limit: 1, group: "verify-extended" });
    expect(step.skipClone).toBeUndefined();
    expect(step.services).toBeUndefined();
    expect(step.commands[0]).toBe(". ci/scripts/toolchain.sh");
    expect(step.commands).toHaveLength(2);
    expect(step.commands[1]).toContain(
      "run-with-diagnostics.ts verify-extended --",
    );
    for (const command of [
      "ci/scripts/bun-install.sh --frozen-lockfile",
      'export TURBO_CACHE="remote:rw"',
      "bun --no-install run verify:extended -- --output-logs=errors-only --summarize",
    ])
      expect(step.commands[1]).toContain(command);
    expect(step.commands.join("\n")).not.toContain("write-ci-handoff");
    expect(step.commands.join("\n")).not.toContain("run verify --");
    expect(step.environment).toMatchObject({
      TURBO_API: "https://turbo-cache.tailnet-1a49.ts.net",
      TURBO_TEAM: "monorepo",
      GRADLE_BUILD_CACHE_URL:
        "https://gradle-build-cache.tailnet-1a49.ts.net/cache/",
      GRADLE_BUILD_CACHE_USERNAME: "ci-main",
      CI_CHANGED_BASE: "",
      CI_EXTENDED_REQUEST: REQUEST,
      CI_EXTENDED_SOURCE: fixture.pipeline.commit,
    });
  });

  test("holds verify's trusted identities and nothing that publishes or deploys", () => {
    expect(step.secrets?.map((grant) => grant.env).toSorted()).toEqual([
      "GITHUB_DOWNLOAD_TOKEN",
      "GRADLE_BUILD_CACHE_WRITE_PASSWORD",
      "SEAWEEDFS_HANDOFF_ACCESS_KEY_ID",
      "SEAWEEDFS_HANDOFF_SECRET_ACCESS_KEY",
      "TURBO_REMOTE_CACHE_SIGNATURE_KEY",
      "TURBO_TOKEN",
    ]);
    expect(
      step.secrets?.find(
        (grant) => grant.env === "TURBO_REMOTE_CACHE_SIGNATURE_KEY",
      )?.key,
    ).toBe("TURBO_REMOTE_CACHE_SIGNATURE_KEY_TRUSTED");
    const verify = testPipelineSteps().find(
      (candidate) => candidate.key === "verify",
    );
    // The same base grants as verify before its trust domain is signed.
    expect(
      step.secrets
        ?.filter(
          (grant) =>
            !grant.env.startsWith("TURBO_REMOTE_CACHE_SIGNATURE_KEY") &&
            !grant.env.startsWith("GRADLE_BUILD_CACHE_"),
        )
        .toSorted((a, b) => a.env.localeCompare(b.env)),
    ).toEqual(verify?.secrets?.toSorted((a, b) => a.env.localeCompare(b.env)));
  });

  test("mounts the shared download and toolchain caches like verify", () => {
    const claims = step.volumes?.map((volume) => volume.claim) ?? [];
    for (const volume of [BUN_CACHE, BUN_CACHE_CONTROL, UV_CACHE, TOOL_CACHE])
      expect(claims).toContain(volume.claim);
    expect(claims).not.toContain(MISE_INSTALLS.claim);
    expect(claims).not.toContain("woodpecker-workspace-seeds");
    expect(claims).not.toContain("woodpecker-workspace-golden");
  });

  test("takes the extended scratch profile and shared mise installs under their flags", () => {
    const [plain] = performanceSteps(steps, DISABLED_PERFORMANCE, true, false);
    expect(plain?.ramScratch).toBeUndefined();
    expect(plain?.resources).toEqual(TURBO_VERIFY_TIER);
    const [tuned] = performanceSteps(
      steps,
      { ...DISABLED_PERFORMANCE, scratch: true, miseInstalls: true },
      true,
      false,
    );
    const profile = RAM_SCRATCH_PROFILES["verify-extended"];
    expect(profile).toEqual({
      ...RAM_SCRATCH_PROFILES.verify,
      stepKey: "verify-extended",
      profile: "verify-extended-v1",
    });
    expect(tuned?.ramScratch).toBe(true);
    expect(tuned?.resources).toEqual(profile.resources);
    expect(tuned?.volumes?.map((volume) => volume.claim)).toContain(
      MISE_INSTALLS.claim,
    );
    // The lane shares no prepared seed or Gradle seed: those are keyed to verify.
    expect(tuned?.sourceCache).toBeUndefined();
    const emitted = z
      .object({
        steps: z.array(
          z.object({
            backend_options: z.object({
              kubernetes: z.object({
                labels: z.record(z.string(), z.string()),
                resources: z.object({
                  requests: z.record(z.string(), z.string()),
                }),
              }),
            }),
          }),
        ),
      })
      .parse(
        parse(
          emitWorkflow(tuned ?? step, { ...TEST_IDENTITY, event: "manual" }),
        ),
      );
    expect(emitted.steps[0]?.backend_options.kubernetes.labels).toMatchObject({
      "ci.sjer.red/ram-scratch": "verify-extended-v1",
      "ci.sjer.red/step-key": "verify-extended",
    });
    expect(
      emitted.steps[0]?.backend_options.kubernetes.resources.requests["memory"],
    ).toBe("30Gi");
  });

  test("routes to the PR pool at the lowest priority on the default branch", () => {
    const [routed] = routeSteps(steps, {
      event: "manual",
      branch: "main",
      defaultBranch: "main",
      draft: false,
      extended: true,
    });
    expect(routed?.agentLabels).toEqual({
      "ci-pool": "pr",
      "kueue.x-k8s.io/priority-class": "ci-draft",
    });
    const emitted: unknown = parse(
      emitWorkflow(routed ?? step, { ...TEST_IDENTITY, event: "manual" }),
    );
    expect(emitted).toMatchObject({
      labels: {
        backend: "kubernetes",
        "ci-pool": "pr",
        "kueue.x-k8s.io/priority-class": "ci-draft",
      },
      concurrency: { limit: 1, group: "verify-extended" },
    });
  });

  test("is not part of the selected graph", () => {
    expect(testPipelineSteps().map((candidate) => candidate.key)).not.toContain(
      EXTENDED_STEP_KEY,
    );
  });
});
