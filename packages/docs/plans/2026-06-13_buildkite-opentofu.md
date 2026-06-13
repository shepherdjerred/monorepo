# Plan: Manage Buildkite via OpenTofu

## Status

Not Started (proposed)

## Goal

Codify the Buildkite **pipeline + cluster + default queue + agent token** as IaC in a new
`packages/homelab/src/tofu/buildkite/` stack, matching the existing `cloudflare` / `github` /
`seaweedfs` stacks. This is **IaC hygiene** (the pipeline + cluster were created in the UI and
drift untracked); it is **not** a throughput change.

## Scope — what Tofu owns vs what it does not

| Concern                                                                                                                     | Managed by                                                                                       | Notes                                                                 |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Pipeline definition + settings (`cancel_intermediate_builds`, `skip_intermediate_builds`, default branch, provider/webhook) | **this stack** `buildkite_pipeline`                                                              | the upload step stays `.buildkite/pipeline.yml`                       |
| Cluster + default queue                                                                                                     | **this stack** `buildkite_cluster`, `buildkite_cluster_queue`, `buildkite_cluster_default_queue` | enables future multi-queue isolation                                  |
| Agent token                                                                                                                 | **this stack** `buildkite_cluster_agent_token`                                                   | ⚠️ coordinate with the live 1Password item — see Risks                |
| `max-in-flight` (agent concurrency)                                                                                         | cdk8s `buildkite.ts`                                                                             | **not** in the TF provider                                            |
| Kueue resource quota                                                                                                        | cdk8s `kueue-config.ts`                                                                          | **not** in the TF provider                                            |
| Per-job `priority` (build-age FIFO)                                                                                         | CI generator `scripts/ci/src/lib/build-age-priority.ts`                                          | **not** in the TF provider                                            |
| Required status checks / branch protection                                                                                  | existing `github` tofu stack (`rulesets.tf`)                                                     | see [[reference_github_rulesets_tofu_managed]] — keep there, not here |

## Resources

| Resource                                   | Action                       | Why import vs create                                       |
| ------------------------------------------ | ---------------------------- | ---------------------------------------------------------- |
| `buildkite_cluster` (the existing cluster) | **import**                   | already live; recreating would orphan agents               |
| `buildkite_cluster_queue` `default`        | **import**                   | the `queue: "default"` the agent-stack uses                |
| `buildkite_pipeline` `monorepo`            | **import**                   | preserves build history + webhook; recreate would break CI |
| `buildkite_cluster_agent_token`            | **import or careful create** | the running agent authenticates with this — see Risks      |
| `buildkite_organization_rule` (optional)   | create                       | only if we want org-level guardrails codified              |

## Implementation steps

1. **Provider + backend.** New `src/tofu/buildkite/{providers.tf,backend.tf,variables.tf}`.
   - `providers.tf`: `buildkite/buildkite ~> 1.x`, `required_version >= 1.6.0`, `provider "buildkite" { organization = "sjerred" }` (token via `BUILDKITE_API_TOKEN` env var).
   - `backend.tf`: copy the s3 block from `github/backend.tf` (bucket `homelab-tofu-state`, SeaweedFS endpoint) with `key = "buildkite/terraform.tfstate"`. See [[reference_tofu_state_seaweedfs]].
2. **Auth.** Mint a Buildkite **API access token** (GraphQL + REST scopes: read/write pipelines, clusters). Store in 1Password; expose to local runs via `op run --env-file=.env` (like cloudflare/github) and to CI via a Dagger `Secret`.
3. **Resource files.** `cluster.tf`, `pipeline.tf` (with `cancel_intermediate_builds`/`skip_intermediate_builds` matching current UI settings — verify them first), `queue.tf`, `agent-token.tf`.
4. **Import live state** before first apply: `tofu import buildkite_pipeline.monorepo <pipeline-uuid>`, same for cluster/queue/token. `tofu plan` must show **no destroys** and near-empty diff before merging.
5. **Wire into CI.** Add `"buildkite"` to `TOFU_STACKS` (`scripts/ci/src/catalog.ts:242`) + a `TOFU_STACK_LABELS` entry; thread the `BUILDKITE_API_TOKEN` secret through the Dagger `tofu-apply`/`tofu-plan` functions (mirror `TOFU_GITHUB_TOKEN_ARG` in `scripts/ci/src/steps/tofu.ts`). PR builds run `tofu-plan`, main runs `tofu-apply`.
6. **Docs.** Note in `packages/homelab/CLAUDE.md` that pipeline/cluster settings are now tofu-managed (UI edits get reverted on apply), mirroring the DNS / github-rulesets guidance.

## Risks

- **Importing live resources, not recreating.** The pipeline + cluster already exist. Every `import` must precede the first `apply`, and the pre-merge `plan` must show **zero destroys**. A stray create/destroy would wipe build history or orphan the running agent.
- **Agent token coordination.** The live agent token is a 1Password item (`buildkite-agent-token`, referenced in `buildkite.ts:26-35`) consumed by cdk8s. If Tofu manages `buildkite_cluster_agent_token`, decide up front: (a) import the existing token and have Tofu manage only metadata, or (b) Tofu mints a new token → update the 1Password item → let ArgoCD roll the agent. Do **not** let Tofu silently rotate the token the running agent depends on. See [[feedback_dont_modify_1p_items]].
- **Provider token scope.** GraphQL-scoped tokens differ from agent tokens; a too-narrow scope fails import opaquely. Verify `tofu plan` works read-only before granting write.
- **Two sources of truth feel.** Be explicit (step 6) that concurrency/priority are NOT here, so future readers don't look in Tofu for `max-in-flight`.

## Open decisions (ask owner before starting)

1. Import the existing agent token (safest) or rotate to a Tofu-minted one?
2. Codify only the pipeline + cluster + queue now, or also organization rules?
3. Single `default` queue, or set up the multi-queue split (heavy image builds vs light lint) as part of this — the main reason a queue-as-code stack pays off?

## Related

- Shipped alongside this plan: PR #1162 — `max-in-flight` 20→24 + build-age job priority (`scripts/ci/src/lib/build-age-priority.ts`).
- Background + live metrics: `packages/docs/logs/2026-06-13_ci-concurrency-and-homelab-health.md`.
- [[project_kueue_buildkite]], [[reference_github_rulesets_tofu_managed]], [[reference_tofu_state_seaweedfs]].
