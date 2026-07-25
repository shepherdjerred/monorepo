---
id: bugsink-s3-smoke-remediation
type: plan
status: in-progress
board: false
---

# Bugsink S3 and Smoke-Test Remediation

## Summary

- Scout has an active production defect: Unicode tracked-player aliases are
  copied into S3 user metadata, where they either fail Node header validation
  or cause a SeaweedFS signature mismatch. Authoritative ingestion then leaves
  the post-match cursor stalled and retries the same matches.
- The Discord Plays Pokemon and Mario Kart issues are CI smoke-test noise.
  Their image tests deliberately use dummy tokens while the production Bugsink
  DSNs remain enabled. Both production bots currently authenticate successfully
  with unchanged credentials.

## Implementation

- Replace new `trackedPlayers` S3 metadata with the ASCII decimal
  `trackedPlayerCount`.
- Read the new count first while retaining the old comma-separated metadata as
  a compatibility fallback for existing objects.
- Remove unconsumed player, reviewer, and personality display names from S3
  headers while keeping them in object bodies and application logs.
- Validate Scout S3 metadata as printable ASCII before issuing `PutObject`.
- Disable Bugsink inside both game image smoke containers by explicitly setting
  an empty `SENTRY_DSN`, without changing production-mode execution or the
  expected dummy-token authentication failure.
- Do not rotate userbot credentials or restart the healthy production bots.

## Verification

- Cover Unicode aliases, zero and multiple tracked players, the new metadata
  count, legacy fallback, malformed counts, and ASCII validation in tests.
- Run Scout backend tests, typecheck, and lint.
- Build and run both game Docker smoke tests.
- Run affected repository verification before publishing the PR.
- After deployment, verify Scout beta drains affected matches before promoting
  the lockstep backend/site release to production.
- Confirm the two Discord issues receive no new events after the next image
  smoke build, then resolve their historical Bugsink groups.

## Session Log — 2026-07-25

### Done

- Replaced Scout's Unicode `trackedPlayers` writes with the ASCII decimal
  `trackedPlayerCount`, retained a legacy metadata reader, and removed
  unconsumed display names from S3 headers.
- Added printable-ASCII validation to Scout's direct S3 metadata writes and
  covered the contract with storage tests, including Unicode aliases and
  legacy objects.
- Disabled Bugsink only inside the Pokemon and Mario Kart image smoke
  containers while preserving their expected dummy-token authentication
  failures.
- Passed 126 Scout storage tests, Scout typecheck and lint, both game-package
  typecheck and lint tasks, and the affected repository verification surface.
- Built both production Docker images locally and passed their real container
  smoke tests.
- Published commit `17cbcb657` and draft PR #1633.

### Remaining

- [ ] Perform post-deploy beta and Bugsink verification.
- [ ] Promote the lockstep Scout backend/site release only after beta drains the
      affected matches.
- [ ] Resolve the historical Bugsink groups after the deployed fixes produce no
      recurrences.

### Caveats

- Production promotion follows Scout's existing lockstep promotion workflow and
  must wait for a clean beta verification.
- No live deployment, production restart, credential rotation, or Bugsink issue
  mutation was performed in this session.
