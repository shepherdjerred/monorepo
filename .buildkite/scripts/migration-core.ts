import { asRecord } from "../../scripts/lib/json.ts";

const applicationTargets = [
  "birmel",
  "tasknotes-server",
  "starlight-karma-bot",
  "streambot",
  "temporal-worker",
  "trmnl-dashboard",
  "scout-for-lol",
  "discord-plays-pokemon",
  "discord-plays-mario-kart",
] as const;

const infrastructureTargets = [
  "bindery",
  "caddy-s3proxy",
  "obsidian-headless",
  "mcp-gateway",
  "redlib",
  "shelfbridge",
] as const;

export const knownImageTargets = [...applicationTargets, "infra"].sort();

const FIXED_CORPUS_LANES: ReadonlySet<string> = new Set([
  "docker-e2e",
  "images",
  "playwright",
  "resume",
  "tofu",
]);

export class FixedCorpusConfigurationError extends Error {}

export function fixedCorpusMode(
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  const value = environment["CI_IO_FIXED_CORPUS"];
  if (value === undefined) {
    return false;
  }
  if (value !== "true") {
    throw new FixedCorpusConfigurationError(
      'CI_IO_FIXED_CORPUS must be exactly "true" when set',
    );
  }
  const branch = environment["BUILDKITE_BRANCH"];
  if (branch !== "main") {
    throw new FixedCorpusConfigurationError(
      `CI_IO_FIXED_CORPUS is main-only; BUILDKITE_BRANCH was ${branch ?? "unset"}`,
    );
  }
  return true;
}

export function fixedCorpusForcesLane(
  lane: string,
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  return fixedCorpusMode(environment) && FIXED_CORPUS_LANES.has(lane);
}

export function fixedCorpusLaneMetadata(
  lane: string,
): Readonly<Record<string, string>> {
  return {
    [`ci-lane-run-${lane}`]: "true",
    [`ci-lane-decision-${lane}`]: "ran — fixed CI I/O corpus requested",
  };
}

export function parseBakeArguments(rawArguments: readonly string[]): {
  readonly affected: boolean;
  readonly push: boolean;
} {
  const flags = new Set(rawArguments);
  for (const argument of flags) {
    if (argument !== "--affected" && argument !== "--push") {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { affected: flags.has("--affected"), push: flags.has("--push") };
}

export function expandTargets(selected: readonly string[]): string[] {
  const targets = [...selected].filter((target) => target !== "infra");
  if (selected.includes("infra")) targets.push(...infrastructureTargets);
  return targets;
}

export function findManagedImagePin(
  versions: string,
  imageName: string,
): { readonly key: string; readonly digest: string } | undefined {
  const lines = versions.split("\n");
  for (const key of [
    `shepherdjerred/${imageName}`,
    `shepherdjerred/${imageName}/beta`,
  ]) {
    const lineIndex = lines.findIndex((line) => line.includes(`"${key}"`));
    if (lineIndex === -1) continue;
    const candidate = lines.slice(lineIndex, lineIndex + 2).join("\n");
    const match = /sha256:[a-f\d]{64}/.exec(candidate);
    if (match !== null) return { key, digest: match[0] };
  }
  return undefined;
}

export function parseStringArray(
  value: unknown,
  description: string,
): string[] {
  if (!Array.isArray(value))
    throw new TypeError(`${description} must be an array`);
  const strings: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new TypeError(`${description} must only contain strings`);
    }
    strings.push(item);
  }
  return strings;
}

export function parseImageSelection(output: string): {
  readonly targets: string[];
  readonly fallbackReason: string;
} {
  try {
    const parsed = parseStringArray(
      JSON.parse(output.trim()),
      "image selection",
    );
    if (!parsed.every((target) => knownImageTargets.includes(target))) {
      return {
        targets: knownImageTargets,
        fallbackReason: "image selector returned invalid targets",
      };
    }
    return { targets: parsed, fallbackReason: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      targets: knownImageTargets,
      fallbackReason: `image selector returned malformed output: ${message}`,
    };
  }
}

export function parseBuildkiteCommits(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Buildkite response must be an array");
  }
  const commits: string[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const commit = record?.["commit"];
    if (typeof commit !== "string" || commit.length === 0) {
      throw new TypeError("Buildkite build must contain a commit");
    }
    commits.push(commit);
  }
  return commits;
}

