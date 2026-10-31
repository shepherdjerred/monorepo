import { expect, test } from "vitest";
import { siteSteps } from "#src/pipeline/lanes/sites.ts";

const images = {
  base: "base",
  playwright: "browser",
  catalog: {
    "aquasec/trivy": "trivy",
    "semgrep/semgrep": "semgrep",
    "texlive/texlive": "texlive",
    "trmnl/trmnlp": "trmnl",
    "grafana/tempo": "tempo",
    "mikefarah/yq": "yq",
    "minio/mc": "mc",
    "minio/minio": "minio",
  },
};
test("every static producer publishes immutable archives with no activation credential or deployment dependency", () => {
  const step = siteSteps(images).find((entry) => entry.key === "sites");
  if (step === undefined) throw new Error("Site producer missing");
  const builds = step.commands.filter((command) =>
    command.includes("scripts/release/deploy-site.ts"),
  );
  expect(builds).toHaveLength(14);
  for (const command of builds) expect(command).toContain(" --archive");
  expect(step.commands).toContain(
    "bun --no-install scripts/ci/write-site-archive-handoff.ts",
  );
  expect(step.dependsOn).toEqual([
    "verify",
    "playwright-e2e",
    "resume-build",
    "scout-site-archives",
  ]);
  expect(
    step.secrets?.some((secret) =>
      /SEAWEEDFS_SITES|CLOUDFLARE|ARGOCD|TOFU/u.test(secret.key),
    ),
  ).toBe(false);
  expect(step.secrets?.map((secret) => secret.key)).toContain(
    "DELIVERY_ARCHIVE_PUBLISHER_SECRET_ACCESS_KEY",
  );
  expect(
    step.commands.some((command) =>
      /homelab-release-admission|purge|s3 sync/u.test(command),
    ),
  ).toBe(false);
  expect(siteSteps(images).some((entry) => entry.key === "publish")).toBe(true);
});
