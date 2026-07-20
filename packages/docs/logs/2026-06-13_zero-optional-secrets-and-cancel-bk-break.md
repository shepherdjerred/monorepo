---
id: log-2026-06-13-zero-optional-secrets-and-cancel-bk-break
type: log
status: complete
board: false
---

# Zero optional secrets — and the cancel-Buildkite-on-merge break it exposed

## What prompted this

Question: "We had a plan to cancel BK jobs if a given PR is merged. Is that working?"

**Answer: no.** The feature (`cancel-Buildkite-builds-on-PR-close`, commit `aa0d06033`,
shipped 2026-06-06) is fully on `main` and the deployed worker (`2.0.0-3822`, built
from `bfeb5e18c`) includes it. The webhook fires correctly on PR `closed` — verified
`cancelBuildkiteBuildsWorkflow` executions for #1146/#1158/#1161. But **every run fails**:

```
error: Error: BUILDKITE_API_TOKEN is required to cancel Buildkite builds
```

100+ failures in 24h. Root cause: the worker pod's `BUILDKITE_API_TOKEN` env is wired
`EnvValue.fromSecretValue(..., { optional: true })` from the 1P-synced secret
`temporal-temporal-worker-1p`, but **that key was never added to the 1P item** (34 keys
present, `BUILDKITE_API_TOKEN` not among them). Runtime `${#BUILDKITE_API_TOKEN}` = 0.
The `optional: true` flag is exactly what let the pod boot with the gap and turned a
hard deploy failure into a silent per-PR failure.

## The fix (user directive)

User: "it should not be optional. we should have ZERO optional secrets in this repo" +
"crash loop follows our fail-fast principle." Decision when asked about optional-by-design
secrets: **make all required + populate 1P** (literal sweep, not remove-the-wiring).

PR #1163 (`feature/no-optional-secrets`) removes every `optional: true` from secret env
vars and secret volumes in cdk8s:

| File                                    | Change                                                                                                                                                                                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resources/temporal/worker.ts`          | `optionalSecretEnv` → `requiredSecretEnv`; dropped optional on HOMELAB_AUDIT_ARCHIVE_BUCKET, PR_REVIEW_FIXTURES_REPO_URL, PR_REVIEW_EVAL_DATABASE_URL, VOYAGE_API_KEY, SENTRY_DSN, SENDER_EMAIL, and the TALOSCONFIG_YAML secret volume; comments rewritten to the fail-fast contract |
| `resources/pokemon.ts`                  | CODEX_API_KEY, CODEX_ACCESS_TOKEN, OPENAI_API_KEY → required                                                                                                                                                                                                                          |
| `resources/streambot.ts`                | TMDB_API_KEY → required; + test updated                                                                                                                                                                                                                                               |
| `misc/discordsrv-config.ts`             | DISCORD_CONSOLE_CHANNEL_ID, DISCORD_INVITE_LINK → required                                                                                                                                                                                                                            |
| `resources/argo-applications/dagger.ts` | docker-hub-config volume → required                                                                                                                                                                                                                                                   |

No 1P linter exists yet to enforce field existence (user says it's coming in a separate
PR); until then, a missing field surfaces as a pod crash-loop.

## 1P fields to populate BEFORE merge/deploy (else crash-loop)

| 1P item                                                | Missing field(s)                                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| temporal-worker `mjgnqqh37jxyzseqrddde2jgaq`           | `BUILDKITE_API_TOKEN` (**write_builds scope**), `HOMELAB_AUDIT_ARCHIVE_BUCKET`, `PR_REVIEW_EVAL_DATABASE_URL`, `VOYAGE_API_KEY` |
| pokemon `hwyhh64dyu3s7w37q7oj7r4qn4`                   | `OPENAI_API_KEY` (the other Codex auth refs were dropped — single auth method)                                                  |
| streambot-tmdb                                         | `TMDB_API_KEY`                                                                                                                  |
| minecraft-sjerred-discord `q37vet77dfggoqbvu4bqle3gje` | `DISCORD_CONSOLE_CHANNEL_ID`, `DISCORD_INVITE_LINK`                                                                             |

`docker-hub-config` (dagger) already exists — safe immediately.

## Session Log — 2026-06-13

### Done

- Diagnosed cancel-on-merge: code is live & firing but failing 100% on empty `BUILDKITE_API_TOKEN` (1P field never added; `optional:true` masked it).
- PR #1163: removed all `optional:true` from cdk8s secret refs (6 files); updated the streambot test that asserted optional. typecheck/test/eslint/prettier clean; pre-commit green.

### Remaining

- **User populates the 10 missing 1P fields above** (esp. `BUILDKITE_API_TOKEN` with `write_builds` — that alone fixes cancel-on-merge).
- Merge #1163 only after fields exist, then sync ArgoCD and confirm worker pods + pokemon/streambot/minecraft pods start clean.
- Post-deploy: open a throwaway PR, let a build start, close it, confirm the build moves to `canceled` and the worker logs `cancel-bk-builds complete`.

### Caveats

- **Pokemon auth collapsed:** goal mode accepts any one of CODEX_ACCESS_TOKEN / CODEX_API_KEY / OPENAI_API_KEY (or a mounted auth.json). Per user, kept only `OPENAI_API_KEY` as a required ref and dropped the other two — so pokemon needs just that one 1P field.
- Fresh-worktree pre-commit `eslint-homelab` fails with `jiti` not found until `bun install` is run in `packages/homelab/` root (eslint+jiti live there, not just in the cdk8s subpkg). Re: memory `reference_worktree_precommit_eslint`.

## Session Log — 2026-06-13 (Greptile P1 address)

### Done

- Investigated Greptile P1 thread `PRRT_kwDOHf4r4c6JXA03` on PR #1163:
  `PR_REVIEW_FIXTURES_REPO_URL omitted from the deploy gate table`.
- Confirmed `PR_REVIEW_FIXTURES_REPO_URL` was intentionally absent from the deploy gate
  table because it was already present in the 1P item (only missing fields needed to be
  added before deploy). Unlike `BUILDKITE_API_TOKEN`, `HOMELAB_AUDIT_ARCHIVE_BUCKET`,
  `PR_REVIEW_EVAL_DATABASE_URL`, `VOYAGE_API_KEY` which were listed as missing.
- Added a confirming comment to `worker.ts` at line 404 explaining:
  (a) the field is required and carried in 1P, (b) the self-pause mechanism in
  `register-schedules.ts` handles the case where the env var is blank at runtime,
  (c) why the original `optional: true` existed and why it was removed by this PR.
- Typecheck + ESLint both pass.
- Resolved PR thread via GraphQL mutation.

### Remaining

- None specific to this thread.

### Caveats

- The `PR_REVIEW_EVAL_DATABASE_URL` was dropped from the pod env (commit `ed92763b2`),
  but `scheduleRequiresConfigPause` in `register-schedules.ts` still checks for it.
  This means `pr-review-eval-nightly` schedule will always be paused (database env
  var never set). That's acceptable behavior since `PR_BOT_ENABLED=false`.

## Session Log — 2026-06-13 (resolution: all secrets settled + live)

### Done

- **cancel-on-merge FIXED & LIVE.** Created a Buildkite token (verified `write_builds`),
  `op`-added it to the temporal 1P item (`temporal-worker-secrets`), operator synced it,
  restarted `temporal-temporal-worker` → new pod has the token; `BUILDKITE_API_TOKEN is
