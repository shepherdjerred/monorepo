# AGENTS.md

This is a Kubernetes homelab infrastructure monorepo using CDK8s for infrastructure-as-code.

## Tech Stack

- **Runtime**: Bun (not Node.js)
- **Language**: TypeScript (strict mode)
- **Infrastructure**: CDK8s for Kubernetes manifests
- **CI/CD**: Dagger + Buildkite + Python CI scripts

## Workspaces

- `src/cdk8s` - Kubernetes infrastructure as code
- `src/helm-types` - Type-safe Helm chart parameter generator
- `../../scripts/ci/src/` - TypeScript CI pipeline generator

Home Assistant automations and the other migrated schedules (dependency summary,
DNS audit, Better Skill Capped fetcher, golink sync) live in `packages/temporal`,
built on the generic `packages/home-assistant` client library — not here.

## Commands

```bash
# Install dependencies
bun install

# Build all workspaces
mise run build

# Run tests
bun test

# Lint
bun run lint

# Type check
bun run typecheck

# Format
bun run prettier
```

## Code Style

### Linting (ESLint v9 flat config)

- Config: `eslint.config.ts`
- Strict TypeScript rules enabled
- File names must be kebab-case
- Zod schemas must follow naming conventions

### Formatting (Prettier)

- Print width: 120 characters
- Runs on all files via lint-staged

### TypeScript

- Strict mode enabled
- Target: ESNext
- Module resolution: bundler
- No unused parameters/locals allowed

## Conventions

### Prefer Bun APIs over Node.js

```typescript
// ✅ Good
Bun.file("path");
Bun.spawn(["cmd"]);
Bun.env.VAR;

// ❌ Avoid
fs.readFileSync("path");
child_process.spawn("cmd");
process.env.VAR;
```

### Use Zod for validation

```typescript
// ✅ Good
const UserSchema = z.object({ name: z.string() });
UserSchema.parse(data);

// ❌ Avoid
typeof data === "object";
data instanceof User;
```

### No type assertions (except `as unknown` or `as const`)

```typescript
// ✅ Good
const items = [] as const;
const unknown = value as unknown;

// ❌ Avoid
const user = data as User;
```

### Naming conventions

- Files: `kebab-case.ts`
- Types/Interfaces: `PascalCase`
- Variables/Functions: `camelCase`
- Constants: `UPPER_CASE` or `camelCase`

## Adding New Services

When adding a new Kubernetes service/chart, you MUST complete ALL of these steps:

1. **CDK8s Chart** - `src/cdk8s/src/cdk8s-charts/{name}.ts`
   - Export a `create{Name}Chart(app: App)` function
   - Register in `src/cdk8s/src/setup-charts.ts`

2. **Helm Chart Directory** - `src/cdk8s/helm/{name}/Chart.yaml`

   ```yaml
   apiVersion: v2
   name: { name }
   description: { description }
   type: application
   version: "$version"
   appVersion: "$appVersion"
   ```

3. **Helm Charts List** - `../../scripts/ci/src/catalog.ts`
   - Add `"{name}"` to the `HELM_CHARTS` array

4. **ArgoCD Application** - `src/cdk8s/src/resources/argo-applications/{name}.ts`
   - Export a `create{Name}App(chart: Chart)` function
   - Wire up in `src/cdk8s/src/cdk8s-charts/apps.ts` (import + call)

**NEVER apply manifests directly with `kubectl apply`. All deployments go through ArgoCD.**

### Single-Node Cluster (torvalds)

The cluster is a **single-node Talos cluster** (`torvalds`). When debugging or testing in-cluster:

- No node-placement variance — GPU/hwaccel, NUMA, and disk locality are constant.
- There is no way to spin up an isolated test pod on a separate node; a replacement pod IS prod.
- `kubectl set image` or any direct deployment mutation hits prod immediately, and ArgoCD reverts it unless that Application is paused. All changes should go through GitOps.

## 1Password Secrets

