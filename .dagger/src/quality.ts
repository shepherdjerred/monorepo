/**
 * Quality-gate helpers — Dagger replacements for the 18 plain Buildkite steps.
 *
 * Each helper takes a `source: Directory` of the monorepo and returns a
 * `Container` whose `.stdout()` materializes the check output. The
 * corresponding `@func()` wrappers live in `index.ts` and call `.stdout()`
 * to return `Promise<string>`.
 *
 * The Dagger CLI accepts the `source` arg as a git URL ref (`URL#sha:`),
 * which means the Buildkite pod uploads no source — the engine fetches once
 * per SHA and serves it from cache to every concurrent caller.
 *
 * Plain functions, not decorated. Keep `index.ts` thin (TypeScript SDK
 * constraint: the `@object()` class must live in one file).
 */
import { dag, Container, Directory } from "@dagger.io/dagger";

import {
  BUN_IMAGE,
  GITLEAKS_IMAGE,
  TRIVY_IMAGE,
  SEMGREP_IMAGE,
  SHELLCHECK_IMAGE,
  BUN_CACHE,
  SOURCE_EXCLUDES,
} from "./constants";

/**
 * Common Bun-flavored base for quality checks.
 *
 * The upstream `oven/bun:*-debian` image already ships `bash`, `find`,
 * `grep`, and `ca-certificates`, which covers every plain-shell check
 * here. We deliberately do NOT run `apt-get update` / `apt-get install`
 * in the shared base — that path is fragile against upstream Debian
 * index rollovers, and `git` is only needed by `lineEndingsCheckHelper`
 * (which installs it itself).
 *
 * We also do NOT run `bun install --frozen-lockfile` here — most checks
 * don't need `node_modules` at all; the few that do (Knip, Prettier,
 * Markdownlint, Lockfile, iOS native deps) call it themselves.
 */
function bunQualityBase(source: Directory): Container {
  return dag
    .container()
    .from(BUN_IMAGE)
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
    .withWorkdir("/repo")
    .withDirectory("/repo", source, { exclude: SOURCE_EXCLUDES });
}

/**
 * Run prettier formatting check across the repo.
 * Replaces `.buildkite/scripts/prettier.sh` (plain step).
 */
export function prettierHelper(source: Directory): Container {
  return bunQualityBase(source)
    .withExec(["bun", "install", "--frozen-lockfile"])
    .withExec(["bunx", "prettier", "--check", "."]);
}

/**
 * Run markdownlint via root `bun run markdownlint`.
 * Replaces the Markdownlint plain step.
 */
export function markdownlintHelper(source: Directory): Container {
  return bunQualityBase(source)
    .withExec(["bun", "install", "--frozen-lockfile"])
    .withExec(["bun", "run", "markdownlint"]);
}

/**
 * Run shellcheck against every `*.sh` in the repo (excluding archive,
 * node_modules, Pods, target). Uses the upstream koalaman/shellcheck-alpine
 * image (alpine + shellcheck binary), which ships find + xargs out of the
 * box. Replaces the previous `install_shellcheck` curl-tar dance in
 * `setup-tools.sh`.
 */
export function shellcheckHelper(source: Directory): Container {
  return dag
    .container()
    .from(SHELLCHECK_IMAGE)
    .withWorkdir("/repo")
    .withDirectory("/repo", source, { exclude: SOURCE_EXCLUDES })
    .withExec([
      "sh",
      "-c",
      [
        'find . -name "*.sh"',
        '-not -path "*/archive/*"',
        '-not -path "*/wasm-src/*"',
        '-not -path "*/node_modules/*"',
        '-not -path "*/Pods/*"',
        '-not -path "*/target/*"',
        "-print0 | xargs -0 shellcheck --severity=warning",
      ].join(" "),
    ]);
}

/**
 * Run the quality-ratchet script which counts suppression markers per
 * file and enforces they don't increase over `.quality-baseline.json`.
 */
export function qualityRatchetHelper(source: Directory): Container {
  return bunQualityBase(source).withExec(["bun", "scripts/quality-ratchet.ts"]);
}

/**
 * Enforce the source-marker → docs invariant for TODO/FIXME/XXX markers
 * (`scripts/check-todos.ts`). This runs in the lefthook pre-commit hook; the
 * Dagger wrapper adds the matching CI gate so a `--no-verify` commit can't
 * bypass it.
 *
 * `check-todos.ts` uses `rg` (ripgrep) to scan source markers; the oven/bun
 * base image does not ship it, so we install it here. Bun's `$` shell returns
 * exit code 1 for both "command not found" and "no matches found", which means
 * a missing `rg` would silently produce an empty marker list and trigger false
 * stale-source-marker-claim errors for every doc with `source_marker: true`.
 */
