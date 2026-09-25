import { describe, expect, test } from "vitest";
import { buildPipelineSteps } from "#src/pipeline/steps.ts";
import { selectSteps } from "#src/pipeline/select.ts";

const IMAGES = {
  base: "ghcr.io/shepherdjerred/ci-base@sha256:" + "a".repeat(64),
  playwright: "ghcr.io/shepherdjerred/ci-playwright@sha256:" + "b".repeat(64),
  windowsCrossCompilerWinui: `ghcr.io/shepherdjerred/windows-cross-compiler-winui@sha256:${"c".repeat(64)}`,
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

/**
 * Pins the release graph against the Buildkite pipeline it replaces.
 *
 * Transcribed edges are easy to drop silently, and a missing one does not
 * fail -- it just lets a lane run too early. Two were in fact missing when
 * this was first written: helm-push must wait on both toolchain refreshes
 * because it embeds their pins, and argocd-sync must wait on the OpenTofu
 * applies so it reconciles against the cluster the charts were built for.
 */
describe("release graph matches the pipeline it replaces", () => {
  const expectedEdges: Readonly<Record<string, readonly string[]>> = {
    "helm-push": [
      "homelab-release-admission",
      "images",
      "ci-base-refresh",
      "ci-playwright-refresh",
    ],
    "argocd-sync": [
      "homelab-release-admission",
      "images",
      "helm-push",
      "tofu-apply-arr",
    ],
    "tofu-apply-seaweedfs": ["homelab-release-admission", "helm-push"],
    "tofu-apply-cloudflare": ["homelab-release-admission", "argocd-sync"],
    "version-commit-back": ["images"],
    "ci-base-refresh": ["verify"],
    "ci-playwright-refresh": ["verify"],
  };

  for (const [key, expected] of Object.entries(expectedEdges)) {
    test(`${key} depends on exactly its pipeline edges`, () => {
      expect(new Set(step(key)?.dependsOn)).toEqual(new Set(expected));
    });
  }
});

/**
 * Every artifact a lane restores must be published by a lane it depends on.
 *
 * This is the invariant the Buildkite artifact store enforced implicitly by
 * scoping downloads to a named producing step. Nothing enforces it now, and a
 * mismatch would surface as a deploy that publishes whatever happens to be on
 * disk rather than as an error.
 */
describe("artifact producers and consumers line up", () => {
  const producedBy = new Map<string, string>();
  const consumedBy: { key: string; artifact: string }[] = [];

  for (const candidate of allSteps()) {
    for (const command of candidate.commands) {
      const put = /ci-artifact\.ts put (?<name>[\w-]+)/u.exec(command);
      if (put?.groups?.["name"] !== undefined) {
        producedBy.set(put.groups["name"], candidate.key);
      }
      const get = /ci-artifact\.ts get (?<name>[\w-]+)/u.exec(command);
      if (get?.groups?.["name"] !== undefined) {
        consumedBy.push({ key: candidate.key, artifact: get.groups["name"] });
      }
    }
  }

  test("at least one artifact is exchanged", () => {
    expect(consumedBy.length).toBeGreaterThan(0);
  });

  test("each consumed artifact has a producer upstream of it", () => {
    for (const { key, artifact } of consumedBy) {
      const producer = producedBy.get(artifact);
      expect(producer, `${artifact} has no producer`).toBeDefined();
      if (producer === undefined) continue;
      expect(
        dependsTransitivelyOn(allSteps(), key, producer),
        `${key} consumes ${artifact} but does not depend on ${producer}`,
      ).toBe(true);
    }
  });
});

/**
 * Handoffs published from inside a script rather than by a lane command.
 *
 * bake-images.ts writes these three itself, so they are invisible to a scan
 * of the lane commands. Declaring them keeps the upstream-dependency check
 * meaningful and records the coupling: if that script stops publishing one,
 * this list is where the consumers are named.
 */
const SCRIPT_PUBLISHED_HANDOFFS: Readonly<Record<string, string>> = {
  "image-digests": "images",
  "version-catalog": "images",
  "pin-candidates": "images",
};

/** Same invariant for the JSON handoff store. */
describe("handoff producers and consumers line up", () => {
  test("each required handoff read has a producer upstream of it", () => {
    const steps = allSteps();
    const producedBy = new Map<string, string>(
      Object.entries(SCRIPT_PUBLISHED_HANDOFFS),
    );
    for (const candidate of steps) {
      for (const command of candidate.commands) {
        const put = /write-ci-handoff\.ts (?<name>[\w-]+)/u.exec(command);
        if (put?.groups?.["name"] !== undefined) {
          producedBy.set(put.groups["name"], candidate.key);
        }
      }
    }
    for (const candidate of steps) {
      for (const command of candidate.commands) {
        const get = /read-ci-handoff\.ts (?<name>[\w-]+)/u.exec(command);
        const artifact = get?.groups?.["name"];
        if (artifact === undefined) continue;
        const producer = producedBy.get(artifact);
        expect(producer, `${artifact} has no producer`).toBeDefined();
        if (producer === undefined) continue;
        expect(
          dependsTransitivelyOn(steps, candidate.key, producer),
          `${candidate.key} reads ${artifact} but does not depend on ${producer}`,
        ).toBe(true);
      }
    }
  });
});

/**
 * Every Buildkite step is accounted for.
 *
 * Kept as an explicit list rather than a count so that dropping a lane during
 * a later refactor names the lane, and so the two steps with NO successor have
 * to be justified in writing rather than silently missing.
 */
describe("coverage of the Buildkite pipeline", () => {
  /** Buildkite key -> the ported lane that covers it. */
  const COVERAGE: Readonly<Record<string, string>> = {
    verify: "verify",
    "alert-dashboard-sqlite": "alert-dashboard-sqlite",
    trivy: "trivy",
    semgrep: "semgrep",
    "resume-build-pr": "resume-build",
    "resume-build-main": "resume-build",
    "trmnl-validate-pr": "trmnl-validate",
    "trmnl-publish": "trmnl-publish",
    "playwright-e2e-pr": "playwright-e2e",
    "playwright-e2e-main": "playwright-e2e",
    "docker-e2e-pr": "docker-e2e",
    "docker-e2e-main": "docker-e2e",
    "pr-dryrun": "pr-dryrun",
    "codex-review-gate": "codex-review-gate",
    "tofu-plan-seaweedfs": "tofu-plan-seaweedfs",
    "tofu-plan-tailscale": "tofu-plan-tailscale",
    "tofu-plan-arr": "tofu-plan-arr",
    "tofu-plan-github": "tofu-plan-github",
    "tofu-plan-cloudflare": "tofu-plan-cloudflare",
    "tofu-platforms-validate": "tofu-platforms-validate",
    "tofu-posthog-plan": "tofu-posthog-plan",
    "homelab-release-admission": "homelab-release-admission",
    images: "images",
    "images-pr": "images-pr",
    "helm-push": "helm-push",
    "argocd-sync": "argocd-sync",
    "tofu-apply-seaweedfs": "tofu-apply-seaweedfs",
    "tofu-apply-tailscale": "tofu-apply-tailscale",
    "tofu-apply-arr": "tofu-apply-arr",
    "tofu-apply-github": "tofu-apply-github",
    "tofu-apply-cloudflare": "tofu-apply-cloudflare",
    "tofu-posthog": "tofu-posthog",
    "tofu-platform-openai": "tofu-platform-openai",
    "tofu-platform-anthropic": "tofu-platform-anthropic",
    "tofu-platform-discord": "tofu-platform-discord",
    "tofu-platform-openrouter": "tofu-platform-openrouter",
    "tofu-platform-cloudflare-tokens": "tofu-platform-cloudflare-tokens",
    sites: "sites",
    publish: "publish",
    "release-please": "release-please",
    "version-commit-back": "version-commit-back",
    "ci-base-refresh": "ci-base-refresh",
    "ci-playwright-refresh": "ci-playwright-refresh",
    "windows-cross-compiler-refresh": "windows-cross-compiler-refresh",
    "windows-cross-compiler-pr": "windows-cross-compiler-pr",
    "macos-cross-compiler-pr": "macos-cross-compiler-pr",
    "macos-cross-compiler": "macos-cross-compiler",
    "scout-beta-release": "scout-beta-release",
    "scout-tag-release": "scout-tag-release",
    "scout-prod-reconcile": "scout-prod-reconcile",
    "quotabar-macos-pr": "quotabar-macos",
    "quotabar-macos-main": "quotabar-macos",
    "hkctl-native-pr": "hkctl-native",
    "hkctl-native-main": "hkctl-native",
    "tasknotes-native-pr": "tasknotes-native",
    "tasknotes-native-main": "tasknotes-native",
    "tasknotes-windows-cross": "tasknotes-windows-cross",
  };

  /** Buildkite steps deliberately left with no successor, and why. */
  const RETIRED: Readonly<Record<string, string>> = {
    "build-summary": "produced only the build annotation this migration drops",
    "macos-native-dispatch":
      "watchdog polling Buildkite job state; Woodpecker queues the workflow itself",
    "tofu-plan-buildkite":
      "plans the Buildkite cluster stack, which is deleted rather than ported",
    "tofu-apply-buildkite":
      "applies the Buildkite cluster stack, which is deleted rather than ported",
  };

  test("accounts for all 61 Buildkite steps", () => {
    expect(Object.keys(COVERAGE).length + Object.keys(RETIRED).length).toBe(61);
  });

  test("every claimed successor actually exists", () => {
    const emitted = new Set(allSteps().map((s) => s.key));
    for (const [buildkiteKey, lane] of Object.entries(COVERAGE)) {
      expect(emitted.has(lane), `${buildkiteKey} -> missing lane ${lane}`).toBe(
        true,
      );
    }
  });

  test("every emitted lane is claimed by something", () => {
    const claimed = new Set(Object.values(COVERAGE));
    for (const emitted of allSteps()) {
      expect(
        claimed.has(emitted.key),
        `${emitted.key} is emitted but unclaimed`,
      ).toBe(true);
    }
  });
});

/**
 * The Storybook catalogs reach their dist-only dependencies through
 * `@scout-for-lol/data`, so the lane has to direct-filter them into the
 * install and compile them before assembling the site. `turbo run` cannot do
 * it: the lane installs a filtered subset, so `^build` has nothing to resolve.
 */
test("the sites lane installs and pre-builds the Storybook catalogs", () => {
  const sites = step("sites");
  if (sites === undefined) throw new Error("sites step missing");
  const commands = sites.commands.join("\n");

  expect(commands).toContain(
    "ci/scripts/selectors/ci-changed.ts site-scout-design-system",
  );
  expect(commands).toContain(
    "--filter '@scout-for-lol/design-system' --filter '@scout-for-lol/app' --filter '@shepherdjerred/llm-models' --filter '@shepherdjerred/glitter-context'",
  );
  expect(commands).toContain(
    "bun --no-install run --cwd packages/llm-models build",
  );
  expect(commands).toContain(
    "bun --no-install run --cwd packages/glitter-context build",
  );
  expect(commands).toContain(
    "bun --no-install scripts/release/deploy-site.ts scout-design-system",
  );
  expect(commands).not.toContain("turbo run");
});

/**
 * `ci-changed.ts`, the Playwright selector, and the image selector each read
 * the change base from the step's environment and treat its absence as "run
 * everything". A step generated without it rebuilds and republishes on every
 * push to main, so every step gets it -- not only the ones that remember to.
 */
describe("change detection", () => {
  test("reaches every step", () => {
    const steps = buildPipelineSteps({
      images: IMAGES,
      changedBase: "green-main",
      imageReleaseBase: "released",
    });
    for (const candidate of steps) {
      expect(candidate.environment, candidate.key).toMatchObject({
        CI_CHANGED_BASE: "green-main",
        CI_LAST_IMAGE_RELEASE_COMMIT: "released",
      });
    }
  });
});
