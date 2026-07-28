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

export function caddyfileBakeArguments(
  selected: readonly string[],
  caddyfilePath?: string,
): string[] {
  if (!selected.includes("infra")) return [];
  if (caddyfilePath === undefined || caddyfilePath.length === 0) {
    throw new Error("CADDYFILE_SMOKE_PATH is required for infra builds");
  }
  return ["--allow", `fs.read=${caddyfilePath}`];
}

export function productionBakeCommand(
  targets: readonly string[],
  selected: readonly string[],
  caddyfilePath?: string,
): string[] {
  return [
    "docker",
    "buildx",
    "bake",
    "--builder",
    "ci",
    ...caddyfileBakeArguments(selected, caddyfilePath),
    "--push",
    ...targets,
  ];
}

export function findPinnedDigest(
  versions: string,
  imageName: string,
): string | undefined {
  const lines = versions.split("\n");
  for (const key of [
    `shepherdjerred/${imageName}`,
    `shepherdjerred/${imageName}/beta`,
  ]) {
    const lineIndex = lines.findIndex((line) => line.includes(`"${key}"`));
    if (lineIndex === -1) continue;
    const candidate = lines.slice(lineIndex, lineIndex + 2).join("\n");
    const match = /sha256:[a-f\d]{64}/.exec(candidate);
    if (match !== null) return match[0];
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
  "argocd-sync",
  "publish",
  "scout-prod-reconcile",
  "ci-image-refresh",
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
  "ci-image",
] as const;

export function outcomeIcon(outcome: string): string {
  return outcome === "passed" ? ":white_check_mark:" : ":x:";
}

export function ciImageTags(image: string, commit: string): readonly string[] {
  return ["--tag", `${image}:${commit}`, "--tag", `${image}:latest`];
}

export const builderCreateCommand = [
  "docker",
  "buildx",
  "create",
  "--name",
  "ci",
  "--driver",
  "remote",
  "tcp://buildkitd-buildkitd-service.buildkitd.svc.cluster.local:1234",
] as const;

export function ciImageBuildCommand(
  image: string,
  dockerfile: string,
  commit: string,
): readonly string[] {
  return [
    "docker",
    "buildx",
    "build",
    "--builder",
    "ci",
    "--file",
    dockerfile,
    "--cache-from",
    `type=registry,ref=${image}:buildcache`,
    "--cache-to",
    `type=registry,ref=${image}:buildcache,mode=max,image-manifest=true`,
    ...ciImageTags(image, commit),
    "--push",
    ".",
  ];
}

export function registryLoginCommand(token?: string): string[] | undefined {
  return token === undefined || token.length === 0
    ? undefined
    : [
        "docker",
        "login",
        "ghcr.io",
        "-u",
        "shepherdjerred",
        "--password-stdin",
      ];
}

export const globalPaths = [
  ".buildkite",
  ".mise.toml",
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
    "packages/sjer.red",
    "packages/astro-opengraph-images",
    "packages/webring",
    ...deployScripts,
  ],
  "site-resume": ["packages/resume", ...deployScripts],
  "site-webring": ["packages/webring", ...deployScripts],
  "site-cooklang": ["packages/cooklang-rich-preview", ...deployScripts],
  "site-stocks": ["packages/stocks-sjer-red", ...deployScripts],
  "site-better-skill-capped": [
    "packages/better-skill-capped",
    ...deployScripts,
  ],
  "site-glitter": [
    "packages/glitter",
    "packages/glitter-context",
    ...deployScripts,
  ],
  "site-scout": [
    "packages/scout-for-lol",
    "packages/astro-opengraph-images",
    "packages/llm-models",
    "packages/glitter-context",
    "packages/homelab/src/cdk8s/src/versions.ts",
    "scripts/package.json",
    "scripts/scout-site-release.ts",
    "scripts/lib",
    "docker-bake.hcl",
    ".dockerignore",
  ],
} as const;

export const lanePaths: Readonly<Record<string, readonly string[]>> = {
  playwright: [
    "packages/sjer.red",
    "packages/astro-opengraph-images",
    "packages/webring",
    "packages/eslint-config",
    ...deployScripts,
  ],
  resume: ["packages/resume", ...deployScripts],
  "docker-e2e": ["packages/llm-observability", "packages/eslint-config"],
  "helm-types": [
    "packages/homelab/src/cdk8s/src/versions.ts",
    "packages/homelab/src/cdk8s/scripts/generate-helm-types.ts",
    "packages/homelab/src/cdk8s/scripts/parse-helm-charts.ts",
    "packages/homelab/src/helm-types",
    "packages/homelab/src/cdk8s/generated/helm",
  ],
  tofu: [
    "packages/homelab/src/tofu",
    "packages/homelab/scripts/tofu-stack.ts",
    "scripts/lib/run.ts",
    "scripts/lib/transient.ts",
  ],
  helm: [
    "packages/homelab/src/cdk8s",
    "packages/homelab/scripts/helm-push.ts",
    "scripts/lib/run.ts",
  ],
  argocd: [
    "packages/homelab/src/cdk8s",
    "packages/homelab/scripts/argocd.ts",
    "scripts/lib/run.ts",
    "scripts/lib/transient.ts",
  ],
  npm: [
    "packages/astro-opengraph-images",
    "packages/webring",
    "packages/homelab/src/helm-types",
    "scripts/publish-npm.ts",
    "scripts/lib",
  ],
  ...sitePaths,
  sites: Object.values(sitePaths).flat(),
  "scout-reconcile": [
    "packages/scout-for-lol",
    "packages/astro-opengraph-images",
    "packages/llm-models",
    "packages/homelab/src/cdk8s/src/versions.ts",
    "scripts/package.json",
    "scripts/scout-site-release.ts",
    "scripts/lib",
  ],
  cooklang: ["packages/cooklang-for-obsidian"],
  "ci-image": [
    ".buildkite/ci-image",
    ".buildkite/ci-playwright",
    ".buildkite/scripts/build-ci-image.ts",
    ".mise.toml",
  ],
};

export function selectBase(response: unknown, head: string): string {
  if (!Array.isArray(response)) {
    throw new TypeError("Buildkite response must be an array");
  }
  for (const value of response) {
    const build = asRecord(value);
    const commit = build?.["commit"];
    if (typeof commit === "string" && commit.length > 0 && commit !== head) {
      return commit;
    }
  }
  throw new Error("Buildkite response contains no earlier green commit");
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
