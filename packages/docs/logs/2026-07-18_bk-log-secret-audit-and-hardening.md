# Buildkite log secret audit + leak-prevention hardening

## Status

In Progress

## Context

While triaging main CI, a `ghs_` GitHub App token was spotted in the public
`cooklang plugin publish` step log (build 5656). That prompted a full audit of
every Buildkite job log from the last 7 days and a set of CI-layer controls so a
script bug can't leak a secret to a world-readable log again.

## Audit — what was scanned

- 448 builds in the window (from 2026-07-11); **13,232 executed-job logs**
  (states passed/failed/canceled/timed_out; `broken`/`skipped`/`waiting_failed`
  never ran a command so can't leak).
- Throttled to Buildkite's 200-req/min REST limit, streamed (no full persist),
  ~15 secret-detection rules (GitHub/AWS/Slack/npm/JWT/private-key/basic-auth/…).
- Scan artifacts live in the session scratchpad (not committed).

## What leaked (6 distinct secrets) + liveness

| Secret                               | Count | Source                                                                                        | Liveness                                                      |
| ------------------------------------ | ----- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| GitHub App tokens (`ghs_…`)          | 8     | minted at runtime, echoed in `cooklang plugin publish` (7) + `release-please commit-back` (1) | **DEAD** — expired (~1h TTL)                                  |
| FontAwesome npm `_authToken`         | 1     | `sandbox/archive/herd/web/.npmrc` (committed 2022)                                            | **DEAD** — 401                                                |
| AWS access-key IDs (`AKIA…`)         | 3     | `sandbox/archive/*/.travis.yml`                                                               | ID-only; secret is Travis-`secure:` encrypted (never exposed) |
| Minecraft `management-server-secret` | 2     | `config/minecraft-{shuxin,sjerred}/server.properties`                                         | feature **disabled** (`enabled=false`, `port=0`) — inert      |
| Firebase web `apiKey`                | 1     | `packages/temporal/src/activities/fetcher.ts` (Skill Capped)                                  | ALIVE but **public-by-design** third-party client key         |

**Net: zero currently-usable secrets of ours are alive.** All 5 config-file
secrets were already **allowlisted in `.gitleaks.toml`** as benign — so the
existing gitleaks gate was working as configured. The exposure came from
**semgrep** (no allowlist) re-printing those flagged lines into a **public**
pipeline log.

## Root cause of the `ghs_` leak

`packages/temporal/src/lib/github-app-token.ts` prints the minted token to
stdout (by design). `scripts/lib/github-auth.ts` mints via
`run([...], { capture: true })` — but `scripts/lib/run.ts` **unconditionally
re-echoed captured stdout** back to the parent, re-emitting the token into the
log. Buildkite's static redaction can't catch it (runtime-minted, not a
job-start env var).

## Controls added (this PR — one change, 4 layers)

- **Layer 0 — pipeline private.** `pipeline.tf`: `visibility = "PRIVATE"`
  (managed so a UI toggle can't drift it back). Removes the public audience for
  all logs. Highest leverage.
- **Layer 1 — runtime redaction + root-cause fix.** `run.ts` gains a `quiet`
  option (suppresses the captured-stdout echo); `github-auth.ts` mints with
  `quiet: true` and calls `buildkite-agent redactor add` on the token so the
  agent scrubs it from the log even if echoed later. Single choke point —
  covers all 3 callers (release / update-versions / cooklang publish).
- **Layer 2 — static env redaction.** `buildkite.ts`: widen
  `BUILDKITE_REDACTED_VARS` on the agent (adds `*_ACCESS_KEY_ID`,
  `*_PRIVATE_KEY`, `*_AUTH_TOKEN`, `GH_TOKEN`, …). Backstop only (redacts values
  the agent process sees).
- **Layer 3 — stop semgrep re-printing benign secrets.** `pipeline.yml`:
  semgrep `--exclude sandbox --exclude server.properties --exclude fetcher.ts`,
  mirroring the `.gitleaks.toml` allowlist.

## Remaining / follow-ups

- **Operator:** flip pipeline visibility to Private in the UI now for instant
  effect (then `tofu -chdir=buildkite apply` makes it managed). Rotate the
  Minecraft `management-server-secret` values and deactivate the 2022 AWS key
  IDs in IAM as hygiene (both low-risk: disabled feature / encrypted secret).
- **Verify on next build:** confirm `buildkite-agent redactor` is present in the
  step container (agent-stack-k8s injects the agent CLI; command exists in
  agent ≥ v3.68) and that Layer 2 redaction actually masks agent-visible vars.
- Consider purging the committed secrets from `sandbox/archive` history.
