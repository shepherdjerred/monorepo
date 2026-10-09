import { expect, test } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import { groupTofuSteps } from "#src/pipeline/group-tofu.ts";
import { emitWorkflow, wrapCommands } from "#src/pipeline/emit.ts";
import { GITHUB_DOWNLOAD } from "#src/pipeline/lanes/tofu.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { testPipelineSteps, TEST_IDENTITY } from "./identity.ts";

function fixture(key: string): CiStep {
  const step = testPipelineSteps().find((candidate) => candidate.key === key);
  if (step === undefined) throw new Error(`Missing fixture ${key}`);
  return step;
}

function grouped(): CiStep {
  const step = groupTofuSteps(testPipelineSteps()).find(
    (candidate) => candidate.key === "tofu-pr",
  );
  if (step === undefined) throw new Error("Missing grouped workflow");
  return step;
}

const Container = z.object({
  name: z.string(),
  commands: z.array(z.string()),
  failure: z.string().optional(),
  depends_on: z.unknown().optional(),
  when: z.unknown().optional(),
  backend_options: z.object({
    kubernetes: z.object({
      secrets: z
        .array(
          z.object({
            name: z.string(),
            key: z.string(),
            target: z.object({ env: z.string() }),
          }),
        )
        .optional(),
      resources: z.object({
        requests: z.object({ cpu: z.string(), memory: z.string() }),
      }),
    }),
  }),
});

test("groups exactly the selected PR checks with one install", () => {
  const workflow = grouped();
  expect(workflow.orderedSteps?.map((step) => step.key)).toEqual([
    "tofu-plan-seaweedfs",
    "tofu-plan-tailscale",
    "tofu-plan-arr",
    "tofu-plan-github",
    "tofu-plan-cloudflare",
    "tofu-platforms-validate",
    "tofu-posthog-plan",
  ]);
  expect(
    [workflow, ...(workflow.orderedSteps ?? [])].flatMap((step) =>
      step.commands.filter((command) => command.includes("bun-install.sh")),
    ),
  ).toHaveLength(1);
  expect(workflow.secrets).toEqual([GITHUB_DOWNLOAD]);
  for (const step of workflow.orderedSteps ?? []) {
    const original = fixture(step.key);
    expect(step.commands.slice(1)).toEqual(original.commands.slice(2));
    expect(step.secrets).toEqual(original.secrets);
    expect(step.resources).toEqual(original.resources);
    expect(step.timeoutMinutes).toBe(original.timeoutMinutes);
    expect(step.volumes).toEqual(original.volumes);
  }
});

test("does not widen a narrow selection or regroup main applies", () => {
  const posthog = fixture("tofu-posthog-plan");
  expect(
    groupTofuSteps([posthog])[0]?.orderedSteps?.map((step) => step.key),
  ).toEqual([posthog.key]);
  const applies = testPipelineSteps().filter((step) =>
    step.key.startsWith("tofu-apply-"),
  );
  expect(groupTofuSteps(applies)).toEqual(applies);
  expect(groupTofuSteps([])).toEqual([]);
});

test("retargets dependencies without retaining removed workflow names", () => {
  const seaweedfs = fixture("tofu-plan-seaweedfs");
  const tailscale = fixture("tofu-plan-tailscale");
  const prerequisite = { ...fixture("verify"), key: "before" };
  const after = {
    ...fixture("verify"),
    key: "after",
    dependsOn: [seaweedfs.key, tailscale.key],
  };
  const result = groupTofuSteps([
    prerequisite,
    { ...seaweedfs, dependsOn: ["before"] },
    tailscale,
    after,
  ]);
  expect(result.map((step) => step.key)).toEqual([
    "before",
    "tofu-pr",
    "after",
  ]);
  expect(result[1]?.dependsOn).toEqual(["before"]);
  expect(result[2]?.dependsOn).toEqual(["tofu-pr"]);
});

test("emits sequential required containers with exact per-container grants", () => {
  const workflow = grouped();
  const rendered = emitWorkflow(workflow, TEST_IDENTITY).replaceAll(
    "$$",
    () => "$",
  );
  const emitted = z
    .object({ steps: z.array(Container) })
    .parse(parse(rendered));
  const expected = [workflow, ...(workflow.orderedSteps ?? [])];
  expect(emitted.steps).toHaveLength(expected.length);
  for (const [index, container] of emitted.steps.entries()) {
    const original = expected[index];
    if (original === undefined) throw new Error("Missing command fixture");
    expect(container.name).toBe(original.key);
    expect(container.commands).toEqual(
      wrapCommands({ ...original, label: original.key }),
    );
    expect(container.backend_options.kubernetes.secrets).toEqual(
      original.secrets?.map((grant) => ({
        name: grant.secret,
        key: grant.key,
        target: { env: grant.env },
      })),
    );
    expect(container.backend_options.kubernetes.resources.requests.cpu).toBe(
      original.resources.cpuRequest,
    );
    // Woodpecker defaults to serial execution and stops after a failed step.
    // A per-container DAG edge, failure override or status condition changes that contract.
    expect(container.depends_on).toBeUndefined();
    expect(container.failure).toBeUndefined();
    expect(container.when).toBeUndefined();
  }
});

test("rejects incompatible grouping and impossible workflow budgets", () => {
  expect(() =>
    groupTofuSteps([
      { ...fixture("tofu-plan-arr"), commands: ["changed setup"] },
    ]),
  ).toThrow("Unexpected setup contract");
  expect(() =>
    groupTofuSteps([
      { ...fixture("tofu-plan-arr"), concurrency: { limit: 1 } },
    ]),
  ).toThrow("Unexpected setup contract");
  expect(() =>
    emitWorkflow({ ...grouped(), timeoutMinutes: 270 }, TEST_IDENTITY),
  ).toThrow("exceed workflow budget");
  const workflow = grouped();
  expect(() =>
    emitWorkflow({ ...workflow, orderedSteps: [workflow] }, TEST_IDENTITY),
  ).toThrow("Duplicate container names");
});
