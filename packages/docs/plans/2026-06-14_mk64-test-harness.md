# Make `e2e-perf-browser.ts` the fix-validation harness for mario-kart streaming

## Status

Partially Complete — CI green, PR ready for human review. Post-merge live-cluster verification still pending.

## Context

PR #1128 (merged) shipped a comprehensive send-side metric set on the
mario-kart streamer pod — `stream_ffmpeg_speed_ratio`, `stream_ffmpeg_fps`,
`stream_ffmpeg_bitrate_kbps`, `stream_frame_interval_ms`,
`stream_frame_write_ms`, `stream_sink_buffer_bytes`, `stream_active`,
`stream_send_frametime_ratio{kind}`, `stream_send_late_frames_total{kind}`,
`stream_hw_encode_engaged` — plus the burned-in overlay + per-seat HUD.
The 2026-06-12 investigation log confirmed the backend pipeline is clean
under normal load. Perceived lag attributes to Discord Go-Live viewer
buffering and is not actionable from our side.

What's missing is **the ability to test fixes**. When the next stream-side
change lands (encoder tune, VAAPI knobs, bitrate change, frame-pacing tweak,
WebRTC config), we need a single command that:

1. drives the streamer with reproducible load,
2. harvests **both** emulator and stream metrics over a known window,
3. emits a structured summary that can be diffed against a previous run.

Today `packages/discord-plays-mario-kart/packages/backend/scripts/e2e-perf-browser.ts`
does (1) and (2) but only for the **emulator** side — it summarises
`emulator_*` metrics and prints frame rate / p95 emulate / resync counts.
Stream-side numbers from PR #1128 are right there in `/metrics` but the
script ignores them, so a fix can't be verified end-to-end without opening
Grafana.

This plan closes that loop in one PR.

## Scope (deliberately tight)

- Extend `e2e-perf-browser.ts` to harvest the existing `stream_*` metrics.
- Print + persist a structured summary JSON.
- Add a `--compare <baseline.json>` mode that prints a side-by-side delta
  table.
- That's it. No new Prometheus metrics. No new dashboard panels. No new
  bot. No k8s changes.

## Approach

### 1 · Enlarge the metric corpus the script scrapes

`packages/discord-plays-mario-kart/packages/backend/scripts/e2e-perf-browser.ts`

The script already pulls `/metrics` from the spawned backend (or `--target`
URL) and parses out emulator counters. Add the existing PR #1128 stream
metrics to that scrape, summarised over the measurement window
(`MEASURE_SECONDS`, default 30s):

| Metric                                                | Summary                         |
| ----------------------------------------------------- | ------------------------------- |
| `stream_active`                                       | last sample (sanity: must be 1) |
| `stream_ffmpeg_speed_ratio`                           | min, mean, last                 |
| `stream_ffmpeg_fps`                                   | min, mean                       |
| `stream_ffmpeg_bitrate_kbps`                          | mean                            |
| `stream_hw_encode_engaged`                            | last (0/1)                      |
| `stream_frame_interval_ms`                            | p50, p95                        |
| `stream_frame_write_ms`                               | p95                             |
| `stream_sink_buffer_bytes`                            | max                             |
| `stream_send_frametime_ratio{kind="video"}`           | p50, p95                        |
| `stream_send_frametime_ratio{kind="audio"}`           | p50, p95                        |
| `stream_send_late_frames_total{kind="video"}` (delta) | counter delta over the window   |
| `stream_send_late_frames_total{kind="audio"}` (delta) | counter delta over the window   |
| `emulator_input_apply_delay_ms`                       | p50, p95 (already partly there) |
| `controller_rtt_ms`                                   | p50, p95                        |

Use the histogram `_bucket` series + `histogram_quantile()`-equivalent
arithmetic the script already does for emulator histograms; histograms are
already in the right exposition format and the parsing code can be
generalised. Counters and gauges are simpler — diff two snapshots.

### 2 · Structured output

Same script, end of run:

- print a compact, copyable table (existing console output stays)
- additionally write a JSON file: `bench-<utc-ts>.json` in the cwd by
  default, or at `--out <path>` if specified

JSON shape:

```json
{
  "ts": "2026-06-14T05:30:00Z",
  "target": "https://mariokart.sjer.red",
  "duration_sec": 30,
  "seats": 4,
  "git": { "sha": "…", "branch": "…", "dirty": false },
  "emulator": { "fps_mean": …, "emulate_ms_p95": …, "resync_total_delta": … },
  "stream":   { "ffmpeg_speed_ratio_mean": …, "frame_interval_ms_p95": …, "send_frametime_ratio_video_p95": …, … },
  "input":    { "controller_rtt_ms_p95": …, "input_apply_delay_ms_p95": … }
}
```

Capture `git sha`, branch, and dirty state with `$ git rev-parse HEAD` etc.
so a JSON file in a stash directory always knows which build it measured.

### 3 · `--compare <baseline.json>` mode

