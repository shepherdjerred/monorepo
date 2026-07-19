# The monorepo CI pipeline. The committed `.buildkite/pipeline.yml` bootstrap
# still does the dynamic pipeline upload; this resource manages the pipeline's
# core Buildkite-side settings (repo, branch rules, cluster, upload step).
#
# provider_settings (the granular GitHub trigger toggles) is intentionally left
# unmanaged: it is configured in the Buildkite UI and `tofu import` leaves it
# null in state, so declaring it here would churn it on every apply. The GitHub
# webhook itself is managed in the `github` tofu stack and is not touched here.
resource "buildkite_pipeline" "monorepo" {
  name       = "monorepo"
  repository = "https://github.com/shepherdjerred/monorepo.git"
  cluster_id = buildkite_cluster.homelab.id

  # Build pages and job logs must NOT be world-readable. A public pipeline
  # serves every build's logs to anonymous viewers, so any secret a step
  # prints (e.g. a runtime-minted token echoed by a script bug) becomes a
  # public disclosure. Keep this managed here so a UI toggle can't drift it
  # back to public. Defense-in-depth for the log-scrubbing controls in
  # .buildkite/pipeline.yml + scripts/lib/github-auth.ts. See
  # packages/docs/logs/2026-07-18_bk-log-secret-audit-and-hardening.md.
  visibility = "PRIVATE"

  default_branch       = "main"
  branch_configuration = "main"

  # Buildkite "skip/cancel intermediate builds" (REST: skip_queued_branch_builds
  # / cancel_running_branch_builds).
  skip_intermediate_builds   = true
  cancel_intermediate_builds = true

  # Exact upload step the pipeline currently runs (queue: default keeps the
  # bootstrap step on the cluster's default queue).
  steps = "steps:\n    - label: \":pipeline: Upload pipeline\"\n      command: buildkite-agent pipeline upload\n      agents:\n        queue: default"
}
