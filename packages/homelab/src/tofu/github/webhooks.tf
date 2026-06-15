################################################################################
# Repository webhooks for shepherdjerred/monorepo.
#
# Two hooks pre-existed in the repo settings before tofu adopted them:
#   * the Buildkite webhook that drives CI builds, and
#   * the temporal worker's pr-bot webhook (the receiver in
#     packages/temporal/src/event-bridge/github-webhook.ts).
#
# HMAC secrets are NOT mirrored into tofu state — they live on the receiving
# end (Buildkite for the first hook, 1Password for the second), and tofu
# ignores the masked round-trip value the GitHub API returns. The point of
# tofu ownership here is to give the *event subscription list* an auditable,
# version-controlled source of truth so drift between "what fires" and
# "what the receiver expects" gets caught by the daily tofu plan in CI.
################################################################################

# Buildkite webhook — drives Buildkite CI builds.
#
# DELIVERY-URL TOKEN — INTENTIONALLY IN VERSION CONTROL.
# The URL embeds Buildkite's delivery token (the trailing hex string). This
# token is not a credential; Buildkite verifies the HMAC signature
# (`X-Buildkite-Signature`) on every delivery using a separate shared secret
# (the `ignore_changes`'d `configuration[0].secret` field below — owned by
# Buildkite, synced to the GitHub webhook by Buildkite's UI). Knowledge of
# the delivery URL alone is not enough to forge a delivery.
#
# This URL has lived in the repo's GitHub webhook settings since the
# Buildkite integration was set up; committing it here only mirrors that
# pre-existing state into tofu so the event subscription list is
# version-controlled. The trade-off (token in git history forever) is
# accepted: if Buildkite's verification model ever changed to make the URL
# alone exploitable, rotating it is the same one-click operation as
# regenerating any other Buildkite-side secret.
import {
  to = github_repository_webhook.buildkite
  id = "monorepo/597363792"
}

resource "github_repository_webhook" "buildkite" {
  repository = github_repository.monorepo.name

  configuration {
    url          = "https://webhook.buildkite.com/deliver/9fa108d68b68868a8e25538fd4b25010a347671187e3c0151f"
    content_type = "json"
    insecure_ssl = false
  }

  active = true
  events = ["deployment", "merge_group", "pull_request", "push"]

  lifecycle {
    # Buildkite owns this secret; the GitHub API returns it masked, so
    # letting tofu manage it would cause a perpetual diff.
    ignore_changes = [configuration[0].secret]
  }
}

# pr-bot webhook — feeds the temporal worker's GitHub event bridge in
# packages/temporal/src/event-bridge/github-webhook.ts. The HMAC secret on
# both ends is GITHUB_WEBHOOK_SECRET, sourced from 1Password by the worker
# pod; tofu does not mirror it.
#
# ROLLOUT ORDERING — the `push` event in this list ships the
# ci/merge-conflict check feature. Do NOT `tofu apply` it until BOTH:
#   (1) the temporal worker pod is running the new activity
#       (i.e. the merge-conflict-check PR has merged and ArgoCD has rolled
#       out the new image), and
#   (2) the one-off `kind: "all-prs"` workflow has run in Temporal to
#       backfill statuses on every currently-open PR.
# Same constraint as the `ci/merge-conflict` required check in
# rulesets.tf — both should be applied together, after backfill.
# See packages/docs/plans/2026-06-14_pr-merge-conflict-check.md.
import {
  to = github_repository_webhook.pr_bot
  id = "monorepo/616025071"
}

resource "github_repository_webhook" "pr_bot" {
  repository = github_repository.monorepo.name

  configuration {
    url          = "https://pr-bot.sjer.red/webhook"
    content_type = "json"
    insecure_ssl = false
  }

  active = true
  events = ["pull_request", "push"]

  lifecycle {
    # GITHUB_WEBHOOK_SECRET lives in 1Password and is synced to the worker
    # pod; the GitHub API returns it masked, so letting tofu manage it would
    # cause a perpetual diff.
    ignore_changes = [configuration[0].secret]
  }
}
