# Adding a Homelab OpenTofu Stack

## Status

Complete (pattern from PR #1343: buildkite, arr, pagerduty).

## CI auto-applies on main — import first

`scripts/ci/src/steps/tofu.ts` `tofu-apply-all` runs `tofu apply -auto-approve` for every stack in `TOFU_STACKS` (`scripts/ci/src/catalog.ts`). A new stack must be **imported to a zero-change `tofu plan` BEFORE** it lands in `TOFU_STACKS`, or the first post-merge apply tries to create existing resources. Import locally against the real SeaweedFS state backend (state key `<stack>/terraform.tfstate`), verify `No changes`, then add to `TOFU_STACKS`.

## Stack files

`packages/homelab/src/tofu/<name>/{providers,backend,variables}.tf` + resources. Copy `backend.tf` from `github/` (S3, SeaweedFS tailnet endpoint); commit `.terraform.lock.hcl`. `.env` + `.terraform/` are gitignored.

Fast import: `import {}` blocks + `tofu plan -generate-config-out=generated.tf`, then `tofu apply` (imports), then delete the import blocks. **Scrub generated config** of read-only/sensitive fields (e.g. pagerduty `integration_key` = the live routing key — delete it; \*arr passwords / api_keys come back null — leave masked).

## Secret threading (one param per secret, through 8 functions)

`tofuApplyHelper`/`tofuPlanHelper` (+ conditional `withSecretVariable("TF_VAR_x", ...)`) and `tofuApplyAllHelper`/`tofuPlanAllHelper` in `.dagger/src/release.ts`; then `tofuApply`/`tofuPlan`/`tofuApplyAll`/`tofuPlanAll` in `.dagger/src/index.ts` (camelCase param → `--kebab-flag`); then `tofuSecretFlags()` in `steps/tofu.ts` as `--flag env:ENV_NAME`. CI pods get env via `envFrom buildkite-ci-secrets` (k8s secret synced from 1P item `Buildkite CI Secrets`) — add the field there + confirm sync. `.dagger/` is excluded from the env-var-names hook; `steps/tofu.ts` is NOT and forces canonical names (`PAGERDUTY_TOKEN`, never the `…_API_TOKEN` alias). `.dagger` can't `tsc` locally (needs `dagger develop` SDK) — parse-check with `bun build`.

## Provider gotchas

- buildkite import IDs are GraphQL node IDs (queue = `<queue_gid>,<cluster_uuid>`); `buildkite_cluster_agent_token` has no import + unreadable secret → leave 1P-managed.
- devopsarr + pagerduty import by numeric/string ID (service_integration = `<svc>.<int>`).
- `*arr` keys: radarr/sonarr in `Recyclarr` 1P `recyclarr.yaml`, prowlarr only in its pod `/config/config.xml`. Reach `*arr` over tailnet FQDNs (`<app>.tailnet-1a49.ts.net`). Recyclarr owns quality_profile/custom_format — Tofu must NOT.
