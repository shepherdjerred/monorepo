import { access } from "node:fs/promises";

export type HomelabAuditPreflightResult = {
  markdown: string;
  warnings: readonly string[];
};

export type HomelabAuditPreflightClassificationInput = {
  missingBinaries: readonly string[];
  missingEnvGroups: readonly string[];
  remoteWarnings: readonly string[];
};

export type HomelabAuditPreflightClassification = {
  fatalMessages: readonly string[];
  markdown: string;
};

type CommandCheck = {
  name: string;
  args: readonly string[];
  timeoutMs?: number | undefined;
};

type CommandCheckResult = {
  ok: boolean;
  output: string;
};

type RequiredEnvGroup = {
  label: string;
  names: readonly string[];
};

const REQUIRED_AUDIT_BINARIES = [
  "claude",
  "kubectl",
  "talosctl",
  "argocd",
  "velero",
  "tofu",
  "gh",
  "toolkit",
  "temporal",
  "bk",
] as const;

const REQUIRED_ENV_GROUPS: readonly RequiredEnvGroup[] = [
  { label: "CLAUDE_CODE_OAUTH_TOKEN", names: ["CLAUDE_CODE_OAUTH_TOKEN"] },
  { label: "PAGERDUTY_TOKEN", names: ["PAGERDUTY_TOKEN"] },
  { label: "BUGSINK_URL", names: ["BUGSINK_URL"] },
  { label: "BUGSINK_TOKEN", names: ["BUGSINK_TOKEN"] },
  { label: "GRAFANA_URL", names: ["GRAFANA_URL"] },
  { label: "GRAFANA_API_KEY", names: ["GRAFANA_API_KEY"] },
  { label: "ARGOCD_SERVER", names: ["ARGOCD_SERVER"] },
  { label: "ARGOCD_AUTH_TOKEN", names: ["ARGOCD_AUTH_TOKEN"] },
  { label: "CLOUDFLARE_API_TOKEN", names: ["CLOUDFLARE_API_TOKEN"] },
  { label: "BUILDKITE_API_TOKEN", names: ["BUILDKITE_API_TOKEN"] },
  { label: "TEMPORAL_ADDRESS", names: ["TEMPORAL_ADDRESS"] },
  {
    label: "GitHub token",
    names: ["GH_TOKEN", "GITHUB_PERSONAL_ACCESS_TOKEN"],
  },
  {
    label: "HOMELAB_AUDIT_ARCHIVE_BUCKET",
    names: ["HOMELAB_AUDIT_ARCHIVE_BUCKET"],
  },
  { label: "S3_ENDPOINT", names: ["S3_ENDPOINT"] },
  { label: "AWS_ACCESS_KEY_ID", names: ["AWS_ACCESS_KEY_ID"] },
  { label: "AWS_SECRET_ACCESS_KEY", names: ["AWS_SECRET_ACCESS_KEY"] },
];

const CLOUDFLARE_TOFU_DIR = "packages/homelab/src/cdk8s/src/tofu/cloudflare";

function hasEnv(names: readonly string[]): boolean {
  return names.some((name) => {
    const value = Bun.env[name];
    return value !== undefined && value !== "";
  });
}

function truncateToolOutput(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 500) {
    return trimmed;
  }
  return `${trimmed.slice(0, 500)}...`;
}

