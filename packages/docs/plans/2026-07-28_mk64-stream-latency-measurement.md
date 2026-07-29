---
id: plan-2026-07-28-mk64-stream-latency-measurement
type: plan
status: in-progress
board: false
---

# MK64 Server-Side Stream Latency Measurement

## Summary

Measure the media pipeline between boundaries owned by the backend, excluding
Discord ingest and playback:

- controller request receipt, raw PCM acceptance, and raw video acceptance;
- encoded NUT packet readiness and RTP send completion.

Use passive packet-timestamp telemetry for continuous attribution and a
calibration run with synchronized flash/chirp markers for exact validation.

## Measurements

| Metric        | Measurement                                                                      |
| ------------- | -------------------------------------------------------------------------------- |
| Audio delay   | Raw chirp PCM accepted to the matching Opus packet becoming ready and being sent |
| Input latency | Controller request received to the first outbound H.264 packet with that state   |
| A/V desync    | Chirp onset PTS minus the corresponding flash PTS; positive means audio lags     |

The calibration run warms up the encoder, then emits repeated pulses. Each
pulse applies an ordinary controller transition, draws a high-contrast marker
on the resulting video, and mixes a recognizable chirp into audio from the same
emulator tick.

## Implementation

- Extend the optional stream observer with packet PTS/duration events and add
  PTS to send statistics.
- Correlate controller receipt, emulator application, source media position,
  encoded packet PTS, and send completion without high-cardinality metric
  labels.
- Capture and decode the NUT output only during calibration, detect flash/chirp
  markers, and produce machine-readable and human-readable summaries.
- Keep the calibration operator-invoked through the existing performance
  harness. Do not add a public controller endpoint or automate a Discord
  viewer.
- Retain passive input-apply, queue-depth, dropped-frame, encoder-speed, and
  sender-behind signals during ordinary production sessions.

## Verification

- A zero-offset synthetic stream must report sync within one video frame and
  one Opus packet.
- Known audio and video delays must be recovered with the correct magnitude and
  sign within media quantization.
- Evicted marked frames must either increase the measured delay or be reported
  explicitly as missed markers.
- Automated tests use the software encoder; the live acceptance run exercises
  the deployed VAAPI path.
- Initial performance results are report-only. A stable live baseline will
  define later regression thresholds; the existing 60 ms sender-sync tolerance
  is the initial A/V health boundary.

## Session Log — 2026-07-28

### Done

- Approved the server-owned measurement boundaries and calibration approach.
- Added encoded-packet PTS/duration and RTP-send PTS checkpoints to the shared
  stream observer.
- Correlated raw video, raw PCM, controller receipt, encoded packets, and sends
  through the Worker and latest-frame queue. Input carried by an evicted frame
  is attributed to the next visible frame.
- Added passive Prometheus metrics and browser performance-summary fields for
  packet-ready delay, send-complete delay, input latency, signed A/V
  source-content offset, and correlation failures.
- Added the `e2e:stream-latency` flash/chirp calibration harness and JSON
  report. The software pipeline measured `-1.0 ms` A/V p50 at baseline,
  recovered an injected `+100 ms` audio delay as `+99.3 ms`, and recovered
  three delayed video frames as `-101.0 ms`.
- Passed MK64 backend typecheck, lint, and 137 tests; MK64 root checks;
  discord-video-stream build, typecheck, and 60 tests; and streambot typecheck,
  lint, and 384 package tests.
- Published code commit `15ac4124b` to PR #1779 and deployed its immutable
  image to the live Kubernetes workload for acceptance.
- Ran a 30-second, four-controller live VAAPI acceptance sample. It sustained
  29.95 emulator fps, reported hardware encoding engaged, recorded 903 ticks,
  populated packet/send and input-to-stream histograms, and recorded zero
  correlation failures.
- Reproduced the reported lag objectively: packet-ready, send-complete, and
  input-to-stream p95 values fell in the `<=2500 ms` bucket. Signed A/V content
  offset averaged `-198.5 ms` (`-263.6` to `-180.8 ms`), meaning video content
  lagged audio at the server-owned stream boundary.
- Recorded the calibration output as an
  [asciinema artifact](https://public.sjer.red/pr/assets/1779/mk64-stream-latency.cast.html).
- Stopped the Discord test session, closed the browser and port forwards, and
  restored Argo CD automated reconciliation. The Application returned to
  `Synced / Healthy` on declared image `2.0.0-6874`.
- Replaced dynamic metric-name regular expressions with a literal,
  line-oriented Prometheus parser after Buildkite Semgrep rejected the first
  implementation. The focused parser suite passes 11 tests, typecheck, and
  lint.

### Remaining

- [ ] Wait for replacement current-head Buildkite CI and human review of
      PR #1779.
- [ ] Use the new evidence to design the separate video-latency reduction; this
      plan measures and attributes latency but does not change buffering policy.

### Caveats

- The ROM-backed and live VAAPI checks are not CI-portable.
- The synthetic calibration validates the same H.264/Opus/NUT media boundary
  but uses the software encoder locally; VAAPI is covered by the live run.
- Prometheus histogram quantiles report the configured bucket boundary, so the
  live `2500 ms` p95 values are upper bounds rather than exact percentiles.
- Discord transport and client playback remain intentionally excluded. The
  measured `-198.5 ms` offset and stream delays exist before Discord receives
  the RTP packets.
