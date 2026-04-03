# Local Quality Check — Full Monorepo Verification

Run all linters, tests, builds, and quality gates locally. Covers TypeScript/Bun, Rust (clauderon), Go (terraform-provider-asuswrt), Java (castle-casters), Swift (tips, glance), LaTeX (resume), plus repo-wide quality gates.

## Execution Strategy

Run in 4 waves. Waves 1 & 2 are parallel. Wave 3 runs after both complete. Wave 4 is non-blocking.

```
Wave 1 (root scripts) ──┐
                         ├──> Wave 3 (quality gates) ──> Wave 4 (soft checks)
Wave 2 (non-JS langs) ──┘
```

## Wave 1: Root Package Scripts

These dispatch to all packages via `scripts/run-package-script.ts`. Run all 4 in parallel:

```bash
bun run lint       # ESLint + language-specific linters for all packages
bun run typecheck  # tsc --noEmit + Astro check + Swift/Cargo build
bun run test       # Bun test + Vitest + Swift test + Cargo test + Maven test
bun run build      # tsc, Vite, Astro, Swift, Cargo, xelatex, bun compile
```

**Notes:**

- Prisma packages (birmel, scout-for-lol) run `prisma generate` inside their scripts
- `resume` needs `xelatex` installed
- Swift packages (tips, glance) need Xcode toolchain

## Wave 2: Non-JS Language Verification

Explicit invocations with stricter flags than package.json defaults. Run in parallel with Wave 1.

### Rust (clauderon)

```bash
cd packages/clauderon
cargo clippy --all-targets --all-features -- -D warnings  # strict linting
cargo test --all-features                                   # tests
cargo fmt --check                                           # formatting
cargo deny check                                            # dependency audit
```

### Go (terraform-provider-asuswrt)

```bash
cd packages/terraform-provider-asuswrt
go build ./...
go test ./...
```

### Java (castle-casters)

```bash
cd packages/castle-casters
mvn -q compile
mvn -q test
```

## Wave 3: Repo-Wide Quality Gates

CI-blocking checks not covered by per-package scripts. Run all in parallel from repo root:

```bash
bun install --frozen-lockfile                  # lockfile integrity
bash scripts/compliance-check.sh               # all packages have required scripts
bun scripts/quality-ratchet.ts                 # lint metrics haven't regressed
bun scripts/check-suppressions.ts --ci         # lint suppressions valid
bash scripts/check-env-var-names.sh            # env var naming conventions
bash scripts/check-dagger-hygiene.sh           # no banned Dagger patterns
bun scripts/guard-no-package-exclusions.ts     # migration guard
gitleaks detect --redact --no-banner           # no secrets in repo
```

## Wave 4: Soft Checks

Non-blocking but useful. Run in parallel:

```bash
bunx prettier --check .   # code formatting
bunx knip                 # unused dependencies/exports
```

## Not Available Locally

These require infrastructure only present in CI:

- **OpenTofu** plan/apply — needs `op run` secrets
- **Container images** — needs Dagger engine
- **Deploys** — sites, NPM, Helm, ArgoCD
- **Security scans** — Trivy, Semgrep (CI containers)
- **Playwright tests** — needs browser install (`bunx playwright install`)
- **Caddyfile validate** — needs Dagger

## Success Criteria

All Wave 1-3 commands exit 0. Wave 4 failures are reported but non-blocking.
