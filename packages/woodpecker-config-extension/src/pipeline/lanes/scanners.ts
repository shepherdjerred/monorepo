import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { SCANNER_TIER } from "#src/pipeline/tiers.ts";
import { GLOBAL_SELECTOR_INPUTS } from "#src/pipeline/inputs.ts";

/**
 * Optional security scanners.
 *
 * Both lanes are advisory: FINDINGS must not block a merge, but a scanner that
 * fails to RUN must. Buildkite expressed that with `soft_fail` on one exact
 * exit status (7 for Trivy, 1 for Semgrep), so a crash still failed the build.
 *
 * Woodpecker's `failure: ignore` is all-or-nothing and would swallow crashes
 * too, so the distinction moves into the command: findings exit 0 with a clear
 * log line, anything else propagates. That keeps the intent next to the logic
 * rather than in configuration a reader has to cross-reference.
 */

const DEPENDENCY_MANIFESTS = [
  "bun.lock",
  "**/bun.lock",
  "bunfig.toml",
  ".trivyignore",
  "package.json",
  "packages/**/package.json",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
  "**/go.mod",
  "**/go.sum",
  "**/Cargo.lock",
  "**/Cargo.toml",
  "**/Podfile.lock",
  "**/Package.resolved",
  "**/requirements*.txt",
  "**/Pipfile",
  "**/Pipfile.lock",
  "**/poetry.lock",
  "**/uv.lock",
  "**/pom.xml",
  "**/build.gradle",
  "**/build.gradle.kts",
  "**/*.csproj",
  "Dockerfile",
  "**/Dockerfile",
  "**/Dockerfile.*",
  "patches/**",
  "turbo.json",
] as const;

/** Extensions Semgrep has rules for; anything else cannot produce a finding. */
const SEMGREP_SOURCE_GLOBS = [
  "**/*.astro",
  "**/*.c",
  "**/*.cjs",
  "**/*.cs",
  "**/*.cpp",
  "**/*.css",
  "**/*.dart",
  "**/*.ex",
  "**/*.exs",
  "**/*.h",
  "**/*.hcl",
  "**/*.hpp",
  "**/*.hs",
  "**/*.html",
  "**/*.go",
  "**/*.java",
  "**/*.js",
  "**/*.json",
  "**/*.jsx",
  "**/*.kt",
  "**/*.kts",
  "**/*.lua",
  "**/*.mjs",
  "**/*.php",
  "**/*.py",
  "**/*.proto",
  "**/*.rb",
  "**/*.rs",
  "**/*.scss",
  "**/*.scala",
  "**/*.sh",
  "**/*.sql",
  "**/*.swift",
  "**/*.tf",
  "**/*.ts",
  "**/*.cts",
  "**/*.mts",
  "**/*.tsx",
  "**/*.vue",
  "**/*.yaml",
  "**/*.yml",
] as const;

/**
 * Trivy's vulnerability database, supplied by a shared claim.
 *
 * The scan runs with --skip-db-update so a pull-request lane never waits on a
 * database download, which means the database has to come from somewhere.
 */
const TRIVY_DB = {
  claim: "woodpecker-trivy-db",
  path: "/woodpecker/trivy-db",
} as const;

const TRIVY_FINDINGS_EXIT = 7;
const SEMGREP_FINDINGS_EXIT = 1;

function trivyCommands(): string[] {
  return [
    'echo "OPTIONAL SECURITY SCAN: HIGH/CRITICAL findings do not block merge; scanner failures do."',
    "set +e",
    `trivy fs --cache-backend memory --cache-dir ${TRIVY_DB.path} --skip-db-update --scanners vuln --severity HIGH,CRITICAL --exit-code ${TRIVY_FINDINGS_EXIT.toString()} --skip-dirs node_modules --skip-dirs sandbox .`,
    "trivy_status=$?",
    "set -e",
    `if [ "$trivy_status" -eq ${TRIVY_FINDINGS_EXIT.toString()} ]; then`,
    '  echo "Trivy reported findings only; not failing this advisory lane."',
    "  exit 0",
    "fi",
    'exit "$trivy_status"',
  ];
}

function semgrepCommands(): string[] {
  return [
    'echo "OPTIONAL SECURITY SCAN: findings do not block merge; merge-base, config, and runtime failures do."',
    "set +e",
    "base=$(git merge-base origin/main HEAD)",
    "merge_base_status=$?",
    "set -e",
    'if [ "$merge_base_status" -ne 0 ]; then',
    '  echo "semgrep could not resolve the PR merge-base" >&2',
    "  exit 2",
    "fi",
    "set +e",
    'semgrep scan --config .semgrep/p-default.yml --metrics=off --error --baseline-commit "$base" --exclude sandbox --exclude packages/temporal/src/activities/fetcher.ts .',
    "semgrep_status=$?",
    "set -e",
    `if [ "$semgrep_status" -eq ${SEMGREP_FINDINGS_EXIT.toString()} ]; then`,
    '  echo "Semgrep reported findings only; not failing this advisory lane."',
    "  exit 0",
    "fi",
    'exit "$semgrep_status"',
  ];
}

export function scannerSteps(images: CiImages): CiStep[] {
  return [
    {
      key: "trivy",
      label: "trivy",
      image: images.catalog["aquasec/trivy"],
      commands: trivyCommands(),
      timeoutMinutes: 20,
      resources: SCANNER_TIER,
      events: ["pull_request"],
      volumes: [TRIVY_DB],
      changed: {
        include: [...GLOBAL_SELECTOR_INPUTS, ...DEPENDENCY_MANIFESTS],
        exclude: ["sandbox/**"],
      },
    },
    {
      key: "semgrep",
      label: "semgrep",
      image: images.catalog["semgrep/semgrep"],
      commands: semgrepCommands(),
      timeoutMinutes: 20,
      resources: SCANNER_TIER,
      events: ["pull_request"],
      changed: {
        include: [
          ...GLOBAL_SELECTOR_INPUTS,
          "patches/**",
          "turbo.json",
          "Dockerfile",
          "**/Dockerfile",
          "**/Dockerfile.*",
          ...SEMGREP_SOURCE_GLOBS,
        ],
      },
    },
  ];
}
