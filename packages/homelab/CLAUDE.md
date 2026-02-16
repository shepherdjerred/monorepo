# CLAUDE.md

This is a Kubernetes homelab infrastructure monorepo using CDK8s for infrastructure-as-code.

## Tech Stack

- **Runtime**: Bun (not Node.js)
- **Language**: TypeScript (strict mode)
- **Infrastructure**: CDK8s for Kubernetes manifests
- **CI/CD**: Dagger (TypeScript SDK) + GitHub Actions

## Workspaces

- `src/cdk8s` - Kubernetes infrastructure as code
- `src/ha` - Home Assistant automations
- `src/helm-types` - Type-safe Helm chart parameter generator
- `.dagger` - CI/CD pipeline module

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

3. **Dagger Helm Registry** - `.dagger/src/helm.ts`
   - Add `"{name}"` to the `HELM_CHARTS` array

4. **ArgoCD Application** - `src/cdk8s/src/resources/argo-applications/{name}.ts`
   - Export a `create{Name}App(chart: Chart)` function
   - Wire up in `src/cdk8s/src/cdk8s-charts/apps.ts` (import + call)

**NEVER apply manifests directly with `kubectl apply`. All deployments go through ArgoCD.**

## Git Workflow

- Conventional commits enforced via commitlint
- Pre-commit: lint-staged runs prettier, eslint, typecheck
- Husky manages git hooks

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