export function checkTodosHelper(source: Directory): Container {
  return bunQualityBase(source)
    .withExec(["apt-get", "update", "-qq"])
    .withExec([
      "apt-get",
      "install",
      "-y",
      "-qq",
      "--no-install-recommends",
      "ripgrep",
    ])
    .withExec(["bun", "scripts/check-todos.ts"]);
}

/**
 * Validate every package has the required scripts in its package.json.
 */
export function complianceCheckHelper(source: Directory): Container {
  return bunQualityBase(source).withExec([
    "bash",
    "scripts/compliance-check.sh",
  ]);
}

/**
 * Run knip across all packages. Replicates `knip-check.sh`: discovers each
 * `packages/<pkg>/bun.lock`, runs `bun install --frozen-lockfile` inside
 * each (so per-workspace `node_modules` exist), installs the root lockfile,
 * then runs the root-pinned Knip binary.
 */
export function knipCheckHelper(source: Directory): Container {
  return bunQualityBase(source).withExec([
    "bash",
    "-c",
    [
      "bun install --frozen-lockfile;",
      "while IFS= read -r -d '' lockfile; do",
      '  dir="$(dirname "$lockfile")";',
      '  (cd "$dir" && bun install --frozen-lockfile);',
      'done < <(find packages/ -name bun.lock -not -path "*/node_modules/*" -not -path "*/example/*" -print0);',
      "bun run knip",
    ].join(" "),
  ]);
}

/**
 * Gitleaks secret-detection scan over the working tree (no git history).
 * Uses the upstream zricethezav/gitleaks image whose entrypoint is the
 * `gitleaks` binary itself — Dagger's `withExec` overrides the entrypoint,
 * so we invoke the binary explicitly as the first arg.
 */
export function gitleaksCheckHelper(source: Directory): Container {
  return dag
    .container()
    .from(GITLEAKS_IMAGE)
    .withWorkdir("/repo")
    .withDirectory("/repo", source, { exclude: SOURCE_EXCLUDES })
    .withExec(["gitleaks", "detect", "--source", "/repo", "--no-git"]);
}

/**
 * Suppression check — counts current per-rule suppression densities and
 * fails if any rule's count exceeds the baseline in
 * `.quality-baseline.json`.
 *
 * The historical `--ci` flag suppressed the staged-only behavior; in
 * Dagger we always run repo-wide.
 */
export function suppressionCheckHelper(source: Directory): Container {
  return bunQualityBase(source).withExec([
    "bun",
    "scripts/check-suppressions.ts",
    "--ci",
  ]);
}

/**
 * Trivy filesystem scan (HIGH + CRITICAL severities). Uses the upstream
 * aquasec/trivy image — CVE DB updates land via the image's
 * `trivy-db` baked layer + on first run. Exit 1 on any finding.
 *
 * The aquasec/trivy image's entrypoint is the `trivy` binary, but Dagger's
 * `withExec` overrides the entrypoint — so we invoke the binary explicitly as
 * the first arg (same as gitleaks/semgrep above).
 */
export function trivyScanHelper(source: Directory): Container {
  return dag
    .container()
    .from(TRIVY_IMAGE)
    .withWorkdir("/repo")
    .withDirectory("/repo", source, { exclude: SOURCE_EXCLUDES })
    .withExec([
      "trivy",
      "fs",
      "--scanners",
      "vuln",
      "--skip-version-check",
      "--exit-code",
      "1",
      "--severity",
      "HIGH,CRITICAL",
      "--ignorefile",
      ".trivyignore",
      "--skip-dirs",
      "sandbox/archive",
      "--skip-dirs",
      "sandbox/practice",
      ".",
    ]);
}

/**
 * Run the dagger-hygiene grep over `.dagger/src/`, `scripts/ci/src/`, and
 * `.buildkite/scripts/`. Self-referential but safe — the engine runs the
 * check against a Directory snapshot, not against its own live source.
 * See `scripts/check-dagger-hygiene.ts` for the full banned-pattern list.
 */
export function daggerHygieneHelper(source: Directory): Container {
  return bunQualityBase(source).withExec([
    "bun",
    "scripts/check-dagger-hygiene.ts",
  ]);
}

