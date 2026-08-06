---
id: log-2026-08-05-agent-work-history-research
type: log
status: complete
board: false
---

# Agent Work History Research

Research durable, external approaches for retaining agent work history and
linking related work across sessions without storing journals in the codebase.

## Session Log — 2026-08-05

### Done

- Researched native Claude Code and Codex transcript/session interfaces,
  retention behavior, lifecycle hooks, and programmatic search surfaces.
- Compared Entire CLI v0.9, dkod, Agent Sessions, Chronicle, and relevant
  transcript-plus-Git research against the requirement for durable evidence and
  deterministic commit provenance.
- Designed an authoritative vendor-neutral model: client-side-encrypted native
  transcript objects, append-only typed session/commit and correction events,
  and a disposable local SQLite FTS5 search projection.
- Recommended Entire only as a bounded redacted browsing/candidate-link pilot,
  not as the sole archive, because concurrent sessions can be falsely co-linked,
  redaction failure can omit transcript content, and hosted search is vendor
  data processing.
- Produced Markdown, Typst, and PDF reports under
  `~/.claude-extra/research/durable-agent-conversation-history.*`; compiled the
  PDF and verified all 41 cited URLs returned HTTP 200.
- Incorporated an adversarial review covering false provenance, correction
  events, Git backend/version drift, hosted search privacy, rewrite/squash
  behavior, remote-sync failure, and Codex preview compatibility.

### Remaining

- None. Installing or exercising Entire and implementing the independent archive
  were outside this research-only session.

### Caveats

- No product was installed and no transcript was uploaded. Entire's capture,
  restore, malformed-transcript, concurrency, rewrite, worktree, squash,
  checkpoint-sync, and correction behavior remains an explicit pilot matrix.
- Entire and agent hook implementations are moving quickly; the report pins v0.9
  documentation and a source snapshot where behavior matters.
- The default Claude Code history root was not present on this machine, so a
  pilot must first locate or configure the actual Claude transcript source.
