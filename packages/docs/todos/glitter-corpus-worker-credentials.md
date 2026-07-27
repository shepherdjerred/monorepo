---
id: glitter-corpus-worker-credentials
type: todo
status: awaiting-human
board: true
verification: human
disposition: active
origin: packages/docs/logs/2026-07-26_pr-1700-glitter-shared-context.md
source_marker: false
---

# Wire Glitter corpus/context credentials into the Temporal worker

PR #1700 (`feature/glitter-shared-context`) adds two Temporal schedules —
`glitter-corpus-daily` and `glitter-context-refresh-weekly`
(`packages/temporal/src/schedules/register-schedules.ts`) — that declare a
`requiredEnvironment` of Glitter Discord + mirrored-corpus storage credentials.
`buildScheduleState` (`packages/temporal/src/schedules/schedule-state.ts`)
fail-safes correctly: while any required var is missing the worker registers
both schedules **paused** with the note
`Paused automatically until required Glitter corpus credentials are configured`,
so nothing runs mis-configured.

Codex flagged (PR #1700, P1) that the deployed worker
(`packages/homelab/src/cdk8s/src/resources/temporal/worker.ts`) supplies none of
these vars, so the schedules stay permanently "unconfigured" and can never reach
the operator-approval pause state, even after the fields are added to 1Password.

This step is **operator-blocked**: wiring the vars as required secret refs makes
`check:1password` fail until the 12 fields exist in the `temporal-temporal-worker-1p`
1Password item, and the repo policy forbids `optional: true` secrets
(`packages/homelab/AGENTS.md` "No optional secrets — fail fast"). Populating them
needs the real Glitter Discord bot token, guild id/slug, denylist channel ids, and
the SeaweedFS/S3 + Cloudflare R2 corpus credentials — values only the operator has.

## Human Verification

All remaining work is operator-gated (1Password provisioning + deploy):

1. Add these 12 fields to the `temporal-temporal-worker-1p` 1Password item with
   real values:
   - `GLITTER_DISCORD_TOKEN`
   - `GLITTER_DISCORD_GUILD_ID`
   - `GLITTER_DISCORD_GUILD_SLUG`
   - `GLITTER_DISCORD_DENYLIST_CHANNEL_IDS`
   - `GLITTER_CORPUS_S3_ENDPOINT`, `GLITTER_CORPUS_S3_BUCKET`,
     `GLITTER_CORPUS_S3_ACCESS_KEY_ID`, `GLITTER_CORPUS_S3_SECRET_ACCESS_KEY`
   - `GLITTER_CORPUS_R2_ENDPOINT`, `GLITTER_CORPUS_R2_BUCKET`,
     `GLITTER_CORPUS_R2_ACCESS_KEY_ID`, `GLITTER_CORPUS_R2_SECRET_ACCESS_KEY`
2. Refresh the vault snapshot:
   `cd packages/homelab/src/cdk8s && bun run scripts/snapshot-1password-vault.ts`
   and commit `onepassword-vault-snapshot.json`.
3. Wire a `glitterCorpusEnv(secret)` block (`requiredSecretEnv(secret, [...])` of
   the 12 keys) into the worker container env in `worker.ts`, spread alongside
   `homelabAuditEnv(secret)`. Confirm `check:1password` passes.
4. After deploy, confirm both schedules transition from the
   "credentials-configured" pause note to their `initialPauseNote`
   (operator-approval) state, then unpause in the Temporal UI when ready.

## Comment Log

- 2026-07-26 — Filed from PR #1700 review (Codex P1 "Wire the required corpus
  credentials into the worker"). Code wiring was drafted and verified to fail
  `check:1password` because the 1P fields do not yet exist; reverted to keep CI
  green. Schedules already fail-safe (auto-paused as unconfigured).
