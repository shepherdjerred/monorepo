import { expect, test } from "vitest";
import { createHash } from "node:crypto";
import { parse } from "yaml";
import { z } from "zod";
import {
  renderPmsReproduction,
  PmsReproductionProtocol,
} from "#src/reproduction/media-pms.ts";
import { TEST_IMAGES } from "#test-identity";
import {
  ORDINARY_CLONE_IMAGE,
  SOURCE_CACHE_PREPARATION_IMAGE,
} from "#src/pipeline/source-cache.ts";

test("PMS preview retains both actual containers and requires separate execution ownership", () => {
  const result = renderPmsReproduction(
    {
      source: "a".repeat(40),
      branch: "feature/media",
      requestId: "d10ddcc4-2245-4774-b49a-a4a51abcfaf8",
    },
    TEST_IMAGES,
  );
  const workflow = z
    .object({
      when: z.array(z.object({ event: z.array(z.string()) })),
      steps: z.array(z.object({ name: z.string(), image: z.string() })),
    })
    .parse(parse(result.yaml));
  expect(workflow.when).toEqual([{ event: ["manual"] }]);
  expect(workflow.steps).toEqual([
    { name: "media-pms-wire", image: TEST_IMAGES.base },
    {
      name: "media-pms-native",
      image: TEST_IMAGES.catalog["plexinc/pms-docker"],
    },
  ]);
  expect(result.plan.yamlSha256).toBe(
    createHash("sha256").update(result.yaml).digest("hex"),
  );
  expect(result.plan.policy).toMatchObject({
    queue: "default",
    workloadPriority: "ci-draft",
    serviceAccount: "woodpecker-job",
  });
  expect(result.plan.componentAcceptanceOnly).toBe(true);
  expect(result.plan.jobImagePullSecrets).toEqual([
    "dockerhub-pull-woodpecker-ci",
  ]);
  expect(result.plan.steps.map((step) => step.name)).toEqual([
    "clear-golden",
    "clone",
    "media-pms-wire",
    "media-pms-native",
  ]);
  expect(result.plan.steps.map((step) => step.uuid)).toEqual(
    [0, 1, 2, 3].map(
      (index) => `d10ddcc4-2245-4774-b49a-a4a51abcfaf8-${index.toString()}`,
    ),
  );
  expect(result.plan.steps.slice(0, 2)).toMatchObject([
    {
      name: "clear-golden",
      image: SOURCE_CACHE_PREPARATION_IMAGE,
      commands: [
        "if [ -e .ci-golden ]; then find . -mindepth 1 -maxdepth 1 -exec rm -rf {} +; fi",
      ],
    },
    { name: "clone", image: ORDINARY_CLONE_IMAGE, commands: [] },
  ]);
  expect(
    PmsReproductionProtocol.safeParse({
      ...result.plan,
      steps: result.plan.steps.slice(1),
    }).success,
  ).toBe(false);
  expect(
    PmsReproductionProtocol.safeParse({ ...result.plan, secret: "forbidden" })
      .success,
  ).toBe(false);
  expect(
    PmsReproductionProtocol.safeParse({
      ...result.plan,
      steps: [...result.plan.steps, result.plan.steps[0]],
    }).success,
  ).toBe(false);
  expect(
    PmsReproductionProtocol.safeParse({
      ...result.plan,
      policy: { ...result.plan.policy, queue: "ci-gates" },
    }).success,
  ).toBe(false);
  expect(
    PmsReproductionProtocol.safeParse({
      ...result.plan,
      jobImagePullSecrets: [],
    }).success,
  ).toBe(false);
  expect(
    PmsReproductionProtocol.safeParse({
      ...result.plan,
      jobImagePullSecrets: ["unapproved"],
    }).success,
  ).toBe(false);
  expect(
    PmsReproductionProtocol.safeParse({
      ...result.plan,
      jobImagePullSecrets: ["dockerhub-pull-woodpecker-ci", "unapproved"],
    }).success,
  ).toBe(false);
});

test("PMS preview refuses symbolic source identities before emitting a workflow", () => {
  expect(() =>
    renderPmsReproduction(
      {
        source: "HEAD",
        branch: "feature/media",
        requestId: "d10ddcc4-2245-4774-b49a-a4a51abcfaf8",
      },
      TEST_IMAGES,
    ),
  ).toThrow();
});
