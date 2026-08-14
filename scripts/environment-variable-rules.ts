const BANNED_ENVIRONMENT_VARIABLES: ReadonlyMap<string, string> = new Map([
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

// A third-party CLI's own input interface is not this repo naming a credential.
// The canonicalization above governs variables we choose; it cannot govern the
// names a vendor binary reads. gcx accepts its credential either as a `--token`
// argv value or as its native GRAFANA_TOKEN/GRAFANA_SERVER runtime overrides
// (its documented CI/CD path), and the env form is the only one that keeps the
// credential out of the process argv, where any process that can read
// /proc/<pid>/cmdline would see it. Same category as GITHUB_TOKEN_EXCLUSIONS
// below, which already exempts tools that demand that spelling.
const VENDOR_INTERFACE_EXCLUSIONS = [
  "packages/temporal/src/activities/gcx-context",
];

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

export function findEnvironmentVariableViolations(
  path: string,
  source: string,
): EnvironmentVariableViolation[] {
  const violations: EnvironmentVariableViolation[] = [];
  const vendorInterface = VENDOR_INTERFACE_EXCLUSIONS.some((exclusion) =>
    path.includes(exclusion),
  );
  for (const [index, text] of source.split("\n").entries()) {
    const upper = text.toUpperCase();
    for (const [pattern, replacement] of BANNED_ENVIRONMENT_VARIABLES) {
      if (!vendorInterface && upper.includes(pattern)) {
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
