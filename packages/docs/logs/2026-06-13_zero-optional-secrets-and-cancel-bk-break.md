# Zero optional secrets — and the cancel-Buildkite-on-merge break it exposed

## Status

In Progress (code shipped as PR #1163; blocked on 1P field population before deploy)

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