Loads the baseline, runs the live measurement, then prints a delta table:

```
metric                                  baseline      this run      Δ        verdict
stream.ffmpeg_speed_ratio_mean          0.998         1.001         +0.003   ok
stream.frame_interval_ms_p95            38.4          33.6          -4.8     improved
stream.send_frametime_ratio_video_p95   0.94          0.78          -0.16    improved
stream.send_late_frames_video_delta     5             0             -5       improved
…
```

`verdict` column is computed per-metric using a small lookup of
"higher-is-better" vs "lower-is-better" and a configurable significance
threshold (default ±5% relative). Pure arithmetic — no statistics, no
significance testing yet.

This is the "test our fixes" loop:

```bash
# baseline before the fix
bun run e2e:perf:browser --target https://mariokart.sjer.red --out before.json

# … hack on the fix, deploy …

# after the fix
bun run e2e:perf:browser --target https://mariokart.sjer.red --compare before.json
```

### 4 · Make `--target https://mariokart.sjer.red` actually work for /metrics

Today `e2e-perf-browser.ts` hits `${TARGET_URL}/metrics`. The prod ingress
at `mariokart.sjer.red` only serves the controller SPA — `/metrics` is
internal to the pod (8081 inside the cluster, not exposed publicly). Two
clean options; pick the one that already exists in the repo:

- If there's a `/metrics` route exposed through Tailscale ingress for the
  mario-kart service: use that URL directly (`--metrics-url <url>` flag).
- Otherwise: when `--target` is the public URL, default
  `--metrics-url` to `http://localhost:8081/metrics` and document that the
  user must run `kubectl -n mario-kart port-forward svc/mario-kart 8081`
  alongside.

The script should fail-fast with a clear message if `/metrics` doesn't
respond, naming the port-forward command in the error.

## Reused building blocks (do not duplicate)

- 4-player driver, PinchTab tab open/eval, seat-click + steering spam loop
  — `packages/discord-plays-mario-kart/packages/backend/scripts/e2e-perf-browser.ts`
  (the whole file; just extending it).
- Prometheus metric names and label sets — already defined at
  `packages/discord-plays-mario-kart/packages/backend/src/observability/metrics.ts`.
- Histogram quantile arithmetic — the existing emulator-side code in the
  same script.

## Verification

In order, none of it requires touching prod state:

1. **Unit-ish**: feed a recorded `/metrics` snapshot (committed under
   `packages/discord-plays-mario-kart/packages/backend/scripts/__fixtures__/metrics-sample.txt`)
   into the new parser and assert the JSON summary matches a golden file.
   Add to `packages/discord-plays-mario-kart/packages/backend/src/**/*.test.ts`.
2. **Local-backend run**: `bun run e2e:perf:browser` (default target =
   local spawn). The local perf config disables the real stream (`stream.enabled =
false`), so the stream block of the JSON will be all-zero / "stream not
   running" — verify the script reports that cleanly rather than crashing
   on missing series.
3. **Live-cluster run**: `kubectl -n mario-kart port-forward svc/mario-kart
8081 &` then `bun run e2e:perf:browser --target https://mariokart.sjer.red
--metrics-url http://localhost:8081/metrics --out test.json`. The
   resulting JSON should show non-trivial values for every stream metric.
4. **Compare**: copy `test.json` to `baseline.json`, rerun with `--compare
baseline.json`, expect a table where every Δ is ~0 (same build, same
   load).
