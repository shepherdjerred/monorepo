---
id: bugsink-open-issues-triage
type: log
status: complete
board: false
---

# Bugsink Open-Issue Triage

Read-only review of the live unresolved Bugsink issue set, including recent
events and stacktraces where needed to identify likely causes and priorities.

## Snapshot

At 2026-07-25 18:25 UTC, Bugsink had 34 unresolved issues across six projects,
representing 11,115 digested events:

| Project                  | Issues | Events | Latest event (UTC) |
| ------------------------ | -----: | -----: | ------------------ |
| Scout for LoL            |     26 | 10,804 | 2026-07-25 18:24   |
| Discord Plays Mario Kart |      1 |    155 | 2026-07-25 17:58   |
| Discord Plays Pokemon    |      1 |    140 | 2026-07-25 17:57   |
| Streambot                |      3 |      8 | 2026-07-25 04:25   |
| TaskNotes App            |      2 |      3 | 2026-07-25 02:32   |
| Temporal                 |      1 |      5 | 2026-07-21 08:50   |

## Triage

### Urgent: Scout S3 writes reject non-ASCII tracked-player aliases

Nineteen Scout issue groups are two symptoms of one current production bug:

- Seven `Invalid character in header content ["x-amz-meta-trackedplayers"]`
  groups, 948 events.
- Twelve `SignatureDoesNotMatch` groups, 698 events.

The current code joins display aliases directly into the `trackedPlayers` S3
user-metadata value in `packages/scout-for-lol/packages/backend/src/storage/s3.ts`
and the other S3 writers. User metadata is transported as HTTP headers.

Representative live events identify the offending values:

- `AmiLama, Lord ARKΞV`: `Ξ` is rejected by Node's header validation.
- `H6 Hadès, H6 lasco`: `è` passes the header check but the bytes used by the
  request and S3 signature disagree.

This is operationally significant: authoritative raw-match ingest gates the
post-match cursor, so every rejected match is retried and the cursor does not
advance. The issue groups are split by match ID, which makes one bug look like
many.

The durable fix is to store only the ASCII decimal tracked-player count through
one shared helper, use it in every S3 writer, and retain a legacy reader in the
only metadata consumer,
`packages/scout-for-lol/packages/backend/scripts/discover-marketing-showcase.ts`.

### CI noise: game-image smoke tests report expected token failures

The Pokemon and Mario Kart issue groups had 295 combined events and received
new events within one minute of this review. Follow-up inspection showed these
are not production authentication failures:

- Recent event `server_name` values are short-lived Docker container IDs.
- Older events identify the `dagger` CI environment.
- Both image smoke tests deliberately start the real production image with
  dummy Discord and userbot tokens so they can assert the expected login
  failure.
- Both live production pods were ready with zero restarts and logged successful
  userbot authentication. Their 1Password item versions were unchanged.

The fix is to explicitly clear `SENTRY_DSN` inside each smoke container so the
deliberate dummy-token failure remains a local CI assertion. No token rotation
or production restart is warranted.

### Already fixed: TaskNotes crash-reproduction events

The two TaskNotes issues are the same duplicate-React startup crash:

- React `19.2.7` vs `react-native-renderer` `19.2.3`.
- The downstream `Cannot read property 'default' of undefined` render failure.

Their event payloads contain a local
`.claude/worktrees/xcc-crash-repro/.../main.jsbundle` path, so these are
reproduction events rather than field reports. Commit `7ecdcb793` / PR #1623
is on `main`, forces Metro to resolve React from the app-local `node_modules`,
and was verified with a booting Release simulator build. These Bugsink issues
can be resolved.

### Lower priority or stale

- Scout Riot API HTTP 520s: two groups, 8,981 events, last seen 2026-07-24.
  These are upstream failures from both beta and prod, not the current S3
  incident. Resolve after recovery and consider aggregating or muting the
  expected upstream failure signal.
- Scout spectator circuit open: 168 events, last seen 2026-07-17 after five
  consecutive upstream failures.
- Scout pre-match lock force-reset: four events, last seen 2026-07-24. Keep open
  for a separate lock-contention investigation if it recurs.
- Temporal connection refused: five startup events since May, last seen
  2026-07-21. This looks like restart ordering against Temporal port 7233 and
  can be resolved unless it recurs outside startup.
- Streambot: six duplicate-interaction acknowledgements and one expired
  interaction, both last seen 2026-07-19; one one-off unhandled ffmpeg exit on
  2026-07-25 with no in-app frame or useful input context. Resolve the
  interaction issues; retain the ffmpeg issue only to compare against a
  recurrence.
- The remaining Scout issues are low-volume stale reports: one prompt-policy
  rejection, one browser `Load failed`, and the old `filters` contract-skew
  crash addressed by the lockstep stage deployment work in PR #1567.

## Session Log — 2026-07-25

### Done

- Queried every live Bugsink project and grouped all unresolved issues by
  project and root cause.
- Inspected representative latest events, stacktraces, releases, tags, and
  breadcrumbs for the active issue clusters.
- Verified the Scout S3 failure against current source, attributed the Discord
  events to CI smoke containers, confirmed both production pods are healthy,
  and verified the TaskNotes fix on `main`.
- Implemented the approved Scout metadata and CI-smoke remediation in draft PR
  #1633, with storage, typecheck, lint, affected-repository, Docker-build, and
  container-smoke verification.
- Made no Bugsink issue, credential, cluster, deployment, or production
  application changes.

### Remaining

- Merge and deploy PR #1633, verify the affected Scout matches drain in beta,
  promote the lockstep release, and confirm the Discord groups receive no new
  events after the next image smokes.
- Resolve the historical Bugsink groups only after those live checks pass.

### Caveats

- This is a live snapshot; the Scout S3 counters were increasing during the
  review.
- Bugsink resolution/muting was intentionally left unchanged until the fixes
  are deployed and verified.