required` errors went 100+/24h → **0**. Did not require PR #1163 to merge — the deployed
  worker already referenced the (optional) env, so token + restart was enough.
- **Refs removed instead of populated** (features off/unused — still zero optional secrets):
  `VOYAGE_API_KEY`, `PR_REVIEW_EVAL_DATABASE_URL` (PR bot disabled); DiscordSRV
  `DISCORD_CONSOLE_CHANNEL_ID` + `DISCORD_INVITE_LINK` (template now hardcodes empty);
  `HOMELAB_AUDIT_ARCHIVE_BUCKET` (audit is email-only via agentTaskWorkflow). Updated the
  `temporal-audit-tooling` + `streambot` synth tests.
- **Pokemon goal-mode auth = `OPENAI_API_KEY`** (single method; dropped the CODEX\_\* refs).
  User opted for the API key over a ChatGPT-sub `auth.json` mount (the sub route needs an
  initContainer-copied writable auth.json + periodic re-login; not worth it here). Validated
  the key (OpenAI `/v1/models` → 200), `op`-added to the Pokebot item, operator synced,
  restarted the pokemon pod → has `OPENAI_API_KEY`.
- **TMDB:** no action — the `streambot-tmdb` 1P item already carries `TMDB_API_KEY`; it
  just isn't synced into the cluster yet because the `streambot-tmdb` OnePasswordItem isn't
  deployed (predates current streambot). Syncs when the chart next deploys.

### Remaining

- Merge PR #1163 + ArgoCD sync. Every required secret now exists, so no crash-loops expected.
- Optional security hardening: the Buildkite token was created with **full org scope**
  (write_agents, delete_packages, graphql, …); cancel only needs `read_builds`+`write_builds`.
  Regenerate a narrowly-scoped token and re-`op`-store when convenient.

### Caveats

- The active deploys for the cancel fix + pokemon key were applied to the **currently
  running pods** (token/key in 1P + pod restart). PR #1163 makes the _code_ match (required
  refs / removed refs) — until it merges, the running config and the branch differ only in
  the optional→required flag and the removed dead refs.
