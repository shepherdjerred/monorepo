import { expect, test } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import { benchmarkRequest, benchmarkSteps } from "#src/pipeline/benchmark.ts";
import { groupSmallChecks } from "#src/pipeline/group-small-checks.ts";
import { performanceSteps } from "#src/pipeline/performance.ts";
import { cacheSourceSteps } from "#src/pipeline/source-cache.ts";
import { DISABLED_PERFORMANCE } from "#src/performance-config.ts";
import { emitWorkflow } from "#src/pipeline/emit.ts";
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
};
const helper = `ghcr.io/shepherdjerred/woodpecker-config-extension@sha256:${"a".repeat(64)}`;
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
