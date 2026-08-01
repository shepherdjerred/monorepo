---
id: codex-security-scan-review
type: log
status: complete
board: false
---

# Codex Security Scan Review — 2026-07-31

Reviewed the sealed codex-security plugin scan at
`~/.codex/state/plugins/codex-security/scans/monorepo/codex-security-monorepo-O3Hhz1`
(scan id `1da40220-4ac3-4ccb-865a-e398640d81c4`, plugin v0.1.14, target = main @
`605c40e963332bf38efa90da5e5bea32e2680e2d`, ran 2026-07-30 22:29 → 2026-07-31 02:06 PT).

Static repository analysis only — no live systems exercised. 20,122 files
inventoried, 17,197 semantically reviewed, 131 candidates normalized to **40
findings: 6 high, 13 medium, 21 low**. Artifacts: `findings.json`,
`coverage.json`, `report.md` (~500 KB), `exports/results.sarif`, plus threat
model and coverage ledgers under `artifacts/`.

## High findings (all high confidence)

1. **Temporal report-only agent tasks are prompt-enforced only** — Claude-provider
   tasks keep Bash + broad worker secrets (GitHub, LLM, HA, S3, Postal, Talos)
   despite "report-only" mode being a schema/prompt convention
   (`packages/temporal/src/activities/agent-task-command.ts`).
2. **Birmel shell tool = unrestricted host exec for the LLM agent by default**
   (`packages/birmel/src/agent-tools/tools/automation/shell.ts:54`).
   3–6. **Birmel Discord tools don't bind targets to the request guild** — channels,
   messages, moderation, roles tools all accept arbitrary guild/channel IDs, so a
   request (or injected model context) in one guild can act in any guild the bot
   is in.

## Medium/low themes

- Birmel PinchTab browser: process-global tab cookies exposure, screenshot path
  traversal, arbitrary-URL navigate/open (SSRF-ish), editor `allowedPaths`
  ignored for Claude SDK Edit/Write, OAuth state = caller-chosen Discord ID (no
  nonce), OAuth error reflection XSS (low).
- Discord Plays Pokemon / Mario Kart: unauthenticated Socket.IO input control +
  screenshot-render DoS vectors.
- Scout: voice-channel join not bound to requester's guild membership; desktop
  heartbeat/config mutations not owner-bound; sound-pack URL/S3/yt-dlp inputs
  under-validated (9 low findings, 3 sinks × create/import/update).
- CI: mise installer curl'd unpinned in secret-bearing jobs; unpinned Python
  packages resolved in the verify pod.

## Coverage caveats

`completeness: partial`. 11 deferred items — nearly all "live Buildkite
fork-build/trigger/approval/secret-injection policy" could not be verified from
the repo alone; one asks for an immutable-identity check on the TeX Live image.

## Session Log — 2026-07-31

### Done

- Parsed manifest, findings.json, and coverage.json; summarized all 40 findings
  by severity to the user with locations and remediation themes.

### Remaining

- No remediation performed (review-only session). If acting on it, the highest-
  leverage fixes are: guild-binding the four Birmel Discord tools, gating the
  Birmel shell tool, and real enforcement for Temporal report-only mode.

### Caveats

- Findings are static-analysis claims, not verified exploits; several assume an
  allowlisted-user or prompt-injection precondition. Live Buildkite policy was
  out of scope for the scanner and remains unverified.
