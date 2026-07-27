---
id: pr-review-tree-sitter-wasm-instability
type: todo
status: complete
board: false
origin: packages/docs/archive/completed/2026-05-30_temporal-workflow-remediation.md
source_marker: false
---

# PR review tree-sitter WASM instability

Temporal worker logs once showed repeated `web-tree-sitter` out-of-bounds
errors while building symbol indexes and block diffs.

## Supersession Evidence

- The current symbol index creates and deletes a parser per file and catches a
  file-level parse failure without retaining parser state.
- The in-repo PR-review bot is disabled in production through
  `PR_BOT_ENABLED=false`; the required review gate uses the external active
  provider rather than this symbol index.
- No current incident or active production path justifies retaining a board
  item for the historical WASM failure signature.

## Comment Log

### 2026-07-27 — in-progress board audit

- Archived as obsolete. A new reproducible parser incident should be filed
  from current evidence rather than reopening this historical symptom card.
