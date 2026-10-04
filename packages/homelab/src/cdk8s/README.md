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

## Static-site SPA routes

`src/misc/s3-static-site.ts` generates Caddy routes for S3-backed sites. A
configured SPA prefix rewrites extensionless document paths to its index object
before the S3 lookup, so deep links return HTTP 200. Paths ending in a file
extension keep their original lookup and return HTTP 404 when the asset is
missing. The S3 error page remains available for that 404 response.

## Helm value types

The committed types in `generated/helm/` are the source of truth — CI does not regenerate them. When changing a chart in `../../../version-catalog/src/catalog.json`, regenerate and commit:

```bash
bun run generate-helm-types
```

The Woodpecker Helm types drift check fails any PR that changes a generator input without regenerating.

## Home Assistant pet-care alerts

`config/homeassistant/configuration.yaml` owns the qualified pet-care problem
sensors: five minutes for robot/feeder/fountain failures, 45 minutes for a
continuous Litter-Robot waiting or cycling sequence, and 15 minutes below
650 mL for a fountain shortage. Feeder problems also include more than 14 hours
without dispensing; the food-status signal combines low and empty food.
The water check reads the volume sensor's `mL` attribute, not its fluid-ounce
state or percentage sensor.

`automation.yaml` creates a persistent HA notification and sends one push via
`notify.send_message` to the registered `notify.jerreds_iphone` device when a
qualified problem turns on. Confirmed recovery dismisses the persistent
notification. Missing water or litter status telemetry cancels pending timers
and marks the signal unknown, without dismissing an existing incident. Restored
input booleans suppress repeat pushes across reconnects and restarts. Attribute
changes refresh the persistent notification's details, and HA startup recreates
notifications for active problems. Notification actions run in a queue so
overlapping updates cannot send duplicate pushes. Prometheus rules consume the
same qualified sensors without a second hold time. Battery, desiccant, filter,
and cleaning maintenance rules remain separate. The config hash rolls HA when
GitOps changes these mounted files; no manual automation reload is needed.

## 1Password lint

`check:1password` verifies offline that every `OnePasswordItem` reference (item and field) exists in the vault, using a committed hash-only snapshot (`onepassword-vault-snapshot.json`):

```bash
bun run check:1password                       # offline lint (runs in bun run verify)
bun run scripts/snapshot-1password-vault.ts   # refresh snapshot after vault changes (needs op)
```

## Commands

```bash
bun run build       # synthesize manifests into dist/
bun run test            # full suite (plus test:gpu-resources)
bun run diff        # build + helm-render diff against the cluster
bun run render      # build + render only
bun run up          # build + apply via helm-render (operator escape hatch)
bun run typecheck
bun run lint
```

Load the repository `homelab-development` skill for the add-a-service workflow.
See the [homelab overview](../../../docs/wiki/src/content/docs/explanation/homelab/overview.md)
for topology and [../../AGENTS.md](../../AGENTS.md) for always-on constraints.