5. **Round-trip a real change**: before/after a deliberate regression
   (e.g., set the local perf config's emulator FPS lower) — confirm the
   compare table flags the regressions, not the no-ops.

## Explicitly out of scope

- New Prometheus metrics. PR #1128's set is enough for fix validation; if
  a metric turns out to be missing, file it as a separate follow-up.
- Discord-viewer-side measurement (`/Users/jerred/.claude/scratch/discord-latency-poc/`
  was the wrong direction and is abandoned; the directory can be deleted).
- A new k8s deployment, chart, image-build pipeline, or "measurement bot".
- WebRTC `getStats()` on the PeerConnection. The hook exists 2 indirections
  away (`packages/discord-video-stream/src/client/voice/WebRtcWrapper.ts:101`)
  but is not needed to test a fix on the existing metric corpus.

## Worktree

Land via a feature worktree per the SessionStart reminder:
`git worktree add .claude/worktrees/mk64-test-harness -b feature/mk64-test-harness origin/main`,
`bun run scripts/setup.ts` in the fresh checkout. One PR — script edit, one
fixture, one test, one short README update at the top of the script.

## Session Log — 2026-06-14

### Done

- Captured a real `/metrics` snapshot from the live `mario-kart` pod
  (`scripts/__fixtures__/metrics-sample.txt`) so the unit test exercises a
  real exposition shape including labeled histograms
  (`stream_send_frametime_ratio{kind=video|audio}`) and the real-world
  encoder-choking gauge values (`stream_ffmpeg_speed_ratio` ≈ 0.57).
- New library at
  `packages/discord-plays-mario-kart/packages/backend/scripts/lib/`:
  - `bench-metrics.ts` — Prometheus text-format parser
    (`counter`/`gauge`/`histogramQuantile` with label-set matching), gauge
    polling helpers, `BenchSummary` shape + `buildSummary()` +
    `gitMetadata()` + Zod-backed `parseBenchSummary()`.
  - `bench-compare.ts` — `compareSummaries()` (directional verdicts with
    ±5% relative significance threshold) + `renderCompareTable()`.
  - `perf-config.ts` — extracted the local-backend perf TOML writer.
- `e2e-perf-browser.ts` refactored:
  - New flags: `--metrics-url <url>` (decoupled from `--target`),
    `--out <path>`, `--compare <baseline.json>`.
  - Gauge poller (1 Hz) running across the measurement window so we get
    `min`/`mean` for `stream_ffmpeg_speed_ratio`/`fps`/`bitrate_kbps` and
    `max` for `stream_sink_buffer_bytes`, not just last-sample values.
  - Output: detailed console table + `bench-<utc-ts>.json` (also written
    when `--out` is set); `--compare` adds a side-by-side delta table and
    exits non-zero when any metric regressed.
  - Friendly fail-fast message when `/metrics` doesn't respond, naming the
    `kubectl -n mario-kart port-forward svc/mario-kart-ui-service
18081:8081` command.
- Tests: 10 new unit tests against the captured fixture
  (`scripts/lib/bench-metrics.test.ts`) covering counter/gauge/histogram
  parsing with and without labels, summary building, and
  improved/regressed/ok verdicts. All 108 backend tests pass.
  `bun run typecheck` clean; `bunx eslint scripts/ src/` clean.

### Remaining

- **Live-cluster verification (post-merge)**: the live mario-kart pod was
  in an active encoder-choking state during this session
  (`stream_ffmpeg_speed_ratio` ≈ 0.39–0.55 sustained, sub-realtime; 2
  pod restarts in 30 min). Running synthetic 4-tab load against prod
  while it's in that state would only worsen it, so the runbook
  verification (steps 3–5 of the plan's Verification section) is deferred
  to the user when the live stream is healthy or quiet enough to absorb
  the load briefly. The expected procedure is documented in the plan.
- **Local-backend run** (step 2) is also unrun; it requires a built
  frontend dist and wasm + a resolvable ROM. The script's graceful
  handling of missing stream metrics (when local backend has
  `stream.enabled = false`) is covered by the existing fixture tests
  (null-valued gauges flow through `summariseGauge` → `null` cleanly).

### Caveats

- The captured prod /metrics snapshot in `__fixtures__/metrics-sample.txt`
  was taken while the encoder was below realtime, which is exactly the
  signal we want the harness to surface — but anyone updating the fixture
  later should re-capture during healthy operation or the test assertions
  may need adjusting.
- `--compare` exit code 2 is used to distinguish "ran cleanly but
  regression detected" from "harness errored" (1). Wiring this into CI as
  a gate would need a small policy decision (block merge on any
  regression vs. only on certain metrics).
- The lifetime-quantile approximation is unchanged from the original
  script: histograms are read at end-of-window, not delta'd between
  start/end. For a freshly-restarted pod or low-baseline window this is
  fine; for long-running pods the absolute quantile may dilute the
  window's signal. Worth revisiting if `--compare` results look noisy.

## Session Log — 2026-06-13 (PR monitoring / Greptile fixes)

### Done

- Tended PR #1202 (`feature/mk64-test-harness`) through full CI green.
- Identified and fixed 2 Greptile P2 inline comments on commit 7939465c:
  1. Stale plan path in `e2e-perf-browser.ts` line 8: `2026-06-13-mk64-test-harness.md` →
     `2026-06-14_mk64-test-harness.md` (wrong date + wrong separator).
  2. Missing version mismatch warning in `compareSummaries()` in `bench-compare.ts`:
     added a `process.stderr.write(...)` guard when `baseline.version !== current.version`.
- Committed as `fix(discord-plays-mario-kart): address Greptile P2 review feedback`
  (commit 2f8b3bf1), pushed to `feature/mk64-test-harness`.
- Buildkite build #4174 passed in 8m28s (all checks green; knip soft-fail is expected/ignorable).
- Greptile Review GitHub check: pass. No new inline comments on the head commit.
- Merge state: `CLEAN` / `MERGEABLE`.

### Remaining

- **Human review + merge** — PR #1202 is ready.
- **Post-merge live-cluster verification** (plan steps 3–5) — unchanged from original log above.

### Caveats

- The two Greptile inline comments from commit 7939465c are attached to the old commit
  and will show as "unresolved" in the PR thread view, but they were addressed in 2f8b3bf1.
  Greptile's own status check went green after reviewing the new head commit.
