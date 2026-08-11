# cdk8s

[cdk8s](https://cdk8s.io/) app that generates every Kubernetes manifest for the homelab. `bun run build` runs `src/app.ts` and `scripts/patch.ts` to synthesize the YAML into `dist/`; ArgoCD deploys the result via the pushed Helm chart (never `kubectl apply`).

## Layout

- `src/app.ts` — entry point; charts are registered in `src/setup-charts.ts`
- `src/cdk8s-charts/` — one chart per service/namespace (`create{Name}Chart`)
- `src/resources/argo-applications/` — the ArgoCD `Application` per chart, wired up in `src/cdk8s-charts/apps.ts` (app-of-apps)
- `helm/<name>/` — the Helm chart shell (`Chart.yaml`) each app is packaged into
- `src/versions.ts` — every Docker image (pinned SHAs) and Helm chart version, annotated for Renovate; the single source of truth for upgrades
- `generated/helm/` — **committed** TypeScript types for Helm chart values
- `imports/` — generated Kubernetes/CRD types (`bun run update-imports`)

## Helm value types

The committed types in `generated/helm/` are the source of truth — CI does not regenerate them. When bumping a chart version in `src/versions.ts`, regenerate and commit:

```bash
bun run generate-helm-types
```

The `helm-types-drift-check` Buildkite step fails any PR that changes a generator input without regenerating.

## 1Password lint

`check:1password` verifies offline that every `OnePasswordItem` reference (item and field) exists in the vault, using a committed hash-only snapshot (`onepassword-vault-snapshot.json`):

```bash
bun run check:1password                       # offline lint (runs in bun run verify)
bun run scripts/snapshot-1password-vault.ts   # refresh snapshot after vault changes (needs op)
```

## Commands

```bash
bun run build       # synthesize manifests into dist/
bun test            # full suite (plus test:gpu-resources)
bun run diff        # build + helm-render diff against the cluster
bun run render      # build + render only
bun run up          # build + apply via helm-render (operator escape hatch)
bun run typecheck
bun run lint
```

See [../../AGENTS.md](../../AGENTS.md) for the add-a-service checklist, cluster topology, and testing notes.
