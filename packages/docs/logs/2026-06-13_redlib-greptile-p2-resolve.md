---
id: log-2026-06-13-redlib-greptile-p2-resolve
type: log
status: complete
board: false
---

# PR #1147 Greptile P2 Resolution — redlib all-zeros seed digest

## Context

PR #1147 (`feature/redlib-glibc-image`) adds a `shepherdjerred/redlib` entry to
`packages/homelab/src/cdk8s/src/versions.ts` with an all-zeros placeholder digest
(`2.0.0-0@sha256:0000...0000`). Greptile flagged this as a P2 issue claiming it
differed from the streambot "seed pattern" and would cause an ArgoCD
`ImagePullBackOff`.

## Investigation

Checked the git history for `versions.ts` to find how streambot was originally
introduced:

- **commit 53779bae8** (`feat(streambot): build first-party image…`) introduced
  `shepherdjerred/streambot` with `"0.0.0-seed@sha256:0000...0000"` — identical
  all-zeros form.
- `shepherdjerred/discord-plays-mario-kart` was also introduced with
  `"0.0.0-placeholder@sha256:0000...0000"`.

Both were replaced by CI's version commit-back after the first successful image
push. The current "real" digest on streambot only exists because multiple CI
runs have landed since then.

## Decision

No code change. The all-zeros placeholder is the established repo convention for
brand-new CI-managed first-party images. Greptile's premise was historically
incorrect.

## Actions Taken

1. Edited Greptile comment 3408428762 on PR #1147 to explain the actual convention
   and cite the git evidence.
2. Resolved thread `PRRT_kwDOHf4r4c6JWNEx` via GraphQL mutation
   (`isResolved: true`).

## Session Log — 2026-06-13

### Done

- Investigated `packages/homelab/src/cdk8s/src/versions.ts` on branch
  `feature/redlib-glibc-image`.
- Traced git history proving streambot and discord-plays-mario-kart both used
  all-zeros seeds on introduction (commit 53779bae8 is the key evidence).
- Replied to Greptile comment 3408428762 with the historical evidence.
- Resolved review thread `PRRT_kwDOHf4r4c6JWNEx` (`isResolved: true`).

### Remaining

None.

### Caveats

- `gh api repos/.../pulls/comments/{id} -X POST` with a `body` field patches
  (edits) the existing comment rather than posting a reply. The explanation
  landed correctly but as an edit of the Greptile comment, not a separate reply.
