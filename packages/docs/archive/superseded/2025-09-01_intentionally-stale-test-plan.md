# Intentionally Stale Plan (docs-groom verification fixture)

## Status

Not Started (2025-09-01). This plan was filed eight months ago and
has had no activity since. If you are reading this in May 2026 or
later, the plan is overdue for re-triage.

## Context

This plan exists solely to give the daily docs-groom workflow a
clearly-stale doc to detect, so the end-to-end PR-creation path is
verifiable on demand. The workflow's audit prompt should classify
this as `status-rot` (an old `Not Started` Status that hasn't moved)
or `stale` (the plan describes work that obviously isn't being done).
A child workflow should then either move this file to
`archive/superseded/` or update the Status section.

## Plan

1. Do nothing. The presence of this file is the entire test.
2. When docs-groom opens a PR archiving or updating this doc, the
   end-to-end verification is complete and this file (or its archived
   sibling) can be deleted by hand.

## Why this is safe to land

- It's purely a docs file under `packages/docs/plans/`.
- It cannot affect runtime behavior of any service.
- It will be cleaned up by docs-groom itself, by design.
