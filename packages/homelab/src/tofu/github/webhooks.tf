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
# verification for ~ a day before it was noticed via a monitoring alert
# and a required-status-check outage. Confirmed root cause via live HMAC
# verification against a real GitHub delivery.
#
# Fix: neither resource's secret is knowable by tofu (both are owned by the
# receiving end -- 1Password for pr_bot, Woodpecker for ci), so tofu
# has no business ever writing to that field again. Both resources are now
# frozen with `lifecycle { ignore_changes = all }`, which stops tofu from
# resending ANY attribute -- not just the secret -- on a future apply. See
# each resource's comment below for the break-glass procedure to make a
# legitimate change to url/events/active.
################################################################################

# The Buildkite webhook is no longer managed here.
#
# CI moved to Woodpecker, which registers its own webhook when a repository is
# activated in its UI -- there is nothing for tofu to declare.
#
# `removed` rather than a deletion: this drops the resource from state WITHOUT
# destroying the live webhook, because a webhook delivering to a still-active
# Buildkite account is what keeps the old pipeline able to run during the
# changeover. Delete it in GitHub by hand once the Buildkite subscription is
# cancelled.
removed {
  from = github_repository_webhook.buildkite

  lifecycle {
    destroy = false
  }
}

# pr-bot webhook — feeds the temporal worker's GitHub event bridge in
# packages/temporal/src/event-bridge/github-webhook.ts. The HMAC secret on
# both ends is GITHUB_WEBHOOK_SECRET, sourced from 1Password by the worker
# pod; tofu does not mirror it (see the file header above for why this
# resource is frozen with `ignore_changes = all`).
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
    # BREAK-GLASS -- read the file header for the full incident writeup.
    # tofu never learns this webhook's real secret, so no future apply may
    # ever touch this resource's `configuration` again, regardless of which
    # field changed: state holds the masked placeholder "********" captured
    # at import, and GitHub accepts that literal string as a real secret
    # write, corrupting the live webhook. This is the bug that broke pr_bot
    # on 2026-07-31.
    ignore_changes = all
  }
}
