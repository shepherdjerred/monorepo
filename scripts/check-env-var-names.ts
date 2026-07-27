import { run } from "./lib/run.ts";

export const BANNED_ENVIRONMENT_VARIABLES: ReadonlyMap<string, string> =
  new Map([
    ["GRAFANA_SERVER", "GRAFANA_URL"],
    ["GRAFANA_TOKEN", "GRAFANA_API_KEY"],
    ["PAGERDUTY_API_KEY", "PAGERDUTY_TOKEN"],
    ["PAGERDUTY_API_TOKEN", "PAGERDUTY_TOKEN"],
    ["RIOT_API_TOKEN", "RIOT_API_KEY"],
    ["BUGSINK_API_TOKEN", "BUGSINK_TOKEN"],
    ["CF_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID"],
    ["CF_R2_ACCESS", "CLOUDFLARE_R2_ACCESS_KEY_ID"],
    ["CF_R2_SECRET", "CLOUDFLARE_R2_SECRET_ACCESS_KEY"],
    ["TS_AUTH_KEY", "TS_AUTHKEY"],
  ]);

const SEARCH_EXTENSIONS = [
  ".ts",
  ".rs",
  ".py",
  ".fish",
  ".tmpl",
  ".yaml",
  ".yml",
  ".env",
  ".md",
  ".sh",
  ".swift",
];

const EXCLUDED_PATHS = new Set([
  "scripts/check-env-var-names.test.ts",
  "scripts/check-env-var-names.ts",
  "packages/docs/decisions/2026-03-27_env-var-naming-convention.md",
  "packages/docs/guides/2026-04-04_homelab-health-audit-2.md",
]);

const GITHUB_TOKEN_EXCLUSIONS = [
  "TOFU_GITHUB_TOKEN",
  "GLANCE_TEST_",
  "@modelcontextprotocol",
  "server-github expects",
  "mcp-gateway",
  "YOUR_GITHUB_TOKEN",
  "env:GITHUB_TOKEN",
  "CHANGELOG.md",
  "plans/",
  "dot_agents/skills/",
  "GITHUB_TOKEN_URL",
  "buildkite/scripts/toolchain.sh",
];

export type EnvironmentVariableViolation = {
  path: string;
  line: number;
  pattern: string;
  replacement: string;
  text: string;
};

function isSearchablePath(path: string): boolean {
  if (
    path.startsWith("sandbox/archive/") ||
    path.startsWith("sandbox/practice/") ||
    path.startsWith(".build/") ||
    path.includes("/generated/") ||
    path.startsWith("packages/docs/archive/")
  ) {
    return false;
  }
  return (
    SEARCH_EXTENSIONS.some((extension) => path.endsWith(extension)) &&
    !EXCLUDED_PATHS.has(path)
  );
}

export function findEnvironmentVariableViolations(
  path: string,
  source: string,
): EnvironmentVariableViolation[] {
  const violations: EnvironmentVariableViolation[] = [];
  for (const [index, text] of source.split("\n").entries()) {
    const upper = text.toUpperCase();
    for (const [pattern, replacement] of BANNED_ENVIRONMENT_VARIABLES) {
      if (upper.includes(pattern)) {
        violations.push({
          path,
          line: index + 1,
          pattern,
          replacement,
          text,
        });
        break;
      }
    }

    if (
      text.includes("GITHUB_TOKEN") &&
      !GITHUB_TOKEN_EXCLUSIONS.some(
        (exclusion) => path.includes(exclusion) || text.includes(exclusion),
      )
    ) {
      violations.push({
        path,
        line: index + 1,
        pattern: "GITHUB_TOKEN",
        replacement: "GH_TOKEN",
        text,
      });
    }
  }
  return violations;
}

export async function checkEnvironmentVariableNames(): Promise<void> {
  const result = await run(["git", "ls-files", "-z"], {
    capture: true,
    secret: true,
  });
  const trackedPaths = result.stdout
    .split("\0")
    .filter((path) => isSearchablePath(path));
  const pathChecks = await Promise.all(
    trackedPaths.map(async (path) => ({
      exists: await Bun.file(path).exists(),
      path,
    })),
  );
  const existingPaths = pathChecks
    .filter(({ exists }) => exists)
    .map(({ path }) => path);
  const perFileViolations = await Promise.all(
    existingPaths.map(async (path) =>
      findEnvironmentVariableViolations(path, await Bun.file(path).text()),
    ),
  );
  const violations = perFileViolations.flat();

  for (const violation of violations) {
    console.error(
      `FAIL: Found banned pattern '${violation.pattern}' (use '${violation.replacement}' instead):`,
    );
    console.error(
      `  ${violation.path}:${violation.line.toString()}:${violation.text}`,
    );
    console.error("");
  }
  if (violations.length > 0) {
    throw new Error(
      `Found ${violations.length.toString()} banned environment variable pattern(s).`,
    );
  }
}

if (import.meta.main) {
  await checkEnvironmentVariableNames();
}
