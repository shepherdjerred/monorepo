import { describe, expect, test } from "vitest";
import { buildPipelineSteps } from "#src/pipeline/steps.ts";
import { selectSteps } from "#src/pipeline/select.ts";

const IMAGES = {
  base: "ghcr.io/shepherdjerred/ci-base@sha256:" + "a".repeat(64),
  playwright: "ghcr.io/shepherdjerred/ci-playwright@sha256:" + "b".repeat(64),
  catalog: {
    "aquasec/trivy": "aquasec/trivy:0.72.0",
    "semgrep/semgrep": "semgrep/semgrep:1.170.0",
    "texlive/texlive": "texlive/texlive:TL2024-historic",
    "trmnl/trmnlp": "trmnl/trmnlp:v0.11.0",
    "grafana/tempo": "grafana/tempo:3.0.3",
    "mikefarah/yq": "mikefarah/yq:latest",
    "minio/mc": "minio/mc:RELEASE",
    "minio/minio": "minio/minio:RELEASE",
  },
};

const allSteps = () => buildPipelineSteps({ images: IMAGES, changedBase: "x" });

const step = (key: string) => allSteps().find((s) => s.key === key);

const secretEnvs = (key: string) =>
  (allSteps().find((s) => s.key === key)?.secrets ?? []).map((g) => g.env);

function keysFor(changedFiles: string[], branch = "feature"): string[] {
  return selectSteps(allSteps(), {
    event: branch === "main" ? "push" : "pull_request",
    branch,
    defaultBranch: "main",
    changedFiles,
  }).map((selected) => selected.key);
}

/** Is `target` an ancestor of `key` anywhere in the dependency graph? */
function dependsTransitivelyOn(
  steps: readonly { key: string; dependsOn?: readonly string[] }[],
  key: string,
  target: string,
): boolean {
  const byKey = new Map(steps.map((s) => [s.key, s]));
  const seen = new Set<string>();
  const stack = [key];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    for (const dependency of byKey.get(current)?.dependsOn ?? []) {
      if (dependency === target) return true;
      stack.push(dependency);
    }
  }
  return false;
}

const isApplyLane = (key: string) =>
  key.startsWith("tofu-apply-") ||
  key.startsWith("tofu-platform-") ||
  key === "tofu-posthog";

describe("release applies", () => {
  test("every apply is gated on the admission token", () => {
    const applies = allSteps().filter((s) => isApplyLane(s.key));
    expect(applies.length).toBeGreaterThan(0);
    const all = allSteps();
    for (const applyStep of applies) {
      // Chained applies reach admission through their predecessor rather
      // than directly, so the invariant is reachability, not adjacency.
      expect(
        dependsTransitivelyOn(all, applyStep.key, "homelab-release-admission"),
      ).toBe(true);
      // A superseded build must stop, and an unexpected verdict must fail.
      const joined = applyStep.commands.join("\n");
      expect(joined).toContain('"$release_admission" = "superseded"');
      expect(joined).toContain("exit 1");
    }
  });

  test("applies are default-branch only", () => {
    const keys = keysFor(["packages/homelab/src/tofu/github/rulesets.tf"]);
    expect(keys).not.toContain("tofu-apply-github");
    expect(
      keysFor(["packages/homelab/src/tofu/github/rulesets.tf"], "main"),
    ).toEqual(
      expect.arrayContaining([
        "homelab-release-admission",
        "tofu-apply-github",
      ]),
    );
  });

  /** They write to one shared destination, so they must not race. */
  test("platform credential applies share one serialization group", () => {
    const groups = allSteps()
      .filter((s) => s.key.startsWith("tofu-platform-"))
      .map((s) => s.concurrency?.group);
    expect(groups).toHaveLength(5);
    expect(new Set(groups)).toEqual(new Set(["tofu-platform-credentials"]));
  });

  test("each platform apply gets only its own provider credentials", () => {
    expect(secretEnvs("tofu-platform-anthropic")).toContain(
      "ANTHROPIC_ADMIN_API_KEY",
    );
    expect(secretEnvs("tofu-platform-anthropic")).not.toContain(
      "OPENAI_ADMIN_KEY",
    );
    expect(secretEnvs("tofu-platform-discord")).toContain(
      "DISCORD_SCOUT_PROD_BOT_TOKEN",
    );
    expect(secretEnvs("tofu-platform-openai")).not.toContain(
      "DISCORD_SCOUT_PROD_BOT_TOKEN",
    );
  });
});

describe("release chain", () => {
  /**
   * Whether a release is needed depends on whether the image lane pushed
   * anything, which selection cannot know. A changed-path guard here would
   * skip a release that pushed images without touching a helm or argocd path.
   */
  test("release lanes carry no changed-path guard", () => {
    for (const key of ["images", "helm-push", "argocd-sync"]) {
      expect(step(key)?.changed).toBeUndefined();
      expect(step(key)?.defaultBranchOnly).toBe(true);
    }
  });

  test("the chain is ordered images then helm-push then argocd-sync", () => {
    expect(step("images")?.dependsOn).toEqual(
      expect.arrayContaining(["verify", "homelab-release-admission"]),
    );
    expect(step("helm-push")?.dependsOn).toContain("images");
    expect(step("argocd-sync")?.dependsOn).toEqual(
      expect.arrayContaining(["images", "helm-push"]),
    );
  });

  /** Two builds must not interleave a rollout. */
  test("helm-push and argocd-sync share one serialization group", () => {
    expect(step("helm-push")?.concurrency).toEqual({
      limit: 1,
      group: "homelab-release",
    });
    expect(step("argocd-sync")?.concurrency).toEqual({
      limit: 1,
      group: "homelab-release",
    });
  });

  test("chained applies run in order behind the release", () => {
    expect(step("tofu-apply-seaweedfs")?.dependsOn).toContain("helm-push");
    expect(step("tofu-apply-tailscale")?.dependsOn).toEqual([
      "tofu-apply-seaweedfs",
    ]);
    expect(step("tofu-apply-arr")?.dependsOn).toEqual(["tofu-apply-tailscale"]);
    // DNS records point at services that must already be reconciled.
    expect(step("tofu-apply-cloudflare")?.dependsOn).toContain("argocd-sync");
  });

  test("argocd-sync uses release-root, never a bare sync", () => {
    const joined = step("argocd-sync")?.commands.join("\n") ?? "";
    expect(joined).toContain("release-root apps argocd-release-expected.json");
    expect(joined).not.toMatch(/argocd\.ts sync\b/u);
  });

  test("the image release base reaches the steps that need it", () => {
    const steps = buildPipelineSteps({
      images: IMAGES,
      changedBase: "x",
      imageReleaseBase: "deadbeef",
    });
    expect(steps.find((s) => s.key === "images")?.environment).toMatchObject({
      CI_LAST_IMAGE_RELEASE_COMMIT: "deadbeef",
    });
  });

  test("an absent image release base is passed through as empty", () => {
    expect(step("images")?.environment).toMatchObject({
      CI_LAST_IMAGE_RELEASE_COMMIT: "",
    });
  });
});
