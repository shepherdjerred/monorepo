import { expect, test } from "vitest";
import { buildPipelineSteps } from "#src/pipeline/steps.ts";
import { separateMaintenance } from "#src/pipeline/maintenance.ts";
import { TEST_IMAGES } from "./identity.ts";

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
