import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  buildPipelineSteps,
  credentiallessHostedAutomationSteps,
} from "#src/pipeline/steps.ts";
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

test("release orchestration resolves only the tools it executes", () => {
  for (const key of [
    "images",
    "ci-base-refresh",
    "ci-playwright-refresh",
    "version-commit-back",
    "release-please",
  ]) {
    expect(step(key)?.commands).toContain(
      "MISE_TOOLCHAIN_SCOPE=automation . ci/scripts/toolchain.sh",
    );
  }
  for (const key of ["helm-push", "argocd-sync"]) {
    expect(step(key)?.commands).toContain(
      "MISE_TOOLCHAIN_SCOPE=deployment . ci/scripts/toolchain.sh",
    );
  }
  for (const candidate of allSteps().filter((s) => s.key.startsWith("tofu-"))) {
    expect(candidate.commands).toContain(
      "MISE_TOOLCHAIN_SCOPE=tofu . ci/scripts/toolchain.sh",
    );
  }
  expect(step("verify")?.commands).toContain(". ci/scripts/toolchain.sh");
});

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
    expect(groups).toHaveLength(4);
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
    expect(joined).toContain('--revision "$apps_revision"');
    expect(joined).toContain('--request-id "$request_id"');
    expect(joined).not.toMatch(/argocd\.ts sync\b/u);
  });

  test("the image release base reaches the steps that need it", () => {
    const steps = buildPipelineSteps({
      images: IMAGES,
      changedBase: "x",
      imageReleaseBase: "deadbeef",
      imageReleasePipeline: 6485,
    });
    expect(steps.find((s) => s.key === "images")?.environment).toMatchObject({
      CI_LAST_IMAGE_RELEASE_COMMIT: "deadbeef",
      CI_LAST_IMAGE_RELEASE_PIPELINE: "6485",
    });
  });

  test("an absent image release base is passed through as empty", () => {
    expect(step("images")?.environment).toMatchObject({
      CI_LAST_IMAGE_RELEASE_COMMIT: "",
      CI_LAST_IMAGE_RELEASE_PIPELINE: "",
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
    "tofu-apply-cloudflare": [
      "homelab-release-admission",
      "argocd-sync",
      "sites",
    ],
    "version-commit-back": ["images", "argocd-sync"],
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
    const command = candidate.commands.join("\n");
    for (const put of command.matchAll(
      /ci-artifact\.ts put (?<name>[\w-]+)/gu,
    )) {
      if (put.groups?.["name"] !== undefined) {
        producedBy.set(put.groups["name"], candidate.key);
      }
    }
    for (const get of command.matchAll(
      /ci-artifact\.ts get (?<name>[\w-]+)/gu,
    )) {
      if (get.groups?.["name"] !== undefined) {
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
 * Every lane the generator emits is named here.
 *
 * Kept as an explicit list rather than a count so that dropping or adding a
 * lane names it, and paused lanes have to be justified in writing rather than
 * silently missing.
 */
describe("lane inventory", () => {
  const EXPECTED_LANES: ReadonlySet<string> = new Set([
    "alert-dashboard-sqlite",
    "argocd-sync",
    "ci-base-refresh",
    "ci-playwright-refresh",
    "codex-review-gate",
    "docker-e2e",
    "helm-push",
    "homelab-release-admission",
    "images",
    "paper-smoke-pr",
    "playwright-e2e",
    "pr-dryrun",
    "publish",
    "release-please",
    "resume-build",
    "scout-beta-release",
    "scout-prod-reconcile",
    "scout-tag-release",
    "semgrep",
    "sites",
    "tofu-apply-arr",
    "tofu-apply-cloudflare",
    "tofu-apply-github",
    "tofu-apply-seaweedfs",
    "tofu-apply-tailscale",
    "tofu-plan-arr",
    "tofu-plan-cloudflare",
    "tofu-plan-github",
    "tofu-plan-seaweedfs",
    "tofu-plan-tailscale",
    "tofu-platform-anthropic",
    "tofu-platform-cloudflare-tokens",
    "tofu-platform-discord",
    "tofu-platform-openai",
    "tofu-platforms-validate",
    "tofu-posthog",
    "tofu-posthog-plan",
    "trivy",
    "trmnl-publish",
    "trmnl-validate",
    "verify",
    "version-commit-back",
  ]);

  /** Lanes that exist in source but are deliberately not emitted, and why. */
  const PAUSED: Readonly<Record<string, string>> = {
    "windows-cross-compiler-refresh": "paused by #3211",
    "windows-cross-compiler-pr": "paused by #3211",
    "macos-cross-compiler-pr": "paused by #3211",
    "macos-cross-compiler": "paused by #3211",
    "quotabar-macos-pr":
      "temporarily paused until the Mac agent joins the GUI audit session",
    "quotabar-macos-main":
      "temporarily paused until the Mac agent joins the GUI audit session",
    "hkctl-native-pr":
      "temporarily paused until the Mac agent joins the GUI audit session",
    "hkctl-native-main":
      "temporarily paused until the Mac agent joins the GUI audit session",
    "tasknotes-native-pr":
      "temporarily paused until the Mac agent joins the GUI audit session",
    "tasknotes-native-main":
      "temporarily paused until the Mac agent joins the GUI audit session",
  };

  test("emits exactly the expected lanes", () => {
    const emitted = new Set(allSteps().map((s) => s.key));
    expect([...emitted].toSorted()).toEqual([...EXPECTED_LANES].toSorted());
  });

  test("emits no paused lane", () => {
    const emitted = new Set(allSteps().map((s) => s.key));
    for (const [lane, reason] of Object.entries(PAUSED)) {
      expect(emitted.has(lane), `${lane} is paused: ${reason}`).toBe(false);
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

test("the sites lane deploys active sites when their paths change", () => {
  const sites = step("sites");
  const dryRun = step("pr-dryrun");
  if (sites === undefined || dryRun === undefined) {
    throw new Error("site deploy or dry-run step missing");
  }
  const commands = sites.commands.join("\n");
  for (const [lane, site, workspace] of [
    [
      "site-statically-typed",
      "statically-typed",
      "@shepherdjerred/statically-typed",
    ],
    ["site-ts-mc-docs", "ts-mc-docs", "@shepherdjerred/ts-mc-docs"],
  ] as const) {
    expect(commands).toContain(`ci/scripts/selectors/ci-changed.ts ${lane}`);
    expect(commands).toContain(`--filter '${workspace}'`);
    expect(commands).toContain(
      `bun --no-install scripts/release/deploy-site.ts ${site}`,
    );
    expect(dryRun.commands.join("\n")).toContain(site);
  }
  const loop = /for site in ([^\n]+); do/u.exec(
    dryRun.commands.join("\n"),
  )?.[1];
  expect(loop?.split(" ")).not.toContain("ts-mc");
});

test("Glitter Boys artifacts are excluded from shared CI", async () => {
  const steps = allSteps();
  for (const key of ["sites", "pr-dryrun"]) {
    const commands = steps
      .find((entry) => entry.key === key)
      ?.commands.join("\n");
    expect(commands).toBeDefined();
    expect(commands).not.toContain("glitter-boys");
  }
  for (const pipeline of [steps, credentiallessHostedAutomationSteps(IMAGES)]) {
    const verify = pipeline
      .find((entry) => entry.key === "verify")
      ?.commands.join("\n")
      .replaceAll(String.raw`'\''`, "'");
    expect(verify).toContain("--filter='!@shepherdjerred/glitter-boys'");
    expect(verify).toContain(
      "--filter='!@shepherdjerred/glitter-boys-launcher'",
    );
  }
  // Homelab imports the publication contract through a workspace dependency.
  // Its inherited ^build must not compile the native application in CI.
  const launcher = z
    .object({ scripts: z.record(z.string(), z.string()) })
    .parse(
      await Bun.file(
        new URL("../../glitter-boys-launcher/package.json", import.meta.url),
      ).json(),
    );
  expect(launcher.scripts["build"]).toBeUndefined();
  expect(launcher.scripts["build:local"]).toContain("cargo build");
  expect(launcher.scripts["test:ci"]).toBeUndefined();
});

test("the sites lane selects every declared per-site change filter", async () => {
  const sites = step("sites");
  if (sites === undefined) throw new Error("sites step missing");
  const selectorSource = await Bun.file(
    new URL(
      "../../../ci/scripts/selectors/site-lane-paths.ts",
      import.meta.url,
    ),
  ).text();
  const lanes = [...selectorSource.matchAll(/"(site-[^"]+)": \[/gu)].flatMap(
    (match) => (match[1] === undefined ? [] : [match[1]]),
  );
  expect(lanes.length).toBeGreaterThan(0);
  const commands = sites.commands.join("\n");
  for (const lane of lanes) {
    expect(commands).toContain(`ci/scripts/selectors/ci-changed.ts ${lane}`);
  }
});
