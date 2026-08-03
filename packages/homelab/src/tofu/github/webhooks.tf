################################################################################
# Repository webhooks for shepherdjerred/monorepo.
#
# Two hooks pre-existed in the repo settings before tofu adopted them:
#   * the Buildkite webhook that drives CI builds, and
#   * the temporal worker's pr-bot webhook (the receiver in
#     packages/temporal/src/event-bridge/github-webhook.ts).
#
# INCIDENT (2026-07-31): both hooks were brought under tofu via a
# `terraform import`, which populates state's `configuration.secret` from a
# GitHub Read -- and GitHub's API ALWAYS echoes back the literal masked
# placeholder "********" for that field, never the real value. Both
# resources had `lifecycle { ignore_changes = [configuration[0].secret] }`
# to avoid a perpetual diff on that placeholder -- but ignore_changes only
# suppresses *diff display*; it does not stop tofu from resending that
# placeholder as part of the full `configuration` PATCH payload whenever
# ANY OTHER attribute on the resource changes. PR #1863 changed pr_bot's
# `events` list; the resulting apply resent the whole `configuration`
# block including the literal "********", and GitHub accepted it as the
# new real secret -- silently breaking the live webhook's HMAC
# verification for ~ a day before it was noticed via a PagerDuty alert
# and a required-status-check outage. Confirmed root cause via live HMAC
# verification against a real GitHub delivery.
#
# Fix: neither resource's secret is knowable by tofu (both are owned by the
# receiving end -- 1Password for pr_bot, Buildkite for buildkite), so tofu
# has no business ever writing to that field again. Both resources are now
# frozen with `lifecycle { ignore_changes = all }`, which stops tofu from
# resending ANY attribute -- not just the secret -- on a future apply. See
# each resource's comment below for the break-glass procedure to make a
# legitimate change to url/events/active.
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
    # BREAK-GLASS -- read before touching this resource.
    #
    # Buildkite (not tofu) generates and owns this webhook's real HMAC
    # secret; tofu never learns its value. `ignore_changes = all` freezes
    # this resource against ANY future Update: even a single unrelated
    # field change (events, active, url) would otherwise force tofu to
    # reconstruct the full `configuration` object for the PATCH request
    # from state, which holds the literal masked placeholder "********"
    # captured at this resource's original `import {}` -- GitHub accepts
    # that literal string as a real secret write, corrupting the live
    # webhook. This is exactly the bug that broke pr_bot on 2026-07-31
    # (see the file header above) -- pr_bot gets the identical treatment
    # below.
    #
    # To make a legitimate change to url/events/active on this resource:
    #   1. Make the change directly via the GitHub repo Settings ->
    #      Webhooks UI (or API), OUTSIDE tofu. Do NOT touch tofu state.
    #   2. Optionally update this file's literal `url`/`events` values to
    #      match, for human-readability only -- with `ignore_changes =
    #      all` in place, tofu will never plan a diff for this resource
    #      regardless of whether this file's text matches live reality,
    #      so step 2 has zero enforcement value beyond documentation.
    #   3. Never remove this lifecycle block just to push an unrelated
    #      field change through tofu -- that reproduces the incident.
    ignore_changes = all
  }
}

# pr-bot webhook — feeds the temporal worker's GitHub event bridge in
# packages/temporal/src/event-bridge/github-webhook.ts. The HMAC secret on
# both ends is GITHUB_WEBHOOK_SECRET, sourced from 1Password by the worker
# pod; tofu does not mirror it (see the file header above for why this
# resource is frozen with `ignore_changes = all`, same as buildkite).
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
  # `push` drives the main-branch merge-conflict backfill and `pull_request`
  # drives the per-PR merge-conflict check + PR-closed Buildkite build
  # cancellation. (The former `issue_comment` subscription drove the removed
  # PR babysitter and is no longer needed.)
  events = ["pull_request", "push"]

  lifecycle {
    # See buildkite's lifecycle block above for the full incident writeup
    # and break-glass procedure -- same fix, same reason: tofu never learns
    # this webhook's real secret, so no future apply may ever touch this
    # resource's `configuration` again, regardless of which field changed.
    ignore_changes = all
  }
}