Secrets are synced from the homelab 1Password vault into Kubernetes via the
`OnePasswordItem` CRD (`spec.itemPath` → `vaults/<vault>/items/<id-or-title>`), and the
synced secret's data keys are consumed via `secretKeyRef`/`envFrom`/volume mounts.

A linter guarantees that **every referenced item and field actually exists in 1Password**,
so a typo'd field name or a missing/renamed item is caught before deploy instead of failing
the operator sync (or crashing the pod) at runtime. It runs offline (pre-commit + a blocking
CI gate) by checking the synthesized references against a committed snapshot of vault
structure — `src/cdk8s/onepassword-vault-snapshot.json`, which holds **only sha256 hashes**
of item ids/titles/field keys (no values, no plaintext names).

```bash
# Lint (offline, no 1Password access). Synthesizes in-memory + checks the snapshot.
cd src/cdk8s && bun run scripts/check-1password-items.ts

# Refresh the snapshot — the ONLY step needing 1Password. Run whenever you add/rename an
# item or field in the vault, then commit the updated snapshot. Uses your local `op` login
# (or 1Password Connect if OP_CONNECT_TOKEN + OP_CONNECT_URL are set).
cd src/cdk8s && bun run scripts/snapshot-1password-vault.ts
```

Notes:

- A referenced field must **exist** (its label is present on the item) **and**, for a
  required reference, be **non-blank**. A required `secretKeyRef` pointing at an
  empty-valued field fails the lint, because the operator skips empty fields at sync time
  and the pod's env var would be missing (`CreateContainerConfigError`). The snapshot records
  which keys are blank as hashes only — no values are ever stored.
- `secretKeyRef` marked `optional: true` is exempt: it may reference a missing or blank field
  by design, so the linter neither requires it to exist nor to be populated.
- If the lint fails right after a legitimate vault change (item/field added, renamed, or
  populated), refresh the snapshot and commit it.

### No optional secrets — fail fast

Do **not** wire any secret env var or secret volume in `src/cdk8s` with `optional: true`. The repo's standard is **zero optional secrets**: if a referenced 1Password field/secret key is missing, the pod SHOULD crash-loop (`CreateContainerConfigError`) so the gap is loud at deploy time, not silently absent at runtime. For a previously-optional secret, pick ONE:

- **Make it required** (drop `optional: true`) and populate the field in 1Password.
- **Remove the ref entirely** if the feature is disabled/optional.

Non-sensitive config (bucket names, etc.) should be plain `EnvValue.fromValue(...)` literals, not secret refs. (A missing `optional: true` masked a never-added `BUILDKITE_API_TOKEN`, silently breaking the cancel-builds-on-PR-close feature.) Note the linter still _exempts_ `optional: true` refs from existence/population checks — this is a policy on top of the linter, not enforced by it.

### 1Password Connect — double-encoded credentials

The 1Password Connect Helm chart v2.3.0 changed `OP_SESSION` from an env var to a file
mount, which silently breaks credentials stored with the old double-base64 convention.
Symptom: Connect returns 500s and logs
`failed to Unmarshal credentials file data into map, invalid character 'e' looking for beginning of value`
(the `e` is the start of `eyJ…`, i.e. base64 of `{"`). Diagnose:

```bash
kubectl get secret op-credentials -n 1password \
  -o jsonpath='{.data.1password-credentials\.json}' | base64 -d | head -c 5
```

If it starts with `eyJ` instead of `{`, the credentials are double-encoded — decode once
more and recreate the secret. (`stringData` auto-encodes once; the old chart decoded
twice, the new chart mounts the file so K8s only decodes once.) Upstream:
github.com/1Password/connect-helm-charts#272.

## Testing & Pre-commit Notes

### Run tests with `bun run test`, not bare `bun test`

Run homelab tests via the **script** `bun run test` (which does
`install-subpkgs && cd src/cdk8s && bun run test && cd ../helm-types && bun run test`).
The `cd src/cdk8s` matters: many cdk8s tests read `config/homeassistant` via a
CWD-relative path. Bare `bun test` from `packages/homelab` uses the wrong CWD and
produces ~15 spurious failures, all reporting
`ENOENT: no such file or directory, open 'config/homeassistant '` (note the trailing
null byte) across unrelated test files — these are NOT real failures. The
`homelab-typecheck` pre-commit hook already uses the script, so only ad-hoc local runs
hit this.

