import { expect, test } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import { mediaPmsSteps } from "#src/pipeline/lanes/media-pms.ts";
import { buildPipelineSteps } from "#src/pipeline/steps.ts";
import { selectSteps } from "#src/pipeline/select.ts";
import { emitWorkflow } from "#src/pipeline/emit.ts";
import { TEST_IDENTITY, TEST_IMAGES } from "#test-identity";

test("real PMS lane is mandatory for Media changes and uses only native catalogued image", () => {
  const lane = mediaPmsSteps(TEST_IMAGES)[0];
  if (lane === undefined) throw new Error("PMS lane missing");
  expect(lane.allowFailure).toBeUndefined();
  expect(lane.retries).toBeUndefined();
  expect(lane.secrets).toBeUndefined();
  expect(lane.volumes).toBeUndefined();
  expect(lane.services).toBeUndefined();
  expect(lane.concurrency).toEqual({ limit: 1, group: "media-pms-wire" });
  expect(lane.commands).toContain(
    "MISE_TOOLCHAIN_SCOPE=runtime . ci/scripts/toolchain.sh",
  );
  expect(lane.orderedSteps).toHaveLength(1);
  expect(lane.orderedSteps?.[0]).toMatchObject({
    image: TEST_IMAGES.catalog["plexinc/pms-docker"],
    timeoutMinutes: 5,
  });
  expect(lane.orderedSteps?.[0]?.secrets).toBeUndefined();
  expect(
    lane.commands.some((command) =>
      command.includes("--compile --target=bun-linux-x64"),
    ),
  ).toBe(true);
  const selected = selectSteps(
    buildPipelineSteps({ images: TEST_IMAGES, changedBase: "x" }),
    {
      event: "pull_request",
      branch: "feature",
      defaultBranch: "main",
      changedFiles: ["packages/media/src/integrations/plex.ts"],
    },
  );
  expect(selected.map((step) => step.key)).toContain("media-pms-wire");
});

test("PMS emission accounts for both container resources and keeps the server on CI node", () => {
  const lane = mediaPmsSteps(TEST_IMAGES)[0];
  if (lane === undefined) throw new Error("PMS lane missing");
  const raw = parse(emitWorkflow(lane, TEST_IDENTITY));
  const workflow = z
    .object({
      steps: z.array(
        z.object({
          name: z.string(),
          image: z.string(),
          backend_options: z.object({
            kubernetes: z.object({
              nodeSelector: z.record(z.string(), z.string()),
              resources: z.unknown(),
            }),
          }),
        }),
      ),
    })
    .parse(raw);
  const native = workflow.steps.find(
    (step) => step.name === "media-pms-native",
  );
  expect(native?.image).toBe(TEST_IMAGES.catalog["plexinc/pms-docker"]);
  expect(native?.backend_options.kubernetes.nodeSelector).toEqual({
    "kubernetes.io/hostname": "liskov",
  });
  expect(native?.backend_options.kubernetes.resources).toEqual({
    requests: { cpu: "1", memory: "2Gi", "ephemeral-storage": "1Gi" },
    limits: { cpu: "2", memory: "4Gi", "ephemeral-storage": "4Gi" },
  });
  expect(JSON.stringify(raw)).not.toMatch(
    /PLEX_CLAIM|ALLOWED_NETWORKS|hostNetwork|secretKeyRef/u,
  );
});

test("wrong architecture or floating PMS image is rejected before generating a runnable lane", () => {
  for (const image of [
    "plexinc/pms-docker:latest",
    TEST_IMAGES.catalog["plexinc/pms-docker"].replace("-amd64@", "-arm64@"),
  ])
    expect(() =>
      mediaPmsSteps({
        ...TEST_IMAGES,
        catalog: { ...TEST_IMAGES.catalog, "plexinc/pms-docker": image },
      }),
    ).toThrow("exact catalogued amd64");
});
