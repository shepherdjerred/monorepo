---
id: plan-2026-08-05-remove-repository-session-logs
type: plan
status: complete
board: false
---

# Remove repository session logs

## Summary

Delete all repository session journals and retire the policy that creates them.
This covers the former session-journal directory, embedded journal appendices,
and all supporting references and agent messaging. Do not rewrite Git history
or implement S3 backup in this change.

## Implementation

- Delete the repository session-log directory without preserving or
  reclassifying its contents.
- Strip existing `Session Log` appendices from non-log documents.
- Remove links, frontmatter origins, Temporal task blocks, commands, comments,
  and skills that point to the deleted logs.
- Remove the mandatory per-session artifact and structured-final-summary rules.
  Plans remain available when substantive design is itself a durable artifact.
- Remove the `log` docs-board document type and directory inference.
- Leave unrelated application, observability, and bot-runtime logs untouched.

## Verification

- Confirm no repository session-log directory, path references, `type: log`
  documents, embedded `Session Log` appendices, or creation mandates remain.
- Run `bun run check-todos`, focused docs-board checks, the affected Buildkite
  test, `git diff --check`, and the staged pre-commit checks.

## Out of scope

- Git history rewriting.
- S3 storage, search, and session-to-commit or PR mapping.
