import { expect, test } from "vitest";
import { deliveryPublicationSteps } from "#src/pipeline/lanes/delivery.ts";
import { npmPackageArchiveSteps } from "#src/pipeline/lanes/npm-packages.ts";
import { selectSteps } from "#src/pipeline/select.ts";
import { buildPipelineSteps } from "#src/pipeline/steps.ts";

const TEST_IMAGES = {
  base: "ci-base-image",
  playwright: "ci-browser-image",
  catalog: {
    "aquasec/trivy": "trivy-image",
    "semgrep/semgrep": "semgrep-image",
    "texlive/texlive": "texlive-image",
    "trmnl/trmnlp": "trmnlp-image",
    "grafana/tempo": "tempo-image",
    "mikefarah/yq": "yq-image",
    "minio/mc": "mc-image",
    "minio/minio": "minio-image",
    "plexinc/pms-docker": `plexinc/pms-docker:1.43.4.10903-e5521bd8c-amd64@sha256:${"c".repeat(64)}`,
  },
};

function testPipelineSteps(deliveryCatalogV2: boolean) {
  return buildPipelineSteps({
    images: TEST_IMAGES,
    changedBase: "base",
    imageReleaseBase: "base",
    deliveryCatalogV2,
  });
}

function publishCommands(catalogV2: boolean): string {
  return (
    testPipelineSteps(catalogV2)
      .find((step) => step.key === "publish")
      ?.commands.join("\n") ?? ""
  );
}

test("the npm archive producer freezes channel tarballs on main with no npm credential", () => {
  const [step] = npmPackageArchiveSteps(TEST_IMAGES);
  expect(step).toMatchObject({
    key: "npm-package-archives",
    defaultBranchOnly: true,
    dependsOn: ["verify"],
  });
  expect(step?.changed).toBeUndefined();
  expect(step?.commands).toContain(
    "bun --no-install scripts/ci/publish-npm-package-archives.ts",
  );
  expect(step?.secrets?.map((grant) => grant.env).sort()).toEqual([
    "DELIVERY_ARCHIVE_PUBLISHER_ACCESS_KEY_ID",
    "DELIVERY_ARCHIVE_PUBLISHER_SECRET_ACCESS_KEY",
    "GITHUB_DOWNLOAD_TOKEN",
    "SEAWEEDFS_HANDOFF_ACCESS_KEY_ID",
    "SEAWEEDFS_HANDOFF_SECRET_ACCESS_KEY",
  ]);
});

test("under the v2 catalog registration waits for the tarballs, and pull requests never reach them", () => {
  const publication = deliveryPublicationSteps(
    TEST_IMAGES,
    true,
    true,
    true,
  ).find((step) => step.key === "delivery-publish");
  expect(publication?.dependsOn).toContain("npm-package-archives");
  const steps = testPipelineSteps(true);
  const select = (event: "push" | "pull_request") =>
    selectSteps(steps, {
      event,
      branch: "main",
      defaultBranch: "main",
      changedFiles: ["packages/webring/src/index.ts"],
    }).map((step) => step.key);
  expect(select("push")).toContain("npm-package-archives");
  expect(select("pull_request")).not.toContain("npm-package-archives");
  expect(testPipelineSteps(false).map((step) => step.key)).not.toContain(
    "npm-package-archives",
  );
  expect(
    deliveryPublicationSteps(TEST_IMAGES, true, true).find(
      (step) => step.key === "delivery-publish",
    )?.dependsOn,
  ).not.toContain("npm-package-archives");
});

test("CI stops publishing webring to npm once the channel deployment is the publisher", () => {
  expect(publishCommands(false)).toContain(
    "bun --no-install run --cwd packages/webring publish:npm",
  );
  expect(publishCommands(true)).not.toMatch(/webring/u);
  expect(publishCommands(true)).toContain(
    "bun --no-install run --cwd packages/astro-opengraph-images publish:npm",
  );
});
