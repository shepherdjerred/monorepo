import { expect, test } from "vitest";
import { selectSteps } from "#src/pipeline/select.ts";
import { tofuArchiveSteps } from "#src/pipeline/lanes/tofu.ts";
import { deliveryPublicationSteps } from "#src/pipeline/lanes/delivery.ts";
import { TEST_IMAGES, testPipelineSteps } from "./identity.ts";

const producer = () =>
  tofuArchiveSteps(TEST_IMAGES).find((step) => step.key === "tofu-archives");

test("the archive producer freezes every stack on every main push with no plan, apply or provider authority", () => {
  const step = producer();
  if (step === undefined) throw new Error("OpenTofu archive producer missing");
  expect(step.defaultBranchOnly).toBe(true);
  expect(step.changed).toBeUndefined();
  expect(step.events).toBeUndefined();
  expect(step.dependsOn).toEqual(["verify"]);
  expect(step.commands).toContain(
    "bun --no-install scripts/ci/publish-tofu-archives.ts",
  );
  expect(step.commands).toContain(
    "bun --no-install scripts/ci/write-tofu-archive-handoff.ts",
  );
  expect(step.commands.join("\n")).not.toMatch(
    /tofu-stack\.ts|tofu (?:plan|apply)|-chdir/u,
  );
  expect(step.secrets?.map((grant) => grant.env).sort()).toEqual([
    "DELIVERY_ARCHIVE_PUBLISHER_ACCESS_KEY_ID",
    "DELIVERY_ARCHIVE_PUBLISHER_SECRET_ACCESS_KEY",
    "GITHUB_DOWNLOAD_TOKEN",
    "SEAWEEDFS_HANDOFF_ACCESS_KEY_ID",
    "SEAWEEDFS_HANDOFF_SECRET_ACCESS_KEY",
  ]);
});

test("registration waits for the archive producer and pull requests never reach it", () => {
  const publication = deliveryPublicationSteps(
    TEST_IMAGES,
    true,
    true,
    true,
  ).find((step) => step.key === "delivery-publish");
  expect(publication?.dependsOn).toContain("tofu-archives");
  expect(publication?.commands).toContain(
    "bun --no-install scripts/ci/publish-delivery.ts --static-archives --catalog-v2",
  );
  const steps = testPipelineSteps(true);
  const main = selectSteps(steps, {
    event: "push",
    branch: "main",
    defaultBranch: "main",
    changedFiles: ["packages/docs/wiki/src/content/docs/index.md"],
  }).map((step) => step.key);
  expect(main).toContain("tofu-archives");
  const pullRequest = selectSteps(steps, {
    event: "pull_request",
    branch: "main",
    defaultBranch: "main",
    changedFiles: [],
  }).map((step) => step.key);
  expect(pullRequest).not.toContain("tofu-archives");
});

test("before the window's catalog flip, main builds no archives and publication registers v1 owners", () => {
  const publication = deliveryPublicationSteps(TEST_IMAGES, true, true).find(
    (step) => step.key === "delivery-publish",
  );
  expect(publication?.dependsOn).not.toContain("tofu-archives");
  expect(publication?.commands).toContain(
    "bun --no-install scripts/ci/publish-delivery.ts --static-archives",
  );
  const steps = testPipelineSteps(false);
  expect(steps.map((step) => step.key)).not.toContain("tofu-archives");
  const commands = steps.flatMap((step) => step.commands).join("\n");
  expect(commands).not.toContain("--catalog-v2");
  expect(
    testPipelineSteps(true)
      .filter((step) =>
        step.commands.some((command) => command.includes("--catalog-v2")),
      )
      .map((step) => step.key)
      .sort(),
  ).toEqual(["helm-push", "images", "sites"]);
});