/**
 * Verify `react`/`react-dom` (and their `@types`) resolve to matching versions
 * in every `bun.lock`. A skew throws "Incompatible React versions" at runtime
 * — invisible to typecheck/build/test. The script reads only `bun.lock` files
 * from the mounted source; no `node_modules` install required.
 */
export function reactVersionSyncHelper(source: Directory): Container {
  return bunQualityBase(source).withExec([
    "bun",
    "scripts/check-react-version-sync.ts",
  ]);
}

/**
 * Verify every cdk8s `TunnelBinding` has a matching cdk8s+Tofu
 * `cloudflare_dns_record`. The script reads both cdk8s TypeScript and
 * Tofu HCL from the repo — both are inside the mounted source.
 */
export function tunnelDnsCoverageHelper(source: Directory): Container {
  return bunQualityBase(source).withExec([
    "bun",
    "scripts/check-tunnel-dns-coverage.ts",
  ]);
}

/**
 * Verify the pinned Talos installer in `patches/image.yaml` matches what the
 * `image.yaml` schematic produces (queries the Image Factory). Catches drift
 * where `image.yaml`'s extraKernelArgs/systemExtensions change without
 * regenerating the pin — which silently boots the old schematic (e.g. dropping
 * `lockdown=integrity` and breaking eBPF profiling). The script is
 * dependency-free, so it runs in the quality base without a node_modules install.
 */
export function talosSchematicSyncHelper(source: Directory): Container {
  return bunQualityBase(source).withExec([
    "bun",
    "packages/homelab/src/talos/update-image-id.ts",
    "--check",
  ]);
}

/**
 * Semgrep `--config auto` scan against the repo. Uses the upstream
 * semgrep/semgrep image which ships with the engine and rule loader.
 */
export function semgrepScanHelper(source: Directory): Container {
  return dag
    .container()
    .from(SEMGREP_IMAGE)
    .withWorkdir("/repo")
    .withDirectory("/repo", source, { exclude: SOURCE_EXCLUDES })
    .withExec(["semgrep", "scan", "--config", "auto", "."]);
}

/**
 * Validate the root `bun.lock` is fully resolved — fails if `bun install
 * --frozen-lockfile` would need to mutate it.
 */
export function lockfileCheckHelper(source: Directory): Container {
  return bunQualityBase(source).withExec([
    "bun",
    "install",
    "--frozen-lockfile",
  ]);
}

/**
 * Validate env-var naming conventions across staged-style file types.
 * Inside Dagger we scan the whole repo (no staged-files concept).
 */
export function envVarNamesHelper(source: Directory): Container {
  return bunQualityBase(source).withExec([
    "bash",
    "scripts/check-env-var-names.sh",
  ]);
}

/**
 * Verify every tracked file's line endings match its `.gitattributes`
 * declaration. Requires the `.git` directory to be present (since the
 * script calls `git ls-files --eol`), so we mount source without
 * `SOURCE_EXCLUDES`. Also the only quality helper that needs the `git`
 * binary, which the upstream bun image does not ship.
 */
export function lineEndingsCheckHelper(source: Directory): Container {
  // SOURCE_EXCLUDES drops `.git`, but check-line-endings.ts calls
  // `git ls-files --eol`. Mount source without those excludes for this
  // single check; the cost is small (.git is shipped once per SHA into
  // the engine cache regardless).
  return dag
    .container()
    .from(BUN_IMAGE)
    .withExec(["apt-get", "update", "-qq"])
    .withExec([
      "apt-get",
      "install",
      "-y",
      "-qq",
      "--no-install-recommends",
      "git",
    ])
    .withWorkdir("/repo")
    .withDirectory("/repo", source)
    .withExec(["bun", "scripts/check-line-endings.ts"]);
}

/**
 * Guard against silent package-exclusion drift in the catalog.
 */
export function migrationGuardHelper(source: Directory): Container {
  return bunQualityBase(source).withExec([
    "bun",
    "scripts/guard-no-package-exclusions.ts",
  ]);
}

/**
 * Verify Scout's committed SQLite test template matches what migrations + seeds
 * produce. Mirrors the pre-PR2 plain step: install scout deps, generate Prisma
 * client in the backend, then run `check:test-template`.
 *
 * scout-for-lol is a nested Bun workspace, so the install runs from its own
 * root before descending into `packages/backend`.
 */
