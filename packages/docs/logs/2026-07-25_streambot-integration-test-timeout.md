---
id: 2026-07-25-streambot-integration-test-timeout
type: log
status: in-progress
board: false
---

# streambot subtitle integration test — flaky under CI load (5s hook timeout)

## Goal

Main build #6076's `:docker: images — build, smoke, push` step failed on the
streambot smoke suite. Make the flaky test robust.

## Diagnosis

`packages/streambot/integration/subtitles.integration.test.ts` builds six test
clips in a single `beforeAll` via **sequential real-ffmpeg encodes**. bun's
default hook timeout is **5000ms**. Idle, the fixtures finish in ~1-2s, but on a
CPU-contended CI node (the cluster was hammering through a large backlog) the
`beforeAll` blew 5s, bun SIGTERM'd the in-flight ffmpeg (`command failed (143)`),
and the suite flaked:

```
error: command failed (143): ffmpeg -y -f lavfi -i testsrc=... .../Embedded Movie ... .mkv
a beforeEach/afterEach hook timed out for this test. (5000.77ms)
```

Unrelated to the Kueue/buildkitd infra fixes — purely a test-timeout flake.

## Fix

- `subtitles.integration.test.ts`: give the fixture-building `beforeAll` an
  explicit generous `120_000`ms timeout.
- `package.json`: `test:integration` → `bun test --timeout 120000 integration/`,
  so the per-test ffmpeg-heavy cases (HDR tonemap chain, VAAPI proxy composite)
  get the same headroom under load.

120s is enormous vs the real ~2s runtime — it only ever bites when the node is
badly contended, so there's no downside to the slack.

## Verification

Ran `bun test --timeout 120000 integration/` locally: `beforeAll` completed all
six encodes with no hook timeout and 8 tests passed in ~2s. The 5 failures are
local-only — homebrew ffmpeg lacks the `subtitles`/libass filter (`No such
filter: 'subtitles'`); the suite is designed to run in the streambot image where
libass/zimg/fonts are present. typecheck + lint green.

## Session Log — 2026-07-25

### Done

- Root-caused the streambot smoke flake to the default 5s `beforeAll` timeout vs
  six sequential ffmpeg encodes under CI contention.
- Added a 120s hook timeout + `--timeout 120000` on `test:integration`; verified
  locally (beforeAll + 8 non-libass tests pass).

### Remaining

- Open PR, merge; confirm the streambot smoke no longer flakes on the next
  `images` build.

### Caveats

- The remaining green-main confirmation is orthogonal: the infra chain is already
  healthy (buildkitd/apps Synced/Healthy); this only removes a smoke-test flake
  that can withhold argocd-sync behind a failed `images` step.
