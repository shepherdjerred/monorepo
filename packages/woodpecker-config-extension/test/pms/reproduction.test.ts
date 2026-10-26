import { expect, test } from "vitest";
import { createHash } from "node:crypto";
import { parse } from "yaml";
import { z } from "zod";
import {
  renderPmsReproduction,
  PmsReproductionProtocol,
} from "#src/reproduction/media-pms.ts";
import { TEST_IMAGES } from "#test-identity";

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
      steps: z.array(z.object({ name: z.string(), image: z.string() })),
    })
    .parse(parse(result.yaml));
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
    "clone",
    "media-pms-wire",
    "media-pms-native",
  ]);
  expect(result.plan.steps.map((step) => step.uuid)).toEqual(
    [0, 1, 2].map(
      (index) => `d10ddcc4-2245-4774-b49a-a4a51abcfaf8-${index.toString()}`,
    ),
  );
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