async function runCommandCheck(
  check: CommandCheck,
): Promise<CommandCheckResult> {
  const proc = Bun.spawn([...check.args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...Bun.env,
      BUILDKITE_ORGANIZATION_SLUG:
        Bun.env["BUILDKITE_ORGANIZATION_SLUG"] ?? "sjerred",
      BUILDKITE_PIPELINE_SLUG: Bun.env["BUILDKITE_PIPELINE_SLUG"] ?? "monorepo",
    },
  });

  const timeout = setTimeout(() => {
    proc.kill();
  }, check.timeoutMs ?? 15_000);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const output = truncateToolOutput(`${stdout}\n${stderr}`);
    return {
      ok: exitCode === 0,
      output:
        output.length > 0
          ? `exit ${String(exitCode)}: ${output}`
          : `exit ${String(exitCode)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function classifyHomelabAuditPreflight(
  input: HomelabAuditPreflightClassificationInput,
): HomelabAuditPreflightClassification {
  const fatalMessages: string[] = [];
  if (input.missingBinaries.length > 0) {
    fatalMessages.push(
      `Missing required audit binaries: ${input.missingBinaries.join(", ")}`,
    );
  }
  if (input.missingEnvGroups.length > 0) {
    fatalMessages.push(
      `Missing required audit environment: ${input.missingEnvGroups.join(", ")}`,
    );
  }

  const markdown: string[] = [
    "Audit tooling preflight:",
    "",
    "- Required binaries: passed.",
    "- Required environment: passed.",
  ];

  if (input.remoteWarnings.length === 0) {
    markdown.push("- Remote checks: passed.");
  } else {
    markdown.push(
      "- Remote checks: warnings to mention in the audit if relevant:",
    );
    for (const warning of input.remoteWarnings) {
      markdown.push(`  - ${warning}`);
    }
  }

  return { fatalMessages, markdown: markdown.join("\n") };
}

function collectMissingBinaries(): string[] {
  const missing: string[] = [];
  for (const binary of REQUIRED_AUDIT_BINARIES) {
    if (Bun.which(binary) === null) {
      missing.push(binary);
    }
  }
  return missing;
}

function collectMissingEnvGroups(): string[] {
  return REQUIRED_ENV_GROUPS.filter((group) => !hasEnv(group.names)).map(
    (group) => group.label,
  );
}

async function collectRemoteWarnings(): Promise<string[]> {
  const warnings: string[] = [];

  try {
    await access(CLOUDFLARE_TOFU_DIR);
  } catch {
    warnings.push(
      `Cloudflare tofu module path is missing: ${CLOUDFLARE_TOFU_DIR}`,
    );
  }

  const checks: readonly CommandCheck[] = [
    {
      name: "Buildkite",
      args: [
        "bk",
        "build",
        "list",
        "--pipeline",
        Bun.env["BUILDKITE_PIPELINE_SLUG"] ?? "monorepo",
        "--branch",
        "main",
        "--limit",
        "1",
      ],
    },
    { name: "Temporal", args: ["temporal", "operator", "cluster", "health"] },
    { name: "Bugsink", args: ["toolkit", "bugsink", "projects", "--json"] },
    {
      name: "Prometheus alerts",
      args: ["toolkit", "gf", "query", 'ALERTS{alertstate="firing"}'],
    },
    { name: "ArgoCD", args: ["argocd", "app", "list", "--grpc-web"] },
    { name: "Velero", args: ["velero", "backup", "get"] },
    {
      name: "Cloudflare tofu",
      args: [
        "tofu",
        "-chdir=packages/homelab/src/cdk8s/src/tofu/cloudflare",
        "version",
      ],
    },
  ];

  for (const check of checks) {
    const result = await runCommandCheck(check);
    if (!result.ok) {
      warnings.push(`${check.name}: ${result.output}`);
    }
  }

  return warnings;
}

export async function runAuditPreflight(): Promise<HomelabAuditPreflightResult> {
  const [missingBinaries, remoteWarnings] = await Promise.all([
    Promise.resolve(collectMissingBinaries()),
    collectRemoteWarnings(),
  ]);
  const missingEnvGroups = collectMissingEnvGroups();
  const classification = classifyHomelabAuditPreflight({
    missingBinaries,
    missingEnvGroups,
    remoteWarnings,
  });

  if (classification.fatalMessages.length > 0) {
    throw new Error(classification.fatalMessages.join("; "));
  }

  return { markdown: classification.markdown, warnings: remoteWarnings };
}