export const summarySteps = [
  "verify",
  "playwright-e2e-main",
  "resume-build-main",
  "docker-e2e-main",
  "images",
  "sites",
  "helm-push",
  "tofu-apply",
  "tofu-github",
  "argocd-sync",
  "scout-beta-release",
  "publish",
  "scout-tag-release",
  "scout-prod-reconcile",
  "tofu-cloudflare",
  "release-please",
  "version-commit-back",
  "ci-base-refresh",
  "ci-playwright-refresh",
] as const;

export const summaryLanes = [
  "playwright",
  "resume",
  "docker-e2e",
  "images",
  "sites",
  "site-sjer-red",
  "site-resume",
  "site-webring",
  "site-cooklang",
  "site-stocks",
  "site-wiki",
  "site-better-skill-capped",
  "site-glitter",
  "site-scout",
  "helm",
  "tofu",
  "argocd",
  "helm-types",
  "npm",
  "cooklang",
  "scout-reconcile",
  "ci-base",
  "ci-playwright",
] as const;

export function outcomeIcon(outcome: string): string {
  return outcome === "passed" ? ":white_check_mark:" : ":x:";
}

export const globalPaths = [
  ".buildkite/pipeline.yml",
  ".buildkite/scripts/ci-changed.ts",
  ".buildkite/scripts/migration-core.ts",
  ".buildkite/scripts/prepare-ci-changed-base.ts",
  ".buildkite/scripts/upload-pipeline.sh",
] as const;

const workspacePaths = [
  "bun.lock",
  "bunfig.toml",
  "package.json",
  "patches",
  "turbo.json",
] as const;

const deployScripts = [
  "scripts/deploy-site.ts",
  "scripts/lib/s3-static-site.ts",
  "scripts/lib/run.ts",
] as const;

const sitePaths = {
  "site-sjer-red": [
    ...workspacePaths,
    "packages/sjer.red",
    "packages/astro-opengraph-images",
    "packages/webring",
    ...deployScripts,
  ],
  "site-resume": ["packages/resume", ...deployScripts],
  "site-webring": [...workspacePaths, "packages/webring", ...deployScripts],
  "site-cooklang": [
    ...workspacePaths,
    "packages/cooklang-rich-preview",
    ...deployScripts,
  ],
  "site-stocks": [
    ...workspacePaths,
    "packages/stocks-sjer-red",
    ...deployScripts,
  ],
  "site-wiki": [...workspacePaths, "packages/docs", ...deployScripts],
  "site-better-skill-capped": [
    ...workspacePaths,
    "packages/better-skill-capped",
    ...deployScripts,
  ],
  "site-glitter": [
    ...workspacePaths,
    "packages/glitter",
    "packages/glitter-context",
    ...deployScripts,
  ],
  "site-scout": [
    ...workspacePaths,
    "packages/scout-for-lol",
    "packages/astro-opengraph-images",
    "packages/llm-models",
    "packages/glitter-context",
    "scripts/package.json",
    "scripts/scout-site-release.ts",
    "scripts/lib/pin-candidates.ts",
    "scripts/lib/run.ts",
    "scripts/lib/s3-static-site.ts",
    "scripts/lib/scout-release-state.ts",
    "scripts/lib/scout-site-storage.ts",
    "docker-bake.hcl",
    ".dockerignore",
  ],
} as const;

