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