### `helm-template.test.ts` flakes under concurrent load

Any commit touching `packages/homelab/` runs the `homelab-typecheck` pre-commit hook,
which runs the full `bun test` suite. `src/cdk8s/src/helm-template.test.ts` ("should
render all charts with helm template without errors") has a **5000ms per-test timeout**
and renders ~29 charts via `helm template`; on `torvalds` it times out under heavy
concurrent CI load (passes in ~7s when idle). It is not network-related (renders from
`dist/`, no fetch — distinct from the live-fetch `argocd-helm-render.test.ts`). Fix: just
retry the commit — a trivial edit cannot change other charts' rendering.

### `argocd-helm-render.test.ts` — transient upstream skips

`src/cdk8s/src/argocd-helm-render.test.ts` renders every external chart by fetching the
pinned tarball **live** from upstream, which intermittently serves `504`. As of PR #1081
it retries with jittered backoff (7 attempts) and treats a failure that still matches the
transient pattern (502/503/504, `ECONN*`, DNS, TLS handshake) as a loudly-logged
**non-fatal skip**, not a build failure. Real errors (404/missing version, template or
schema-validation errors) stay hard failures. So a red helm-render build means a genuine
chart/values bug, not a flake; `Skipped N/M chart(s) due to transient upstream errors` is
expected. Run locally with `HELM_RENDER_TEST=1 bun test src/argocd-helm-render.test.ts`
(needs `bun run build` first for `dist/apps.k8s.yaml`).

## Git Workflow

- Conventional commits and pre-commit checks are managed at monorepo root
- Pre-commit checks run via root `lefthook.yml`

## Version Management

Uses `mise` (formerly rtx) for tool versions:

```bash
mise trust    # Trust the mise.toml config
mise run dev  # Install dependencies and setup
```

## DNS Management

All Cloudflare DNS records are managed by OpenTofu in `src/tofu/cloudflare/`.
Each domain has its own `.tf` file with zone, DNS records, and DNSSEC resources.

Records **excluded** from tofu (dynamic, managed elsewhere):

- `ddns.sjer.red` (A/AAAA) — updated by ddns service
- `mc.sjer.red`, `shuxin.sjer.red`, `mc.ts-mc.net` — CNAME to ddns
- `files.sjer.red`, `storage.ts-mc.net` — auto-managed by Cloudflare R2 custom domains

To add/modify DNS records, edit the appropriate `.tf` file and run:

```bash
op run --env-file=.env -- tofu -chdir=cloudflare plan
op run --env-file=.env -- tofu -chdir=cloudflare apply
```

## OpenTofu State

OpenTofu/Terraform state for the `src/tofu/*` stacks is stored in **SeaweedFS** (S3-compatible), not locally. `tofu init` therefore needs AWS credentials for the backend. To validate `.tf` without state access, use `tofu init -backend=false` (syntax) and `tofu validate` (resource schemas).

## GitHub Repo Settings & Rulesets

The `shepherdjerred/monorepo` branch rulesets and repo settings are OpenTofu-managed in `src/tofu/github/` (`rulesets.tf`, `repos.tf`). **Manual edits via `gh api`/the GitHub UI do not stick** — a `tofu apply` reconciles them away. To change required status checks, enforcement, or bypass actors, edit `rulesets.tf`.

Required status checks are `required_check { context = "..." }` blocks under `rules { required_status_checks { ... } }`. Buildkite reports each pipeline step as a status context `buildkite/monorepo/pr/<safe-key>`; a context only exists on PR builds whose pipeline includes that step, so requiring a brand-new step's context would block all other PRs until that step reaches `main`. Routing the requirement through Tofu (applied on merge) makes enforcement land exactly when the step lands. Validate locally: `tofu -chdir=github init -backend=false && tofu -chdir=github validate`.
