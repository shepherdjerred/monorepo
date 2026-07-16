---
id: turbo-cache-rollout
status: blocked
origin: packages/docs/plans/2026-07-13_ci-parity-implementation.md
---

# Roll out the turbo remote-cache server (staged, not deployed)

The ducktors/turborepo-remote-cache cdk8s app is fully written
(`src/resources/turbo-cache.ts` + chart + argo app) but its registration is
commented out in `setup-charts.ts` and `cdk8s-charts/apps.ts` — deploying it
before its secret exists would just crash-loop, and `check:1password`
correctly fails on the missing vault item.

Operator steps, in order:

1. `tofu apply` the staged R2 bucket (`packages/homelab/src/tofu/cloudflare/turbo-cache.tf`).
2. In the Cloudflare dashboard, mint an R2 S3 token scoped to the
   `turbo-cache` bucket (Object Read & Write).
3. Create 1Password item `turbo-cache-r2` in the homelab vault with fields
   `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `TURBO_TOKEN` (shared bearer token turbo
   clients present).
4. `cd packages/homelab/src/cdk8s && bun run scripts/snapshot-1password-vault.ts`
   and commit the refreshed snapshot.
5. Uncomment `createTurboCacheChart` (setup-charts.ts) +
   `createTurboCacheApp` (apps.ts), and recreate
   `src/cdk8s/helm/turbo-cache/Chart.yaml` (+ empty values.yaml) matching
   the other charts' boilerplate (apiVersion v2, name turbo-cache,
   version/appVersion "$version"/"$appVersion"); synth + merge; ArgoCD
   deploys it.
6. Wire clients: `TURBO_API=https://turbo-cache.<tailnet>` + `TURBO_TOKEN` +
   `TURBO_TEAM` in `buildkite-ci-secrets` and dev shells.
