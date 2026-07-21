---
id: pr-review-tree-sitter-wasm-instability
type: todo
status: in-progress
board: true
verification: agent
disposition: active
origin: packages/docs/archive/completed/2026-05-30_temporal-workflow-remediation.md
source_marker: false
---

# PR review tree-sitter WASM instability

## What

Temporal worker logs showed repeated `web-tree-sitter` out-of-bounds memory errors while building symbol indexes and block diffs. The current code falls back, but the review loses useful structure.

## Remaining

- [ ] Symbol indexing isolates or reinitializes parser state so one parse failure cannot poison later files.
- [ ] Block-diff fallback emits enough metadata to measure how often structured parsing is unavailable.
- [ ] Tests cover a parser failure followed by a successful parse in the same workflow process.