export const lanePaths: Readonly<Record<string, readonly string[]>> = {
  playwright: [
    ...workspacePaths,
    "packages/sjer.red",
    "packages/astro-opengraph-images",
    "packages/webring",
    "packages/eslint-config",
    "packages/docs",
    "packages/scout-for-lol/eslint.config.ts",
    "packages/scout-for-lol/tsconfig.base.json",
    "packages/scout-for-lol/packages/data",
    "packages/scout-for-lol/packages/evals",
    ...deployScripts,
  ],
  resume: ["packages/resume", ...deployScripts],
  "docker-e2e": [
    ...workspacePaths,
    "packages/llm-observability",
    "packages/eslint-config",
  ],
  "helm-types": [
    ...workspacePaths,
    "packages/homelab/src/cdk8s/src/versions.ts",
    "packages/homelab/src/cdk8s/scripts/generate-helm-types.ts",
    "packages/homelab/src/cdk8s/scripts/parse-helm-charts.ts",
    "packages/homelab/src/helm-types",
    "packages/homelab/src/cdk8s/generated/helm",
  ],
  tofu: [
    ...workspacePaths,
    "packages/homelab/src/tofu",
    "packages/homelab/scripts/tofu-stack.ts",
    "scripts/lib/run.ts",
    "scripts/lib/transient.ts",
  ],
  helm: [
    ...workspacePaths,
    "packages/homelab/src/cdk8s",
    "packages/homelab/scripts/helm-release-core.ts",
    "packages/homelab/scripts/helm-push.ts",
    "scripts/lib/run.ts",
  ],
  argocd: [
    ...workspacePaths,
    "packages/homelab/src/cdk8s",
    "packages/homelab/scripts/argocd.ts",
    "scripts/lib/run.ts",
    "scripts/lib/transient.ts",
  ],
  npm: [
    ...workspacePaths,
    "packages/astro-opengraph-images",
    "packages/webring",
    "packages/homelab/src/helm-types",
    "scripts/publish-npm.ts",
    "scripts/lib",
  ],
  ...sitePaths,
  sites: Object.entries(sitePaths)
    .filter(([lane]) => lane !== "site-scout")
    .flatMap(([, paths]) => paths),
  "scout-reconcile": [
    ...workspacePaths,
    "packages/scout-for-lol",
    "packages/astro-opengraph-images",
    "packages/llm-models",
    "packages/homelab/src/cdk8s/src/versions.ts",
    "scripts/package.json",
    "scripts/scout-site-release.ts",
    "scripts/lib",
  ],
  cooklang: [...workspacePaths, "packages/cooklang-for-obsidian"],
  "ci-base": [
    ".buildkite/ci-image/Dockerfile",
    ".buildkite/scripts/application-image-runtime.ts",
    ".buildkite/scripts/bake-retry.ts",
    ".buildkite/scripts/build-ci-image-core.ts",
    ".buildkite/scripts/build-ci-image.ts",
    ".buildkite/scripts/buildkit-env.ts",
    ".buildkite/scripts/update-ci-image-pin-core.ts",
    ".buildkite/scripts/update-ci-image-pin-github.ts",
    ".buildkite/scripts/update-ci-image-pin.ts",
    "scripts/lib/transient-error.ts",
    ".mise.toml",
  ],
  "ci-playwright": [
    ".buildkite/ci-playwright/Dockerfile",
    ".buildkite/scripts/application-image-runtime.ts",
    ".buildkite/scripts/bake-retry.ts",
    ".buildkite/scripts/build-ci-image-core.ts",
    ".buildkite/scripts/build-ci-image.ts",
    ".buildkite/scripts/buildkit-env.ts",
    ".buildkite/scripts/update-ci-image-pin-core.ts",
    ".buildkite/scripts/update-ci-image-pin-github.ts",
    ".buildkite/scripts/update-ci-image-pin.ts",
    "scripts/lib/transient-error.ts",
  ],
};

const lanesWithoutGlobalPaths = new Set(["site-scout"]);

export function selectorPathsForLane(
  lane: string,
): readonly string[] | undefined {
  const paths = lanePaths[lane];
  if (paths === undefined) {
    return undefined;
  }
  return lanesWithoutGlobalPaths.has(lane) ? paths : [...globalPaths, ...paths];
}

export function caddyfileEntitlementArguments(
  targets: readonly string[],
  caddyfile?: string,
): string[] {
  if (!targets.includes("caddy-s3proxy")) return [];
  if (caddyfile === undefined) {
    throw new Error("CADDYFILE_SMOKE_PATH is required for caddy-s3proxy");
  }
  return ["--allow", `fs.read=${caddyfile}`];
}

export function selectBase(response: unknown): string {
  if (!Array.isArray(response)) {
    throw new TypeError("Buildkite response must be an array");
  }
  for (const value of response) {
    const build = asRecord(value);
    const commit = build?.["commit"];
    if (typeof commit === "string" && commit.length > 0) {
      return commit;
    }
  }
  throw new Error("Buildkite response contains no valid green commit");
}

export function laneMetadata(
  lane: string,
  changed: boolean,
  base: string,
): Readonly<Record<string, string>> {
  return {
    [`ci-lane-run-${lane}`]: changed ? "true" : "false",
    [`ci-lane-decision-${lane}`]: changed
      ? `ran — matching changes since ${base}`
      : `skipped — unchanged since ${base}`,
  };
}
