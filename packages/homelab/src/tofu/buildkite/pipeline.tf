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
