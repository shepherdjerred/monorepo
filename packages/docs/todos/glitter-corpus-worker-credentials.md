---
id: glitter-corpus-worker-credentials
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/logs/2026-07-26_pr-1700-glitter-shared-context.md
source_marker: false
---

# Complete quota-gated Glitter context refresh acceptance

The Discord and SeaweedFS credentials are provisioned in 1Password, wired into
the deployed Temporal worker, and covered by the committed non-secret vault
snapshot. The trusted seed, full backfill, daily capture, recovery verification,
and observability gates all pass. `glitter-corpus-daily` is active in production.

The remaining credential boundary is the Temporal worker's existing
`OPENAI_API_KEY`. The fixed-time, snapshot-pinned production dry run reached the
generation activity, but both configured attempts failed closed on OpenAI HTTP
429 `insufficient_quota`. The worker credential is intentionally distinct from
the Birmel and Pokémon credentials.

## Remaining

- [ ] Restore quota for the OpenAI project used by the Temporal worker, or
      explicitly authorize a different production OpenAI credential for this
      workflow.
- [ ] Rerun the fixed-time dry run twice against snapshot
      `dbb59f00-3f6b-4cab-a87c-6d8a65e21d62` at SHA-256
      `e4253d203408efe65f4ad4199ccaebf3c83df68a182ce816865f6abc43837ff9`
      and require complete output equality.
- [ ] Run the real refresh with the same pin, inspect its sole PR or no-diff
      result, and smoke-test the shared package, Birmel, Scout, and Glitter
      consumers.
- [ ] Unpause `glitter-context-refresh-weekly` only after those acceptance
      gates pass, then complete and archive this TODO and the live rollout plan.

## Comment Log

- 2026-07-26 — Filed from PR #1700 review (Codex P1 "Wire the required corpus
  credentials into the worker"). Code wiring was drafted and verified to fail
  `check:1password` because the 1P fields do not yet exist; reverted to keep CI
  green. Schedules already fail-safe (auto-paused as unconfigured).
- 2026-07-29 — Discord and SeaweedFS credentials, worker wiring, deployment,
  seed, backfill, daily schedule, recovery, and observability are complete.
  Removed obsolete R2 and provisioning tasks. The only remaining operator
  boundary is OpenAI project quota; weekly refresh remains deliberately paused.
- 2026-07-29 — Re-audited the live Ready worker, ArgoCD application, and both
  schedules, then retried the exact fixed-time, snapshot-pinned dry run as
  workflow `glitter-context-refresh-manual-a3f6ec23-cb6d-45db-9766-f75009766b00`.
  Both configured attempts again reached OpenAI and failed closed on HTTP 429
  `insufficient_quota`; no branch, PR, or context mutation occurred.