export function scoutTestTemplateCheckHelper(source: Directory): Container {
  return bunQualityBase(source)
    .withWorkdir("/repo/packages/scout-for-lol")
    .withExec(["bun", "install", "--frozen-lockfile"])
    .withWorkdir("/repo/packages/scout-for-lol/packages/backend")
    .withExec(["bunx", "--trust", "prisma", "generate"])
    .withExec(["bun", "run", "check:test-template"]);
}

/**
 * Detect unresolved merge-conflict markers in source files. Honors
 * `.conflictignore` (read in-container so the file lives in the
 * Directory).
 *
 * `grep -rl` returns exit 1 when no matches are found, which is the happy
 * path here — so we capture exit status explicitly rather than swallowing
 * it. Same pattern as the original BK-side step.
 */
export function mergeConflictCheckHelper(source: Directory): Container {
  return bunQualityBase(source).withExec([
    "bash",
    "-c",
    [
      'ignore_args="";',
      "if [ -f .conflictignore ]; then",
      "  while IFS= read -r line; do",
      '    case "$line" in ""|"#"*) continue ;; esac;',
      "    ignore_args=\"$ignore_args | grep -v '$line'\";",
      "  done < .conflictignore;",
      "fi;",
      "cmd=\"grep -rl '<<<<<<< \\|>>>>>>> '",
      "--include='*.ts' --include='*.tsx' --include='*.rs'",
      "--include='*.json' --include='*.yaml' --include='*.yml'",
      "--include='*.md' --include='*.sh'",
      "--exclude-dir=node_modules --exclude-dir=.dagger",
      '--exclude=lefthook.yml .";',
      "set +e;",
      'files=$(eval "$cmd $ignore_args"); status=$?;',
      "set -e;",
      // grep returns 1 when nothing matched — that's the success case here.
      // Only treat 0 (matches present) as a failure; > 1 is a real error.
      'if [ "$status" -gt 1 ]; then echo "grep failed (exit $status)"; exit "$status"; fi;',
      'if [ -n "$files" ]; then',
      '  echo "Merge conflict markers found:";',
      '  echo "$files";',
      "  exit 1;",
      "fi",
    ].join(" "),
  ]);
}

/**
 * Detect files larger than 5 MB in the working tree. Honors `.largeignore`
 * (read in-container).
 */
export function largeFileCheckHelper(source: Directory): Container {
  // Build the `-not -path` exclusions from `.largeignore` into a bash
  // array, then expand it with `"${extra[@]}"`. No `eval`, no string
  // splicing — globs, single quotes, and whitespace in path entries
  // stay literal. The hard-coded excludes go first; per-line entries
  // get prefixed with `./` to anchor them against find's relative paths.
  return bunQualityBase(source).withExec([
    "bash",
    "-c",
    [
      "assetExitCode=0;",
      "bun packages/scout-for-lol/scripts/check-asset-sizes.ts || assetExitCode=1;",
      "extra=();",
      "if [ -f .largeignore ]; then",
      "  while IFS= read -r line; do",
      '    case "$line" in ""|"#"*) continue ;; esac;',
      '    extra+=( -not -path "./$line" );',
      "  done < .largeignore;",
      "fi;",
      "large=$(find . -type f -size +5M",
      '  -not -path "*/node_modules/*"',
      '  -not -path "*/.git/*"',
      '  -not -path "*/.build/*"',
      '  -not -path "*/.dagger/*"',
      '  -not -path "*/archive/*"',
      '  "${extra[@]}"',
      "  -exec ls -lh {} +);",
      'if [ -n "$large" ]; then',
      '  echo "Files exceed 5MB limit:";',
      '  echo "$large";',
      "  exit 1;",
      "fi;",
      "exit $assetExitCode",
    ].join(" "),
  ]);
}

/**
 * iOS native-deps check for tasks-for-obsidian. Replaces the script
 * `.buildkite/scripts/tasks-for-obsidian-ios-native-deps.sh` which the
 * BK pod previously ran against its working tree.
 *
 * `--linker hoisted` matches the legacy script — required because the
 * downstream `check:ios-native-deps` consumer expects a flat node_modules
 * layout, not isolated.
 */
export function tasksForObsidianIosNativeDepsHelper(
  source: Directory,
): Container {
  return bunQualityBase(source)
    .withWorkdir("/repo/packages/tasks-for-obsidian")
    .withExec(["bun", "install", "--frozen-lockfile", "--linker", "hoisted"])
    .withExec(["bun", "run", "check:ios-native-deps"]);
}
