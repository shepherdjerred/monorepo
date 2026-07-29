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
  # bootstrap step on the cluster's default queue). The stable key and pod
  # label keep this first command pod in the same I/O attribution contract as
  # every command loaded by the static pipeline.
  steps = <<-YAML
    steps:
      - label: ":pipeline: Upload pipeline"
        key: pipeline-upload
        command: sh .buildkite/scripts/upload-pipeline.sh
        timeout_in_minutes: 5
        agents:
          queue: default
        plugins:
          - kubernetes:
              metadata:
                labels:
                  ci.sjer.red/step-key: pipeline-upload
              # This bootstrap job runs before the repository pipeline can be
              # uploaded, so it cannot rely on .buildkite/pipeline.yml for
              # checkout resources. Keep the override here as well as in the
              # agent-stack controller to prevent a controller rollout or
              # configuration regression from making CI unable to clone the
              # repository that contains its fix.
              podSpecPatch:
                containers:
                  - name: checkout
                    resources:
                      requests:
                        cpu: 50m
                        memory: 1Gi
                      limits:
                        cpu: 400m
                        memory: 2Gi
                  # container-0 runs upload-pipeline.sh. The checkout is a
                  # reference clone against the shared git mirror; without
                  # this mount every git operation in this container degrades
                  # to a full-repo pack download into the tmpfs workspace,
                  # which the namespace LimitRange's 768Mi default limit then
                  # OOM-kills (fleet-wide red PRs 2026-08-02; see
                  # packages/docs/logs/2026-08-02_buildkite-pipeline-upload-oom-diagnosis.md).
                  # Resources copy the pod_light container-0 shape from
                  # .buildkite/pipeline.yml so the LimitRange default can
                  # never apply and even a full-pack-fetch regression fits.
                  # Do NOT add secret env sources here: pipeline upload
                  # interpolates $VAR at upload time and would bake secret
                  # values into the stored pipeline. Do NOT pin a CI image
                  # here: its digest is computed BY this step; the default
                  # agent container (git + buildkite-agent) is sufficient.
                  - name: container-0
                    resources:
                      requests:
                        cpu: 250m
                        memory: 512Mi
                        ephemeral-storage: 1Gi
                      limits:
                        cpu: "7"
                        memory: 12Gi
                        ephemeral-storage: 20Gi
                    volumeMounts:
                      # The pod-level volume is injected for every job by the
                      # agent stack's default-checkout-params.gitMirrors.
                      - name: buildkite-git-mirrors
                        mountPath: /buildkite/git-mirrors
                        readOnly: true
  YAML
}

# A separate, schedule-only pipeline owns complete fresh test and coverage
# reporting. It deliberately has no webhook triggers and no release/deploy
# steps; the ordinary monorepo pipeline remains the per-change quality gate.
resource "buildkite_pipeline" "reporting" {
  name       = "monorepo-test-reporting"
  repository = "https://github.com/shepherdjerred/monorepo.git"
  cluster_id = buildkite_cluster.homelab.id

  visibility           = "PRIVATE"
  default_branch       = "main"
  branch_configuration = "main"

  skip_intermediate_builds   = true
  cancel_intermediate_builds = true

  provider_settings = {
    trigger_mode = "none"
  }

  steps = <<-YAML
    steps:
      - label: ":pipeline: Upload reporting pipeline"
        key: reporting-pipeline-upload
        command: sh .buildkite/scripts/upload-reporting-pipeline.sh
        timeout_in_minutes: 5
        agents:
          queue: default
        plugins:
          - kubernetes:
              metadata:
                labels:
                  ci.sjer.red/step-key: reporting-pipeline-upload
              podSpecPatch:
                containers:
                  - name: checkout
                    resources:
                      requests:
                        cpu: 50m
                        memory: 1Gi
                      limits:
                        cpu: 400m
                        memory: 2Gi
  YAML
}

# Keep the recurring trigger disabled until the pipeline succeeds manually.
# The rollout branch enables it after that evidence exists.
resource "buildkite_pipeline_schedule" "reporting_daily" {
  pipeline_id = buildkite_pipeline.reporting.id
  label       = "Daily complete test and coverage reporting"
  cronline    = "0 3 * * *"
  branch      = "main"
  commit      = "HEAD"
  message     = "Daily complete test and coverage reporting"
  enabled     = false
}
