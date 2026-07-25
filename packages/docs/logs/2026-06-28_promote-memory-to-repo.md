---
id: log-2026-06-28-promote-memory-to-repo
type: log
status: complete
board: false
---

# Promote personal MEMORY.md knowledge into shared repo config

## Context

Follow-on to the 2026-06-28 Claude effectiveness audit. Personal Claude `MEMORY.md`
(140 entries, in `~/.claude`) held a lot of broadly-useful repo knowledge gated behind
personal-memory recall. This session promoted the durable, broadly-useful entries into the
repo's version-controlled surfaces (`CLAUDE.md`/`AGENTS.md`, repo-local skills, `packages/docs/`)
so every agent and collaborator gets them.

## Method

A background workflow (`promote-memory-to-repo`) fanned out ~11 cluster agents to classify
each in-scope memory against the **durable** repo surfaces (a `SKILL.md`/`references/`, a
package `AGENTS.md`, or `docs/{architecture,patterns,decisions,guides}` — mentions in
`plans/logs/todos/archive` don't count), then a per-destination-file agent integrated the
additions in-voice. Placement rule: rule → AGENTS.md, how-to → skill, runbook/decision → docs.

## Outcome

112 in-scope memories: **93 promoted**, 16 already covered durably, 3 skipped (stale/too-specific).

- **root `CLAUDE.md`** — new "Engineering Principles" section (no-type-assertions, fail-fast,
  fix-don't-ignore, verify-before-asserting, contract-violations-fail-loudly, etc.).
- **package `AGENTS.md`** — homelab, scout-for-lol, temporal, streambot,
  discord-plays-mario-kart; new `discord-plays-pokemon/AGENTS.md`.
- **skills** (`packages/dotfiles/dot_agents/skills/`) — git-helper, worktree-workflow,
  version-management, dagger-helper, buildkite-helper, sentry-helper, talos-helper,
  torvalds-deployment, storage-backup, op-helper, helm-types-gen, bun-test-patterns,
  bugsink-helper, pinchtab-helper, chezmoi-helper.
- **packages/docs** — 13 new guides + 1 decision (homelab security hardening); `index.md` updated.

Skipped as not durable/worth promoting: `bun-sharp-dvs-patch` (stale — dpp migrated to the
in-repo dvs rewrite), `ci-only-error-typed-duration-ms` (one-off), `agent-hooks-cc-codex`
(version-pinned tooling that stales fast).

## Session Log — 2026-06-28

### Done

- Workflow-classified + integrated 93 memory entries across 38 files (PR: feature/promote-memory).
- Fixed pre-commit blockers: MD037 (`*arr` emphasis) and env-var-names (a banned
  `…_API_TOKEN` literal in prose → reworded). markdownlint/prettier clean; commit hooks green.

### Remaining

- Merge the PR.
- After merge (or after push), clean the promoted/already-covered entries out of personal
  `MEMORY.md` so it shrinks to the personal/transient layer (separate `~/.claude` change).
- `chezmoi apply` to render the updated skills into `~/.agents/skills`.

### Caveats

- Skill `SKILL.md` files are excluded from markdownlint/prettier in this repo, so their
  formatting wasn't auto-checked (content reviewed manually).
- `BUILDKITE_API_TOKEN` / `CLOUDFLARE_API_TOKEN` appear in prose — these are real upstream
  env var names and are NOT flagged by the env-var-names hook (only internal aliases in the
  `<SERVICE>_API_TOKEN` form, e.g. the PagerDuty one, are banned in favor of `<SERVICE>_TOKEN`).
