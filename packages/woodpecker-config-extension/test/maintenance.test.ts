import { expect, test } from "vitest";
import { buildPipelineSteps } from "#src/pipeline/steps.ts";
import {
  separateMaintenance,
  maintenanceSteps,
  eligibleMaintenanceSteps,
} from "#src/pipeline/maintenance.ts";
import { PipelineSchema } from "#src/schemas.ts";
import fixture from "./fixtures/woodpecker-v3.18.1-config-request.json" with { type: "json" };
import { TEST_IMAGES } from "./identity.ts";

test("seed maintenance requires the exact fully verified source, including manual requests", async () => {
  const pipeline = PipelineSchema.parse(fixture.pipeline);
  for (const green of [undefined, "b".repeat(40)]) {
    const steps = await eligibleMaintenanceSteps(
      TEST_IMAGES,
      "workspace-seeds",
      pipeline,
      () => Promise.resolve(green),
    );
    expect(steps[0]?.key).toBe("maintenance-unverified");
    expect(steps[0]?.commands).toContain("exit 1");
  }
  const verified = await eligibleMaintenanceSteps(
    TEST_IMAGES,
    "workspace-seeds",
    pipeline,
    () => Promise.resolve(pipeline.commit),
  );
  expect(verified[0]?.key).toBe("maintenance-workspace-seeds");
});
test("workspace seeds publish both isolated profiles and emit their final receipt only after both", () => {
  const [step] = maintenanceSteps(TEST_IMAGES, "workspace-seeds");
  expect(step?.key).toBe("maintenance-workspace-seeds");
  expect(step?.volumes?.map((volume) => volume.claim)).toContain(
    "woodpecker-workspace-seeds",
  );
  expect(step?.commands.join("\n")).toContain(
    "flock -x /woodpecker/source-control/seeds.lock",
  );
  expect(step?.orderedSteps?.map((child) => child.key)).toEqual([
    "workspace-seed-browser",
    "workspace-seeds-result",
  ]);
  expect(step?.orderedSteps?.[0]?.commands).toContain(
    "cd /woodpecker/browser-seed",
  );
  expect(step?.orderedSteps?.[1]?.commands.join("\n")).toContain(
    "publish-workspace-seed.ts result",
  );
  expect(step?.commands.join("\n")).not.toContain(
    "publish-workspace-seed.ts result",
  );
});

test.each(["release-notes", "ci-images"] as const)(
  "%s selects the automation toolchain through its scope contract",
  (kind) => {
    expect(maintenanceSteps(TEST_IMAGES, kind)[0]?.commands[0]).toBe(
      "MISE_TOOLCHAIN_SCOPE=automation . ci/scripts/toolchain.sh",
    );
  },
);

test("separation removes only maintenance and retains publication and deployment gates", () => {
  const before = buildPipelineSteps({
    images: TEST_IMAGES,
    changedBase: "base",
  });
  const after = separateMaintenance(before);
  expect(
    before
      .filter((step) => !after.some((other) => other.key === step.key))
      .map((step) => step.key),
  ).toEqual(["ci-base-refresh", "ci-playwright-refresh"]);
  expect(after.find((step) => step.key === "helm-push")?.dependsOn).toEqual([
    "homelab-release-admission",
    "images",
  ]);
  expect(after.find((step) => step.key === "publish")?.dependsOn).toContain(
    "release-please",
  );
  expect(
    after.find((step) => step.key === "release-please")?.commands,
  ).toContain(
    "bun --no-install scripts/release/release.ts --phase github-release",
  );
  for (const key of [
    "verify",
    "playwright-e2e",
    "images",
    "publish",
    "argocd-sync",
    "version-commit-back",
  ]) {
    expect(after.find((step) => step.key === key)).toEqual(
      before.find((step) => step.key === key),
    );
  }
});
